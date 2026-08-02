import "server-only";

import { apiFailure, apiSuccess } from "@/lib/api/result";
import {
  logServerError,
  operationalErrorFields,
} from "@/lib/server/logging";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

const mappedErrors = {
  SESSION_EXPIRED: {
    status: 401,
    message: "登录已失效，请重新登录",
  },
  FEATURE_DISABLED: {
    status: 403,
    message: "AI 生成功能暂未开放",
  },
  FORBIDDEN_JOB: {
    status: 403,
    message: "无权访问该任务",
  },
  JOB_ALREADY_STARTED: {
    status: 409,
    message: "任务已经开始，无法取消",
  },
  VALIDATION_ERROR: {
    status: 422,
    message: "请求格式不正确",
  },
  URL_NOT_ALLOWED: {
    status: 422,
    message: "该链接不支持访问",
  },
  DAILY_AI_LIMIT_REACHED: {
    status: 429,
    message: "今天的 5 次生成机会已用完",
  },
  RATE_LIMITED: {
    status: 429,
    message: "请求过于频繁，请稍后再试",
  },
  AI_SERVICE_UNAVAILABLE: {
    status: 503,
    message: "AI 服务暂时不可用，请稍后再试",
  },
} as const;

type MappedErrorCode = keyof typeof mappedErrors;

function isMappedErrorCode(value: unknown): value is MappedErrorCode {
  return typeof value === "string" && value in mappedErrors;
}

function errorCode(error: unknown): MappedErrorCode | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; message?: unknown };
  if (isMappedErrorCode(candidate.message)) return candidate.message;
  if (isMappedErrorCode(candidate.code)) return candidate.code;
  return null;
}

function retryAfterSeconds(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

export function aiSuccess<T>(data: T, requestId: string, status = 200) {
  return Response.json(apiSuccess(data, requestId), {
    status,
    headers: noStoreHeaders,
  });
}

export function aiValidationFailure(
  issue: { message: string; path: PropertyKey[] },
  requestId: string,
) {
  return Response.json(
    apiFailure("VALIDATION_ERROR", issue.message, requestId, {
      field: issue.path[0]?.toString(),
    }),
    { status: 422, headers: noStoreHeaders },
  );
}

export function aiFailure(error: unknown, requestId: string) {
  const code = errorCode(error) ?? "AI_SERVICE_UNAVAILABLE";
  const mapped = mappedErrors[code];
  if (mapped.status >= 500) {
    logServerError("AI generation request failed", {
      requestId,
      ...operationalErrorFields(error),
    });
  }

  return Response.json(
    apiFailure(code, mapped.message, requestId, {
      retryAfterSeconds: code === "RATE_LIMITED"
        ? retryAfterSeconds(error)
        : undefined,
    }),
    { status: mapped.status, headers: noStoreHeaders },
  );
}
