import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { checkInKeys, setMonthRecord } from "@/features/checkins/queries";
import type { CheckInRecord, CheckInSummary } from "@/features/checkins/types";

const date = "2026-09-16";
const manual: CheckInRecord = { id: "manual-id", date, entryMode: "manual", attention: "手动标题", sourceUrl: "", summary: "", inspiration: "", imagePath: null, imageName: "", imageUrl: null, version: 3, createdAt: "2026-09-16T00:00:00Z", updatedAt: "2026-09-16T01:00:00Z" };
const ai: CheckInRecord = { ...manual, id: "ai-id", entryMode: "ai", attention: "AI 标题", version: 1 };

describe("mode-scoped cache", () => {
  it("keeps both records in a same-day monthly list and removes only the requested mode", () => {
    const cache = new QueryClient();
    setMonthRecord(cache, manual, date);
    setMonthRecord(cache, ai, date);
    const month = () => cache.getQueryData<CheckInSummary[]>(checkInKeys.month("2026-09"));
    expect(month()).toHaveLength(2);
    expect(month()).toEqual(expect.arrayContaining([
      expect.objectContaining({ attention: "手动标题", entryMode: "manual", version: 3 }),
      expect.objectContaining({ attention: "AI 标题", entryMode: "ai", version: 1 }),
    ]));
    setMonthRecord(cache, null, date, "ai");
    expect(month()).toEqual([expect.objectContaining({ attention: "手动标题", entryMode: "manual" })]);
  });

  it("updating an AI cache cannot replace the manual cache", () => {
    const cache = new QueryClient();
    cache.setQueryData(checkInKeys.date(date), manual);
    cache.setQueryData(checkInKeys.date(date, "ai"), ai);
    expect(cache.getQueryData(checkInKeys.date(date, "manual"))).toEqual(manual);
    expect(cache.getQueryData(checkInKeys.date(date, "ai"))).toEqual(ai);
  });
});
