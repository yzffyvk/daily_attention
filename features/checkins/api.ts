import type { ApiFailure, ApiSuccess } from "@/lib/api/result";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { AccountProfile } from "@/server/auth/ports";
import type { CheckInInput } from "@/lib/domain/checkin";
import type { CheckInRecord, CheckInSummary } from "./types";

type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

type ApiErrorOptions = {
  status: number;
  code: string;
  requestId: string;
  current?: CheckInRecord | null;
  field?: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly current?: CheckInRecord | null;
  readonly field?: string;

  constructor(message: string, options: ApiErrorOptions) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.current = options.current;
    this.field = options.field;
  }
}

function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof value.ok === "boolean" &&
    "requestId" in value &&
    typeof value.requestId === "string"
  );
}

function currentRecord(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "object" || value === null) return undefined;
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

  const details = payload.error.details;
  throw new ApiError(payload.error.message, {
    status: response.status,
    code: payload.error.code,
    requestId: payload.requestId,
    current:
      response.status === 409
        ? currentRecord(details?.current)
        : undefined,
    field: details?.field,
  });
}

export async function getMonthCheckIns(month: string) {
  return requestApi<CheckInSummary[]>(`/api/checkins?month=${encodeURIComponent(month)}`);
}

export async function getCheckIn(date: string): Promise<CheckInRecord | null> {
  try {
    return await requestApi<CheckInRecord>(`/api/checkins/${encodeURIComponent(date)}`);
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
  name?: string;
  avatarKey?: number;
  currentPassword?: string;
}) {
  const result = await requestApi<{ profile: AccountProfile }>("/api/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return result.profile;
}
