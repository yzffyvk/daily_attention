import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckInDraft } from "@/features/checkins/checkin-editor";
import type { CheckInRecord } from "@/features/checkins/types";

const draftStore = vi.hoisted(() => ({
  deleteDraft: vi.fn(),
  loadDraft: vi.fn(),
  saveDraft: vi.fn(),
}));

vi.mock("@/lib/indexed-db/drafts", () => draftStore);

import { storedDraftFromEditor, useCheckInDraft } from "@/features/drafts/use-checkin-draft";

const date = "2026-07-23";
const emptyDraft: CheckInDraft = {
  attention: "",
  sourceUrl: "",
  summary: "",
  inspiration: "",
  imageFile: null,
  removeImage: false,
  uploadedImagePath: null,
};

function cloudRecord(updatedAt = "2026-07-23T10:00:00.000Z"): CheckInRecord {
  return {
    id: "checkin-1",
    date,
    attention: "cloud",
    sourceUrl: "",
    summary: "",
    inspiration: "",
    imagePath: null,
    imageName: "",
    imageUrl: null,
    version: 3,
    createdAt: updatedAt,
    updatedAt,
  };
}

function storedDraft(updatedAt = "2026-07-23T11:00:00.000Z") {
  return {
    userId: "auth-user-1",
    date,
    attention: "local",
    sourceUrl: "https://example.com",
    summary: "local summary",
    inspiration: "local inspiration",
    imageBlob: new Blob(["image"], { type: "image/png" }),
    imageName: "local.png",
    removeImage: false,
    baseVersion: 3,
    updatedAt,
  };
}

function useDraft(options?: Partial<Parameters<typeof useCheckInDraft>[0]>) {
  return useCheckInDraft({
    userId: "auth-user-1",
    date,
    cloudRecord: cloudRecord(),
    draft: { ...emptyDraft, attention: "changed" },
    isDirty: true,
    baseVersion: 3,
    onRestore: vi.fn(),
    ...options,
  });
}

async function flushDraftEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  draftStore.deleteDraft.mockReset();
  draftStore.loadDraft.mockReset().mockResolvedValue(undefined);
  draftStore.saveDraft.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useCheckInDraft", () => {
  it("restores a newer local draft as a File-backed editor draft", async () => {
    const onRestore = vi.fn();
    draftStore.loadDraft.mockResolvedValue(storedDraft());

    renderHook(() => useDraft({ onRestore }));

    await flushDraftEffects();
    expect(onRestore).toHaveBeenCalledTimes(1);
    const [restored, baseVersion] = onRestore.mock.calls[0] as [CheckInDraft, number | null];
    expect(restored).toMatchObject({ attention: "local", uploadedImagePath: null });
    expect(restored.imageFile).toBeInstanceOf(File);
    expect(restored.imageFile?.name).toBe("local.png");
    expect(baseVersion).toBe(3);
  });

  it("keeps the cloud record when the local draft is not newer", async () => {
    const onRestore = vi.fn();
    draftStore.loadDraft.mockResolvedValue(storedDraft("2026-07-23T09:00:00.000Z"));

    renderHook(() => useDraft({ onRestore }));

    await flushDraftEffects();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("restores a local draft while offline before a cloud read is available", async () => {
    const onRestore = vi.fn();
    draftStore.loadDraft.mockResolvedValue(storedDraft());
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    renderHook(() => useDraft({ cloudRecord: undefined, onRestore }));

    await flushDraftEffects();
    expect(onRestore).toHaveBeenCalledWith(
      expect.objectContaining({ attention: "local" }),
      3,
    );
  });

  it("debounces dirty writes and cancels the old date when selection changes", async () => {
    const { rerender } = renderHook(
      ({ selectedDate }) => useDraft({ date: selectedDate, cloudRecord: null }),
      { initialProps: { selectedDate: date } },
    );

    await flushDraftEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(399);
    });
    expect(draftStore.saveDraft).not.toHaveBeenCalled();

    rerender({ selectedDate: "2026-07-24" });
    await flushDraftEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(draftStore.saveDraft).toHaveBeenCalledTimes(1);
    expect(draftStore.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-07-24" }));
  });

  it("ignores a stale write failure after the selected date changes", async () => {
    let rejectSave!: (error: Error) => void;
    draftStore.saveDraft.mockImplementation(() => new Promise<void>((_resolve, reject) => {
      rejectSave = reject;
    }));
    const { result, rerender } = renderHook(
      ({ selectedDate }) => useDraft({ date: selectedDate, cloudRecord: null }),
      { initialProps: { selectedDate: date } },
    );

    await flushDraftEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    rerender({ selectedDate: "2026-07-24" });
    await flushDraftEffects();
    await act(async () => {
      rejectSave(new Error("old write failed"));
      await Promise.resolve();
    });

    expect(result.current.storageState).toBe("ready");
  });

  it("keeps a draft when storage cannot be written", async () => {
    draftStore.saveDraft.mockRejectedValue(new Error("quota exceeded"));
    const { result } = renderHook(() => useDraft({ cloudRecord: null }));

    await flushDraftEffects();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(draftStore.deleteDraft).not.toHaveBeenCalled();
    expect(result.current.storageState).toBe("unavailable");
  });

  it("never snapshots uploaded image paths in a local draft", () => {
    const snapshot = storedDraftFromEditor(
      "auth-user-1",
      date,
      {
        ...emptyDraft,
        imageFile: new File(["image"], "local.png", { type: "image/png" }),
        uploadedImagePath: "checkin-images/auth-user-1/remote.png",
      },
      3,
    );

    expect(snapshot).not.toHaveProperty("uploadedImagePath");
    expect(JSON.stringify(snapshot)).not.toContain("checkin-images/");
  });

  it("deletes only when the workspace confirms a cloud save", async () => {
    const { result } = renderHook(() => useDraft({ cloudRecord: null }));

    await act(async () => {
      await result.current.deleteAfterCloudSave();
    });

    expect(draftStore.deleteDraft).toHaveBeenCalledWith("auth-user-1", date);
  });

  it("tracks offline and online events without submitting anything", async () => {
    const { result } = renderHook(() => useDraft({ cloudRecord: null }));
    expect(result.current.isOffline).toBe(false);

    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    act(() => window.dispatchEvent(new Event("offline")));
    expect(result.current.isOffline).toBe(true);

    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    act(() => window.dispatchEvent(new Event("online")));
    expect(result.current.isOffline).toBe(false);
    expect(draftStore.deleteDraft).not.toHaveBeenCalled();
  });

  it("guards restoration work across StrictMode remounts and IndexedDB failures", async () => {
    const onRestore = vi.fn();
    draftStore.loadDraft.mockRejectedValue(new Error("IndexedDB blocked"));

    const { result } = renderHook(() => useDraft({ onRestore }), {
      wrapper: StrictMode,
    });

    await flushDraftEffects();
    expect(result.current.storageState).toBe("unavailable");
    expect(onRestore).not.toHaveBeenCalled();
  });
});
