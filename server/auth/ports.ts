export type AccountProfile = {
  id: string;
  email: string;
  displayName: string;
  avatarKey: number;
};

export type AuthPorts = {
  rateLimit(input: { action: "register" | "login" | "recover" | "rotate"; bucket: string }): Promise<void>;
  createAuthUser(input: { email: string; password: string }): Promise<{ id: string }>;
  deleteAuthUser(userId: string): Promise<void>;
  completeRegistration(input: {
    userId: string;
    email: string;
    avatarKey: number;
    recoveryDigest: Uint8Array;
  }): Promise<AccountProfile>;
  resolveEmail(email: string): Promise<{ userId: string } | null>;
  resolveRecoveryChallenge(email: string): Promise<{ userId: string | null; recoveryDigest: Uint8Array }>;
  readProfile(userId: string): Promise<AccountProfile>;
  readRecoveryDigest(userId: string): Promise<Uint8Array>;
  replaceRecoveryDigest(userId: string, expected: Uint8Array, next: Uint8Array): Promise<boolean>;
  updateProfile(input: {
    userId: string;
    displayName: string;
    avatarKey: number;
  }): Promise<AccountProfile>;
  updatePassword(userId: string, password: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
};
