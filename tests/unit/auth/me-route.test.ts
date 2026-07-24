import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentProfile: vi.fn(),
  currentUser: vi.fn(),
  updateProfileAvatar: vi.fn(),
  updateProfileIdentity: vi.fn(),
}));

vi.mock("@/server/auth/supabase-adapter", () => ({
  createSupabaseAuthAdapter: vi.fn(async () => ({
    currentProfile: mocks.currentProfile,
    currentUser: mocks.currentUser,
    ports: {
      updateProfileAvatar: mocks.updateProfileAvatar,
      updateProfileIdentity: mocks.updateProfileIdentity,
    },
  })),
}));

import { PATCH } from "@/app/api/me/route";

afterEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/me", () => {
  it.each([
    ["an empty body", {}],
    ["a password-only body", { currentPassword: "password123" }],
  ])("returns the established validation response for %s", async (_label, body) => {
    const response = await PATCH(new Request("http://example.test/api/me", {
      method: "PATCH",
      body: JSON.stringify(body),
    }));

    expect(response.status).toBe(422);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(mocks.currentUser).not.toHaveBeenCalled();
  });

  it("uses the atomic avatar-only operation without reading or rewriting the login name", async () => {
    mocks.currentUser.mockResolvedValue({ id: "user-1" });
    mocks.updateProfileAvatar.mockResolvedValue({ id: "user-1", displayName: "已重命名", avatarKey: 5 });

    const response = await PATCH(new Request("http://example.test/api/me", {
      method: "PATCH",
      body: JSON.stringify({ avatarKey: 5 }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { profile: { displayName: "已重命名", avatarKey: 5 } },
    });
    expect(mocks.currentProfile).not.toHaveBeenCalled();
    expect(mocks.updateProfileIdentity).not.toHaveBeenCalled();
    expect(mocks.updateProfileAvatar).toHaveBeenCalledWith({ userId: "user-1", avatarKey: 5 });
  });
});
