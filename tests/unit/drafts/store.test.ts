import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyAiResultToDraft,
  deleteAttentionDraftDatabase,
  loadDraft,
  saveDraft,
} from "@/lib/indexed-db/drafts";

const date = "2026-07-23";

beforeEach(async () => {
  await deleteAttentionDraftDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await deleteAttentionDraftDatabase();
});

describe("draft storage", () => {
  it("isolates drafts by immutable user id and date", async () => {
    await saveDraft({
      userId: "user-1",
      date,
      attention: "one",
      sourceUrl: "",
      summary: "",
      inspiration: "",
      imageBlob: null,
      imageName: "",
      removeImage: false,
      baseVersion: 1,
      updatedAt: "2026-07-23T10:00:00.000Z",
    });

    expect(await loadDraft("user-1", date)).toMatchObject({ attention: "one" });
    expect(await loadDraft("user-2", date)).toBeUndefined();
    expect(await loadDraft("user-1", "2026-07-24")).toBeUndefined();
  });

  it("stores image content as a Blob instead of a data URL", async () => {
    const imageBlob = new Blob(["image-bytes"], { type: "image/png" });

    await saveDraft({
      userId: "user-1",
      date,
      attention: "with image",
      sourceUrl: "",
      summary: "",
      inspiration: "",
      imageBlob,
      imageName: "note.png",
      removeImage: false,
      baseVersion: null,
      updatedAt: "2026-07-23T10:00:00.000Z",
    });

    const stored = await loadDraft("user-1", date);
    // fake-indexeddb structurally clones jsdom Blobs without their prototype.
    expect(typeof stored?.imageBlob).toBe("object");
    expect(stored).not.toHaveProperty("imageUrl");
    expect(JSON.stringify(stored)).not.toContain("data:");
  });

  it("keeps optional active AI metadata while old rows remain valid", async () => {
    await saveDraft({
      userId: "user-1",
      date,
      attention: "",
      sourceUrl: "https://example.com/article",
      summary: "",
      inspiration: "",
      imageBlob: null,
      imageName: "",
      removeImage: false,
      baseVersion: null,
      updatedAt: "2026-07-23T10:00:00.000Z",
      activeAiJob: {
        jobId: "10000000-0000-4000-8000-000000000001",
        targetDate: date,
        sourceUrl: "https://example.com/article",
        createdAt: "2026-07-23T10:00:00.000Z",
      },
    });

    expect((await loadDraft("user-1", date))?.activeAiJob).toMatchObject({
      targetDate: date,
      sourceUrl: "https://example.com/article",
    });
    expect((await loadDraft("user-2", date))?.activeAiJob).toBeUndefined();
  });

  it("applies AI output to the job target date and clears active metadata", async () => {
    const targetDate = "2026-07-24";
    const job = {
      jobId: "10000000-0000-4000-8000-000000000001",
      targetDate,
      sourceUrl: "https://example.com/target",
      createdAt: "2026-07-24T10:00:00.000Z",
    };
    await saveDraft({
      userId: "user-1",
      date: targetDate,
      attention: "旧草稿",
      sourceUrl: job.sourceUrl,
      summary: "",
      inspiration: "",
      imageBlob: null,
      imageName: "",
      removeImage: false,
      baseVersion: null,
      updatedAt: job.createdAt,
      activeAiJob: job,
    });

    await applyAiResultToDraft("user-1", job, {
      attention: "AI 标题",
      summary: "AI 小结",
      inspiration: "AI 灵感",
      sourceTitle: "资料标题",
      warnings: [],
    });

    expect(await loadDraft("user-1", targetDate)).toMatchObject({
      attention: "AI 标题",
      summary: "AI 小结",
      inspiration: "AI 灵感",
      sourceUrl: job.sourceUrl,
    });
    expect((await loadDraft("user-1", targetDate))?.activeAiJob).toBeUndefined();
    expect(await loadDraft("user-1", date)).toBeUndefined();
  });

  it("does not write when aborted before the database opens", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(saveDraft({
      userId: "user-1",
      date,
      attention: "aborted",
      sourceUrl: "",
      summary: "",
      inspiration: "",
      imageBlob: null,
      imageName: "",
      removeImage: false,
      baseVersion: null,
      updatedAt: "2026-07-23T10:00:00.000Z",
    }, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });

    expect(await loadDraft("user-1", date)).toBeUndefined();
  });

  it("aborts an active readwrite transaction before the old key commits", async () => {
    await loadDraft("open-database", date);
    const controller = new AbortController();
    const originalTransaction = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (
      this: IDBDatabase,
      storeNames: string | Iterable<string>,
      mode?: IDBTransactionMode,
      options?: IDBTransactionOptions,
    ) {
      const transaction = originalTransaction.call(this, storeNames, mode, options);
      if (mode === "readwrite") queueMicrotask(() => controller.abort());
      return transaction;
    });

    await expect(saveDraft({
      userId: "user-1",
      date,
      attention: "stale",
      sourceUrl: "",
      summary: "",
      inspiration: "",
      imageBlob: null,
      imageName: "",
      removeImage: false,
      baseVersion: null,
      updatedAt: "2026-07-23T10:00:00.000Z",
    }, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });

    expect(await loadDraft("user-1", date)).toBeUndefined();
  });

  it("reports success when an abort arrives after the transaction already committed", async () => {
    await loadDraft("open-database", date);
    const controller = new AbortController();
    const originalTransaction = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (
      this: IDBDatabase,
      storeNames: string | Iterable<string>,
      mode?: IDBTransactionMode,
      options?: IDBTransactionOptions,
    ) {
      const transaction = originalTransaction.call(this, storeNames, mode, options);
      if (mode === "readwrite") {
        vi.spyOn(transaction, "abort").mockImplementation(() => {
          throw new DOMException("The transaction is already inactive.", "InvalidStateError");
        });
        queueMicrotask(() => controller.abort());
      }
      return transaction;
    });

    await expect(saveDraft({
      userId: "user-1",
      date,
      attention: "committed",
      sourceUrl: "",
      summary: "",
      inspiration: "",
      imageBlob: null,
      imageName: "",
      removeImage: false,
      baseVersion: null,
      updatedAt: "2026-07-23T10:00:00.000Z",
    }, { signal: controller.signal })).resolves.toBeUndefined();

    expect(await loadDraft("user-1", date)).toMatchObject({ attention: "committed" });
  });
});
