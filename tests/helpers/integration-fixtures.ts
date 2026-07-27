import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import {
  cleanupIntegrationUserRegistry,
  deleteOwnedIntegrationUsers as deleteRegistryUsers,
  localIntegrationApiUrl,
  readIntegrationUserRegistry,
  trackIntegrationUserInRegistry,
} from "../../scripts/integration-user-registry.mjs";

const execFileAsync = promisify(execFile);
const rateBuckets = new Set<string>();
const integrationRunScopePattern = /^[0-9a-f]{16}$/u;
const reservedIntegrationEmail = /^integration-[0-9a-f]{16}-[0-9]+@integration\.daily-attention\.invalid$/u;
const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type IntegrationOwnership = { userId: string; email: string };
type IntegrationAdmin = {
  auth: {
    admin: {
      getUserById(userId: string): Promise<unknown>;
      deleteUser(userId: string): Promise<unknown>;
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
  const registryFile = process.env.INTEGRATION_USER_REGISTRY_FILE;
  if (!registryFile) {
    throw new Error("Integration ownership registry is unavailable");
  }
  trackIntegrationUserInRegistry(registryFile, { userId, email });
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
  checkpoint?: (remaining: ReadonlyArray<IntegrationOwnership>) => void,
) {
  await deleteRegistryUsers(admin, ownership, checkpoint);
}

export { readIntegrationUserRegistry };

export function trackIntegrationRateBucket(action: "register" | "login" | "recover" | "rotate", bucket: string) {
  rateBuckets.add(`${action}:${bucket}`);
}

export async function cleanupIntegrationFixtures() {
  const url = process.env.TEST_SUPABASE_URL;
  const secretKey = process.env.TEST_SUPABASE_SECRET_KEY;
  const pepper = process.env.AUTH_RATE_LIMIT_PEPPER;
  const registryFile = process.env.INTEGRATION_USER_REGISTRY_FILE;
  if (!url || !secretKey || !pepper || !registryFile) {
    throw new Error("Missing integration cleanup bindings");
  }
  const apiUrl = localIntegrationApiUrl(url);

  const admin = createClient(apiUrl.origin, secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  await cleanupIntegrationUserRegistry(admin, registryFile);

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
