import { afterAll, describe, expect, it } from "vitest";
import { ApiSession } from "../helpers/api-session";
import {
  cleanupIntegrationFixtures,
  trackIntegrationRateBucket,
  trackIntegrationUser,
  uniqueEmail,
} from "../helpers/integration-fixtures";

const date = "2026-07-23";
let emailSeed = 20_000;

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
  const email = uniqueEmail(emailSeed++);
  trackIntegrationRateBucket("register", ip);
  const response = await session.post("/api/auth/register", {
    email,
    password: "password123",
  });
  if (response.status === 201) {
    const profile = response.body?.data?.profile;
    if (typeof profile?.id === "string" && typeof profile.email === "string") {
      trackIntegrationUser(profile.id, profile.email);
    }
  }
  expect(response.status).toBe(201);
  trackIntegrationRateBucket("login", `${ip}:${email}`);
  expect((await session.post("/api/auth/login", { email, password: "password123" })).status).toBe(200);
  expect((await session.post("/api/onboarding", {
    displayName: "集成测试用户",
    avatarKey: 1,
  })).status).toBe(200);
  return session;
}

afterAll(async () => {
  await cleanupIntegrationFixtures();
});

describe("check-in routes", () => {
  it("preserves AI metadata omitted by old clients and permits explicit clearing", async () => {
    const user = await registeredSession();
    const aiGenerationContext = { userPrompt: "原要求", promptVersion: "knowledge-skeleton-user-prompt-v1" };
    const input = { ...entry(null), entryMode: "ai", userPrompt: "当前要求", aiGenerationContext };
    expect((await user.put(`/api/checkins/${date}`, input)).status).toBe(200);
    const legacySave = await user.put(`/api/checkins/${date}`, { ...entry(1), entryMode: "ai", inspiration: "旧客户端保存的新反思" });
    expect(legacySave.status).toBe(200);
    expect(legacySave.body.data).toMatchObject({ userPrompt: "当前要求", aiGenerationContext, version: 2 });
    expect((await user.get(`/api/checkins/${date}?mode=ai`)).body.data)
      .toMatchObject({ userPrompt: "当前要求", aiGenerationContext, inspiration: "旧客户端保存的新反思" });
    const cleared = await user.put(`/api/checkins/${date}`, { ...entry(2), entryMode: "ai", userPrompt: "", aiGenerationContext: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toMatchObject({ userPrompt: "", aiGenerationContext: null, version: 3 });
  });

  it("persists current AI requirements separately from the context used for the saved summary", async () => {
    const user = await registeredSession();
    const promptDate = "2026-09-23";
    const aiGenerationContext = { userPrompt: "旧要求", promptVersion: "knowledge-skeleton-user-prompt-v1" };
    const input = { ...entry(null), entryMode: "ai", userPrompt: "新要求", aiGenerationContext };
    const created = await user.put(`/api/checkins/${promptDate}`, input);
    expect(created.status).toBe(200);
    expect(created.body.data).toMatchObject({ userPrompt: "新要求", aiGenerationContext });
    const updated = await user.put(`/api/checkins/${promptDate}`, { ...input, userPrompt: "第三个要求", version: 1 });
    expect(updated.status).toBe(200);
    const read = await user.get(`/api/checkins/${promptDate}?mode=ai`);
    expect(read.body.data).toMatchObject({ userPrompt: "第三个要求", aiGenerationContext, version: 2 });
    const conflict = await user.put(`/api/checkins/${promptDate}`, { ...input, version: 1 });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.details.current).toMatchObject({ userPrompt: "第三个要求", aiGenerationContext });
    const manual = await user.put(`/api/checkins/${promptDate}`, { ...input, entryMode: "manual" });
    expect(manual.status).toBe(200);
    expect(manual.body.data).toMatchObject({ userPrompt: "", aiGenerationContext: null });
  });

  it("keeps same-day manual and AI content and versions independent while counting one date", async () => {
    const user = await registeredSession();
    const modeDate = "2026-09-16";
    const manualInput = { ...entry(null), attention: "手写内容", summary: "手写小结", inspiration: "手写反思" };
    const aiInput = { ...entry(null), entryMode: "ai", attention: "AI 内容", summary: "AI 小结", inspiration: "AI 反思" };
    const manual = await user.put(`/api/checkins/${modeDate}`, manualInput);
    const ai = await user.put(`/api/checkins/${modeDate}`, aiInput);
    expect(manual.status).toBe(200);
    expect(ai.status).toBe(200);
    expect(manual.body.data).toMatchObject({ entryMode: "manual", version: 1, attention: "手写内容" });
    expect(ai.body.data).toMatchObject({ entryMode: "ai", version: 1, attention: "AI 内容" });
    expect(ai.body.data.id).not.toBe(manual.body.data.id);
    const updatedAi = await user.put(`/api/checkins/${modeDate}`, { ...aiInput, version: 1, summary: "AI 更新" });
    expect(updatedAi.status).toBe(200);
    expect(updatedAi.body.data.version).toBe(2);
    const staleAi = await user.put(`/api/checkins/${modeDate}`, { ...aiInput, version: 1 });
    expect(staleAi.status).toBe(409);
    expect(staleAi.body.error.details.current).toMatchObject({ id: ai.body.data.id, entryMode: "ai", version: 2 });
    const manualRead = await user.get(`/api/checkins/${modeDate}`);
    expect(manualRead.body.data).toMatchObject({ ...manualInput, entryMode: "manual", version: 1 });
    expect((await user.get(`/api/checkins/${modeDate}?mode=ai`)).body.data).toMatchObject({ entryMode: "ai", summary: "AI 更新", version: 2 });
    const month = await user.get("/api/checkins?month=2026-09");
    expect(month.body.data).toHaveLength(2);
    expect(month.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: modeDate, entryMode: "manual", version: 1 }),
      expect.objectContaining({ date: modeDate, entryMode: "ai", version: 2 }),
    ]));
    expect((await user.get(`/api/checkins/stats?today=${modeDate}`)).body.data).toEqual({ totalCount: 1, currentStreak: 1, hasTodayRecord: true });
    const invalid = await user.get(`/api/checkins/${modeDate}?mode=other`);
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.details.field).toBe("mode");
  });
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

  it("resolves concurrent first saves and updates without depending on request order", async () => {
    const user = await registeredSession();
    const concurrentDate = "2026-07-24";

    const firstSaves = await Promise.all([
      user.put(`/api/checkins/${concurrentDate}`, entry(null)),
      user.put(`/api/checkins/${concurrentDate}`, entry(null)),
    ]);
    const successfulCreates = firstSaves.filter(
      (response) => response.status === 200,
    );
    const createConflicts = firstSaves.filter(
      (response) => response.status === 409,
    );
    expect(successfulCreates).toHaveLength(1);
    expect(createConflicts).toHaveLength(1);

    const created = successfulCreates[0];
    const createConflict = createConflicts[0];
    expect(created.body.data).toMatchObject({
      date: concurrentDate,
      version: 1,
    });
    expect(createConflict.body.error).toMatchObject({
      code: "VERSION_CONFLICT",
    });
    expect(createConflict.body.error.details.current).toEqual(
      created.body.data,
    );

    const updates = await Promise.all([
      user.put(`/api/checkins/${concurrentDate}`, entry(1)),
      user.put(`/api/checkins/${concurrentDate}`, entry(1)),
    ]);
    const successfulUpdates = updates.filter(
      (response) => response.status === 200,
    );
    const updateConflicts = updates.filter(
      (response) => response.status === 409,
    );
    expect(successfulUpdates).toHaveLength(1);
    expect(updateConflicts).toHaveLength(1);

    const updated = successfulUpdates[0];
    const updateConflict = updateConflicts[0];
    expect(updated.body.data).toMatchObject({
      date: concurrentDate,
      version: 2,
    });
    expect(updateConflict.body.error).toMatchObject({
      code: "VERSION_CONFLICT",
      details: { current: { version: 2 } },
    });
    expect(updateConflict.body.error.details.current).toEqual(
      updated.body.data,
    );
  });

  it("returns lifetime totals and a current streak across month boundaries with RLS isolation", async () => {
    const userOne = await registeredSession();
    const userTwo = await registeredSession();
    const dates = [
      "2025-12-20",
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
      "2026-07-10",
    ];
    for (const checkInDate of dates) {
      expect((await userOne.put(`/api/checkins/${checkInDate}`, entry(null))).status).toBe(200);
    }

    const stats = await userOne.get("/api/checkins/stats?today=2026-07-01");
    expect(stats.status).toBe(200);
    expect(stats.body.data).toEqual({
      totalCount: 5,
      currentStreak: 3,
      hasTodayRecord: true,
    });
    expect(stats.headers.get("Cache-Control")).toBe("private, no-store");

    const isolated = await userTwo.get("/api/checkins/stats?today=2026-07-01");
    expect(isolated.status).toBe(200);
    expect(isolated.body.data).toEqual({
      totalCount: 0,
      currentStreak: 0,
      hasTodayRecord: false,
    });
  });

  it("returns session and validation errors without caching", async () => {
    const anonymous = new ApiSession();
    const unauthorized = await anonymous.get(`/api/checkins/${date}`);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.body.error.code).toBe("SESSION_EXPIRED");
    expect(unauthorized.headers.get("Cache-Control")).toBe(
      "private, no-store",
    );
    expect((await anonymous.get("/api/checkins/stats?today=2026-07-01")).status).toBe(401);

    const user = await registeredSession();
    const invalid = await user.get("/api/checkins?month=2026-13");
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
    const invalidStats = await user.get("/api/checkins/stats?today=2026-02-30");
    expect(invalidStats.status).toBe(422);
    expect(invalidStats.body.error.code).toBe("VALIDATION_ERROR");
  });
});
