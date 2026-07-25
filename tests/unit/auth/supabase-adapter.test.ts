import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  updateUserById: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: vi.fn(() => ({
    auth: {
      admin: {
        createUser: mocks.createUser,
        deleteUser: mocks.deleteUser,
        updateUserById: mocks.updateUserById,
      },
    },
    rpc: mocks.rpc,
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: {
      getUser: mocks.getUser,
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
    },
    from: mocks.from,
  })),
}));

vi.mock("@/server/rate-limit/service", () => ({
  consumeRateLimit: vi.fn(),
}));

import { createSupabaseAuthAdapter } from "@/server/auth/supabase-adapter";

const databaseProfile = {
  id: "user-1",
  phone: "13800138000",
  display_name: "Attention_001",
  avatar_key: 2,
};

beforeEach(() => {
  mocks.createUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  mocks.deleteUser.mockResolvedValue({ error: null });
  mocks.updateUserById.mockResolvedValue({ error: null });
  mocks.signInWithPassword.mockResolvedValue({
    data: { user: { id: "user-1" }, session: { access_token: "token" } },
    error: null,
  });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  mocks.maybeSingle.mockResolvedValue({ data: databaseProfile, error: null });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.from.mockReturnValue({ select: mocks.select });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Supabase auth adapter", () => {
  it("creates a confirmed phone user through the server-only admin client", async () => {
    const { ports } = await createSupabaseAuthAdapter();

    await expect(
      ports.createAuthUser({ phone: "+8613800138000", password: "password123" }),
    ).resolves.toEqual({ id: "user-1" });
    expect(mocks.createUser).toHaveBeenCalledWith({
      phone: "+8613800138000",
      password: "password123",
      phone_confirm: true,
    });
  });

  it("signs in natively with phone and password", async () => {
    const { ports } = await createSupabaseAuthAdapter();

    await ports.signIn("+8613800138000", "password123");

    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      phone: "+8613800138000",
      password: "password123",
    });
  });

  it("uses the phone registration RPC contract and maps all profile fields", async () => {
    mocks.rpc.mockResolvedValue({ data: databaseProfile, error: null });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(
      ports.completeRegistration({
        userId: "user-1",
        phone: "13800138000",
        avatarKey: 2,
        recoveryDigest: new Uint8Array([0xab, 0xcd]),
      }),
    ).resolves.toEqual({
      id: "user-1",
      phone: "13800138000",
      displayName: "Attention_001",
      avatarKey: 2,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("complete_registration", {
      target_user_id: "user-1",
      target_phone: "13800138000",
      target_avatar_key: 2,
      target_recovery_digest: "\\xabcd",
    });
  });

  it("rejects an array-shaped registration profile response", async () => {
    mocks.rpc.mockResolvedValue({ data: [databaseProfile], error: null });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(
      ports.completeRegistration({
        userId: "user-1",
        phone: "13800138000",
        avatarKey: 2,
        recoveryDigest: new Uint8Array([0xab, 0xcd]),
      }),
    ).rejects.toThrow("Malformed profile response");
  });

  it("resolves a local phone through the phone RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ user_id: "user-1" }], error: null });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(ports.resolvePhone("13800138000")).resolves.toEqual({ userId: "user-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("resolve_phone", { target_phone: "13800138000" });
  });

  it("rejects a malformed phone resolution response", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ user_id: undefined }], error: null });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(ports.resolvePhone("13800138000")).rejects.toThrow(
      "Malformed phone resolution response",
    );
  });

  it("updates display name and avatar through the unified profile RPC", async () => {
    mocks.rpc.mockResolvedValue({
      data: { ...databaseProfile, display_name: "新的名称", avatar_key: 5 },
      error: null,
    });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(
      ports.updateProfile({ userId: "user-1", displayName: "新的名称", avatarKey: 5 }),
    ).resolves.toMatchObject({
      id: "user-1",
      phone: "13800138000",
      displayName: "新的名称",
      avatarKey: 5,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("update_profile", {
      target_user_id: "user-1",
      target_display_name: "新的名称",
      target_avatar_key: 5,
    });
  });

  it("rejects an updated profile response with a missing phone", async () => {
    const profileWithoutPhone: Partial<typeof databaseProfile> = { ...databaseProfile };
    delete profileWithoutPhone.phone;
    mocks.rpc.mockResolvedValue({ data: profileWithoutPhone, error: null });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(
      ports.updateProfile({ userId: "user-1", displayName: "新的名称", avatarKey: 5 }),
    ).rejects.toThrow("Malformed profile response");
  });

  it("selects and maps the complete current profile", async () => {
    const adapter = await createSupabaseAuthAdapter();

    await expect(adapter.currentProfile("user-1")).resolves.toEqual({
      id: "user-1",
      phone: "13800138000",
      displayName: "Attention_001",
      avatarKey: 2,
    });
    expect(mocks.select).toHaveBeenCalledWith("id, phone, display_name, avatar_key");
    expect(mocks.eq).toHaveBeenCalledWith("id", "user-1");
  });

  it("rejects a current profile response using the old field shape", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: "user-1",
        auth_email: "internal@internal.invalid",
        display_name: "Attention_001",
        avatar_key: 2,
      },
      error: null,
    });
    const adapter = await createSupabaseAuthAdapter();

    await expect(adapter.currentProfile("user-1")).rejects.toThrow("Malformed profile response");
  });

  it("maps only Supabase invalid-credentials errors to the public credential failure", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "invalid_credentials", message: "Invalid login credentials" },
    });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(ports.signIn("+8613800138000", "wrong-password")).rejects.toThrow("INVALID_CREDENTIALS");
  });

  it("keeps Supabase availability failures opaque to the response mapper", async () => {
    const outage = { code: "overloaded", message: "database host 10.0.0.8 is unavailable" };
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: outage,
    });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(ports.signIn("+8613800138000", "password123")).rejects.toBe(outage);
  });

  it("rejects malformed sign-in results instead of treating them as a session", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: null });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(ports.signIn("+8613800138000", "password123")).rejects.toThrow(
      "Malformed sign-in response",
    );
  });
});
