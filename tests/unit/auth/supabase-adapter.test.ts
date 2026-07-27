import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminFrom: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
  getUser: vi.fn(),
  getUserById: vi.fn(),
  listUsers: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  rpcRequiresClientContext: false,
  select: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  updateUserById: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: vi.fn(() => {
    const adminClient = {
      rpc(this: unknown, ...args: Parameters<typeof mocks.rpc>) {
        if (mocks.rpcRequiresClientContext && this !== adminClient) {
          throw new TypeError("Supabase rpc requires its client context");
        }
        return mocks.rpc(...args);
      },
      auth: {
        admin: {
          createUser: mocks.createUser,
          deleteUser: mocks.deleteUser,
          getUserById: mocks.getUserById,
          listUsers: mocks.listUsers,
          updateUserById: mocks.updateUserById,
        },
      },
      from: mocks.adminFrom,
    };
    return adminClient;
  }),
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
  email: "user@example.com",
  display_name: "Attention_001",
  avatar_key: 2,
};

beforeEach(() => {
  mocks.rpcRequiresClientContext = false;
  mocks.createUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  mocks.deleteUser.mockResolvedValue({ error: null });
  mocks.getUserById.mockResolvedValue({
    data: { user: null },
    error: { status: 404, code: "user_not_found" },
  });
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
  mocks.adminFrom.mockReturnValue({ select: mocks.select });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Supabase auth adapter", () => {
  it("creates a confirmed email user through the server-only admin client", async () => {
    const { ports } = await createSupabaseAuthAdapter();

    await expect(
      ports.createAuthUser({ email: "user@example.com", password: "password123" }),
    ).resolves.toEqual({ id: "user-1" });
    expect(mocks.createUser).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password123",
      email_confirm: true,
    });
  });

  it("verifies targeted Auth absence after a successful delete", async () => {
    mocks.deleteUser.mockResolvedValue({
      data: { user: { id: "untrusted-delete-response" } },
      error: null,
    });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(ports.deleteAuthUser("user-1")).resolves.toBeUndefined();

    expect(mocks.deleteUser).toHaveBeenCalledWith("user-1");
    expect(mocks.getUserById).toHaveBeenCalledWith("user-1");
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });

  it.each([
    { description: "a missing error property", deleted: {} },
    { description: "an inherited null error", deleted: Object.create({ error: null }) },
    { description: "a non-null error", deleted: { error: { code: "delete_failed" } } },
  ])("rejects a delete response with $description", async ({ deleted }) => {
    mocks.deleteUser.mockResolvedValue(deleted);
    const { ports } = await createSupabaseAuthAdapter();

    await expect(ports.deleteAuthUser("user-1")).rejects.toThrow(
      "Auth user deletion could not be verified",
    );
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });

  it.each([
    {
      description: "a returned user",
      absent: { data: { user: { id: "unexpected-user" } }, error: { status: 404, code: "user_not_found" } },
    },
    { description: "a missing data envelope", absent: { error: { status: 404, code: "user_not_found" } } },
    { description: "an inherited null user", absent: { data: Object.create({ user: null }), error: { status: 404, code: "user_not_found" } } },
    { description: "a missing error envelope", absent: { data: { user: null } } },
    { description: "an inherited error status", absent: { data: { user: null }, error: Object.create({ status: 404, code: "user_not_found" }) } },
    { description: "an inherited error code", absent: { data: { user: null }, error: Object.assign(Object.create({ code: "user_not_found" }), { status: 404 }) } },
    { description: "a wrong status", absent: { data: { user: null }, error: { status: 400, code: "user_not_found" } } },
    { description: "a wrong code", absent: { data: { user: null }, error: { status: 404, code: "other" } } },
  ])("rejects a targeted read with $description", async ({ absent }) => {
    mocks.getUserById.mockResolvedValue(absent);
    const { ports } = await createSupabaseAuthAdapter();

    await expect(ports.deleteAuthUser("user-1")).rejects.toThrow(
      "Auth user deletion could not be verified",
    );
  });

  it("rejects a thrown targeted read without exposing its details", async () => {
    mocks.getUserById.mockRejectedValue(new Error("targeted read failed"));
    const { ports } = await createSupabaseAuthAdapter();

    await expect(ports.deleteAuthUser("user-1")).rejects.toThrow(
      "Auth user deletion could not be verified",
    );
  });

  it("signs in natively with email and password", async () => {
    const { ports } = await createSupabaseAuthAdapter();

    await ports.signIn("user@example.com", "password123");

    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password123",
    });
  });

  it("uses the email registration RPC contract and maps all profile fields", async () => {
    mocks.rpc.mockResolvedValue({ data: databaseProfile, error: null });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(
      ports.completeRegistration({
        userId: "user-1",
        email: "user@example.com",
        avatarKey: 2,
        recoveryDigest: new Uint8Array([0xab, 0xcd]),
      }),
    ).resolves.toEqual({
      id: "user-1",
      email: "user@example.com",
      displayName: "Attention_001",
      avatarKey: 2,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("complete_registration", {
      target_user_id: "user-1",
      target_email: "user@example.com",
      target_avatar_key: 2,
      target_recovery_digest: "\\xabcd",
    });
  });

  it("preserves the admin client context when invoking RPCs", async () => {
    mocks.rpcRequiresClientContext = true;
    mocks.rpc.mockResolvedValue({ data: databaseProfile, error: null });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(
      ports.completeRegistration({
        userId: "user-1",
        email: "user@example.com",
        avatarKey: 2,
        recoveryDigest: new Uint8Array([0xab, 0xcd]),
      }),
    ).resolves.toMatchObject({ id: "user-1", email: "user@example.com" });
  });

  it("rejects an array-shaped registration profile response", async () => {
    mocks.rpc.mockResolvedValue({ data: [databaseProfile], error: null });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(
      ports.completeRegistration({
        userId: "user-1",
        email: "user@example.com",
        avatarKey: 2,
        recoveryDigest: new Uint8Array([0xab, 0xcd]),
      }),
    ).rejects.toThrow("Malformed profile response");
  });

  it("resolves an email through the email RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ user_id: "user-1" }], error: null });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(ports.resolveEmail("user@example.com")).resolves.toEqual({ userId: "user-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("resolve_email", { target_email: "user@example.com" });
  });

  it("reads one known recovery challenge through the fixed-shape RPC", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        user_id: "00000000-0000-4000-8000-000000000001",
        recovery_code_digest: `\\x${"ab".repeat(32)}`,
      }],
      error: null,
    });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(ports.resolveRecoveryChallenge("user@example.com")).resolves.toEqual({
      userId: "00000000-0000-4000-8000-000000000001",
      recoveryDigest: new Uint8Array(32).fill(0xab),
    });
    expect(mocks.rpc).toHaveBeenCalledWith("resolve_recovery_challenge", {
      target_email: "user@example.com",
    });
  });

  it("accepts a null user ID for a missing-account recovery challenge", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ user_id: null, recovery_code_digest: `\\x${"00".repeat(32)}` }],
      error: null,
    });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(ports.resolveRecoveryChallenge("missing@example.com")).resolves.toEqual({
      userId: null,
      recoveryDigest: new Uint8Array(32),
    });
  });

  it.each([
    { data: [], description: "zero rows" },
    {
      data: [
        { user_id: null, recovery_code_digest: `\\x${"00".repeat(32)}` },
        { user_id: null, recovery_code_digest: `\\x${"00".repeat(32)}` },
      ],
      description: "multiple rows",
    },
    {
      data: [{ user_id: "not-a-uuid", recovery_code_digest: `\\x${"00".repeat(32)}` }],
      description: "a malformed user ID",
    },
  ])("rejects a recovery challenge response with $description", async ({ data }) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(ports.resolveRecoveryChallenge("user@example.com")).rejects.toThrow(
      "Malformed recovery challenge response",
    );
  });

  it.each(["", "not-bytea", `\\x${"ab".repeat(31)}`, `\\x${"zz".repeat(32)}`])(
    "rejects a recovery challenge response with a malformed digest",
    async (recovery_code_digest) => {
      mocks.rpc.mockResolvedValue({
        data: [{ user_id: null, recovery_code_digest }],
        error: null,
      });
      const { ports } = await createSupabaseAuthAdapter();

      await expect(ports.resolveRecoveryChallenge("user@example.com")).rejects.toThrow(
        "Malformed recovery digest",
      );
    },
  );

  it("reads and validates a recovery profile through the service-role RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: databaseProfile, error: null });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(ports.readProfile("user-1")).resolves.toEqual({
      id: "user-1",
      email: "user@example.com",
      displayName: "Attention_001",
      avatarKey: 2,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("read_profile", {
      target_user_id: "user-1",
    });
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it("rejects a malformed email resolution response", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ user_id: undefined }], error: null });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(ports.resolveEmail("user@example.com")).rejects.toThrow(
      "Malformed email resolution response",
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
      email: "user@example.com",
      displayName: "新的名称",
      avatarKey: 5,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("update_profile", {
      target_user_id: "user-1",
      target_display_name: "新的名称",
      target_avatar_key: 5,
    });
  });

  it("rejects an updated profile response with the old phone field shape", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...databaseProfile, phone: "13800138000", email: undefined }, error: null });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(
      ports.updateProfile({ userId: "user-1", displayName: "新的名称", avatarKey: 5 }),
    ).rejects.toThrow("Malformed profile response");
  });

  it("selects and maps the complete current profile", async () => {
    const adapter = await createSupabaseAuthAdapter();

    await expect(adapter.currentProfile("user-1")).resolves.toEqual({
      id: "user-1",
      email: "user@example.com",
      displayName: "Attention_001",
      avatarKey: 2,
    });
    expect(mocks.select).toHaveBeenCalledWith("id, email, display_name, avatar_key");
    expect(mocks.eq).toHaveBeenCalledWith("id", "user-1");
  });

  it("rejects a current profile response using the old field shape", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: "user-1",
        phone: "13800138000",
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

    await expect(ports.signIn("user@example.com", "wrong-password")).rejects.toThrow("INVALID_CREDENTIALS");
  });

  it("keeps Supabase availability failures opaque to the response mapper", async () => {
    const outage = { code: "overloaded", message: "database host 10.0.0.8 is unavailable" };
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: outage,
    });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(ports.signIn("user@example.com", "password123")).rejects.toBe(outage);
  });

  it("rejects malformed sign-in results instead of treating them as a session", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: null });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(ports.signIn("user@example.com", "password123")).rejects.toThrow(
      "Malformed sign-in response",
    );
  });
});
