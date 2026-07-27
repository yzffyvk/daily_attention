import { describe, expect, it } from "vitest";
import { authFailure } from "@/server/auth/response";

describe("auth response mapping", () => {
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
