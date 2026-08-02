import "server-only";

export const RATE_LIMITS = {
  register: { action: "register", attempts: 5, windowSeconds: 3600 },
  login: { action: "login", attempts: 10, windowSeconds: 900 },
  recover: { action: "recover", attempts: 5, windowSeconds: 1800 },
  rotate: { action: "rotate", attempts: 5, windowSeconds: 3600 },
  aiGenerate: { action: "ai_generate", attempts: 10, windowSeconds: 600 },
} as const;

type RateLimitRpcResult = { allowed: boolean; retry_after_seconds: number };
type StorageUploadLimitReason =
  | "RATE_LIMITED"
  | "STORAGE_QUOTA_EXCEEDED";
type StorageUploadLimitRpcResult = {
  allowed: boolean;
  reason: StorageUploadLimitReason | null;
  retry_after_seconds: number;
};
type RpcClient = {
  rpc: unknown;
};

function rpc(
  client: RpcClient,
  name: string,
  params: Record<string, unknown>,
): PromiseLike<{ data: unknown; error: unknown }> {
  if (typeof client.rpc !== "function") {
    throw new Error("RPC client is unavailable");
  }
  const invoke = client.rpc as (
    targetName: string,
    targetParams: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
  return invoke.call(client, name, params);
}

function isRateLimitRpcResult(value: unknown): value is RateLimitRpcResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  const allowed = result.allowed;
  const retryAfterSeconds = result.retry_after_seconds;
  if (typeof allowed !== "boolean") return false;
  if (typeof retryAfterSeconds !== "number" || !Number.isSafeInteger(retryAfterSeconds) || retryAfterSeconds < 0) return false;
  return allowed ? retryAfterSeconds === 0 : retryAfterSeconds > 0;
}

function isSupabaseRpcError(value: unknown): value is { message: string } {
  return !!value && typeof value === "object" && typeof (value as Record<string, unknown>).message === "string";
}

function isStorageUploadLimitRpcResult(
  value: unknown,
): value is StorageUploadLimitRpcResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  const allowed = result.allowed;
  const reason = result.reason;
  const retryAfterSeconds = result.retry_after_seconds;
  if (typeof allowed !== "boolean") return false;
  if (
    typeof retryAfterSeconds !== "number"
    || !Number.isSafeInteger(retryAfterSeconds)
    || retryAfterSeconds < 0
  ) {
    return false;
  }
  if (allowed) return reason === null && retryAfterSeconds === 0;
  if (reason === "RATE_LIMITED") return retryAfterSeconds > 0;
  return reason === "STORAGE_QUOTA_EXCEEDED" && retryAfterSeconds === 0;
}

function throwRpcError(error: unknown, fallback: string) {
  if (!isSupabaseRpcError(error)) throw new Error(fallback);
  throw error;
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
  admin: RpcClient,
) {
  const limit = RATE_LIMITS[action];
  const digest = await bucketDigest(limit.action, rawBucket);
  const { data, error } = await rpc(admin, "consume_auth_rate_limit", {
    target_bucket: `\\x${Buffer.from(digest).toString("hex")}`,
    target_action: limit.action,
    target_max_attempts: limit.attempts,
    target_window_seconds: limit.windowSeconds,
  });
  if (error !== null) {
    throwRpcError(error, "Rate-limit RPC failed");
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

export async function reserveStorageUpload(
  input: { userId: string; path: string; size: number },
  admin: RpcClient,
) {
  const { data, error } = await rpc(admin, "reserve_checkin_image_upload", {
    target_user_id: input.userId,
    target_path: input.path,
    target_size: input.size,
  });
  if (error !== null) {
    throwRpcError(error, "Storage upload limit RPC failed");
  }
  if (
    !Array.isArray(data)
    || data.length !== 1
    || !isStorageUploadLimitRpcResult(data[0])
  ) {
    throw new Error("Malformed storage upload limit response");
  }
  const result = data[0];
  if (!result.allowed) {
    throw Object.assign(new Error("RATE_LIMITED"), {
      code: "RATE_LIMITED",
      reason: result.reason,
      retryAfterSeconds: result.retry_after_seconds,
    });
  }
}

export async function releaseStorageUploadReservation(
  input: { userId: string; path: string },
  admin: RpcClient,
) {
  const { data, error } = await rpc(
    admin,
    "release_checkin_image_upload_reservation",
    {
      target_user_id: input.userId,
      target_path: input.path,
    },
  );
  if (error !== null) {
    throwRpcError(error, "Storage upload reservation release failed");
  }
  if (typeof data !== "boolean") {
    throw new Error("Malformed storage upload reservation release response");
  }
}
