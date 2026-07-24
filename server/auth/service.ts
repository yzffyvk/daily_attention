import { timingSafeEqual } from "node:crypto";
import type { AuthPorts } from "./ports";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export type RecoveryCodeResult = { recoveryCode: string };

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

export async function registerAccount(
  input: { name: string; password: string; avatarKey: number; bucket: string },
  ports: AuthPorts,
) {
  await ports.rateLimit({ action: "register", bucket: input.bucket });
  const authEmail = `${crypto.randomUUID()}@internal.invalid`;
  const recoveryCode = randomRecoveryCode();
  const authUser = await ports.createAuthUser({ email: authEmail, password: input.password });

  try {
    const profile = await ports.completeRegistration({
      userId: authUser.id,
      loginName: input.name,
      authEmail,
      avatarKey: input.avatarKey,
      recoveryDigest: await digest(recoveryCode),
    });
    await ports.signIn(authEmail, input.password);
    return { profile, recoveryCode };
  } catch (error) {
    await ports.deleteAuthUser(authUser.id);
    throw error;
  }
}

export async function loginAccount(
  input: { name: string; password: string; bucket: string },
  ports: AuthPorts,
) {
  await ports.rateLimit({ action: "login", bucket: input.bucket });
  const account = await ports.resolveLoginName(input.name);
  if (!account) throw new Error("INVALID_CREDENTIALS");
  await ports.signIn(account.authEmail, input.password);
}

export async function recoverAccount(
  input: { name: string; recoveryCode: string; newPassword: string; bucket: string },
  ports: AuthPorts,
): Promise<RecoveryCodeResult> {
  await ports.rateLimit({ action: "recover", bucket: input.bucket });
  const account = await ports.resolveLoginName(input.name);
  if (!account) throw new Error("INVALID_RECOVERY");
  const expected = await ports.readRecoveryDigest(account.userId);
  const supplied = await digest(input.recoveryCode);
  if (!sameDigest(expected, supplied)) throw new Error("INVALID_RECOVERY");

  const recoveryCode = randomRecoveryCode();
  await ports.updatePassword(account.userId, input.newPassword);
  const replaced = await ports.replaceRecoveryDigest(account.userId, expected, await digest(recoveryCode));
  if (!replaced) throw new Error("RECOVERY_ALREADY_USED");
  await ports.signIn(account.authEmail, input.newPassword);
  return { recoveryCode };
}

export async function updateProfile(
  input: {
    userId: string;
    currentName: string;
    nextName: string;
    nextAvatarKey: number;
    currentPassword: string;
  },
  ports: AuthPorts,
) {
  const account = await ports.resolveLoginName(input.currentName);
  if (!account || account.userId !== input.userId) throw new Error("INVALID_CREDENTIALS");
  await ports.signIn(account.authEmail, input.currentPassword);
  return ports.updateProfileIdentity({
    userId: input.userId,
    loginName: input.nextName,
    avatarKey: input.nextAvatarKey,
  });
}

export async function rotateRecoveryCode(
  input: {
    userId: string;
    currentName: string;
    currentPassword: string;
    bucket: string;
  },
  ports: AuthPorts,
): Promise<RecoveryCodeResult> {
  await ports.rateLimit({ action: "rotate", bucket: input.bucket });
  const account = await ports.resolveLoginName(input.currentName);
  if (!account || account.userId !== input.userId) throw new Error("INVALID_CREDENTIALS");
  await ports.signIn(account.authEmail, input.currentPassword);
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
