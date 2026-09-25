import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { openDB } from "idb";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCheckInDraft } from "@/features/drafts/use-checkin-draft";
import type { CheckInDraft } from "@/features/checkins/checkin-editor";
import * as draftStore from "@/lib/indexed-db/drafts";

const date = "2026-09-16";
const emptyDraft: CheckInDraft = {
  attention: "", sourceUrl: "", summary: "", inspiration: "", imageFile: null,
  removeImage: false, uploadedImagePath: null,
};
const job = {
  jobId: "10000000-0000-4000-8000-000000000001", targetDate: date,
  sourceUrl: "https://example.com/ai", createdAt: "2026-09-16T10:00:00.000Z",
};

beforeEach(async () => { await draftStore.deleteAttentionDraftDatabase(); });
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await draftStore.deleteAttentionDraftDatabase(); });

describe("mode scoped draft hook", () => {
  it("flushes edits before the debounce and restores each mode independently", async () => {
    const restored: CheckInDraft[] = [];
    const { result, rerender } = renderHook(
      ({ mode, draft }) => useCheckInDraft({
        userId: "user-1", date, entryMode: mode, cloudRecord: null, draft, isDirty: true,
        baseVersion: mode === "manual" ? 8 : 2, activeAiJob: job,
        onRestore: (local) => { restored.push(local); },
      }),
      { initialProps: { mode: "manual" as "manual" | "ai", draft: { ...emptyDraft, attention: "手动未保存" } } },
    );
    await waitFor(() => expect(result.current.isReadyForCurrentIdentity).toBe(true));
    await act(() => result.current.flushCurrentDraft());
    expect(await draftStore.loadDraft("user-1", date)).toMatchObject({ attention: "手动未保存", baseVersion: 8 });
    expect(await draftStore.loadDraft("user-1", date)).not.toHaveProperty("activeAiJob");

    rerender({ mode: "ai", draft: { ...emptyDraft, attention: "AI 未保存", uploadedImagePath: "user-1/ai.png" } });
    await waitFor(() => expect(result.current.isReadyForCurrentIdentity).toBe(true));
    await act(() => result.current.flushCurrentDraft());
    expect(await draftStore.loadDraft("user-1", date, "ai")).toMatchObject({ attention: "AI 未保存", baseVersion: 2, activeAiJob: job });
    rerender({ mode: "manual", draft: emptyDraft });
    await waitFor(() => expect(restored.at(-1)?.attention).toBe("手动未保存"));
    rerender({ mode: "ai", draft: emptyDraft });
    await waitFor(() => expect(restored.at(-1)).toMatchObject({ attention: "AI 未保存", uploadedImagePath: "user-1/ai.png" }));
  });

  it("deletes a saved AI draft while keeping manual unsaved content", async () => {
    const { result, rerender } = renderHook(
      ({ mode }) => useCheckInDraft({
        userId: "user-1", date, entryMode: mode, cloudRecord: null,
        draft: { ...emptyDraft, attention: mode }, isDirty: true, baseVersion: null, onRestore: () => {},
      }),
      { initialProps: { mode: "manual" as "manual" | "ai" } },
    );
    await waitFor(() => expect(result.current.isReadyForCurrentIdentity).toBe(true));
    await act(() => result.current.flushCurrentDraft());
    rerender({ mode: "ai" });
    await waitFor(() => expect(result.current.isReadyForCurrentIdentity).toBe(true));
    await act(() => result.current.flushCurrentDraft());
    await act(() => result.current.deleteAfterCloudSave());
    expect(await draftStore.loadDraft("user-1", date, "ai")).toBeUndefined();
    expect(await draftStore.loadDraft("user-1", date)).toMatchObject({ attention: "manual" });
  });

  it("rejects a failed flush so a caller can keep the outgoing mode visible", async () => {
    const { result } = renderHook(() => useCheckInDraft({
      userId: "user-1", date, cloudRecord: null, draft: { ...emptyDraft, attention: "retain me" },
      isDirty: true, baseVersion: null, onRestore: () => {},
    }));
    await waitFor(() => expect(result.current.isReadyForCurrentIdentity).toBe(true));
    vi.spyOn(draftStore, "saveDraft").mockRejectedValue(new Error("quota exceeded"));
    await act(async () => { await expect(result.current.flushCurrentDraft()).rejects.toThrow("quota exceeded"); });
    expect(result.current.storageState).toBe("unavailable");
  });

  it("recovers an unchanged mode after an explicit flush retry without automatically retrying the failure", async () => {
    const { result } = renderHook(() => useCheckInDraft({
      userId: "user-1", date, entryMode: "manual", cloudRecord: null,
      draft: { ...emptyDraft, attention: "retry this manual draft", inspiration: "retain my reflections" },
      isDirty: true, baseVersion: 8, onRestore: () => {},
    }));
    await waitFor(() => expect(result.current.isReadyForCurrentIdentity).toBe(true));
    const save = vi.spyOn(draftStore, "saveDraft").mockRejectedValueOnce(new Error("temporary failure"));
    await act(async () => {
      await expect(result.current.flushCurrentDraft()).rejects.toThrow("temporary failure");
    });
    expect(result.current.storageState).toBe("unavailable");
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 450)); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(await draftStore.loadDraft("user-1", date)).toBeUndefined();

    await act(async () => { await expect(result.current.flushCurrentDraft()).resolves.toBeUndefined(); });
    expect(result.current.storageState).toBe("ready");
    expect(await draftStore.loadDraft("user-1", date)).toMatchObject({
      entryMode: "manual", attention: "retry this manual draft", inspiration: "retain my reflections", baseVersion: 8,
    });
    expect(await draftStore.loadDraft("user-1", date, "ai")).toBeUndefined();
  });

  it("reports a held legacy tab as blocked and reloads its AI draft before flushing after the tab closes", async () => {
    const oldTab = await openDB("attention-cloud-drafts", 1, {
      upgrade(db) {
        db.createObjectStore("drafts", { keyPath: ["userId", "date"] }).createIndex("by-user", "userId");
      },
    });
    await oldTab.put("drafts", {
      userId: "user-1", date, attention: "legacy manual content", sourceUrl: "", summary: "",
      inspiration: "legacy reflections", imageBlob: null, imageName: "", removeImage: false,
      baseVersion: 8, updatedAt: job.createdAt,
    });
    try {
      const save = vi.spyOn(draftStore, "saveDraft");
      const { result } = renderHook(() => useCheckInDraft({
        userId: "user-1", date, entryMode: "ai", cloudRecord: null,
        draft: { ...emptyDraft, attention: "current AI content" }, isDirty: true,
        baseVersion: 2, onRestore: () => {},
      }));
      await waitFor(() => expect(result.current.storageState).toBe("blocked"));
      expect(result.current.isReadyForCurrentIdentity).toBe(false);
      await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 450)); });
      expect(save).not.toHaveBeenCalled();
      oldTab.close();
      await act(async () => { await expect(result.current.flushCurrentDraft()).rejects.toThrow(); });
      act(() => result.current.retryDraftLoad());
      await waitFor(() => expect(result.current.isReadyForCurrentIdentity).toBe(true));
      await act(async () => { await expect(result.current.flushCurrentDraft()).resolves.toBeUndefined(); });
      expect(result.current.storageState).toBe("ready");
      expect(await draftStore.loadDraft("user-1", date)).toMatchObject({
        entryMode: "manual", attention: "legacy manual content", inspiration: "legacy reflections", baseVersion: 8,
      });
      expect(await draftStore.loadDraft("user-1", date, "ai")).toMatchObject({
        entryMode: "ai", attention: "current AI content", baseVersion: 2,
      });
    } finally {
      oldTab.close();
    }
  });

  it("refuses a blocked manual flush and restores legacy content through the explicit reload action", async () => {
    const oldTab = await openDB("attention-cloud-drafts", 1, {
      upgrade(db) {
        db.createObjectStore("drafts", { keyPath: ["userId", "date"] }).createIndex("by-user", "userId");
      },
    });
    await oldTab.put("drafts", {
      userId: "user-1", date, attention: "unsaved legacy manual", sourceUrl: "", summary: "legacy summary",
      inspiration: "legacy personal reflections", imageBlob: null, imageName: "", removeImage: false,
      baseVersion: 8, updatedAt: job.createdAt,
    });
    try {
      const restored: CheckInDraft[] = [];
      const { result } = renderHook(() => {
        const [editor, setEditor] = useState({ draft: emptyDraft, version: null as number | null });
        return useCheckInDraft({
          userId: "user-1", date, entryMode: "manual", cloudRecord: null,
          draft: editor.draft, isDirty: false, baseVersion: editor.version,
          onRestore: (draft, version) => { restored.push(draft); setEditor({ draft, version }); },
        });
      });
      await waitFor(() => expect(result.current.storageState).toBe("blocked"));
      oldTab.close();
      await act(async () => { await expect(result.current.flushCurrentDraft()).rejects.toThrow(); });
      act(() => result.current.retryDraftLoad());
      expect(result.current.isReadyForCurrentIdentity).toBe(false);
      await waitFor(() => expect(result.current.isReadyForCurrentIdentity).toBe(true));
      expect(restored.at(-1)).toMatchObject({
        attention: "unsaved legacy manual", summary: "legacy summary", inspiration: "legacy personal reflections",
      });
      await act(() => result.current.flushCurrentDraft());
      expect(await draftStore.loadDraft("user-1", date)).toMatchObject({
        entryMode: "manual", attention: "unsaved legacy manual", inspiration: "legacy personal reflections", baseVersion: 8,
      });
    } finally { oldTab.close(); }
  });
});
