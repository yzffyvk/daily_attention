import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeOnboarding: vi.fn(),
  currentProfile: vi.fn(),
  currentUser: vi.fn(),
}));

vi.mock("@/server/auth/supabase-adapter", () => ({
  createSupabaseAuthAdapter: vi.fn(async () => ({
    currentProfile: mocks.currentProfile,
    currentUser: mocks.currentUser,
    ports: {
      completeOnboarding: mocks.completeOnboarding,
    },
  })),
}));

import { POST } from "@/app/api/onboarding/route";

const incompleteProfile = {
  id: "user-1",
  email: "user@example.com",
  displayName: "Attention_001",
  avatarKey: 1,
  onboardingCompleted: false,
};

beforeEach(() => {
  mocks.currentUser.mockResolvedValue({ id: "user-1" });
  mocks.currentProfile.mockResolvedValue(incompleteProfile);
  mocks.completeOnboarding.mockResolvedValue({
    ...incompleteProfile,
    displayName: "新的名称",
    avatarKey: 4,
    onboardingCompleted: true,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/onboarding", () => {
  it("rejects forged identity and state before reading the session", async () => {
    const response = await POST(new Request("http://example.test/api/onboarding", {
      method: "POST",
      body: JSON.stringify({
        displayName: "新的名称",
        avatarKey: 4,
        userId: "forged-user",
        onboardingCompleted: true,
      }),
    }));

    expect(response.status).toBe(422);
    expect(mocks.currentUser).not.toHaveBeenCalled();
  });

  it("returns unauthorized when no current user exists", async () => {
    mocks.currentUser.mockRejectedValue(new Error("UNAUTHORIZED"));

    const response = await POST(new Request("http://example.test/api/onboarding", {
      method: "POST",
      body: JSON.stringify({ displayName: "新的名称", avatarKey: 4 }),
    }));

    expect(response.status).toBe(401);
    expect(mocks.completeOnboarding).not.toHaveBeenCalled();
  });

  it("completes onboarding for the current user", async () => {
    const response = await POST(new Request("http://example.test/api/onboarding", {
      method: "POST",
      body: JSON.stringify({ displayName: " 新的名称 ", avatarKey: 4 }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.completeOnboarding).toHaveBeenCalledWith({
      userId: "user-1",
      displayName: "新的名称",
      avatarKey: 4,
    });
    await expect(response.json()).resolves.toMatchObject({
      data: { profile: { onboardingCompleted: true } },
    });
  });

  it("returns an already completed profile without another write", async () => {
    mocks.currentProfile.mockResolvedValue({
      ...incompleteProfile,
      onboardingCompleted: true,
    });

    const response = await POST(new Request("http://example.test/api/onboarding", {
      method: "POST",
      body: JSON.stringify({ displayName: "另一个名称", avatarKey: 5 }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.completeOnboarding).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: { profile: { onboardingCompleted: true } },
    });
  });
});
