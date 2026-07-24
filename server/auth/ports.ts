export type AccountProfile = { id: string; displayName: string; avatarKey: number };

export type AuthPorts = {
  rateLimit(input: { action: "register" | "login" | "recover" | "rotate"; bucket: string }): Promise<void>;
  createAuthUser(input: { email: string; password: string }): Promise<{ id: string }>;
  deleteAuthUser(userId: string): Promise<void>;
  completeRegistration(input: {
    userId: string;
    loginName: string;
    authEmail: string;
    avatarKey: number;
    recoveryDigest: Uint8Array;
  }): Promise<AccountProfile>;
  resolveLoginName(name: string): Promise<{ userId: string; authEmail: string } | null>;
  readRecoveryDigest(userId: string): Promise<Uint8Array>;
  replaceRecoveryDigest(userId: string, expected: Uint8Array, next: Uint8Array): Promise<boolean>;
  updateProfileIdentity(input: {
    userId: string;
    loginName: string;
    avatarKey: number;
  }): Promise<AccountProfile>;
  updateProfileAvatar(input: {
    userId: string;
    avatarKey: number;
  }): Promise<AccountProfile>;
  updatePassword(userId: string, password: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
};
