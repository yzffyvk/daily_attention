export type ApiSuccess<T> = { ok: true; data: T; requestId: string };
export type ApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    field?: string;
    retryAfterSeconds?: number;
  };
  requestId: string;
};

export const apiSuccess = <T>(data: T, requestId = crypto.randomUUID()): ApiSuccess<T> => ({
  ok: true,
  data,
  requestId,
});

export const apiFailure = (
  code: string,
  message: string,
  requestId = crypto.randomUUID(),
  details: Pick<ApiFailure["error"], "field" | "retryAfterSeconds"> = {},
): ApiFailure => ({ ok: false, error: { code, message, ...details }, requestId });
