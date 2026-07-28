import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ApiSession } from "../helpers/api-session";
import {
  cleanupIntegrationFixtures,
  confirmIntegrationAuthOwnership,
  trackIntegrationRateBucket,
  trackIntegrationUser,
  uniqueEmail,
} from "../helpers/integration-fixtures";

const validWrongRecoveryCode = "00000-00000-00000-00000-000000";
let emailSeed = 10_000;

function fixtureSession() {
  const ip = `integration-${crypto.randomUUID()}`;
  return {
    ip,
    session: new ApiSession(undefined, { "CF-Connecting-IP": ip }),
  };
}

async function register(session: ApiSession, ip: string, email: string) {
  trackIntegrationRateBucket("register", ip);
  const response = await session.post("/api/auth/register", { email, password: "password123" });
  if (response.status === 201) trackIntegrationUser(response.body.data.profile.id as string, email);
  return response;
}

function trackEmailBucket(action: "login" | "recover", ip: string, email: string) {
  trackIntegrationRateBucket(action, `${ip}:${email}`);
}

afterAll(async () => {
  await cleanupIntegrationFixtures();
});

describe("authentication routes", () => {
  it("rejects direct Supabase sign-up outside the application registration route", async () => {
    const url = process.env.TEST_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !publishableKey) throw new Error("Missing integration Supabase bindings");
    const directClient = createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });

    const email = uniqueEmail(emailSeed++);
    const { data, error } = await directClient.auth.signUp({
      email,
      password: "password123",
    });
    if (data.user) {
      const ownership = confirmIntegrationAuthOwnership(data.user, email);
      trackIntegrationUser(ownership.userId, ownership.email);
    }

    expect(data.user === null).toBe(true);
    expect(data.session === null).toBe(true);
    expect(error?.code === "signup_disabled").toBe(true);
    expect(error?.status === 422).toBe(true);
  });

  it("registers, logs out, logs in, updates a profile, and rotates recovery credentials", async () => {
    const { ip, session } = fixtureSession();
    const email = uniqueEmail(emailSeed++);
    const registered = await register(session, ip, email);
    expect(registered.status).toBe(201);
    expect(registered.headers.get("Cache-Control")).toBe("private, no-store");
    expect(registered.body.data.recoveryCode.replace(/-/g, "")).toHaveLength(26);
    expect(registered.body.data.profile).toEqual(expect.objectContaining({
      email,
      displayName: expect.stringMatching(/^Attention_[0-9]{3}$/),
      avatarKey: 1,
      onboardingCompleted: false,
    }));
    const originalRecoveryCode = registered.body.data.recoveryCode as string;

    expect((await session.request("/api/me")).status).toBe(401);
    const duplicateEmail = await register(new ApiSession(undefined, { "CF-Connecting-IP": ip }), ip, email);
    expect(duplicateEmail.status).toBe(409);
    expect(duplicateEmail.headers.get("Cache-Control")).toBe("private, no-store");
    expect(duplicateEmail.body.error).toMatchObject({
      code: "EMAIL_TAKEN",
      details: { field: "email" },
    });

    expect((await session.post("/api/auth/logout", {})).status).toBe(200);
    trackEmailBucket("login", ip, email);
    expect((await session.post("/api/auth/login", { email, password: "not-the-password" })).status).toBe(401);
    trackEmailBucket("login", ip, email);
    expect((await session.post("/api/auth/login", { email, password: "password123" })).status).toBe(200);

    const renamed = "测试用户新名称";
    const onboarded = await session.post("/api/onboarding", {
      displayName: renamed,
      avatarKey: 5,
    });
    expect(onboarded.status).toBe(200);
    expect(onboarded.body.data.profile).toMatchObject({
      email,
      displayName: renamed,
      avatarKey: 5,
      onboardingCompleted: true,
    });
    expect(
      (
        await session.request("/api/me", {
          method: "PATCH",
          body: JSON.stringify({
            displayName: renamed,
            avatarKey: 5,
          }),
        })
    ).status,
    ).toBe(200);
    const avatarOnlyAfterRename = await session.request("/api/me", {
      method: "PATCH",
      body: JSON.stringify({ avatarKey: 1 }),
    });
    expect(avatarOnlyAfterRename.status).toBe(200);
    expect(avatarOnlyAfterRename.body.data.profile).toMatchObject({
      email,
      displayName: renamed,
      avatarKey: 1,
    });
    await session.post("/api/auth/logout", {});
    trackEmailBucket("login", ip, email);
    expect((await session.post("/api/auth/login", { email, password: "password123" })).status).toBe(200);

    trackIntegrationRateBucket("rotate", registered.body.data.profile.id as string);
    const rotated = await session.post("/api/auth/recovery-code/rotate", { currentPassword: "password123" });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.recoveryCode.replace(/-/g, "")).toHaveLength(26);
    const rotatedRecoveryCode = rotated.body.data.recoveryCode as string;
    await session.post("/api/auth/logout", {});

    trackEmailBucket("recover", ip, email);
    expect((await session.post("/api/auth/recover", {
      email,
      recoveryCode: originalRecoveryCode,
      newPassword: "newpassword123",
    })).status).toBe(401);
    trackEmailBucket("recover", ip, email);
    expect((await session.post("/api/auth/recover", {
      email,
      recoveryCode: validWrongRecoveryCode,
      newPassword: "newpassword123",
    })).status).toBe(401);
    trackEmailBucket("recover", ip, email);
    const recovered = await session.post("/api/auth/recover", {
      email,
      recoveryCode: rotatedRecoveryCode,
      newPassword: "newpassword123",
    });
    expect(recovered.status).toBe(200);
    expect(recovered.body.data.recoveryCode.replace(/-/g, "")).toHaveLength(26);
    expect((await session.post("/api/auth/logout", {})).status).toBe(200);
    trackEmailBucket("login", ip, email);
    expect((await session.post("/api/auth/login", { email, password: "newpassword123" })).status).toBe(200);
  });

  it("blocks native Auth email flows without changing the account or its password", async () => {
    const url = process.env.TEST_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !publishableKey) throw new Error("Missing integration Supabase bindings");

    const { ip, session } = fixtureSession();
    const email = uniqueEmail(emailSeed++);
    const password = "password123";
    const registered = await register(session, ip, email);
    expect(registered.status).toBe(201);
    const userId = registered.body.data.profile.id as string;
    await session.post("/api/auth/logout", {});

    const directClient = createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const passwordless = await directClient.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    expect(passwordless.data.user === null).toBe(true);
    expect(passwordless.data.session === null).toBe(true);
    expect(passwordless.error === null).toBe(false);

    const reset = await directClient.auth.resetPasswordForEmail(email);
    expect(reset.error === null).toBe(false);

    const signedIn = await directClient.auth.signInWithPassword({ email, password });
    expect(signedIn.error === null).toBe(true);
    expect(signedIn.data.user?.email === email).toBe(true);

    const changedEmail = uniqueEmail(emailSeed++);
    const changed = await directClient.auth.updateUser({ email: changedEmail });
    expect(changed.error === null).toBe(false);

    const currentUser = await directClient.auth.getUser();
    expect(currentUser.error === null).toBe(true);
    expect(currentUser.data.user?.id === userId).toBe(true);
    expect(currentUser.data.user?.email === email).toBe(true);

    const profile = await directClient
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .single();
    expect(profile.error === null).toBe(true);
    expect(profile.data?.email === email).toBe(true);

    await directClient.auth.signOut({ scope: "local" });
    const originalPassword = await directClient.auth.signInWithPassword({ email, password });
    expect(originalPassword.error === null).toBe(true);
    expect(originalPassword.data.user?.id === userId).toBe(true);
    expect(originalPassword.data.user?.email === email).toBe(true);
  });

  it("validates requests before service calls", async () => {
    const response = await new ApiSession().post("/api/auth/register", {});
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("returns meaningful no-store failures without leaking sensitive profile fields", async () => {
    const { ip, session } = fixtureSession();
    const unauthenticatedProfile = await session.request("/api/me");
    expect(unauthenticatedProfile.status).toBe(401);
    expect(unauthenticatedProfile.body.error.code).toBe("UNAUTHORIZED");
    expect(unauthenticatedProfile.headers.get("Cache-Control")).toBe("private, no-store");

    const unauthenticatedRotation = await session.post("/api/auth/recovery-code/rotate", { currentPassword: "password123" });
    expect(unauthenticatedRotation.status).toBe(401);
    expect(unauthenticatedRotation.body.error.code).toBe("UNAUTHORIZED");
    expect(unauthenticatedRotation.headers.get("Cache-Control")).toBe("private, no-store");

    const malformed = await session.request("/api/auth/register", { method: "POST", body: "{" });
    expect(malformed.status).toBe(422);
    expect(malformed.body.error).toMatchObject({ code: "VALIDATION_ERROR", details: {} });
    expect(malformed.headers.get("Cache-Control")).toBe("private, no-store");

    const email = uniqueEmail(emailSeed++);
    const registered = await register(session, ip, email);
    expect(registered.status).toBe(201);
    trackEmailBucket("login", ip, email);
    expect((await session.post("/api/auth/login", { email, password: "password123" })).status).toBe(200);
    const profile = await session.request("/api/me");
    expect(profile.status).toBe(200);
    expect(profile.body.data.profile).toEqual(expect.objectContaining({
      email,
      displayName: expect.stringMatching(/^Attention_[0-9]{3}$/),
      avatarKey: 1,
      onboardingCompleted: false,
    }));
    expect(JSON.stringify(profile.body)).not.toMatch(/auth_email|internal\.invalid|recovery_digest/i);
    const displayName = profile.body.data.profile.displayName as string;

    const missingPassword = await session.request("/api/me", {
      method: "PATCH",
      body: JSON.stringify({ avatarKey: 3 }),
    });
    expect(missingPassword.status).toBe(200);
    expect(missingPassword.body.data.profile).toMatchObject({
      id: profile.body.data.profile.id,
      email,
      displayName,
      avatarKey: 3,
    });

    const invalidDisplayName = await session.request("/api/me", {
      method: "PATCH",
      body: JSON.stringify({ displayName: "超过二十个字符的资料名称不应被接口接受测试", avatarKey: 3 }),
    });
    expect(invalidDisplayName.status).toBe(422);
    expect(invalidDisplayName.body.error.code).toBe("VALIDATION_ERROR");

    const changedAvatar = await session.request("/api/me", {
      method: "PATCH",
      body: JSON.stringify({ avatarKey: 4 }),
    });
    expect(changedAvatar.status).toBe(200);
    expect(changedAvatar.body.data.profile).toMatchObject({
      id: profile.body.data.profile.id,
      email,
      displayName,
      avatarKey: 4,
    });
  });

  it("rate-limits by verified Cloudflare identity rather than spoofed X-Forwarded-For", async () => {
    const session = new ApiSession();
    const cloudflareIp = `cf-${crypto.randomUUID()}`;
    const headers = { "CF-Connecting-IP": cloudflareIp };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      trackIntegrationRateBucket("register", cloudflareIp);
      const response = await session.request("/api/auth/register", {
        method: "POST",
        headers: { ...headers, "X-Forwarded-For": `198.51.100.${attempt}` },
        body: JSON.stringify({
          email: uniqueEmail(emailSeed++),
          password: "password123",
        }),
      });
      expect(response.status).toBe(201);
      if (response.status === 201) trackIntegrationUser(response.body.data.profile.id as string, response.body.data.profile.email as string);
    }

    trackIntegrationRateBucket("register", cloudflareIp);
    const spoofedXff = await session.request("/api/auth/register", {
      method: "POST",
      headers: { ...headers, "X-Forwarded-For": "203.0.113.99" },
      body: JSON.stringify({ email: uniqueEmail(emailSeed++), password: "password123" }),
    });
    expect(spoofedXff.status).toBe(429);
    expect(spoofedXff.body.error.code).toBe("RATE_LIMITED");
    expect(spoofedXff.headers.get("Cache-Control")).toBe("private, no-store");

    trackIntegrationRateBucket("register", `${cloudflareIp}-different`);
    const differentVerifiedIp = await session.request("/api/auth/register", {
      method: "POST",
      headers: { "CF-Connecting-IP": `${cloudflareIp}-different`, "X-Forwarded-For": "203.0.113.99" },
      body: JSON.stringify({ email: uniqueEmail(emailSeed++), password: "password123" }),
    });
    expect(differentVerifiedIp.status).toBe(201);
    if (differentVerifiedIp.status === 201) trackIntegrationUser(differentVerifiedIp.body.data.profile.id as string, differentVerifiedIp.body.data.profile.email as string);
  });
});
