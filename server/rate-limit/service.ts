export const RATE_LIMITS = {
  register: { attempts: 5, windowSeconds: 3600 },
  login: { attempts: 10, windowSeconds: 900 },
  recover: { attempts: 5, windowSeconds: 1800 },
  rotate: { attempts: 5, windowSeconds: 3600 },
} as const;

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
  if (error) throw error;
  const result = (data as Array<{ allowed: boolean; retry_after_seconds: number }>)[0];
  if (!result.allowed) {
    throw Object.assign(new Error("RATE_LIMITED"), {
      code: "RATE_LIMITED",
      retryAfterSeconds: result.retry_after_seconds,
    });
  }
}
