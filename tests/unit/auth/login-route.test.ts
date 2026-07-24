import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
}));

vi.mock("@/server/auth/supabase-adapter", () => ({
  createSupabaseAuthAdapter: vi.fn(async () => ({
    ports: {
      rateLimit: vi.fn(),
      resolveLoginName: vi.fn().mockResolvedValue({ userId: "user-1", authEmail: "internal@internal.invalid" }),
      signIn: mocks.signIn,
    },
  })),
}));

import { POST } from "@/app/api/auth/login/route";

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/login", () => {
  it("returns a no-store 401 for the known invalid-credentials adapter error", async () => {
    mocks.signIn.mockRejectedValue(new Error("INVALID_CREDENTIALS"));

    const response = await POST(new Request("http://example.test/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ name: "学习者", password: "wrong-password" }),
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_CREDENTIALS" } });
  });

  it("sanitizes a Supabase outage rather than misclassifying it as invalid credentials", async () => {
    mocks.signIn.mockRejectedValue({ code: "overloaded", message: "database host 10.0.0.8 is unavailable" });

    const response = await POST(new Request("http://example.test/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ name: "学习者", password: "password123" }),
    }));
    const body = await response.json() as { error: { code: string; message: string } };

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body.error).toEqual({ code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后再试", details: {} });
    expect(JSON.stringify(body)).not.toContain("10.0.0.8");
  });
});
