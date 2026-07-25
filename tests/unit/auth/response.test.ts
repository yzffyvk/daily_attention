import { describe, expect, it } from "vitest";
import { authFailure } from "@/server/auth/response";

describe("auth response mapping", () => {
  it.each([
    ["a duplicate profile phone", { code: "23505" }],
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
