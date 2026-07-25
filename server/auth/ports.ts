export type AccountProfile = {
  id: string;
  phone: string;
  displayName: string;
  avatarKey: number;
};

export type AuthPorts = {
  rateLimit(input: { action: "register" | "login" | "recover" | "rotate"; bucket: string }): Promise<void>;
  createAuthUser(input: { phone: string; password: string }): Promise<{ id: string }>;
  deleteAuthUser(userId: string): Promise<void>;
  completeRegistration(input: {
    userId: string;
    phone: string;
    avatarKey: number;
    recoveryDigest: Uint8Array;
  }): Promise<AccountProfile>;
  resolvePhone(phone: string): Promise<{ userId: string } | null>;
  readRecoveryDigest(userId: string): Promise<Uint8Array>;
  replaceRecoveryDigest(userId: string, expected: Uint8Array, next: Uint8Array): Promise<boolean>;
  updateProfile(input: {
    userId: string;
    displayName: string;
    avatarKey: number;
  }): Promise<AccountProfile>;
  updatePassword(userId: string, password: string): Promise<void>;
  signIn(phone: string, password: string): Promise<void>;
};
