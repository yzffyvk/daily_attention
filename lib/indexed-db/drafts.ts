import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ActiveAiJob } from "@/features/ai-generation/types";
import type { AiGenerationResult } from "@/lib/domain/ai-generation";

export type StoredDraft = {
  userId: string;
  date: string;
  attention: string;
  sourceUrl: string;
  summary: string;
  inspiration: string;
  imageBlob: Blob | null;
  imageName: string;
  removeImage: boolean;
  baseVersion: number | null;
  updatedAt: string;
  activeAiJob?: ActiveAiJob;
};

interface AttentionDraftDatabase extends DBSchema {
  drafts: {
    key: [string, string];
    value: StoredDraft;
    indexes: { "by-user": string };
  };
}

const databaseName = "attention-cloud-drafts";
let databasePromise: Promise<IDBPDatabase<AttentionDraftDatabase>> | null = null;

function getDatabase() {
  if (!databasePromise) {
    databasePromise = openDB<AttentionDraftDatabase>(databaseName, 1, {
      upgrade(database) {
        const store = database.createObjectStore("drafts", {
          keyPath: ["userId", "date"],
        });
        store.createIndex("by-user", "userId");
      },
    }).catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

export async function loadDraft(userId: string, date: string) {
  return (await getDatabase()).get("drafts", [userId, date]);
}

function abortError() {
  return new DOMException("The operation was aborted.", "AbortError");
}

export async function saveDraft(
  draft: StoredDraft,
  options: { signal?: AbortSignal } = {},
) {
  const { signal } = options;
  if (signal?.aborted) throw abortError();

  const database = await getDatabase();
  if (signal?.aborted) throw abortError();

  const transaction = database.transaction("drafts", "readwrite");
  let transactionAborted = false;
  const abortTransaction = () => {
    try {
      transaction.abort();
      transactionAborted = true;
    } catch {
      // The transaction already settled, so its committed/failed outcome wins.
    }
  };
  signal?.addEventListener("abort", abortTransaction, { once: true });

  try {
    if (signal?.aborted) abortTransaction();
    await Promise.all([
      transaction.store.put(draft),
      transaction.done,
    ]);
  } catch (error) {
    if (transactionAborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener("abort", abortTransaction);
  }
}

export async function deleteDraft(userId: string, date: string) {
  await (await getDatabase()).delete("drafts", [userId, date]);
}

export async function applyAiResultToDraft(
  userId: string,
  job: ActiveAiJob,
  result: AiGenerationResult,
) {
  const existing = await loadDraft(userId, job.targetDate);
  const next: StoredDraft = {
    userId,
    date: job.targetDate,
    attention: result.attention,
    sourceUrl: job.sourceUrl,
    summary: result.summary,
    inspiration: result.inspiration,
    imageBlob: existing?.imageBlob ?? null,
    imageName: existing?.imageName ?? "",
    removeImage: existing?.removeImage ?? false,
    baseVersion: existing?.baseVersion ?? null,
    updatedAt: new Date().toISOString(),
  };
  await saveDraft(next);
  return next;
}

export async function clearDraftActiveAiJob(
  userId: string,
  job: ActiveAiJob,
) {
  const existing = await loadDraft(userId, job.targetDate);
  if (!existing || existing.activeAiJob?.jobId !== job.jobId) return;
  const cleared = { ...existing };
  delete cleared.activeAiJob;
  await saveDraft({ ...cleared, updatedAt: new Date().toISOString() });
}

export async function deleteAttentionDraftDatabase() {
  const openDatabase = databasePromise;
  databasePromise = null;
  if (openDatabase) (await openDatabase).close();
  await deleteDB(databaseName);
}
