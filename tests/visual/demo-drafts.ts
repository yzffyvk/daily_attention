// The acceptance demo must also run in embedded browsers where IndexedDB hangs.
// serve.mjs aliases the draft module here; automated fixtures keep the real store.
import * as persistent from "../../lib/indexed-db/drafts";
import type { StoredDraft } from "../../lib/indexed-db/drafts";

export type { StoredDraft };
export { DraftDatabaseBlockedError } from "../../lib/indexed-db/drafts";

const isDemo = new URLSearchParams(window.location.search).get("fixture") !== "1";
const storageKey = "aura-acceptance-demo:drafts:v1";
type Snapshot = Omit<StoredDraft, "imageBlob"> & { imageData: string | null };
const snapshots = new Map<string, Snapshot>();
const keyFor = (userId: string, date: string, mode = "manual") => JSON.stringify([userId, date, mode]);

if (isDemo) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]") as Snapshot[];
    for (const draft of saved) {
      if (draft.userId?.startsWith("demo-") && draft.date && typeof draft.attention === "string") {
        snapshots.set(keyFor(draft.userId, draft.date, draft.entryMode), draft);
      }
    }
  } catch { /* Session storage is optional; this tab can still demonstrate the flow. */ }
}

function persist() {
  try { sessionStorage.setItem(storageKey, JSON.stringify([...snapshots.values()])); }
  catch { /* Keep the in-memory drafts usable when browser storage is unavailable. */ }
}

function encodeImage(blob: Blob | null): Promise<string | null> {
  if (!blob) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function restore(snapshot: Snapshot): StoredDraft {
  const { imageData, ...draft } = structuredClone(snapshot);
  const imageBlob = imageData ? new Blob([
    Uint8Array.from(atob(imageData.slice(imageData.indexOf(",") + 1)), char => char.charCodeAt(0)),
  ], { type: imageData.slice(5, imageData.indexOf(";")) }) : null;
  return { ...draft, imageBlob };
}

export const loadDraft: typeof persistent.loadDraft = async (userId, date, mode = "manual") => {
  if (!isDemo) return persistent.loadDraft(userId, date, mode);
  const snapshot = snapshots.get(keyFor(userId, date, mode));
  return snapshot ? restore(snapshot) : undefined;
};

export const saveDraft: typeof persistent.saveDraft = async (draft, { signal } = {}) => {
  if (!isDemo) return persistent.saveDraft(draft, { signal });
  signal?.throwIfAborted();
  const { imageBlob, ...fields } = structuredClone(draft);
  const snapshot: Snapshot = { ...fields, entryMode: draft.entryMode ?? "manual", imageData: await encodeImage(imageBlob) };
  signal?.throwIfAborted();
  if (snapshot.entryMode === "manual") delete snapshot.activeAiJob;
  snapshots.set(keyFor(snapshot.userId, snapshot.date, snapshot.entryMode), snapshot);
  persist();
};

export const deleteDraft: typeof persistent.deleteDraft = async (userId, date, mode = "manual") => {
  if (!isDemo) return persistent.deleteDraft(userId, date, mode);
  snapshots.delete(keyFor(userId, date, mode));
  persist();
};

export const applyAiResultToDraft: typeof persistent.applyAiResultToDraft = async (userId, job, result, savedRecord) => {
  if (!isDemo) return persistent.applyAiResultToDraft(userId, job, result, savedRecord);
  const existing = await loadDraft(userId, job.targetDate, "ai");
  const saved = savedRecord?.entryMode === "ai" ? savedRecord : null;
  const draft: StoredDraft = {
    userId, date: job.targetDate, entryMode: "ai",
    attention: result.attention, sourceUrl: job.sourceUrl, summary: result.summary,
    userPrompt: existing?.userPrompt ?? job.userPrompt ?? job.generationContext?.userPrompt ?? "",
    aiGenerationContext: job.generationContext ?? null,
    inspiration: existing?.inspiration ?? saved?.inspiration ?? "",
    imageBlob: existing?.imageBlob ?? null, imageName: existing?.imageName ?? "",
    removeImage: existing?.removeImage ?? false, uploadedImagePath: existing?.uploadedImagePath ?? null,
    baseVersion: existing ? existing.baseVersion : saved?.version ?? null,
    updatedAt: new Date().toISOString(),
  };
  await saveDraft(draft);
  return draft;
};

export const clearDraftActiveAiJob: typeof persistent.clearDraftActiveAiJob = async (userId, job) => {
  if (!isDemo) return persistent.clearDraftActiveAiJob(userId, job);
  const existing = await loadDraft(userId, job.targetDate, "ai");
  if (!existing || existing.activeAiJob?.jobId !== job.jobId) return;
  delete existing.activeAiJob;
  await saveDraft({ ...existing, updatedAt: new Date().toISOString() });
};

export const deleteAttentionDraftDatabase: typeof persistent.deleteAttentionDraftDatabase = async () => {
  if (!isDemo) return persistent.deleteAttentionDraftDatabase();
  snapshots.clear();
  persist();
};
