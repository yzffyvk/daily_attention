import type { TakeawayState } from "@/lib/domain/daily-takeaway";
import { tennisLessons } from "@/lib/domain/tennis-lessons";

export function takeawayFixture(overrides: Partial<TakeawayState> = {}): TakeawayState {
  return {
    today: "2026-10-09", timeZone: "Asia/Shanghai", nextAvailableAt: "2026-10-09T16:00:00.000Z",
    totalLessons: 30, skippedCount: 0, currentLesson: tennisLessons[0], history: [], quizResults: [], ...overrides,
  };
}
