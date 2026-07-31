import { afterEach, describe, expect, it, vi } from "vitest";
import {
  logServerError,
  operationalErrorFields,
} from "@/lib/server/logging";

describe("sanitized server logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits a stable structured error shape", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logServerError("check-in request failed", {
      requestId: "request-1",
      errorCode: "PGRST001",
    });

    expect(errorSpy).toHaveBeenCalledExactlyOnceWith("server_error", {
      event: "check-in request failed",
      requestId: "request-1",
      errorCode: "PGRST001",
    });
  });

  it.each([
    "body",
    "email",
    "password",
    "recoveryCode",
    "token",
    "secret",
    "signed_url",
    "source-url",
    "reasoningContent",
    "stack",
  ])("rejects the forbidden field %s after normalization", (field) => {
    expect(() => logServerError("unsafe", { [field]: "private" })).toThrow(
      `Unsafe log field: ${field}`,
    );
  });

  it.each([
    ["array", []],
    ["object", { nested: "private" }],
  ])("rejects a non-primitive %s value", (_label, value) => {
    expect(() =>
      logServerError("unsafe", { detail: value as never }),
    ).toThrow("Unsafe log value: detail");
  });
});

describe("operationalErrorFields", () => {
  it("keeps an operational code without exposing an error message", () => {
    const error = Object.assign(
      new Error("database failed for person@example.com"),
      { code: "PGRST001" },
    );

    expect(operationalErrorFields(error)).toEqual({
      errorType: "Error",
      errorCode: "PGRST001",
    });
  });

  it("recognizes aggregate errors and operational message-shaped codes", () => {
    expect(
      operationalErrorFields(
        new AggregateError([], "REGISTRATION_COMPENSATION_FAILED"),
      ),
    ).toEqual({
      errorType: "AggregateError",
      errorCode: "REGISTRATION_COMPENSATION_FAILED",
    });
  });

  it("makes arbitrary thrown values opaque", () => {
    expect(operationalErrorFields("person@example.com")).toEqual({
      errorType: "string",
      errorCode: "INTERNAL_ERROR",
    });
  });
});
