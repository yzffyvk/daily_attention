import "server-only";

export const RATE_LIMITS = {
  register: { attempts: 5, windowSeconds: 3600 },
  login: { attempts: 10, windowSeconds: 900 },
  recover: { attempts: 5, windowSeconds: 1800 },
  rotate: { attempts: 5, windowSeconds: 3600 },
} as const;

type RateLimitRpcResult = { allowed: boolean; retry_after_seconds: number };

function isRateLimitRpcResult(value: unknown): value is RateLimitRpcResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  if (typeof result.allowed !== "boolean") return false;
  if (!Number.isSafeInteger(result.retry_after_seconds) || result.retry_after_seconds < 0) return false;
  return result.allowed ? result.retry_after_seconds === 0 : result.retry_after_seconds > 0;
}

function isSupabaseRpcError(value: unknown): value is { message: string } {
  return !!value && typeof value === "object" && typeof (value as Record<string, unknown>).message === "string";
}

export async function bucketDigest(action: string, rawBucket: string) {
  const pepper = process.env.AUTH_RATE_LIMIT_PEPPER;
  if (!pepper) throw new Error("Missing AUTH_RATE_LIMIT_PEPPER");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${action}:${rawBucket}`)),
  );
}

export async function consumeRateLimit(
  action: keyof typeof RATE_LIMITS,
  rawBucket: string,
  admin: { rpc: (name: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
) {
  const limit = RATE_LIMITS[action];
  const digest = await bucketDigest(action, rawBucket);
  const { data, error } = await admin.rpc("consume_auth_rate_limit", {
    target_bucket: `\\x${Buffer.from(digest).toString("hex")}`,
    target_action: action,
    target_max_attempts: limit.attempts,
    target_window_seconds: limit.windowSeconds,
  });
  if (error !== null) {
    if (!isSupabaseRpcError(error)) throw new Error("Rate-limit RPC failed");
    throw error;
  }
  if (!Array.isArray(data) || data.length !== 1 || !isRateLimitRpcResult(data[0])) {
    throw new Error("Malformed rate-limit RPC response");
  }
  const result = data[0];
  if (!result.allowed) {
    throw Object.assign(new Error("RATE_LIMITED"), {
      code: "RATE_LIMITED",
      retryAfterSeconds: result.retry_after_seconds,
    });
  }
}
