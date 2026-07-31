import { describe, expect, it, vi } from "vitest";
import type { CheckInRepository } from "@/server/checkins/repository";
import { getCheckInStats } from "@/server/checkins/stats-service";

function repository(stats: {
  totalCount: number;
  currentStreak: number;
  hasTodayRecord: boolean;
}) {
  return {
    getStats: vi.fn().mockResolvedValue(stats),
  } as unknown as CheckInRepository;
}

describe("getCheckInStats", () => {
  it("delegates statistics aggregation to the authenticated repository", async () => {
    const expected = {
      totalCount: 5,
      currentStreak: 3,
      hasTodayRecord: true,
    };
    const store = repository(expected);

    const result = await getCheckInStats("user-1", "2026-07-01", store);

    expect(result).toEqual(expected);
    expect(store.getStats).toHaveBeenCalledExactlyOnceWith("2026-07-01");
  });

  it("preserves a zero-valued database result", async () => {
    const store = repository({
      totalCount: 0,
      currentStreak: 0,
      hasTodayRecord: false,
    });

    await expect(getCheckInStats("user-1", "2026-07-01", store)).resolves.toEqual({
      totalCount: 0,
      currentStreak: 0,
      hasTodayRecord: false,
    });
  });
});
