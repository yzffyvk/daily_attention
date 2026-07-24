import { describe, expect, it, vi } from "vitest";
import type { CheckInRepository } from "@/server/checkins/repository";
import { getCheckInStats } from "@/server/checkins/stats-service";

function repository(dates: string[]) {
  return {
    findAllDates: vi.fn().mockResolvedValue(dates),
  } as unknown as CheckInRepository;
}

describe("getCheckInStats", () => {
  it("counts the full lifetime and continues a streak across a month boundary", async () => {
    const store = repository([
      "2025-12-20",
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
      "2026-07-10",
    ]);

    const result = await getCheckInStats("user-1", "2026-07-01", store);

    expect(result).toEqual({
      totalCount: 5,
      currentStreak: 3,
      hasTodayRecord: true,
    });
    expect(store.findAllDates).toHaveBeenCalledExactlyOnceWith("user-1");
  });

  it("continues counting from yesterday when today has no record", async () => {
    const store = repository([
      "2026-06-28",
      "2026-06-29",
      "2026-06-30",
      "2026-07-03",
    ]);

    await expect(getCheckInStats("user-1", "2026-07-01", store)).resolves.toEqual({
      totalCount: 4,
      currentStreak: 3,
      hasTodayRecord: false,
    });
  });
});
