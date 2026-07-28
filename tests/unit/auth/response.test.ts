import { afterEach, describe, expect, it, vi } from "vitest";
import { authFailure } from "@/server/auth/response";

describe("auth response mapping", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs a sanitized operational alert for registration compensation failure", async () => {
    const error = new AggregateError(
      [
        new Error("profile registration failed for user@example.com and user-1"),
        new Error("cleanup failed with password and recovery data"),
      ],
      "REGISTRATION_COMPENSATION_FAILED",
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = authFailure(error, "request-id");
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "服务暂时不可用，请稍后再试",
        details: {},
      },
      requestId: "request-id",
    });
    expect(errorSpy).toHaveBeenCalledWith("auth request failed", {
      requestId: "request-id",
      errorType: "AggregateError",
      errorCode: "REGISTRATION_COMPENSATION_FAILED",
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(body)).not.toContain("user@example.com");
    expect(JSON.stringify(body)).not.toContain("user-1");
    expect(JSON.stringify(body)).not.toContain("password");
    expect(JSON.stringify(body)).not.toContain("recovery data");
  });

  it("does not alert for a mapped client error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = authFailure(new Error("INVALID_CREDENTIALS"), "request-id");

    expect(response.status).toBe(401);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a duplicate profile email identified by its message",
      {
        code: "23505",
        message: 'duplicate key value violates unique constraint "profiles_email_key"',
      },
    ],
    ["a duplicate profile email identified by its constraint", { code: "23505", constraint: "profiles_email_key" }],
    ["a duplicate Supabase Auth email", { code: "email_exists" }],
  ])("maps %s to the email field", async (_label, error) => {
    const response = authFailure(error, "request-id");

    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "EMAIL_TAKEN",
        message: "该邮箱已注册",
        details: { field: "email" },
      },
    });
  });

  it.each([
    [
      "another unique constraint",
      {
        code: "23505",
        message: 'duplicate key value violates unique constraint "profiles_display_name_key"',
        details: "Key (display_name)=(Attention_001) already exists.",
      },
    ],
    ["a constraint-free unique violation", { code: "23505" }],
  ])("keeps %s opaque", async (_label, error) => {
    const response = authFailure(error, "request-id");
    const body = await response.json() as { error: { code: string; message: string } };

    expect(response.status).toBe(500);
    expect(body.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "服务暂时不可用，请稍后再试",
      details: {},
    });
    expect(JSON.stringify(body)).not.toContain("profiles_display_name_key");
    expect(JSON.stringify(body)).not.toContain("Attention_001");
  });

  it("does not retain the legacy phone duplicate contract", async () => {
    const response = authFailure({ code: "phone_exists" }, "request-id");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INTERNAL_ERROR",
        message: "服务暂时不可用，请稍后再试",
        details: {},
      },
    });
  });

  it("uses the email-specific invalid login message", async () => {
    const response = authFailure(new Error("INVALID_CREDENTIALS"), "request-id");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "邮箱或密码不正确",
      },
    });
  });

  it("uses the email-specific invalid recovery message", async () => {
    const response = authFailure(new Error("INVALID_RECOVERY"), "request-id");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_RECOVERY",
        message: "邮箱或恢复码不正确",
      },
    });
  });
});
