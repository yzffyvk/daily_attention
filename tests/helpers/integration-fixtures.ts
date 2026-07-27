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
const authUserPageLimit = 10_000;

type IntegrationOwnership = { userId: string; email: string };
type IntegrationAdmin = {
  auth: {
    admin: {
      getUserById(userId: string): Promise<{
        data: { user: { id: string; email?: string } | null };
        error: unknown;
      }>;
      deleteUser(userId: string): Promise<unknown>;
      listUsers(parameters: { page: number; perPage: number }): Promise<unknown>;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSuccessfulDeleteResult(value: unknown) {
  return (
    isRecord(value)
    && Object.prototype.hasOwnProperty.call(value, "error")
    && value.error === null
  );
}

async function verifyCurrentIntegrationOwner(
  admin: IntegrationAdmin,
  entry: IntegrationOwnership,
) {
  let response;
  try {
    response = await admin.auth.admin.getUserById(entry.userId);
  } catch {
    throw new Error("Integration cleanup ownership does not match the current Auth user");
  }
  if (
    response.error
    || !response.data.user
    || response.data.user.id !== entry.userId
    || response.data.user.email !== entry.email
  ) {
    throw new Error("Integration cleanup ownership does not match the current Auth user");
  }
}

async function listIntegrationAuthUsers(admin: IntegrationAdmin) {
  const users: Array<Record<string, unknown> & { id: string }> = [];
  const seenPages = new Set<number>();
  const seenUserIds = new Set<string>();
  let expectedLastPage: number | undefined;
  let expectedTotal: number | undefined;
  let page = 1;

  while (true) {
    if (seenPages.has(page) || seenPages.size >= authUserPageLimit) {
      throw new Error("Unable to verify integration Auth cleanup");
    }
    seenPages.add(page);

    let response;
    try {
      response = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    } catch {
      throw new Error("Unable to verify integration Auth cleanup");
    }
    if (
      !isRecord(response)
      || !Object.prototype.hasOwnProperty.call(response, "error")
      || response.error !== null
      || !isRecord(response.data)
      || !Object.prototype.hasOwnProperty.call(response.data, "users")
      || !Object.prototype.hasOwnProperty.call(response.data, "nextPage")
      || !Object.prototype.hasOwnProperty.call(response.data, "lastPage")
      || !Object.prototype.hasOwnProperty.call(response.data, "total")
      || !Array.isArray(response.data.users)
      || typeof response.data.lastPage !== "number"
      || !Number.isSafeInteger(response.data.lastPage)
      || response.data.lastPage < 0
      || typeof response.data.total !== "number"
      || !Number.isSafeInteger(response.data.total)
      || response.data.total < 0
      || (
        response.data.nextPage !== null
        && (
          typeof response.data.nextPage !== "number"
          || !Number.isSafeInteger(response.data.nextPage)
          || response.data.nextPage < 1
        )
      )
    ) {
      throw new Error("Unable to verify integration Auth cleanup");
    }

    const { lastPage, nextPage, total } = response.data;
    if (
      (expectedLastPage !== undefined && lastPage !== expectedLastPage)
      || (expectedTotal !== undefined && total !== expectedTotal)
      || (total === 0 && lastPage !== 0)
      || (total > 0 && lastPage < 1)
    ) {
      throw new Error("Unable to verify integration Auth cleanup");
    }
    expectedLastPage ??= lastPage;
    expectedTotal ??= total;

    for (const user of response.data.users) {
      if (
        !isRecord(user)
        || typeof user.id !== "string"
        || !userIdPattern.test(user.id)
        || seenUserIds.has(user.id)
      ) {
        throw new Error("Unable to verify integration Auth cleanup");
      }
      seenUserIds.add(user.id);
      users.push(user as Record<string, unknown> & { id: string });
    }
    if (users.length > total) {
      throw new Error("Unable to verify integration Auth cleanup");
    }

    if (nextPage !== null) {
      if (
        nextPage !== page + 1
        || nextPage > lastPage
        || page >= lastPage
        || users.length >= total
      ) {
        throw new Error("Unable to verify integration Auth cleanup");
      }
      page = nextPage;
      continue;
    }

    if (
      users.length !== total
      || (
        total === 0
          ? lastPage !== 0 || page !== 1
          : page !== lastPage
      )
    ) {
      throw new Error("Unable to verify integration Auth cleanup");
    }
    return users;
  }
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
    await verifyCurrentIntegrationOwner(admin, entry);
    verifiedOwnership.push(entry);
  }

  for (const entry of verifiedOwnership) {
    await verifyCurrentIntegrationOwner(admin, entry);
    let response;
    try {
      response = await admin.auth.admin.deleteUser(entry.userId);
    } catch {
      throw new Error("Unable to delete an owned integration user");
    }
    if (!isSuccessfulDeleteResult(response)) {
      throw new Error("Unable to delete an owned integration user");
    }

    const usersAfterDelete = await listIntegrationAuthUsers(admin);
    if (usersAfterDelete.some((user) => user.id === entry.userId)) {
      throw new Error("Integration Auth cleanup did not complete");
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
