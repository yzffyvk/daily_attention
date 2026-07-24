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
