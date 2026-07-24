import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";

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
  let abortRequested = false;
  const abortTransaction = () => {
    abortRequested = true;
    try {
      transaction.abort();
    } catch {
      // The transaction may already have settled; the caller still observes abort.
    }
  };
  signal?.addEventListener("abort", abortTransaction, { once: true });

  try {
    if (signal?.aborted) abortTransaction();
    await Promise.all([
      transaction.store.put(draft),
      transaction.done,
    ]);
    if (abortRequested) throw abortError();
  } catch (error) {
    if (abortRequested || signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener("abort", abortTransaction);
  }
}

export async function deleteDraft(userId: string, date: string) {
  await (await getDatabase()).delete("drafts", [userId, date]);
}

export async function deleteAttentionDraftDatabase() {
  const openDatabase = databasePromise;
  databasePromise = null;
  if (openDatabase) (await openDatabase).close();
  await deleteDB(databaseName);
}
