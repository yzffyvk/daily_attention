import { afterAll, describe, expect, it } from "vitest";
import { ApiSession } from "../helpers/api-session";
import {
  cleanupIntegrationFixtures,
  trackIntegrationRateBucket,
  trackIntegrationUser,
} from "../helpers/integration-fixtures";

const validWrongRecoveryCode = "00000-00000-00000-00000-000000";

function fixtureSession() {
  const ip = `integration-${crypto.randomUUID()}`;
  return {
    ip,
    session: new ApiSession(undefined, { "CF-Connecting-IP": ip }),
  };
}

async function register(session: ApiSession, ip: string, name: string, avatarKey: number) {
  trackIntegrationRateBucket("register", ip);
  const response = await session.post("/api/auth/register", { name, password: "password123", avatarKey });
  if (response.status === 201) trackIntegrationUser(response.body.data.profile.id as string);
  return response;
}

function trackNameBucket(action: "login" | "recover", ip: string, name: string) {
  trackIntegrationRateBucket(action, `${ip}:${name}`);
}

afterAll(async () => {
  await cleanupIntegrationFixtures();
});

describe("authentication routes", () => {
  it("registers, logs out, logs in, updates a profile, and rotates recovery credentials", async () => {
    const { ip, session } = fixtureSession();
    const name = `测试-${crypto.randomUUID().slice(0, 12)}`;
    const registered = await register(session, ip, name, 4);
    expect(registered.status).toBe(201);
    expect(registered.headers.get("Cache-Control")).toBe("private, no-store");
    expect(registered.body.data.recoveryCode.replace(/-/g, "")).toHaveLength(26);
    const originalRecoveryCode = registered.body.data.recoveryCode as string;

    expect((await session.request("/api/me")).status).toBe(200);
    const duplicateName = await register(new ApiSession(undefined, { "CF-Connecting-IP": ip }), ip, name, 1);
    expect(duplicateName.status).toBe(409);
    expect(duplicateName.headers.get("Cache-Control")).toBe("private, no-store");
    expect(duplicateName.body.error).toMatchObject({
      code: "NAME_TAKEN",
      details: { field: "name" },
    });

    expect((await session.post("/api/auth/logout", {})).status).toBe(200);
    trackNameBucket("login", ip, name);
    expect((await session.post("/api/auth/login", { name, password: "not-the-password" })).status).toBe(401);
    trackNameBucket("login", ip, name);
    expect((await session.post("/api/auth/login", { name, password: "password123" })).status).toBe(200);

    const renamed = `${name}-新`;
    expect(
      (
        await session.request("/api/me", {
          method: "PATCH",
          body: JSON.stringify({
            name: renamed,
            avatarKey: 5,
            currentPassword: "password123",
          }),
        })
    ).status,
    ).toBe(200);
    await session.post("/api/auth/logout", {});
    trackNameBucket("login", ip, name);
    expect((await session.post("/api/auth/login", { name, password: "password123" })).status).toBe(401);
    trackNameBucket("login", ip, renamed);
    expect((await session.post("/api/auth/login", { name: renamed, password: "password123" })).status).toBe(200);

    trackIntegrationRateBucket("rotate", registered.body.data.profile.id as string);
    const rotated = await session.post("/api/auth/recovery-code/rotate", { currentPassword: "password123" });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.recoveryCode.replace(/-/g, "")).toHaveLength(26);
    const rotatedRecoveryCode = rotated.body.data.recoveryCode as string;
    await session.post("/api/auth/logout", {});

    trackNameBucket("recover", ip, renamed);
    expect((await session.post("/api/auth/recover", {
      name: renamed,
      recoveryCode: originalRecoveryCode,
      newPassword: "newpassword123",
    })).status).toBe(401);
    trackNameBucket("recover", ip, renamed);
    expect((await session.post("/api/auth/recover", {
      name: renamed,
      recoveryCode: validWrongRecoveryCode,
      newPassword: "newpassword123",
    })).status).toBe(401);
    trackNameBucket("recover", ip, renamed);
    const recovered = await session.post("/api/auth/recover", {
      name: renamed,
      recoveryCode: rotatedRecoveryCode,
      newPassword: "newpassword123",
    });
    expect(recovered.status).toBe(200);
    expect(recovered.body.data.recoveryCode.replace(/-/g, "")).toHaveLength(26);
    expect((await session.post("/api/auth/logout", {})).status).toBe(200);
    trackNameBucket("login", ip, renamed);
    expect((await session.post("/api/auth/login", { name: renamed, password: "newpassword123" })).status).toBe(200);
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

    const name = `私密-${crypto.randomUUID().slice(0, 12)}`;
    const registered = await register(session, ip, name, 2);
    expect(registered.status).toBe(201);
    const profile = await session.request("/api/me");
    expect(profile.status).toBe(200);
    expect(profile.body.data.profile).toEqual(expect.objectContaining({ displayName: name, avatarKey: 2 }));
    expect(JSON.stringify(profile.body)).not.toMatch(/auth_email|internal\.invalid|recovery_digest/i);

    const missingPassword = await session.request("/api/me", {
      method: "PATCH",
      body: JSON.stringify({ avatarKey: 3 }),
    });
    expect(missingPassword.status).toBe(422);
    expect(missingPassword.body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      details: { field: "currentPassword" },
    });

    const wrongPassword = await session.request("/api/me", {
      method: "PATCH",
      body: JSON.stringify({ avatarKey: 3, currentPassword: "wrong-password" }),
    });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe("INVALID_CREDENTIALS");

    const changedAvatar = await session.request("/api/me", {
      method: "PATCH",
      body: JSON.stringify({ avatarKey: 3, currentPassword: "password123" }),
    });
    expect(changedAvatar.status).toBe(200);
    expect(changedAvatar.body.data.profile).toMatchObject({ id: profile.body.data.profile.id, displayName: name, avatarKey: 3 });
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
          name: `限流-${crypto.randomUUID().slice(0, 12)}`,
          password: "password123",
          avatarKey: 1,
        }),
      });
      expect(response.status).toBe(201);
      if (response.status === 201) trackIntegrationUser(response.body.data.profile.id as string);
    }

    trackIntegrationRateBucket("register", cloudflareIp);
    const spoofedXff = await session.request("/api/auth/register", {
      method: "POST",
      headers: { ...headers, "X-Forwarded-For": "203.0.113.99" },
      body: JSON.stringify({ name: `限流-${crypto.randomUUID().slice(0, 12)}`, password: "password123", avatarKey: 1 }),
    });
    expect(spoofedXff.status).toBe(429);
    expect(spoofedXff.body.error.code).toBe("RATE_LIMITED");
    expect(spoofedXff.headers.get("Cache-Control")).toBe("private, no-store");

    trackIntegrationRateBucket("register", `${cloudflareIp}-different`);
    const differentVerifiedIp = await session.request("/api/auth/register", {
      method: "POST",
      headers: { "CF-Connecting-IP": `${cloudflareIp}-different`, "X-Forwarded-For": "203.0.113.99" },
      body: JSON.stringify({ name: `限流-${crypto.randomUUID().slice(0, 12)}`, password: "password123", avatarKey: 1 }),
    });
    expect(differentVerifiedIp.status).toBe(201);
    if (differentVerifiedIp.status === 201) trackIntegrationUser(differentVerifiedIp.body.data.profile.id as string);
  });
});
