import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);
const ownedUsers = new Map<string, string>();
const rateBuckets = new Set<string>();
const integrationRunScopePattern = /^[0-9a-f]{16}$/u;
const reservedIntegrationEmail = /^integration-[0-9a-f]{16}-[0-9]+@integration\.daily-attention\.invalid$/u;
const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type IntegrationOwnership = { userId: string; email: string };
type IntegrationAdmin = {
  auth: {
    admin: {
      getUserById(userId: string): Promise<{
        data: { user: { id: string; email?: string } | null };
        error: unknown;
      }>;
      deleteUser(userId: string): Promise<{
        data: unknown;
        error: unknown;
      }>;
      listUsers(parameters: { page: number; perPage: number }): Promise<{
        data: { users: Array<{ id: string; email?: string }> };
        error: unknown;
      }>;
    };
  };
};

export function uniqueEmail(seed: number) {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("Integration email seed must be a non-negative integer");
  const scope = process.env.INTEGRATION_RUN_SCOPE;
  if (!scope || !integrationRunScopePattern.test(scope)) {
    throw new Error("Integration run scope is unavailable");
  }
  return `integration-${scope}-${seed}@integration.daily-attention.invalid`;
}

export function trackIntegrationUser(userId: string, email: string) {
  if (!userIdPattern.test(userId) || !reservedIntegrationEmail.test(email)) {
    throw new Error("Cannot track invalid integration ownership");
  }
  const existing = ownedUsers.get(userId);
  if (existing && existing !== email) {
    throw new Error("Conflicting integration email ownership");
  }
  for (const [ownedUserId, ownedEmail] of ownedUsers) {
    if (ownedUserId !== userId && ownedEmail === email) {
      throw new Error("Conflicting integration email ownership");
    }
  }
  ownedUsers.set(userId, email);
}

export function confirmIntegrationAuthOwnership(
  user: { id?: unknown; email?: unknown },
  expectedEmail: string,
): IntegrationOwnership {
  if (
    !user
    || typeof user.id !== "string"
    || !userIdPattern.test(user.id)
    || typeof user.email !== "string"
    || user.email !== expectedEmail
    || !reservedIntegrationEmail.test(expectedEmail)
  ) {
    throw new Error("Integration Auth ownership does not match the expected fixture");
  }
  return { userId: user.id, email: expectedEmail };
}

export async function deleteOwnedIntegrationUsers(
  admin: IntegrationAdmin,
  ownership: ReadonlyArray<IntegrationOwnership>,
) {
  const verifiedOwnership: IntegrationOwnership[] = [];
  for (const entry of ownership) {
    if (!userIdPattern.test(entry.userId) || !reservedIntegrationEmail.test(entry.email)) {
      throw new Error("Refusing to clean up invalid integration ownership");
    }
    const { data, error } = await admin.auth.admin.getUserById(entry.userId);
    if (
      error
      || !data.user
      || data.user.id !== entry.userId
      || data.user.email !== entry.email
    ) {
      throw new Error("Integration cleanup ownership does not match the current Auth user");
    }
    verifiedOwnership.push(entry);
  }

  for (const entry of verifiedOwnership) {
    let response;
    try {
      response = await admin.auth.admin.deleteUser(entry.userId);
    } catch {
      throw new Error("Unable to delete an owned integration user");
    }
    if (response.error) throw new Error("Unable to delete an owned integration user");

    for (let page = 1; ; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (
        error
        || !data
        || !Array.isArray(data.users)
        || data.users.some((user) => (
          !user
          || typeof user.id !== "string"
          || !userIdPattern.test(user.id)
        ))
      ) {
        throw new Error("Unable to verify integration Auth cleanup");
      }
      if (data.users.some((user) => user.id === entry.userId)) {
        throw new Error("Integration Auth cleanup did not complete");
      }
      if (data.users.length < 1000) break;
    }
  }
}

export function trackIntegrationRateBucket(action: "register" | "login" | "recover" | "rotate", bucket: string) {
  rateBuckets.add(`${action}:${bucket}`);
}

export async function cleanupIntegrationFixtures() {
  const url = process.env.TEST_SUPABASE_URL;
  const secretKey = process.env.TEST_SUPABASE_SECRET_KEY;
  const pepper = process.env.AUTH_RATE_LIMIT_PEPPER;
  if (!url || !secretKey || !pepper) throw new Error("Missing integration cleanup bindings");

  const admin = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  await deleteOwnedIntegrationUsers(
    admin,
    [...ownedUsers].map(([userId, email]) => ({ userId, email })),
  );

  if (rateBuckets.size === 0) return;
  const entries = [...rateBuckets].map((entry) => {
    const separator = entry.indexOf(":");
    const action = entry.slice(0, separator);
    const bucket = entry.slice(separator + 1);
    const digest = createHmac("sha256", pepper).update(`${action}:${bucket}`).digest("hex");
    return `(decode('${digest}', 'hex'), '${action}')`;
  });
  await execFileAsync(process.platform === "win32" ? "npx.cmd" : "npx", [
    "supabase",
    "db",
    "query",
    "--local",
    `delete from private.auth_rate_limits where (bucket_digest, action) in (${entries.join(",")});`,
  ], { cwd: process.cwd() });
}
