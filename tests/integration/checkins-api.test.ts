import { afterAll, describe, expect, it } from "vitest";
import { ApiSession } from "../helpers/api-session";
import {
  cleanupIntegrationFixtures,
  trackIntegrationRateBucket,
  trackIntegrationUser,
} from "../helpers/integration-fixtures";

const date = "2026-07-23";

function entry(version: number | null) {
  return {
    attention: `理解版本 ${version ?? "new"}`,
    sourceUrl: "https://example.com/attention",
    summary: "Query、Key、Value 共同计算相关性。",
    inspiration: "尝试把会议纪要按主题聚类。",
    imagePath: null,
    imageName: "",
    version,
  };
}

async function registeredSession() {
  const ip = `checkin-${crypto.randomUUID()}`;
  const session = new ApiSession(undefined, { "CF-Connecting-IP": ip });
  const name = `打卡-${crypto.randomUUID().slice(0, 12)}`;
  trackIntegrationRateBucket("register", ip);
  const response = await session.post("/api/auth/register", {
    name,
    password: "password123",
    avatarKey: 1,
  });
  expect(response.status).toBe(201);
  trackIntegrationUser(response.body.data.profile.id as string);
  return session;
}

afterAll(async () => {
  await cleanupIntegrationFixtures();
});

describe("check-in routes", () => {
  it("uses optimistic versions and isolates records by authenticated user", async () => {
    const userOne = await registeredSession();
    const userTwo = await registeredSession();

    const created = await userOne.put(`/api/checkins/${date}`, entry(null));
    expect(created.status).toBe(200);
    expect(created.body.data.version).toBe(1);
    expect(created.headers.get("Cache-Control")).toBe("private, no-store");

    const updated = await userOne.put(`/api/checkins/${date}`, entry(1));
    expect(updated.status).toBe(200);
    expect(updated.body.data.version).toBe(2);

    const stale = await userOne.put(`/api/checkins/${date}`, entry(1));
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({
      code: "VERSION_CONFLICT",
      details: { current: { version: 2 } },
    });

    const record = await userOne.get(`/api/checkins/${date}`);
    expect(record.status).toBe(200);
    expect(record.body.data).toMatchObject({ date, version: 2 });

    const month = await userOne.get("/api/checkins?month=2026-07");
    expect(month.status).toBe(200);
    expect(month.body.data).toEqual([
      expect.objectContaining({ date, version: 2, hasImage: false }),
    ]);
    expect(month.body.data[0]).not.toHaveProperty("summary");

    expect((await userTwo.get(`/api/checkins/${date}`)).status).toBe(404);
  });

  it("returns session and validation errors without caching", async () => {
    const anonymous = new ApiSession();
    const unauthorized = await anonymous.get(`/api/checkins/${date}`);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.body.error.code).toBe("SESSION_EXPIRED");
    expect(unauthorized.headers.get("Cache-Control")).toBe(
      "private, no-store",
    );

    const user = await registeredSession();
    const invalid = await user.get("/api/checkins?month=2026-13");
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
  });
});
