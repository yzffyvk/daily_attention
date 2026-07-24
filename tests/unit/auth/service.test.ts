import { describe, expect, it, vi } from "vitest";
import { recoverAccount, registerAccount } from "@/server/auth/service";
import type { AuthPorts } from "@/server/auth/ports";

function ports(): AuthPorts {
  return {
    rateLimit: vi.fn().mockResolvedValue(undefined),
    createAuthUser: vi.fn().mockResolvedValue({ id: "user-1" }),
    deleteAuthUser: vi.fn().mockResolvedValue(undefined),
    completeRegistration: vi.fn().mockResolvedValue({ id: "user-1", displayName: "学习者", avatarKey: 2 }),
    resolveLoginName: vi.fn().mockResolvedValue({ userId: "user-1", authEmail: "internal@internal.invalid" }),
    readRecoveryDigest: vi.fn(),
    replaceRecoveryDigest: vi.fn().mockResolvedValue(true),
    updateProfileIdentity: vi.fn().mockResolvedValue({ id: "user-1", displayName: "学习者", avatarKey: 2 }),
    updatePassword: vi.fn().mockResolvedValue(undefined),
    signIn: vi.fn().mockResolvedValue(undefined),
  };
}

describe("auth service", () => {
  it("compensates when profile completion fails", async () => {
    const adapter = ports();
    vi.mocked(adapter.completeRegistration).mockRejectedValue(new Error("duplicate"));
    await expect(
      registerAccount(
        { name: "学习者", password: "password123", avatarKey: 2, bucket: "register-key" },
        adapter,
      ),
    ).rejects.toThrow("duplicate");
    expect(adapter.deleteAuthUser).toHaveBeenCalledWith("user-1");
  });

  it("rotates the recovery digest after changing the password", async () => {
    const adapter = ports();
    vi.mocked(adapter.readRecoveryDigest).mockResolvedValue(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("0123456789ABCDEFGHJKMNPQRS"))));
    const result = await recoverAccount(
      {
        name: "学习者",
        recoveryCode: "01234-56789-ABCDE-FGHJK-MNPQRS",
        newPassword: "newpassword123",
        bucket: "recover-key",
      },
      adapter,
    );
    expect(adapter.updatePassword).toHaveBeenCalledWith("user-1", "newpassword123");
    expect(adapter.replaceRecoveryDigest).toHaveBeenCalledOnce();
    expect(result.recoveryCode.replace(/-/g, "")).toHaveLength(26);
  });
});
