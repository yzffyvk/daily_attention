import { apiFailure, apiSuccess } from "@/lib/api/result";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

type MappedError = {
  code: string;
  message: string;
  status: number;
  field?: string;
  retryAfterSeconds?: number;
};

export function noStoreJson(data: unknown, status = 200) {
  return Response.json(data, { status, headers: noStoreHeaders });
}

export function validationFailure(issue: { message: string; path: PropertyKey[] }, requestId: string) {
  return noStoreJson(
    apiFailure("VALIDATION_ERROR", issue.message, requestId, {
      field: issue.path[0]?.toString(),
    }),
    422,
  );
}

export function authSuccess<T>(data: T, requestId: string, status = 200) {
  return noStoreJson(apiSuccess(data, requestId), status);
}

export function authFailure(error: unknown, requestId: string) {
  const mapped = mapError(error);
  return noStoreJson(
    apiFailure(mapped.code, mapped.message, requestId, {
      field: mapped.field,
      retryAfterSeconds: mapped.retryAfterSeconds,
    }),
    mapped.status,
  );
}

function mapError(error: unknown): MappedError {
  const code = error && typeof error === "object" ? (error as { code?: string }).code : undefined;
  const message = error instanceof Error ? error.message : "";
  const retryAfterSeconds =
    error && typeof error === "object" && typeof (error as { retryAfterSeconds?: unknown }).retryAfterSeconds === "number"
      ? (error as { retryAfterSeconds: number }).retryAfterSeconds
      : undefined;

  if (code === "23505") return { code: "NAME_TAKEN", message: "这个名称已经被使用", status: 409, field: "name" };
  if (code === "RATE_LIMITED" || message === "RATE_LIMITED") {
    return { code: "RATE_LIMITED", message: "请稍后再试", status: 429, retryAfterSeconds };
  }
  if (message === "INVALID_CREDENTIALS") {
    return { code: "INVALID_CREDENTIALS", message: "名称或密码不正确", status: 401 };
  }
  if (message === "INVALID_RECOVERY" || message === "RECOVERY_ALREADY_USED") {
    return { code: "INVALID_RECOVERY", message: "名称或恢复码不正确", status: 401 };
  }
  if (message === "UNAUTHORIZED") return { code: "UNAUTHORIZED", message: "请先登录", status: 401 };
  if (message === "PROFILE_NOT_FOUND") return { code: "PROFILE_NOT_FOUND", message: "用户资料不存在", status: 404 };
  return { code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后再试", status: 500 };
}
