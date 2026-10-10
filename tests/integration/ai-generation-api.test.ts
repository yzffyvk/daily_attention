import { afterAll, describe, expect, it } from "vitest";
import { ApiSession } from "../helpers/api-session";
import {
  cleanupIntegrationFixtures,
  trackIntegrationRateBucket,
  trackIntegrationUser,
  uniqueEmail,
} from "../helpers/integration-fixtures";

let emailSeed = 60_000;

async function registeredSession() {
  const ip = `ai-${crypto.randomUUID()}`;
  const session = new ApiSession(undefined, { "CF-Connecting-IP": ip });
  const email = uniqueEmail(emailSeed++);
  trackIntegrationRateBucket("register", ip);
  const registration = await session.post("/api/auth/register", {
    email,
    password: "password123",
  });
  expect(registration.status).toBe(201);
  const profile = registration.body.data.profile;
  trackIntegrationUser(profile.id, profile.email);
  trackIntegrationRateBucket("login", `${ip}:${email}`);
  expect((await session.post("/api/auth/login", { email, password: "password123" })).status).toBe(200);
  expect((await session.post("/api/onboarding", {
    displayName: "AI 集成测试用户",
    avatarKey: 1,
  })).status).toBe(200);
  trackIntegrationRateBucket("ai_generate", `${profile.id}:${ip}`);
  return { session, userId: profile.id };
}

function generation(index: number) {
  return {
    sourceUrl: `https://example.com/article-${index}`,
    targetDate: "2026-07-31",
    idempotencyKey: `30000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
  };
}

afterAll(async () => {
  await cleanupIntegrationFixtures();
});

describe("AI generation API", () => {
  it("snapshots a request prompt and rejects changed payloads under the same idempotency key", async () => {
    const owner = await registeredSession();
    const input = { ...generation(81), userPrompt: "  聚焦实现细节  " };
    const first = await owner.session.post("/api/ai/generations", input);
    expect(first.status).toBe(202);
    const generationContext = { userPrompt: "聚焦实现细节", promptVersion: "knowledge-questions-v1" };
    expect(first.body.data.generationContext).toEqual(generationContext);
    const repeated = await owner.session.post("/api/ai/generations", { ...input, userPrompt: "聚焦实现细节" });
    expect(repeated.status).toBe(202);
    expect(repeated.body.data.jobId).toBe(first.body.data.jobId);
    expect(repeated.body.data.quota).toEqual(first.body.data.quota);
    for (const changed of [
      { userPrompt: "改为面试要点" },
      { targetDate: "2026-08-01" },
      { sourceUrl: "https://example.com/changed" },
    ]) {
      const conflict = await owner.session.post("/api/ai/generations", { ...input, ...changed });
      expect(conflict.status).toBe(409);
      expect(conflict.body.error.code).toBe("AI_IDEMPOTENCY_CONFLICT");
    }
    const owned = await owner.session.get(`/api/ai/generations/${first.body.data.jobId}`);
    expect(owned.body.data.generationContext).toEqual(generationContext);
    const next = await owner.session.post("/api/ai/generations", generation(82));
    expect(next.status).toBe(202);
    expect(next.body.data.quota.used).toBe(2);
    expect(next.body.data.generationContext.userPrompt).toBe("");
  });

  it("enforces durable concurrent quota, idempotency, ownership, and cancellation", async () => {
    const anonymous = new ApiSession();
    expect((await anonymous.post("/api/ai/generations", generation(99))).status).toBe(401);

    const owner = await registeredSession();
    const foreign = await registeredSession();
    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, index) => owner.session.post(
        "/api/ai/generations",
        generation(index + 1),
      )),
    );
    expect(attempts.filter((response) => response.status === 202)).toHaveLength(5);
    expect(attempts.filter((response) => response.status === 429)).toHaveLength(1);

    const first = attempts.find((response) => response.status === 202)!;
    const firstIndex = attempts.indexOf(first) + 1;
    const repeated = await owner.session.post("/api/ai/generations", generation(firstIndex));
    expect(repeated.status).toBe(202);
    expect(repeated.body.data.jobId).toBe(first.body.data.jobId);

    const jobId = first.body.data.jobId;
    const owned = await owner.session.get(`/api/ai/generations/${jobId}`);
    expect(owned.status).toBe(200);
    expect(owned.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await foreign.session.get(`/api/ai/generations/${jobId}`)).status).toBe(403);

    const cancelled = await owner.session.request(`/api/ai/generations/${jobId}`, { method: "DELETE" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe("cancelled");
    expect((await owner.session.request(`/api/ai/generations/${jobId}`, { method: "DELETE" })).status).toBe(409);

    expect((await owner.session.post("/api/ai/generations", generation(7))).status).toBe(202);
  });
});
