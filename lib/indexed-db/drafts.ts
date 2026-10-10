import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ActiveAiJob } from "@/features/ai-generation/types";
import type { AiGenerationResult } from "@/lib/domain/ai-generation";
import type { CheckInEntryMode } from "@/lib/domain/checkin";
import type { AiGenerationContext } from "@/lib/domain/ai-prompt";

export type StoredDraft = {
  userId: string;
  date: string;
  entryMode?: CheckInEntryMode;
  attention: string;
  sourceUrl: string;
  userPrompt?: string;
  aiGenerationContext?: AiGenerationContext | null;
  summary: string;
  inspiration: string;
  imageBlob: Blob | null;
  imageName: string;
  removeImage: boolean;
  uploadedImagePath?: string | null;
  baseVersion: number | null;
  updatedAt: string;
  activeAiJob?: ActiveAiJob;
};

interface AttentionDraftDatabase extends DBSchema {
  drafts: {
    key: [string, string, CheckInEntryMode];
    value: StoredDraft;
    indexes: { "by-user": string };
  };
}

const databaseName = "attention-cloud-drafts";
let databasePromise: Promise<IDBPDatabase<AttentionDraftDatabase>> | null = null;

export class DraftDatabaseBlockedError extends Error {
  constructor() {
    super("Another tab is using an older draft database. Refresh or close that tab and retry.");
    this.name = "DraftDatabaseBlockedError";
  }
}

function getDatabase() {
  if (!databasePromise) {
    let wasBlocked = false;
    let rejectBlocked!: (error: DraftDatabaseBlockedError) => void;
    const blocked = new Promise<never>((_resolve, reject) => {
      rejectBlocked = reject;
    });
    const opening = openDB<AttentionDraftDatabase>(databaseName, 2, {
      blocked() {
        wasBlocked = true;
        rejectBlocked(new DraftDatabaseBlockedError());
      },
      blocking(_currentVersion, _blockedVersion, event) {
        (event.target as IDBDatabase).close();
        if (databasePromise === attempt) databasePromise = null;
      },
      upgrade(database, oldVersion, _newVersion, transaction) {
        const createDraftStore = () => {
          const store = database.createObjectStore("drafts", {
            keyPath: ["userId", "date", "entryMode"],
          });
          store.createIndex("by-user", "userId");
          return store;
        };
        if (oldVersion === 0) {
          createDraftStore();
          return;
        }
        void transaction.objectStore("drafts").getAll().then((legacyDrafts) => {
          database.deleteObjectStore("drafts");
          const store = createDraftStore();
          for (const draft of legacyDrafts) {
            void store.put(normalizeDraft({ ...draft, entryMode: "manual" }));
            if (draft.activeAiJob) {
              const job = draft.activeAiJob;
              void store.put({
                userId: draft.userId,
                date: job.targetDate,
                entryMode: "ai",
                attention: "",
                sourceUrl: job.sourceUrl,
                summary: "",
                inspiration: "",
                imageBlob: null,
                imageName: "",
                removeImage: false,
                baseVersion: null,
                updatedAt: draft.updatedAt,
                activeAiJob: job,
              });
            }
          }
        }).catch(() => transaction.abort());
      },
    }).then((database) => {
      // IndexedDB cannot cancel an open request; release a connection that arrives after rejection.
      if (wasBlocked) database.close();
      return database;
    });
    const attempt: Promise<IDBPDatabase<AttentionDraftDatabase>> = Promise.race([opening, blocked]).catch((error: unknown) => {
      if (databasePromise === attempt) databasePromise = null;
      throw error;
    });
    databasePromise = attempt;
  }
  return databasePromise;
}

function normalizeDraft(draft: StoredDraft): StoredDraft {
  const normalized = { ...draft, entryMode: draft.entryMode ?? "manual" };
  if (normalized.entryMode === "manual") {
    delete normalized.activeAiJob;
    delete normalized.userPrompt;
    delete normalized.aiGenerationContext;
  }
  return normalized;
}

export async function loadDraft(userId: string, date: string, entryMode: CheckInEntryMode = "manual") {
  return (await getDatabase()).get("drafts", [userId, date, entryMode]);
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
      transaction.store.put(normalizeDraft(draft)),
      transaction.done,
    ]);
  } catch (error) {
    if (transactionAborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener("abort", abortTransaction);
  }
}

export async function deleteDraft(userId: string, date: string, entryMode: CheckInEntryMode = "manual") {
  await (await getDatabase()).delete("drafts", [userId, date, entryMode]);
}

export async function applyAiResultToDraft(
  userId: string,
  job: ActiveAiJob,
  result: AiGenerationResult,
  savedRecord?: { entryMode?: CheckInEntryMode; inspiration: string; version: number } | null,
) {
  const database = await getDatabase();
  const transaction = database.transaction("drafts", "readwrite");
  const existing = await transaction.store.get([userId, job.targetDate, "ai"]);
  const savedAiRecord = savedRecord?.entryMode === "ai" ? savedRecord : null;
  const next: StoredDraft = {
    userId,
    date: job.targetDate,
    entryMode: "ai",
    attention: result.attention,
    sourceUrl: job.sourceUrl,
    userPrompt: existing?.userPrompt ?? job.userPrompt ?? job.generationContext?.userPrompt ?? "",
    aiGenerationContext: job.generationContext ?? null,
    summary: result.summary,
    inspiration: existing?.inspiration ?? savedAiRecord?.inspiration ?? "",
    imageBlob: existing?.imageBlob ?? null,
    imageName: existing?.imageName ?? "",
    removeImage: existing?.removeImage ?? false,
    uploadedImagePath: existing?.uploadedImagePath ?? null,
    baseVersion: existing ? existing.baseVersion : savedAiRecord?.version ?? null,
    updatedAt: new Date().toISOString(),
  };
  await Promise.all([transaction.store.put(next), transaction.done]);
  return next;
}

export async function clearDraftActiveAiJob(
  userId: string,
  job: ActiveAiJob,
) {
  const existing = await loadDraft(userId, job.targetDate, "ai");
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
