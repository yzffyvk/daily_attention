import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ApiSession } from "../helpers/api-session";
import {
  cleanupIntegrationFixtures,
  trackIntegrationRateBucket,
  trackIntegrationUser,
} from "../helpers/integration-fixtures";

const date = "2026-07-23";

async function registeredSession() {
  const ip = `storage-${crypto.randomUUID()}`;
  const session = new ApiSession(undefined, { "CF-Connecting-IP": ip });
  trackIntegrationRateBucket("register", ip);
  const response = await session.post("/api/auth/register", {
    name: `图片-${crypto.randomUUID().slice(0, 12)}`,
    password: "password123",
    avatarKey: 1,
  });
  expect(response.status).toBe(201);
  const userId = response.body.data.profile.id as string;
  trackIntegrationUser(userId);
  return { session, userId };
}

function checkIn(imagePath: string | null, version: number | null) {
  return {
    attention: "私有图片",
    sourceUrl: "",
    summary: "",
    inspiration: "",
    imagePath,
    imageName: imagePath ? "checkin.png" : "",
    version,
  };
}

afterAll(async () => {
  await cleanupIntegrationFixtures();
});

describe("private check-in image storage", () => {
  it("lets the owner upload, read, and delete while rejecting another user", async () => {
    const userOne = await registeredSession();
    const userTwo = await registeredSession();
    const signedUpload = await userOne.session.post("/api/uploads/checkin-image", {
      date,
      mimeType: "image/png",
      size: 3,
    });
    expect(signedUpload.status).toBe(200);
    expect(signedUpload.headers.get("Cache-Control")).toBe("private, no-store");
    const { path, token } = signedUpload.body.data as { path: string; token: string };
    expect(path).toMatch(new RegExp(`^${userOne.userId}/${date}/[0-9a-f-]+\\.png$`, "u"));

    const url = process.env.TEST_SUPABASE_URL!;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const storage = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
    const uploaded = await storage.storage
      .from("checkin-images")
      .uploadToSignedUrl(path, token, new Uint8Array([137, 80, 78]), {
        contentType: "image/png",
      });
    expect(uploaded.error).toBeNull();

    expect((await userOne.session.put(`/api/checkins/${date}`, checkIn(path, null))).status).toBe(200);
    const read = await userOne.session.get(`/api/checkins/${date}`);
    expect(read.status).toBe(200);
    expect(read.body.data.imageUrl).toEqual(expect.stringContaining("/storage/v1/object/sign/"));
    const signedReadUrl = read.body.data.imageUrl as string;
    expect((await fetch(signedReadUrl)).status).toBe(200);

    expect(
      (await userTwo.session.put(`/api/checkins/${date}`, checkIn(null, null))).status,
    ).toBe(200);
    const foreignPersist = await userTwo.session.put(
      `/api/checkins/${date}`,
      checkIn(path, 1),
    );
    expect(foreignPersist.status).toBe(403);
    expect(foreignPersist.headers.get("Cache-Control")).toBe("private, no-store");
    expect(foreignPersist.body.error.code).toBe("FORBIDDEN_IMAGE_PATH");
    const userTwoRecord = await userTwo.session.get(`/api/checkins/${date}`);
    expect(userTwoRecord.status).toBe(200);
    expect(userTwoRecord.body.data).toMatchObject({ imagePath: null, imageUrl: null, version: 1 });

    const forbidden = await userTwo.session.request("/api/uploads/checkin-image", {
      method: "DELETE",
      body: JSON.stringify({ path }),
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN_IMAGE_PATH");

    const deleted = await userOne.session.request("/api/uploads/checkin-image", {
      method: "DELETE",
      body: JSON.stringify({ path }),
    });
    expect(deleted.status).toBe(200);
    expect((await fetch(signedReadUrl)).status).not.toBe(200);
  });

  it("validates signed-upload metadata and authentication", async () => {
    const anonymous = new ApiSession();
    expect(
      (await anonymous.post("/api/uploads/checkin-image", {
        date,
        mimeType: "image/png",
        size: 1,
      })).status,
    ).toBe(401);

    const { session } = await registeredSession();
    expect(
      (await session.post("/api/uploads/checkin-image", {
        date: "2026-02-29",
        mimeType: "image/png",
        size: 1,
      })).status,
    ).toBe(422);
    expect(
      (await session.post("/api/uploads/checkin-image", {
        date,
        mimeType: "image/gif",
        size: 1,
      })).status,
    ).toBe(422);
    expect(
      (await session.post("/api/uploads/checkin-image", {
        date,
        mimeType: "image/png",
        size: 10 * 1024 * 1024 + 1,
      })).status,
    ).toBe(413);
  });

  it("returns 429 after five signed-upload requests in ten minutes", async () => {
    const { session } = await registeredSession();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await session.post("/api/uploads/checkin-image", {
        date,
        mimeType: "image/png",
        size: 1024,
      });
      expect(response.status).toBe(200);
    }

    const limited = await session.post("/api/uploads/checkin-image", {
      date,
      mimeType: "image/png",
      size: 1024,
    });

    expect(limited.status).toBe(429);
    expect(limited.headers.get("Cache-Control")).toBe("private, no-store");
    expect(limited.body.error).toMatchObject({
      code: "RATE_LIMITED",
      message: "图片上传过于频繁或存储空间已达上限",
    });
  });
});
