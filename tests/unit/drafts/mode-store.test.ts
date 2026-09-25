import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyAiResultToDraft,
  clearDraftActiveAiJob,
  deleteAttentionDraftDatabase,
  deleteDraft,
  loadDraft,
  saveDraft,
  type StoredDraft,
} from "@/lib/indexed-db/drafts";

const date = "2026-09-16";
const job = {
  jobId: "10000000-0000-4000-8000-000000000001",
  targetDate: date,
  sourceUrl: "https://example.com/ai",
  createdAt: "2026-09-16T10:00:00.000Z",
};
const manual: StoredDraft = {
  userId: "user-1", date, attention: "手动标题", sourceUrl: "https://example.com/manual",
  summary: "手动摘要", inspiration: "手动反思", imageBlob: null, imageName: "manual.png",
  removeImage: true, baseVersion: 8, updatedAt: job.createdAt,
};
const aiResult = {
  attention: "AI 标题", summary: "AI 摘要", inspiration: "AI 感想", sourceTitle: "资料", warnings: [],
};

beforeEach(deleteAttentionDraftDatabase);
afterEach(deleteAttentionDraftDatabase);

describe("draft mode isolation", () => {
  it("saves and deletes one mode without replacing the other mode on the same date", async () => {
    await saveDraft(manual);
    await saveDraft({ ...manual, entryMode: "ai", attention: "AI 编辑", baseVersion: 2 });
    expect(await loadDraft("user-1", date)).toMatchObject({ entryMode: "manual", attention: "手动标题", baseVersion: 8 });
    expect(await loadDraft("user-1", date, "ai")).toMatchObject({ entryMode: "ai", attention: "AI 编辑", baseVersion: 2 });
    await deleteDraft("user-1", date, "ai");
    expect(await loadDraft("user-1", date, "ai")).toBeUndefined();
    expect(await loadDraft("user-1", date)).toMatchObject({ attention: "手动标题" });
  });

  it("strips active AI metadata from every new manual save", async () => {
    await saveDraft({ ...manual, activeAiJob: job });
    expect(await loadDraft("user-1", date)).not.toHaveProperty("activeAiJob");
  });

  it("migrates v1 content intact to manual and moves only active job data to a blank AI draft", async () => {
    const database = await openDB("attention-cloud-drafts", 1, {
      upgrade(db) {
        db.createObjectStore("drafts", { keyPath: ["userId", "date"] }).createIndex("by-user", "userId");
      },
    });
    await database.put("drafts", { ...manual, activeAiJob: job });
    await database.put("drafts", { ...manual, userId: "user-2", attention: "无任务的旧草稿" });
    database.close();

    const migrated = await loadDraft("user-1", date);
    expect(migrated).toMatchObject({ ...manual, entryMode: "manual" });
    expect(migrated).not.toHaveProperty("activeAiJob");
    expect(await loadDraft("user-1", date, "ai")).toMatchObject({
      entryMode: "ai", attention: "", summary: "", inspiration: "", imageBlob: null,
      imageName: "", removeImage: false, baseVersion: null, sourceUrl: job.sourceUrl, activeAiJob: job,
    });
    expect(await loadDraft("user-2", date)).toMatchObject({ entryMode: "manual", attention: "无任务的旧草稿" });
    expect(await loadDraft("user-2", date, "ai")).toBeUndefined();
  });

  it("rejects an upgrade blocked by an old tab, then preserves its draft after the tab closes", async () => {
    const oldTab = await openDB("attention-cloud-drafts", 1, {
      upgrade(db) {
        db.createObjectStore("drafts", { keyPath: ["userId", "date"] }).createIndex("by-user", "userId");
      },
    });
    await oldTab.put("drafts", manual);
    const closedVersions: number[] = [];
    const originalClose = IDBDatabase.prototype.close;
    vi.spyOn(IDBDatabase.prototype, "close").mockImplementation(function (this: IDBDatabase) {
      closedVersions.push(this.version);
      originalClose.call(this);
    });
    const pendingLoad = loadDraft("user-1", date);
    const outcome = await Promise.race([
      pendingLoad.then(() => "opened", (error: unknown) => error),
      new Promise<string>((resolve) => window.setTimeout(() => resolve("still pending"), 100)),
    ]);
    oldTab.close();
    // Await any late connection before cleanup even when the rejection assertion fails.
    await pendingLoad.catch(() => undefined);
    expect(outcome).toMatchObject({ name: "DraftDatabaseBlockedError" });
    expect(await loadDraft("user-1", date)).toMatchObject({ ...manual, entryMode: "manual" });
    expect(closedVersions).toContain(2);
    expect(await loadDraft("user-1", date, "ai")).toBeUndefined();
  });

  it("closes its current connection when a future app version upgrades the database", async () => {
    await saveDraft(manual);
    let wasBlocked = false;
    const futureOpen = openDB("attention-cloud-drafts", 3, {
      blocked() { wasBlocked = true; },
    });
    void futureOpen.then((futureTab) => futureTab.close());
    const outcome = await Promise.race([
      futureOpen.then(() => "opened"),
      new Promise<string>((resolve) => window.setTimeout(() => resolve("still pending"), 100)),
    ]);
    await deleteAttentionDraftDatabase();
    expect(outcome).toBe("opened");
    expect(wasBlocked).toBe(false);
  });

  it("late AI output preserves only AI reflections, image selection and version", async () => {
    await saveDraft(manual);
    await saveDraft({
      ...manual, entryMode: "ai", inspiration: "AI 侧反思", imageName: "ai.png", removeImage: false,
      uploadedImagePath: "user-1/ai.png", baseVersion: 3, activeAiJob: job,
    });
    await applyAiResultToDraft("user-1", job, aiResult);
    expect(await loadDraft("user-1", date)).toMatchObject({ ...manual, entryMode: "manual" });
    expect(await loadDraft("user-1", date, "ai")).toMatchObject({
      entryMode: "ai", attention: "AI 标题", summary: "AI 摘要", inspiration: "AI 侧反思",
      imageName: "ai.png", uploadedImagePath: "user-1/ai.png", removeImage: false, baseVersion: 3,
    });
    expect(await loadDraft("user-1", date, "ai")).not.toHaveProperty("activeAiJob");
  });

  it.each([undefined, "manual"] as const)("never copies saved manual reflections into AI output (%s)", async (entryMode) => {
    await saveDraft(manual);
    await applyAiResultToDraft("user-1", job, aiResult, { entryMode, inspiration: "保存的手动反思", version: 8 });
    expect(await loadDraft("user-1", date, "ai")).toMatchObject({ inspiration: "", baseVersion: null });
    expect(await loadDraft("user-1", date)).toMatchObject({ attention: "手动标题", inspiration: "手动反思" });
  });

  it("clears AI job metadata without changing a manual draft", async () => {
    await saveDraft(manual);
    await saveDraft({ ...manual, entryMode: "ai", activeAiJob: job });
    await clearDraftActiveAiJob("user-1", job);
    expect(await loadDraft("user-1", date)).toMatchObject({ ...manual, entryMode: "manual" });
    expect(await loadDraft("user-1", date, "ai")).not.toHaveProperty("activeAiJob");
  });
});
