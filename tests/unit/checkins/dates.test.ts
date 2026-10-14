import { describe, expect, it } from "vitest";
import { getTodayKey, millisecondsUntilNextLocalMidnight } from "@/features/checkins/dates";

describe("learning calendar clock", () => {
  it("uses Beijing's day independent of the host timezone", () => {
    expect(getTodayKey(new Date("2026-12-31T15:59:59Z"))).toBe("2026-12-31");
    expect(getTodayKey(new Date("2026-12-31T16:00:00Z"))).toBe("2027-01-01");
  });
  it("refreshes at Beijing midnight", () => {
    expect(millisecondsUntilNextLocalMidnight(new Date("2026-12-31T15:59:50Z"))).toBe(10_000);
    expect(millisecondsUntilNextLocalMidnight(new Date("2026-12-31T16:00:00Z"))).toBe(86_400_000);
  });
});
