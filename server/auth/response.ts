import { apiFailure, apiSuccess } from "@/lib/api/result";

const noStoreHeaders = { "Cache-Control": "private, no-store" };
const operationalErrorCodes = new Set([
  "REGISTRATION_COMPENSATION_FAILED",
  "RECOVERY_ROLLBACK_FAILED",
  "INTERNAL_ERROR",
]);

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
  if (mapped.status >= 500) {
    console.error("auth request failed", {
      requestId,
      errorType: error instanceof AggregateError ? "AggregateError" : error instanceof Error ? "Error" : "UnknownError",
      errorCode: error instanceof Error && operationalErrorCodes.has(error.message)
        ? error.message
        : "INTERNAL_ERROR",
    });
  }
  return noStoreJson(
    apiFailure(mapped.code, mapped.message, requestId, {
      field: mapped.field,
      retryAfterSeconds: mapped.retryAfterSeconds,
    }),
    mapped.status,
  );
}

function mapError(error: unknown): MappedError {
  const errorRecord = error && typeof error === "object"
    ? error as { code?: unknown; constraint?: unknown; message?: unknown }
    : undefined;
  const code = typeof errorRecord?.code === "string" ? errorRecord.code : undefined;
  const constraint = typeof errorRecord?.constraint === "string" ? errorRecord.constraint : undefined;
  const message = typeof errorRecord?.message === "string" ? errorRecord.message : "";
  const retryAfterSeconds =
    error && typeof error === "object" && typeof (error as { retryAfterSeconds?: unknown }).retryAfterSeconds === "number"
      ? (error as { retryAfterSeconds: number }).retryAfterSeconds
      : undefined;

  const isEmailUniqueConflict =
    code === "23505"
    && (
      constraint === "profiles_email_key"
      || message.includes('unique constraint "profiles_email_key"')
    );
  if (code === "email_exists" || isEmailUniqueConflict) {
    return { code: "EMAIL_TAKEN", message: "该邮箱已注册", status: 409, field: "email" };
  }
  if (code === "RATE_LIMITED" || message === "RATE_LIMITED") {
    return { code: "RATE_LIMITED", message: "请稍后再试", status: 429, retryAfterSeconds };
  }
  if (message === "INVALID_CREDENTIALS") {
    return { code: "INVALID_CREDENTIALS", message: "邮箱或密码不正确", status: 401 };
  }
  if (message === "INVALID_RECOVERY" || message === "RECOVERY_ALREADY_USED") {
    return { code: "INVALID_RECOVERY", message: "邮箱或恢复码不正确", status: 401 };
  }
  if (message === "UNAUTHORIZED") return { code: "UNAUTHORIZED", message: "请先登录", status: 401 };
  if (message === "PROFILE_NOT_FOUND") return { code: "PROFILE_NOT_FOUND", message: "用户资料不存在", status: 404 };
  return { code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后再试", status: 500 };
}
