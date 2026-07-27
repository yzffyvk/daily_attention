import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);
const ownedUsers = new Map<string, string>();
const rateBuckets = new Set<string>();
const reservedIntegrationEmail = /^integration-[0-9]+@integration\.daily-attention\.invalid$/u;

export function uniqueEmail(seed: number) {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("Integration email seed must be a non-negative integer");
  return `integration-${seed}@integration.daily-attention.invalid`;
}

export function trackIntegrationUser(userId: string, email: string) {
  if (!reservedIntegrationEmail.test(email)) {
    throw new Error("Cannot track non-reserved integration email ownership");
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
  for (const [userId, email] of ownedUsers) {
    if (!reservedIntegrationEmail.test(email)) {
      throw new Error("Refusing to clean up a non-reserved integration email");
    }
    const { data, error: readError } = await admin.auth.admin.getUserById(userId);
    if (readError || !data.user || data.user.email !== email) {
      throw new Error("Integration cleanup ownership no longer matches the current Auth email");
    }
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw error;
  }

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
