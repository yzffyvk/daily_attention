import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("@/server/auth/supabase-adapter", () => ({
  createSupabaseAuthAdapter: vi.fn(async () => ({
    ports: {
      rateLimit: mocks.rateLimit,
      signIn: mocks.signIn,
    },
  })),
}));

import { POST } from "@/app/api/auth/login/route";

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/login", () => {
  it("uses a normalized email rate bucket and signs in with email", async () => {
    const response = await POST(new Request("http://example.test/api/auth/login", {
      method: "POST",
      headers: { "cf-connecting-ip": "203.0.113.7" },
      body: JSON.stringify({ email: " User@Example.com ", password: "password123" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.rateLimit).toHaveBeenCalledWith({
      action: "login",
      bucket: "203.0.113.7:user@example.com",
    });
    expect(mocks.signIn).toHaveBeenCalledWith("user@example.com", "password123");
  });

  it("returns the email-specific no-store 401 for invalid credentials", async () => {
    mocks.signIn.mockRejectedValue(new Error("INVALID_CREDENTIALS"));

    const response = await POST(new Request("http://example.test/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "user@example.com", password: "wrong-password" }),
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "邮箱或密码不正确",
      },
    });
  });

  it("sanitizes a Supabase outage rather than misclassifying it as invalid credentials", async () => {
    mocks.signIn.mockRejectedValue({ code: "overloaded", message: "database host 10.0.0.8 is unavailable" });

    const response = await POST(new Request("http://example.test/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "user@example.com", password: "password123" }),
    }));
    const body = await response.json() as { error: { code: string; message: string } };

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body.error).toEqual({ code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后再试", details: {} });
    expect(JSON.stringify(body)).not.toContain("10.0.0.8");
  });
});
