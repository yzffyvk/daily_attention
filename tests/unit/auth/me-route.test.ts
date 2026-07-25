import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentProfile: vi.fn(),
  currentUser: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock("@/server/auth/supabase-adapter", () => ({
  createSupabaseAuthAdapter: vi.fn(async () => ({
    currentProfile: mocks.currentProfile,
    currentUser: mocks.currentUser,
    ports: {
      updateProfile: mocks.updateProfile,
    },
  })),
}));

import { PATCH } from "@/app/api/me/route";

beforeEach(() => {
  mocks.currentUser.mockResolvedValue({ id: "user-1" });
  mocks.currentProfile.mockResolvedValue({
    id: "user-1",
    phone: "13800138000",
    displayName: "Attention_001",
    avatarKey: 2,
  });
  mocks.updateProfile.mockResolvedValue({
    id: "user-1",
    phone: "13800138000",
    displayName: "Attention_001",
    avatarKey: 5,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/me", () => {
  it("returns the established validation response for an empty body", async () => {
    const response = await PATCH(new Request("http://example.test/api/me", {
      method: "PATCH",
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(422);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(mocks.currentUser).not.toHaveBeenCalled();
  });

  it("rejects phone changes before touching the authenticated profile", async () => {
    const response = await PATCH(new Request("http://example.test/api/me", {
      method: "PATCH",
      body: JSON.stringify({ phone: "13900139000" }),
    }));

    expect(response.status).toBe(422);
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it("preserves the display name when updating only the avatar", async () => {
    const response = await PATCH(new Request("http://example.test/api/me", {
      method: "PATCH",
      body: JSON.stringify({ avatarKey: 5 }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        profile: {
          id: "user-1",
          phone: "13800138000",
          displayName: "Attention_001",
          avatarKey: 5,
        },
      },
    });
    expect(mocks.updateProfile).toHaveBeenCalledWith({
      userId: "user-1",
      displayName: "Attention_001",
      avatarKey: 5,
    });
  });

  it("updates displayName without accepting a phone or requiring a password", async () => {
    mocks.updateProfile.mockResolvedValue({
      id: "user-1",
      phone: "13800138000",
      displayName: "新的名称",
      avatarKey: 2,
    });

    const response = await PATCH(new Request("http://example.test/api/me", {
      method: "PATCH",
      body: JSON.stringify({ displayName: "新的名称" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.updateProfile).toHaveBeenCalledWith({
      userId: "user-1",
      displayName: "新的名称",
      avatarKey: 2,
    });
    expect(mocks.updateProfile).not.toHaveBeenCalledWith(expect.objectContaining({ phone: expect.anything() }));
  });
});
