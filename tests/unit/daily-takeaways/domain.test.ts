import { describe, expect, it } from "vitest";
import { getLearningDate, nextLearningMidnight, takeawayActionSchema, takeawayMilestone, takeawayStage } from "@/lib/domain/daily-takeaway";

describe("daily takeaway boundaries", () => {
  it("uses Beijing midnight independently of the browser time zone", () => {
    expect(getLearningDate(new Date("2026-10-09T15:59:59Z"))).toBe("2026-10-09");
    expect(getLearningDate(new Date("2026-10-09T16:00:00Z"))).toBe("2026-10-10");
    expect(nextLearningMidnight(new Date("2026-12-31T16:00:00Z"))).toBe("2027-01-01T16:00:00.000Z");
  });

  it("requires an explicit action and rejects client-controlled user/date/correctness", () => {
    const input = { action: "collect", lessonId: "tennis-01", version: 1 };
    expect(takeawayActionSchema.safeParse(input).success).toBe(true);
    for (const extra of [{ userId: "someone" }, { date: "2026-10-01" }, { correct: true }, { answerIndex: 0 }]) {
      expect(takeawayActionSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    }
    expect(takeawayActionSchema.safeParse({ ...input, action: "read" }).success).toBe(false);
    expect(takeawayActionSchema.safeParse({ ...input, action: "quiz", answerIndex: 1 }).success).toBe(true);
    expect(takeawayActionSchema.safeParse({ ...input, action: "quiz", answerIndex: 2 }).success).toBe(false);
  });

  it("distinguishes an unpublished library from a finished personal sequence", () => {
    expect(takeawayStage({ totalLessons: 0, collectedToday: false, hasCurrentLesson: false })).toBe("unavailable");
    expect(takeawayStage({ totalLessons: 30, collectedToday: false, hasCurrentLesson: true })).toBe("available");
    expect(takeawayStage({ totalLessons: 30, collectedToday: true, hasCurrentLesson: false })).toBe("done");
    expect(takeawayStage({ totalLessons: 30, collectedToday: false, hasCurrentLesson: false })).toBe("complete");
  });

  it("marks only the requested collection milestones, not skipped lessons", () => {
    expect([0, 1, 6, 7, 8, 14, 29, 30].map(takeawayMilestone)).toEqual([null, null, null, 7, null, 14, null, 30]);
  });
});
