import type { ApiFailure, ApiSuccess } from "@/lib/api/result";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { AccountProfile } from "@/server/auth/ports";
import type { CheckInEntryMode, CheckInInput } from "@/lib/domain/checkin";
import type { CheckInRecord, CheckInStats, CheckInSummary } from "./types";

type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

type ApiErrorOptions = {
  status: number;
  code: string;
  requestId: string;
  details?: Record<string, unknown>;
  current?: CheckInRecord | null;
  field?: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly details?: Record<string, unknown>;
  readonly current?: CheckInRecord | null;
  readonly field?: string;

  constructor(message: string, options: ApiErrorOptions) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.details = options.details;
    this.current = options.current;
    this.field = options.field;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  if (
    !isObject(value) ||
    typeof value.ok !== "boolean" ||
    typeof value.requestId !== "string"
  ) {
    return false;
  }

  if (value.ok) return "data" in value;

  if (!isObject(value.error)) return false;
  if (
    typeof value.error.code !== "string" ||
    typeof value.error.message !== "string"
  ) {
    return false;
  }

  return value.error.details === undefined || isObject(value.error.details);
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function currentRecord(value: unknown): CheckInRecord | null | undefined {
  if (value === null) return null;
  if (!isObject(value)) return undefined;
  if (
    typeof value.id !== "string" ||
    !isDateKey(value.date) ||
    typeof value.attention !== "string" ||
    typeof value.sourceUrl !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.inspiration !== "string" ||
    !isNullableString(value.imagePath) ||
    typeof value.imageName !== "string" ||
    !isNullableString(value.imageUrl) ||
    typeof value.version !== "number" ||
    !Number.isInteger(value.version) ||
    value.version <= 0 ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt)
  ) {
    return undefined;
  }
  return value as CheckInRecord;
}

export async function requestApi<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError("网络连接失败，请检查网络后重试", {
      status: 0,
      code: "NETWORK_ERROR",
      requestId: "",
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError("服务返回内容不正确，请稍后再试", {
      status: response.status,
      code: "MALFORMED_RESPONSE",
      requestId: "",
    });
  }

  if (!isEnvelope(payload)) {
    throw new ApiError("服务返回内容不正确，请稍后再试", {
      status: response.status,
      code: "MALFORMED_RESPONSE",
      requestId: "",
    });
  }

  if (payload.ok) return payload.data as T;

  const details = isObject(payload.error.details) ? payload.error.details : undefined;
  const isVersionConflict = response.status === 409 && payload.error.code === "VERSION_CONFLICT";
  const current = isVersionConflict ? currentRecord(details?.current) : undefined;
  if (isVersionConflict && current === undefined) {
    throw new ApiError("服务返回内容不正确，请稍后再试", {
      status: response.status,
      code: "MALFORMED_RESPONSE",
      requestId: payload.requestId,
    });
  }
  throw new ApiError(payload.error.message, {
    status: response.status,
    code: payload.error.code,
    requestId: payload.requestId,
    details,
    current,
    field: typeof details?.field === "string" ? details.field : undefined,
  });
}

export async function getMonthCheckIns(month: string) {
  return requestApi<CheckInSummary[]>(`/api/checkins?month=${encodeURIComponent(month)}`);
}

export async function getCheckInStats(today: string) {
  return requestApi<CheckInStats>(
    `/api/checkins/stats?today=${encodeURIComponent(today)}`,
  );
}

export async function getCheckIn(date: string, entryMode: CheckInEntryMode = "manual"): Promise<CheckInRecord | null> {
  try {
    return await requestApi<CheckInRecord>(`/api/checkins/${encodeURIComponent(date)}${entryMode === "ai" ? "?mode=ai" : ""}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && error.code === "NOT_FOUND") {
      return null;
    }
    throw error;
  }
}

export async function saveCheckIn(date: string, input: CheckInInput) {
  return requestApi<CheckInRecord>(`/api/checkins/${encodeURIComponent(date)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

type SignedUpload = { path: string; token: string };

export async function uploadCheckInImage(date: string, file: File) {
  const upload = await requestApi<SignedUpload>("/api/uploads/checkin-image", {
    method: "POST",
    body: JSON.stringify({ date, mimeType: file.type, size: file.size }),
  });
  const { error } = await createBrowserSupabase()
    .storage
    .from("checkin-images")
    .uploadToSignedUrl(upload.path, upload.token, file, {
      contentType: file.type,
    });

  if (error) {
    await deleteCheckInImage(upload.path).catch(() => undefined);
    throw new ApiError("图片上传失败，请换一张图片后重试", {
      status: 0,
      code: "UPLOAD_FAILED",
      requestId: "",
    });
  }

  return upload.path;
}

export async function deleteCheckInImage(path: string) {
  await requestApi<Record<string, never>>("/api/uploads/checkin-image", {
    method: "DELETE",
    body: JSON.stringify({ path }),
  });
}

export async function getCurrentProfile() {
  const result = await requestApi<{ profile: AccountProfile }>("/api/me");
  return result.profile;
}

export async function updateCurrentProfile(input: {
  displayName: string;
  avatarKey: number;
}) {
  const result = await requestApi<{ profile: AccountProfile }>("/api/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return result.profile;
}

export async function rotateRecoveryCode(currentPassword: string) {
  const result = await requestApi<{ recoveryCode: string }>(
    "/api/auth/recovery-code/rotate",
    {
      method: "POST",
      body: JSON.stringify({ currentPassword }),
    },
  );
  return result.recoveryCode;
}
