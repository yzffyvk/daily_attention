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

function patch(session: ApiSession, path: string, body: unknown) {
  return session.request(path, { method: "PATCH", body: JSON.stringify(body) });
}
function recordInput(overrides: Record<string, unknown> = {}) {
  const content: Partial<ReturnType<typeof entry>> = { ...entry(null) };
  delete content.version;
  return { ...content, id: crypto.randomUUID(), date, entryMode: "manual", albumId: null, status: "completed", ...overrides };
}

describe("independent learning records and albums API", () => {
  it("preserves multiple same-day records and rejects retired date writes", async () => {
    const user = await registeredSession();
    const first = await user.post("/api/records", recordInput({ attention: "First" }));
    const second = await user.post("/api/records", recordInput({ attention: "Second" }));
    expect(first.status).toBe(201); expect(second.status).toBe(201);
    expect(first.body.data.id).not.toBe(second.body.data.id);
    const read = await user.get(`/api/records?date=${date}`);
    expect(read.body.data.records).toHaveLength(2);
    expect(read.body.data.records.map((r: { attention: string }) => r.attention)).toEqual(expect.arrayContaining(["First", "Second"]));
    expect((await user.get(`/api/checkins/${date}`)).body.error.code).toBe("CLIENT_UPGRADE_REQUIRED");
    expect((await user.put(`/api/checkins/${date}`, entry(1))).body.error.code).toBe("CLIENT_UPGRADE_REQUIRED");
    expect((await user.get(`/api/checkins/stats?today=${date}`)).body.data.totalCount).toBe(1);
  });

  it("supports collection, single-album moves, completion and safe album removal", async () => {
    const user = await registeredSession();
    const album = await user.post("/api/albums", { name: "AI 产品", description: "持续学习" });
    expect(album.status).toBe(201);
    const created = await user.post("/api/records", recordInput({ attention: "", sourceUrl: "https://example.com#chapter", summary: "", status: "pending" }));
    expect(created.status).toBe(201);
    const record = created.body.data;
    expect(record).toMatchObject({ attention: "example.com", sourceUrl: "https://example.com/", status: "pending", completedAt: null });
    expect((await user.get(`/api/checkins/stats?today=${date}`)).body.data.totalCount).toBe(0);
    expect((await user.post("/api/records/move", { recordIds: [record.id], albumId: album.body.data.id })).body.data.moved).toBe(1);
    expect((await user.get(`/api/records/${record.id}`)).body.data.version).toBe(1);
    const completed = await patch(user, `/api/records/${record.id}`, { version: 1, status: "completed", summary: "我学到的内容" });
    expect(completed.status).toBe(200); expect(completed.body.data.completedAt).toEqual(expect.any(String));
    expect((await user.get("/api/albums")).body.data[0]).toMatchObject({ recordCount: 1, completedCount: 1 });
    expect((await user.request(`/api/albums/${album.body.data.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await user.get(`/api/records/${record.id}`)).body.data).toMatchObject({ albumId: null, summary: "我学到的内容", status: "completed" });
  });

  it("uses stable create IDs and optimistic update/delete without overwriting another record", async () => {
    const user = await registeredSession(); const input = recordInput();
    const creates = await Promise.all([user.post("/api/records", input), user.post("/api/records", input)]);
    expect(creates.map(r => r.status)).toEqual([201,201]);
    expect((await user.get(`/api/records?date=${date}`)).body.data.records).toHaveLength(1);
    const updates = await Promise.all([
      patch(user, `/api/records/${input.id}`, { version: 1, summary: "first change" }),
      patch(user, `/api/records/${input.id}`, { version: 1, summary: "second change" }),
    ]);
    expect(updates.map(r => r.status).sort()).toEqual([200,409]);
    expect((await user.request(`/api/records/${input.id}?version=1`, { method: "DELETE" })).status).toBe(409);
    expect((await user.request(`/api/records/${input.id}?version=2`, { method: "DELETE" })).status).toBe(200);
    expect((await user.get(`/api/records/${input.id}`)).status).toBe(404);
  });

  it("isolates albums and records and rejects a mixed-owner batch atomically", async () => {
    const owner = await registeredSession(); const other = await registeredSession();
    const record = (await owner.post("/api/records", recordInput())).body.data;
    const foreign = (await other.post("/api/records", recordInput())).body.data;
    const album = (await owner.post("/api/albums", { name: "My album" })).body.data;
    expect((await other.get(`/api/records/${record.id}`)).status).toBe(404);
    expect((await owner.post("/api/records/move", { recordIds: [record.id,foreign.id], albumId: album.id })).status).toBe(404);
    expect((await owner.get(`/api/records/${record.id}`)).body.data.albumId).toBeNull();
    expect((await other.request(`/api/albums/${album.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await other.get("/api/albums")).body.data).toEqual([]);
  });

  it("returns uncacheable auth/validation errors and prevents date reassignment", async () => {
    const anonymous = new ApiSession();
    const response = await anonymous.get("/api/records"); expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const user = await registeredSession();
    expect((await user.get("/api/records?limit=10000")).status).toBe(422);
    const record = (await user.post("/api/records", recordInput())).body.data;
    expect((await patch(user, `/api/records/${record.id}`, { version: 1, date: "2026-07-24" })).status).toBe(422);
  });
});
