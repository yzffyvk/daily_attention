import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recoverAccount: vi.fn(),
}));

vi.mock("@/server/auth/service", () => ({
  recoverAccount: mocks.recoverAccount,
}));

vi.mock("@/server/auth/supabase-adapter", () => ({
  createSupabaseAuthAdapter: vi.fn(async () => ({
    ports: {},
  })),
}));

import { POST } from "@/app/api/auth/recover/route";

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/recover", () => {
  it("returns the recovered profile after using the phone rate bucket", async () => {
    mocks.recoverAccount.mockResolvedValue({
      recoveryCode: "01234-56789-ABCDE-FGHJK-MNPQRS",
      profile: {
        id: "user-1",
        phone: "13800138000",
        displayName: "Attention_001",
        avatarKey: 1,
      },
    });

    const response = await POST(new Request("http://example.test/api/auth/recover", {
      method: "POST",
      headers: { "cf-connecting-ip": "203.0.113.7" },
      body: JSON.stringify({
        phone: "138 0013 8000",
        recoveryCode: "01234-56789-ABCDE-FGHJK-MNPQRS",
        newPassword: "new-password123",
      }),
    }));

    expect(mocks.recoverAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "13800138000",
        bucket: "203.0.113.7:13800138000",
      }),
      expect.anything(),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        profile: { displayName: "Attention_001" },
        recoveryCode: "01234-56789-ABCDE-FGHJK-MNPQRS",
      },
    });
  });

  it("maps recovery failures without exposing internal details", async () => {
    mocks.recoverAccount.mockRejectedValue({ code: "overloaded", message: "database host 10.0.0.8 is unavailable" });

    const response = await POST(new Request("http://example.test/api/auth/recover", {
      method: "POST",
      body: JSON.stringify({
        phone: "13800138000",
        recoveryCode: "01234-56789-ABCDE-FGHJK-MNPQRS",
        newPassword: "new-password123",
      }),
    }));
    const body = await response.json() as { error: { code: string; message: string } };

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body.error).toEqual({ code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后再试", details: {} });
    expect(JSON.stringify(body)).not.toContain("10.0.0.8");
  });
});
