import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { takeawayStateSchema } from "@/lib/domain/daily-takeaway";
import { tennisLessons } from "@/lib/domain/tennis-lessons";
import { ApiSession } from "../helpers/api-session";
import { cleanupIntegrationFixtures, trackIntegrationRateBucket, trackIntegrationUser, uniqueEmail } from "../helpers/integration-fixtures";

const fixtureReviewer = `integration-takeaway-${crypto.randomUUID()}`;
const fixtureIds: string[] = [];
let client: ReturnType<typeof createClient<Database>> | undefined;
let accountSeed = 86000;

async function account() {
  const ip = `takeaway-${crypto.randomUUID()}`;
  const email = uniqueEmail(accountSeed++);
  const password = "password123";
  const session = new ApiSession(undefined, { "CF-Connecting-IP": ip });
  trackIntegrationRateBucket("register", ip);
  const registration = await session.post("/api/auth/register", { email, password });
  expect(registration.status).toBe(201);
  const profile = registration.body.data.profile;
  trackIntegrationUser(profile.id, profile.email);
  trackIntegrationRateBucket("login", `${ip}:${email}`);
  expect((await session.post("/api/auth/login", { email, password })).status).toBe(200);
  expect((await session.post("/api/onboarding", { displayName: "新知测试", avatarKey: 1 })).status).toBe(200);
  return { session, userId: profile.id, email, password, ip };
}

afterAll(async () => {
  await cleanupIntegrationFixtures();
  if (client && fixtureIds.length) {
    const result = await client.from("daily_takeaway_lessons").delete().in("id", fixtureIds).eq("reviewed_by", fixtureReviewer);
    expect(result.error).toBeNull();
  }
});

describe("daily takeaway persisted API lifecycle", () => {
  it("keeps concurrent collection, retry, skip, quiz and cross-device state consistent", async () => {
    const url = process.env.TEST_SUPABASE_URL!;
    expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
    client = createClient<Database>(url, process.env.TEST_SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const existing = await client.from("daily_takeaway_lessons").select("id").eq("published", true);
    expect(existing.error).toBeNull();
    if ((existing.data?.length ?? 0) < 3) {
      for (let i = 0; i < 3; i++) {
        const id = `tennis-${91 + i}`;
        const content = { ...tennisLessons[i], id, sequence: 901 + i };
        const result = await client.from("daily_takeaway_lessons").insert({ id, sequence: content.sequence, version: 1, content, published: true, reviewed_by: fixtureReviewer, reviewed_at: new Date().toISOString() });
        expect(result.error).toBeNull();
        fixtureIds.push(id);
      }
    }
    expect((await new ApiSession().get("/api/daily-takeaways")).status).toBe(401);
    const owner = await account();
    const other = await account();
    const initial = await owner.session.get("/api/daily-takeaways");
    expect(initial.status).toBe(200);
    const first = takeawayStateSchema.parse(initial.body.data);
    expect(first.history).toEqual([]);
    const firstLesson = first.currentLesson!;
    const skip = { action: "skip", lessonId: firstLesson.id, version: firstLesson.version };
    const skips = await Promise.all([owner.session.post("/api/daily-takeaways", skip), owner.session.post("/api/daily-takeaways", skip)]);
    expect(skips.map(result => result.status)).toEqual([200, 200]);
    const second = takeawayStateSchema.parse(skips[1].body.data);
    expect(second.skippedCount).toBe(1);
    expect(second.history).toEqual([]);
    const lesson = second.currentLesson!;
    const wrongAnswer = lesson.quiz.correctIndex === 0 ? 1 : 0;
    const quiz = await owner.session.post("/api/daily-takeaways", { action: "quiz", lessonId: lesson.id, version: lesson.version, answerIndex: wrongAnswer });
    expect(quiz.status).toBe(200);
    expect(quiz.body.data.history).toEqual([]);
    expect(quiz.body.data.quizResults[0].correct).toBe(false);
    const collect = { action: "collect", lessonId: lesson.id, version: lesson.version };
    const collects = await Promise.all(Array.from({ length: 4 }, () => owner.session.post("/api/daily-takeaways", collect)));
    expect(collects.map(result => result.status)).toEqual([200, 200, 200, 200]);
    expect(collects.every(result => result.body.data.history.length === 1)).toBe(true);
    expect(collects[0].body.data.currentLesson).toBeNull();
    expect((await other.session.get("/api/daily-takeaways")).body.data.history).toEqual([]);
    const competing = await Promise.all([
      other.session.post("/api/daily-takeaways", { action: "collect", lessonId: firstLesson.id, version: firstLesson.version }),
      other.session.post("/api/daily-takeaways", collect),
    ]);
    expect(competing.map(result => result.status).sort()).toEqual([200, 409]);
    expect((await other.session.get("/api/daily-takeaways")).body.data.history).toHaveLength(1);
    const checkins = await client.from("check_ins").select("id").eq("user_id", owner.userId);
    expect(checkins.error).toBeNull();
    expect(checkins.data).toEqual([]);
    const crossDevice = new ApiSession(undefined, { "CF-Connecting-IP": owner.ip });
    expect((await crossDevice.post("/api/auth/login", { email: owner.email, password: owner.password })).status).toBe(200);
    expect((await crossDevice.get("/api/daily-takeaways")).body.data.history[0].lesson.id).toBe(lesson.id);
    const tomorrowCandidate = (await client.from("daily_takeaway_lessons").select("content").eq("published", true).gt("sequence", lesson.sequence).order("sequence").limit(1)).data![0].content as unknown as typeof lesson;
    expect((await crossDevice.post("/api/daily-takeaways", { action: "collect", lessonId: tomorrowCandidate.id, version: tomorrowCandidate.version })).status).toBe(409);
    // Move only this test user's receipt into the past to exercise returning after a gap.
    const previousDate = new Date(Date.parse(`${first.today}T12:00:00Z`) - 3 * 86400000).toISOString().slice(0, 10);
    const moved = await client.from("daily_takeaway_progress").update({ learning_date: previousDate }).eq("user_id", owner.userId).eq("lesson_id", lesson.id);
    expect(moved.error).toBeNull();
    expect((await owner.session.get("/api/daily-takeaways")).body.data.currentLesson.id).toBe(tomorrowCandidate.id);
    expect((await owner.session.post("/api/daily-takeaways", collect)).body.data.history).toHaveLength(1);
    const nextCollected = await owner.session.post("/api/daily-takeaways", { action: "collect", lessonId: tomorrowCandidate.id, version: tomorrowCandidate.version });
    expect(nextCollected.status).toBe(200);
    expect(nextCollected.body.data.history).toHaveLength(2);
    expect((await owner.session.post("/api/daily-takeaways", { ...collect, userId: other.userId })).status).toBe(422);
  }, 30000);
});
