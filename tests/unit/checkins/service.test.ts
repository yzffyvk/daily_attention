import { describe, expect, it, vi } from "vitest";
import type { CheckInRepository } from "@/server/checkins/repository";
import { saveCheckIn } from "@/server/checkins/service";
import type { CheckInRecord } from "@/features/checkins/types";

const input = {
  entryMode: "manual" as const,
  attention: "local",
  sourceUrl: "",
  summary: "",
  inspiration: "",
  imagePath: null,
  imageName: "",
  version: null as number | null,
};

function repository(
  overrides: Partial<CheckInRepository> = {},
): CheckInRepository {
  return {
    findByDate: vi.fn().mockResolvedValue(null),
    findByMonth: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue({
      totalCount: 0,
      currentStreak: 0,
      hasTodayRecord: false,
    }),
    insert: vi.fn().mockResolvedValue({
      id: "1",
      date: "2026-07-23",
      attention: "local",
      sourceUrl: "",
      summary: "",
      inspiration: "",
      imagePath: null,
      imageName: "",
      imageUrl: null,
      version: 1,
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: "2026-07-23T00:00:00.000Z",
    }),
    updateAtVersion: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("saveCheckIn", () => {
  it("creates and updates the AI record without conflicting with the same-day manual record", async () => {
    const manual = {
      id: "manual-id", date: "2026-07-23", entryMode: "manual" as const,
      attention: "手写内容", sourceUrl: "", summary: "手写小结", inspiration: "手写启发",
      imagePath: "manual-image", imageName: "manual.png", imageUrl: null, version: 4,
      createdAt: "2026-07-23T00:00:00Z", updatedAt: "2026-07-23T00:00:00Z",
    };
    const rows = new Map<string, CheckInRecord>([["manual", manual]]);
    const store = repository({
      async findByDate(_userId, _date, mode = "manual") { return rows.get(mode) ?? null; },
      async insert(_userId, date, value) {
        const record = { ...manual, ...value, id: "ai-id", date, version: 1 };
        rows.set(value.entryMode, record);
        return record;
      },
      async updateAtVersion(_userId, _date, expectedVersion, value) {
        const current = rows.get(value.entryMode);
        if (!current || current.version !== expectedVersion) return null;
        const record = { ...current, ...value, version: expectedVersion + 1 };
        rows.set(value.entryMode, record);
        return record;
      },
    });
    const aiInput = { ...input, entryMode: "ai" as const, attention: "AI 内容" };
    expect(await saveCheckIn("user-1", "2026-07-23", aiInput, store)).toMatchObject({
      ok: true, record: { id: "ai-id", entryMode: "ai", version: 1 },
    });
    expect(await saveCheckIn("user-1", "2026-07-23", { ...aiInput, version: 1 }, store)).toMatchObject({
      ok: true, record: { id: "ai-id", entryMode: "ai", version: 2 },
    });
    expect(rows.get("manual")).toEqual(manual);
    expect(await saveCheckIn("user-1", "2026-07-23", { ...aiInput, version: 1 }, store)).toMatchObject({
      ok: false, current: { id: "ai-id", entryMode: "ai", version: 2 },
    });
  });
  it("inserts version one when no cloud record exists", async () => {
    const store = repository();

    const result = await saveCheckIn(
      "user-1",
      "2026-07-23",
      input,
      store,
    );

    expect(result).toMatchObject({ ok: true, record: { version: 1 } });
    expect(store.insert).toHaveBeenCalledWith(
      "user-1",
      "2026-07-23",
      input,
    );
  });

  it("returns a conflict when a version is supplied for a missing record", async () => {
    const store = repository();

    const result = await saveCheckIn(
      "user-1",
      "2026-07-23",
      { ...input, version: 1 },
      store,
    );

    expect(result).toEqual({
      ok: false,
      reason: "VERSION_CONFLICT",
      current: null,
    });
    expect(store.insert).not.toHaveBeenCalled();
  });

  it("returns the winning record when concurrent first saves collide", async () => {
    const winning = {
      id: "1",
      date: "2026-07-23",
      attention: "cloud",
      sourceUrl: "",
      summary: "",
      inspiration: "",
      imagePath: null,
      imageName: "",
      imageUrl: null,
      version: 1,
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: "2026-07-23T00:00:00.000Z",
    };
    const store = repository({
      findByDate: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(winning),
      insert: vi.fn().mockRejectedValue({ code: "23505" }),
    });

    const result = await saveCheckIn(
      "user-1",
      "2026-07-23",
      input,
      store,
    );

    expect(result).toEqual({
      ok: false,
      reason: "VERSION_CONFLICT",
      current: winning,
    });
  });

  it("returns the cloud record when an existing row receives no version", async () => {
    const current = { id: "1", version: 3, attention: "cloud" };
    const store = repository({
      findByDate: vi.fn().mockResolvedValue(current),
    });

    const result = await saveCheckIn(
      "user-1",
      "2026-07-23",
      input,
      store,
    );

    expect(result).toEqual({
      ok: false,
      reason: "VERSION_CONFLICT",
      current,
    });
    expect(store.updateAtVersion).not.toHaveBeenCalled();
  });

  it("returns the incremented cloud record after a matched update", async () => {
    const current = { id: "1", version: 2, attention: "cloud" };
    const updated = { id: "1", version: 3, attention: "local" };
    const store = repository({
      findByDate: vi.fn().mockResolvedValue(current),
      updateAtVersion: vi.fn().mockResolvedValue(updated),
    });

    const result = await saveCheckIn(
      "user-1",
      "2026-07-23",
      { ...input, version: 2 },
      store,
    );

    expect(result).toEqual({ ok: true, record: updated });
  });

  it("returns the latest cloud record when a conditional update loses a race", async () => {
    const current = { id: "1", version: 2, attention: "cloud" };
    const latest = { id: "1", version: 3, attention: "newer cloud" };
    const store = repository({
      findByDate: vi
        .fn()
        .mockResolvedValueOnce(current)
        .mockResolvedValueOnce(latest),
      updateAtVersion: vi.fn().mockResolvedValue(null),
    });

    const result = await saveCheckIn(
      "user-1",
      "2026-07-23",
      { ...input, version: 2 },
      store,
    );

    expect(result).toEqual({
      ok: false,
      reason: "VERSION_CONFLICT",
      current: latest,
    });
  });
});
