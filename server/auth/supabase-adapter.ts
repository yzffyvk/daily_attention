import "server-only";

import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/server/rate-limit/service";
import { z } from "zod";
import type { AccountProfile, AuthPorts } from "./ports";

type SupabaseError = { code?: string; message?: string };

const databaseProfileSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  display_name: z.string().min(1),
  avatar_key: z.number().int().min(1).max(5),
});
const emailResolutionSchema = z.array(z.object({ user_id: z.string().min(1) })).max(1);
const recoveryChallengeSchema = z
  .array(
    z.object({
      user_id: z.string().uuid().nullable(),
      recovery_code_digest: z.string(),
    }),
  )
  .length(1);

function isInvalidCredentialsError(error: SupabaseError) {
  return error.code === "invalid_credentials";
}

function bytea(value: Uint8Array) {
  return `\\x${Buffer.from(value).toString("hex")}`;
}

function bytes(value: string) {
  const hex = value.replace(/^\\x/u, "");
  if (!/^[0-9a-f]{64}$/iu.test(hex)) throw new Error("Malformed recovery digest");
  return new Uint8Array(Buffer.from(hex, "hex"));
}

function profile(value: unknown): AccountProfile {
  const parsed = databaseProfileSchema.safeParse(value);
  if (!parsed.success) throw new Error("Malformed profile response");

  return {
    id: parsed.data.id,
    email: parsed.data.email,
    displayName: parsed.data.display_name,
    avatarKey: parsed.data.avatar_key,
  };
}

function throwIfError(error: SupabaseError | null) {
  if (error) throw error;
}

export async function createSupabaseAuthAdapter() {
  const admin = createAdminSupabase();
  const server = await createServerSupabase();

  const ports: AuthPorts = {
    async rateLimit({ action, bucket }) {
      await consumeRateLimit(
        action,
        bucket,
        admin as unknown as {
          rpc: (name: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
        },
      );
    },
    async createAuthUser({ email, password }) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      throwIfError(error);
      if (!data.user) throw new Error("Auth user was not created");
      return { id: data.user.id };
    },
    async deleteAuthUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      throwIfError(error);
    },
    async completeRegistration(input) {
      const { data, error } = await admin.rpc("complete_registration", {
        target_user_id: input.userId,
        target_email: input.email,
        target_avatar_key: input.avatarKey,
        target_recovery_digest: bytea(input.recoveryDigest),
      });
      throwIfError(error);
      if (!data) throw new Error("Profile was not created");
      return profile(data);
    },
    async resolveEmail(email) {
      const { data, error } = await admin.rpc("resolve_email", {
        target_email: email,
      });
      throwIfError(error);
      const parsed = emailResolutionSchema.safeParse(data);
      if (!parsed.success) throw new Error("Malformed email resolution response");
      const account = parsed.data[0];
      return account ? { userId: account.user_id } : null;
    },
    async resolveRecoveryChallenge(email) {
      const { data, error } = await admin.rpc("resolve_recovery_challenge", {
        target_email: email,
      });
      throwIfError(error);
      const parsed = recoveryChallengeSchema.safeParse(data);
      if (!parsed.success) throw new Error("Malformed recovery challenge response");
      const challenge = parsed.data[0];
      return {
        userId: challenge.user_id,
        recoveryDigest: bytes(challenge.recovery_code_digest),
      };
    },
    async readProfile(userId) {
      const { data, error } = await admin.rpc("read_profile", {
        target_user_id: userId,
      });
      throwIfError(error);
      if (!data) throw new Error("PROFILE_NOT_FOUND");
      return profile(data);
    },
    async readRecoveryDigest(userId) {
      const { data, error } = await admin.rpc("read_recovery_digest", {
        target_user_id: userId,
      });
      throwIfError(error);
      if (typeof data !== "string") throw new Error("Recovery digest was not found");
      return bytes(data);
    },
    async replaceRecoveryDigest(userId, expected, next) {
      const { data, error } = await admin.rpc("replace_recovery_digest", {
        target_user_id: userId,
        expected_digest: bytea(expected),
        next_digest: bytea(next),
      });
      throwIfError(error);
      if (typeof data !== "boolean") throw new Error("Malformed recovery update response");
      return data;
    },
    async updateProfile(input) {
      const { data, error } = await admin.rpc("update_profile", {
        target_user_id: input.userId,
        target_display_name: input.displayName,
        target_avatar_key: input.avatarKey,
      });
      throwIfError(error);
      if (!data) throw new Error("Profile was not updated");
      return profile(data);
    },
    async updatePassword(userId, password) {
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      throwIfError(error);
    },
    async signIn(email, password) {
      const { data, error } = await server.auth.signInWithPassword({ email, password });
      if (error) {
        if (isInvalidCredentialsError(error)) throw new Error("INVALID_CREDENTIALS");
        throw error;
      }
      if (!data.user || !data.session) throw new Error("Malformed sign-in response");
    },
  };

  return {
    ports,
    async signOut() {
      const { error } = await server.auth.signOut();
      throwIfError(error);
    },
    async currentUser() {
      const { data, error } = await server.auth.getUser();
      if (error || !data.user) throw new Error("UNAUTHORIZED");
      return data.user;
    },
    async currentProfile(userId: string) {
      const { data, error } = await server
        .from("profiles")
        .select("id, email, display_name, avatar_key")
        .eq("id", userId)
        .maybeSingle();
      throwIfError(error);
      if (!data) throw new Error("PROFILE_NOT_FOUND");
      return profile(data);
    },
  };
}
