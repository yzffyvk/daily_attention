export type SafeFetchErrorCode =
  | "URL_NOT_ALLOWED"
  | "FETCH_TIMEOUT"
  | "TOO_MANY_REDIRECTS"
  | "RESPONSE_TOO_LARGE"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "CONTENT_BLOCKED";

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;

  constructor(code: SafeFetchErrorCode, internalMessage: string = code) {
    super(internalMessage);
    this.name = "SafeFetchError";
    this.code = code;
  }
}
