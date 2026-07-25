import { describe, expect, it } from "vitest";
import { authFailure } from "@/server/auth/response";

describe("auth response mapping", () => {
  it.each([
    [
      "a duplicate profile phone",
      {
        code: "23505",
        message: 'duplicate key value violates unique constraint "profiles_phone_key"',
      },
    ],
    ["a duplicate Supabase Auth phone", { code: "phone_exists" }],
  ])("maps %s to the phone field", async (_label, error) => {
    const response = authFailure(error, "request-id");

    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "PHONE_TAKEN",
        message: "该手机号已注册",
        details: { field: "phone" },
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

  it("uses the phone-specific invalid login message", async () => {
    const response = authFailure(new Error("INVALID_CREDENTIALS"), "request-id");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "手机号或密码不正确",
      },
    });
  });

  it("uses the phone-specific invalid recovery message", async () => {
    const response = authFailure(new Error("INVALID_RECOVERY"), "request-id");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_RECOVERY",
        message: "手机号或恢复码不正确",
      },
    });
  });
});
