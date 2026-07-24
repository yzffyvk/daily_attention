import { describe, expect, it } from "vitest";
import { ApiSession } from "../helpers/api-session";

const validWrongRecoveryCode = "00000-00000-00000-00000-000000";

describe("authentication routes", () => {
  it("registers, logs out, logs in, updates a profile, and rotates recovery credentials", async () => {
    const session = new ApiSession();
    const name = `测试-${crypto.randomUUID().slice(0, 12)}`;
    const registered = await session.post("/api/auth/register", {
      name,
      password: "password123",
      avatarKey: 4,
    });
    expect(registered.status).toBe(201);
    expect(registered.headers.get("Cache-Control")).toBe("private, no-store");
    expect(registered.body.data.recoveryCode.replace(/-/g, "")).toHaveLength(26);
    const originalRecoveryCode = registered.body.data.recoveryCode as string;

    expect((await session.request("/api/me")).status).toBe(200);
    expect((await new ApiSession().post("/api/auth/register", {
      name,
      password: "password123",
      avatarKey: 1,
    })).status).toBe(409);

    expect((await session.post("/api/auth/logout", {})).status).toBe(200);
    expect((await session.post("/api/auth/login", { name, password: "not-the-password" })).status).toBe(401);
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
    expect((await session.post("/api/auth/login", { name, password: "password123" })).status).toBe(401);
    expect((await session.post("/api/auth/login", { name: renamed, password: "password123" })).status).toBe(200);

    const rotated = await session.post("/api/auth/recovery-code/rotate", { currentPassword: "password123" });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.recoveryCode.replace(/-/g, "")).toHaveLength(26);
    const rotatedRecoveryCode = rotated.body.data.recoveryCode as string;
    await session.post("/api/auth/logout", {});

    expect((await session.post("/api/auth/recover", {
      name: renamed,
      recoveryCode: originalRecoveryCode,
      newPassword: "newpassword123",
    })).status).toBe(401);
    expect((await session.post("/api/auth/recover", {
      name: renamed,
      recoveryCode: validWrongRecoveryCode,
      newPassword: "newpassword123",
    })).status).toBe(401);
    const recovered = await session.post("/api/auth/recover", {
      name: renamed,
      recoveryCode: rotatedRecoveryCode,
      newPassword: "newpassword123",
    });
    expect(recovered.status).toBe(200);
    expect(recovered.body.data.recoveryCode.replace(/-/g, "")).toHaveLength(26);
    expect((await session.post("/api/auth/logout", {})).status).toBe(200);
    expect((await session.post("/api/auth/login", { name: renamed, password: "newpassword123" })).status).toBe(200);
  });

  it("validates requests before service calls", async () => {
    const response = await new ApiSession().post("/api/auth/register", {});
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
