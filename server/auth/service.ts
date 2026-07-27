import { timingSafeEqual } from "node:crypto";
import type { AuthPorts } from "./ports";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export type RecoveryCodeResult = { recoveryCode: string };
export type RecoveryResult = RecoveryCodeResult & {
  profile: Awaited<ReturnType<AuthPorts["readProfile"]>>;
};

function randomRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(26));
  const raw = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
  return [
    raw.slice(0, 5),
    raw.slice(5, 10),
    raw.slice(10, 15),
    raw.slice(15, 20),
    raw.slice(20),
  ].join("-");
}

async function digest(value: string) {
  const raw = value.replace(/-/g, "").toUpperCase();
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
}

function sameDigest(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

async function restoreRecoveryDigest(
  ports: AuthPorts,
  userId: string,
  next: Uint8Array,
  expected: Uint8Array,
  cause: unknown,
): Promise<never> {
  try {
    if (await ports.replaceRecoveryDigest(userId, next, expected)) throw cause;
    throw new Error("Conditional recovery digest rollback did not apply");
  } catch (rollbackError) {
    if (rollbackError === cause) throw cause;
    throw new AggregateError([cause, rollbackError], "RECOVERY_ROLLBACK_FAILED");
  }
}

export async function registerAccount(
  input: { email: string; password: string; avatarKey: number; bucket: string },
  ports: AuthPorts,
) {
  await ports.rateLimit({ action: "register", bucket: input.bucket });
  const recoveryCode = randomRecoveryCode();
  const authUser = await ports.createAuthUser({ email: input.email, password: input.password });

  try {
    const profile = await ports.completeRegistration({
      userId: authUser.id,
      email: input.email,
      avatarKey: input.avatarKey,
      recoveryDigest: await digest(recoveryCode),
    });
    await ports.signIn(input.email, input.password);
    return { profile, recoveryCode };
  } catch (error) {
    await ports.deleteAuthUser(authUser.id);
    throw error;
  }
}

export async function loginAccount(
  input: { email: string; password: string; bucket: string },
  ports: AuthPorts,
) {
  await ports.rateLimit({ action: "login", bucket: input.bucket });
  await ports.signIn(input.email, input.password);
}

export async function recoverAccount(
  input: { email: string; recoveryCode: string; newPassword: string; bucket: string },
  ports: AuthPorts,
): Promise<RecoveryResult> {
  await ports.rateLimit({ action: "recover", bucket: input.bucket });
  const account = await ports.resolveEmail(input.email);
  if (!account) throw new Error("INVALID_RECOVERY");
  const expected = await ports.readRecoveryDigest(account.userId);
  const supplied = await digest(input.recoveryCode);
  if (!sameDigest(expected, supplied)) throw new Error("INVALID_RECOVERY");
  const profile = await ports.readProfile(account.userId);
  if (profile.id !== account.userId || profile.email !== input.email) {
    throw new Error("PROFILE_NOT_FOUND");
  }

  const recoveryCode = randomRecoveryCode();
  const next = await digest(recoveryCode);
  const replaced = await ports.replaceRecoveryDigest(account.userId, expected, next);
  if (!replaced) throw new Error("RECOVERY_ALREADY_USED");

  try {
    await ports.updatePassword(account.userId, input.newPassword);
  } catch (passwordError) {
    await restoreRecoveryDigest(ports, account.userId, next, expected, passwordError);
  }

  try {
    await ports.signIn(input.email, input.newPassword);
  } catch (signInError) {
    await restoreRecoveryDigest(ports, account.userId, next, expected, signInError);
  }
  return { profile, recoveryCode };
}

export async function updateProfile(
  input: {
    userId: string;
    displayName: string;
    avatarKey: number;
  },
  ports: AuthPorts,
) {
  return ports.updateProfile({
    userId: input.userId,
    displayName: input.displayName,
    avatarKey: input.avatarKey,
  });
}

export async function rotateRecoveryCode(
  input: {
    userId: string;
    email: string;
    currentPassword: string;
    bucket: string;
  },
  ports: AuthPorts,
): Promise<RecoveryCodeResult> {
  await ports.rateLimit({ action: "rotate", bucket: input.bucket });
  const account = await ports.resolveEmail(input.email);
  if (!account || account.userId !== input.userId) throw new Error("INVALID_CREDENTIALS");
  await ports.signIn(input.email, input.currentPassword);
  const expected = await ports.readRecoveryDigest(input.userId);
  const recoveryCode = randomRecoveryCode();
  const replaced = await ports.replaceRecoveryDigest(
    input.userId,
    expected,
    await digest(recoveryCode),
  );
  if (!replaced) throw new Error("RECOVERY_ALREADY_USED");
  return { recoveryCode };
}
