import { describe, expect, it, vi } from "vitest";
import type { CheckInRepository } from "@/server/checkins/repository";
import { saveCheckIn } from "@/server/checkins/service";

const input = {
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
