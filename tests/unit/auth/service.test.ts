import { describe, expect, it, vi } from "vitest";
import { loginAccount, recoverAccount, registerAccount, updateProfile } from "@/server/auth/service";
import type { AuthPorts } from "@/server/auth/ports";

function ports(): AuthPorts {
  const profile = {
    id: "user-1",
    email: "user@example.com",
    displayName: "Attention_001",
    avatarKey: 2,
  };

  return {
    rateLimit: vi.fn().mockResolvedValue(undefined),
    createAuthUser: vi.fn().mockResolvedValue({ id: "user-1" }),
    deleteAuthUser: vi.fn().mockResolvedValue(undefined),
    completeRegistration: vi.fn().mockResolvedValue(profile),
    resolveEmail: vi.fn().mockResolvedValue({ userId: "user-1" }),
    readProfile: vi.fn().mockResolvedValue(profile),
    readRecoveryDigest: vi.fn(),
    replaceRecoveryDigest: vi.fn().mockResolvedValue(true),
    updateProfile: vi.fn().mockResolvedValue(profile),
    updatePassword: vi.fn().mockResolvedValue(undefined),
    signIn: vi.fn().mockResolvedValue(undefined),
  };
}

async function recoveryDigest() {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode("0123456789ABCDEFGHJKMNPQRS")),
  );
}

function recoveryInput() {
  return {
    email: "user@example.com",
    recoveryCode: "01234-56789-ABCDE-FGHJK-MNPQRS",
    newPassword: "newpassword123",
    bucket: "recover-key",
  };
}

describe("auth service", () => {
  it("compensates when profile completion fails", async () => {
    const adapter = ports();
    vi.mocked(adapter.completeRegistration).mockRejectedValue(new Error("duplicate"));
    await expect(
      registerAccount(
        { email: "user@example.com", password: "password123", avatarKey: 2, bucket: "register-key" },
        adapter,
      ),
    ).rejects.toThrow("duplicate");
    expect(adapter.deleteAuthUser).toHaveBeenCalledWith("user-1");
  });

  it("compensates when sign-in after profile completion fails", async () => {
    const adapter = ports();
    const signInFailure = new Error("sign-in failed");
    vi.mocked(adapter.signIn).mockRejectedValue(signInFailure);

    await expect(
      registerAccount(
        { email: "user@example.com", password: "password123", avatarKey: 2, bucket: "register-key" },
        adapter,
      ),
    ).rejects.toThrow(signInFailure);

    expect(adapter.deleteAuthUser).toHaveBeenCalledWith("user-1");
  });

  it("registers with email and signs in", async () => {
    const adapter = ports();

    await registerAccount(
      {
        email: "user@example.com",
        password: "password123",
        avatarKey: 2,
        bucket: "register-key",
      },
      adapter,
    );

    expect(adapter.createAuthUser).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password123",
    });
    expect(adapter.completeRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ email: "user@example.com" }),
    );
    expect(adapter.signIn).toHaveBeenCalledWith("user@example.com", "password123");
  });

  it("signs in directly with email", async () => {
    const adapter = ports();

    await loginAccount({ email: "user@example.com", password: "password123", bucket: "login-key" }, adapter);

    expect(adapter.signIn).toHaveBeenCalledWith("user@example.com", "password123");
    expect(adapter.resolveEmail).not.toHaveBeenCalled();
  });

  it("claims the recovery digest before changing the password", async () => {
    const adapter = ports();
    vi.mocked(adapter.readRecoveryDigest).mockResolvedValue(await recoveryDigest());
    const result = await recoverAccount(recoveryInput(), adapter);
    const replaceRecoveryDigest = vi.mocked(adapter.replaceRecoveryDigest);
    const updatePassword = vi.mocked(adapter.updatePassword);

    expect(replaceRecoveryDigest.mock.invocationCallOrder[0]).toBeLessThan(
      updatePassword.mock.invocationCallOrder[0],
    );
    expect(adapter.updatePassword).toHaveBeenCalledWith("user-1", "newpassword123");
    expect(adapter.resolveEmail).toHaveBeenCalledWith("user@example.com");
    expect(adapter.replaceRecoveryDigest).toHaveBeenCalledOnce();
    expect(result.profile).toMatchObject({ id: "user-1", email: "user@example.com" });
    expect(result.recoveryCode.replace(/-/g, "")).toHaveLength(26);
  });

  it("performs zero recovery mutations when the profile lookup fails", async () => {
    const adapter = ports();
    const profileFailure = new Error("profile lookup failed");
    vi.mocked(adapter.readRecoveryDigest).mockResolvedValue(await recoveryDigest());
    vi.mocked(adapter.readProfile).mockRejectedValue(profileFailure);

    await expect(recoverAccount(recoveryInput(), adapter)).rejects.toThrow(profileFailure);

    expect(adapter.replaceRecoveryDigest).not.toHaveBeenCalled();
    expect(adapter.updatePassword).not.toHaveBeenCalled();
    expect(adapter.signIn).not.toHaveBeenCalled();
  });

  it("does not change the password when another recovery claims the digest", async () => {
    const adapter = ports();
    vi.mocked(adapter.readRecoveryDigest).mockResolvedValue(await recoveryDigest());
    vi.mocked(adapter.replaceRecoveryDigest).mockResolvedValue(false);

    await expect(recoverAccount(recoveryInput(), adapter)).rejects.toThrow("RECOVERY_ALREADY_USED");

    expect(adapter.updatePassword).not.toHaveBeenCalled();
    expect(adapter.signIn).not.toHaveBeenCalled();
  });

  it("restores the recovery digest when changing the password fails", async () => {
    const adapter = ports();
    const expected = await recoveryDigest();
    const passwordFailure = new Error("password update failed");
    vi.mocked(adapter.readRecoveryDigest).mockResolvedValue(expected);
    vi.mocked(adapter.updatePassword).mockRejectedValue(passwordFailure);
    vi.mocked(adapter.replaceRecoveryDigest).mockResolvedValueOnce(true).mockResolvedValueOnce(true);

    await expect(recoverAccount(recoveryInput(), adapter)).rejects.toThrow(passwordFailure);

    expect(adapter.replaceRecoveryDigest).toHaveBeenCalledTimes(2);
    const replaceRecoveryDigest = vi.mocked(adapter.replaceRecoveryDigest);
    const [, claimedDigest] = replaceRecoveryDigest.mock.calls[0].slice(1);
    expect(replaceRecoveryDigest.mock.calls[1]).toEqual([
      "user-1",
      claimedDigest,
      expected,
    ]);
    expect(adapter.signIn).not.toHaveBeenCalled();
  });

  it("reports a failed recovery rollback without signing in", async () => {
    const adapter = ports();
    vi.mocked(adapter.readRecoveryDigest).mockResolvedValue(await recoveryDigest());
    vi.mocked(adapter.updatePassword).mockRejectedValue(new Error("password update failed"));
    vi.mocked(adapter.replaceRecoveryDigest).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(recoverAccount(recoveryInput(), adapter)).rejects.toThrow("RECOVERY_ROLLBACK_FAILED");

    expect(adapter.replaceRecoveryDigest).toHaveBeenCalledTimes(2);
    expect(adapter.signIn).not.toHaveBeenCalled();
  });

  it("restores the previous recovery digest when sign-in after recovery fails", async () => {
    const adapter = ports();
    const expected = await recoveryDigest();
    const signInFailure = new Error("INVALID_CREDENTIALS");
    vi.mocked(adapter.readRecoveryDigest).mockResolvedValue(expected);
    vi.mocked(adapter.signIn).mockRejectedValue(signInFailure);
    vi.mocked(adapter.replaceRecoveryDigest).mockResolvedValueOnce(true).mockResolvedValueOnce(true);

    await expect(recoverAccount(recoveryInput(), adapter)).rejects.toThrow(signInFailure);

    const replaceRecoveryDigest = vi.mocked(adapter.replaceRecoveryDigest);
    const [, claimedDigest] = replaceRecoveryDigest.mock.calls[0].slice(1);
    expect(replaceRecoveryDigest.mock.calls[1]).toEqual(["user-1", claimedDigest, expected]);
    expect(adapter.signIn).toHaveBeenCalledOnce();
  });

  it("reports rollback failure when sign-in after recovery fails", async () => {
    const adapter = ports();
    vi.mocked(adapter.readRecoveryDigest).mockResolvedValue(await recoveryDigest());
    vi.mocked(adapter.signIn).mockRejectedValue(new Error("INVALID_CREDENTIALS"));
    vi.mocked(adapter.replaceRecoveryDigest).mockResolvedValueOnce(true).mockRejectedValue(new Error("rollback failed"));

    await expect(recoverAccount(recoveryInput(), adapter)).rejects.toMatchObject({
      name: "AggregateError",
      message: "RECOVERY_ROLLBACK_FAILED",
    });
  });

  it("updates a profile without signing in or requiring a password", async () => {
    const adapter = ports();

    await updateProfile(
      {
        userId: "user-1",
        displayName: "Attention_002",
        avatarKey: 5,
      },
      adapter,
    );

    expect(adapter.signIn).not.toHaveBeenCalled();
    expect(adapter.updateProfile).toHaveBeenCalledWith({
      userId: "user-1",
      displayName: "Attention_002",
      avatarKey: 5,
    });
  });
});
