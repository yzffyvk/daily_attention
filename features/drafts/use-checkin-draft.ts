"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CheckInDraft } from "@/features/checkins/checkin-editor";
import type { CheckInRecord } from "@/features/checkins/types";
import type { ActiveAiJob } from "@/features/ai-generation/types";
import type { CheckInEntryMode } from "@/lib/domain/checkin";
import { sameAiGenerationContext } from "@/lib/domain/ai-prompt";
import {
  deleteDraft,
  loadDraft,
  saveDraft,
  type StoredDraft,
} from "@/lib/indexed-db/drafts";

export type DraftStorageState = "loading" | "ready" | "unavailable" | "blocked";

type ActiveWrite = {
  controller: AbortController;
  promise: Promise<void>;
};

type EditTokenState = {
  draft: CheckInDraft;
  isDirty: boolean;
  token: number;
};

type UseCheckInDraftOptions = {
  userId: string | null;
  date: string;
  entryMode?: CheckInEntryMode;
  cloudRecord: CheckInRecord | null | undefined;
  draft: CheckInDraft;
  isDirty: boolean;
  baseVersion: number | null;
  activeAiJob?: ActiveAiJob | null;
  onRestore: (
    draft: CheckInDraft,
    baseVersion: number | null,
    activeAiJob?: ActiveAiJob | null,
  ) => void;
};

function isAbortError(error: unknown) {
  return (
    typeof error === "object"
    && error !== null
    && "name" in error
    && error.name === "AbortError"
  );
}

function storageStateForError(error: unknown): DraftStorageState {
  return typeof error === "object" && error !== null
    && "name" in error && error.name === "DraftDatabaseBlockedError"
    ? "blocked"
    : "unavailable";
}

function abortActiveWrites(activeWrites: Set<ActiveWrite>) {
  for (const write of activeWrites) write.controller.abort();
}

function editorDraftsMatch(left: CheckInDraft, right: CheckInDraft) {
  return (
    left.attention === right.attention
    && left.sourceUrl === right.sourceUrl
    && (left.userPrompt ?? "") === (right.userPrompt ?? "")
    && sameAiGenerationContext(left.aiGenerationContext, right.aiGenerationContext)
    && left.summary === right.summary
    && left.inspiration === right.inspiration
    && left.imageFile === right.imageFile
    && left.removeImage === right.removeImage
    && left.uploadedImagePath === right.uploadedImagePath
  );
}

function editorDraftFromStored(stored: StoredDraft): CheckInDraft {
  const imageFile = stored.imageBlob
    ? new File([stored.imageBlob], stored.imageName || "image", {
        type: stored.imageBlob.type,
        lastModified: Date.parse(stored.updatedAt) || Date.now(),
      })
    : null;

  return {
    attention: stored.attention,
    sourceUrl: stored.sourceUrl,
    userPrompt: stored.entryMode === "ai" ? stored.userPrompt ?? "" : "",
    aiGenerationContext: stored.entryMode === "ai" ? stored.aiGenerationContext ?? null : null,
    summary: stored.summary,
    inspiration: stored.inspiration,
    imageFile,
    removeImage: stored.removeImage,
    uploadedImagePath: stored.uploadedImagePath ?? null,
  };
}

function storedDraftFromEditor(
  userId: string,
  date: string,
  draft: CheckInDraft,
  baseVersion: number | null,
  activeAiJob: ActiveAiJob | null = null,
  entryMode: CheckInEntryMode = "manual",
): StoredDraft {
  return {
    userId,
    date,
    entryMode,
    attention: draft.attention,
    sourceUrl: draft.sourceUrl,
    userPrompt: entryMode === "ai" ? draft.userPrompt ?? "" : "",
    aiGenerationContext: entryMode === "ai" ? draft.aiGenerationContext ?? null : null,
    summary: draft.summary,
    inspiration: draft.inspiration,
    imageBlob: draft.imageFile,
    imageName: draft.imageFile?.name ?? "",
    removeImage: draft.removeImage,
    uploadedImagePath: draft.uploadedImagePath,
    baseVersion,
    updatedAt: new Date().toISOString(),
    ...(entryMode === "ai" && activeAiJob ? { activeAiJob } : {}),
  };
}

export function useCheckInDraft({
  userId,
  date,
  entryMode = "manual",
  cloudRecord,
  draft,
  isDirty,
  baseVersion,
  activeAiJob = null,
  onRestore,
}: UseCheckInDraftOptions) {
  const identity = JSON.stringify([userId, date, entryMode]);
  const [identityLoadState, setIdentityLoadState] = useState(() => ({
    identity,
    loadedIdentity: null as string | null,
  }));
  if (identityLoadState.identity !== identity) {
    setIdentityLoadState({ identity, loadedIdentity: null });
  }
  const hasLoadedCurrentIdentity = identityLoadState.identity === identity
    && identityLoadState.loadedIdentity === identity;
  const [loadRetry, setLoadRetry] = useState(0);
  const [storageState, setStorageState] = useState<DraftStorageState>("loading");
  const isReadyForCurrentIdentity = storageState === "ready" && hasLoadedCurrentIdentity;
  const [isOffline, setIsOffline] = useState(() =>
    typeof navigator !== "undefined" && !navigator.onLine,
  );
  const loadGenerationRef = useRef(0);
  const writeGenerationRef = useRef(0);
  const writeTimerRef = useRef<number | null>(null);
  const activeWritesRef = useRef(new Set<ActiveWrite>());
  const onRestoreRef = useRef(onRestore);
  const persistedActiveJobIdRef = useRef<string | null>(null);
  const isCloudRecordLoading = cloudRecord === undefined;
  const modeActiveAiJob = entryMode === "ai" ? activeAiJob : null;
  const cloudUpdatedAt = cloudRecord
    ? Date.parse(cloudRecord.updatedAt)
    : Number.NEGATIVE_INFINITY;
  const [editTokenState, setEditTokenState] = useState<EditTokenState>(() => ({
    draft,
    isDirty,
    token: 0,
  }));
  let editToken = editTokenState.token;
  const draftChanged = !editorDraftsMatch(draft, editTokenState.draft);
  if (draftChanged || isDirty !== editTokenState.isDirty) {
    if (isDirty && (!editTokenState.isDirty || draftChanged)) {
      editToken += 1;
    }
    setEditTokenState({ draft, isDirty, token: editToken });
  }
  const editGenerationRef = useRef(editToken);

  useLayoutEffect(() => {
    editGenerationRef.current = editToken;
  }, [editToken]);

  const cancelPendingWrites = useCallback(() => {
    writeGenerationRef.current += 1;
    if (writeTimerRef.current !== null) {
      window.clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
    }
    const activeWrites = [...activeWritesRef.current];
    abortActiveWrites(activeWritesRef.current);
    return activeWrites;
  }, []);

  const retryDraftLoad = useCallback(() => {
    loadGenerationRef.current += 1;
    cancelPendingWrites();
    setIdentityLoadState({ identity, loadedIdentity: null });
    setStorageState("loading");
    setLoadRetry((retry) => retry + 1);
  }, [cancelPendingWrites, identity]);

  useLayoutEffect(() => () => {
    loadGenerationRef.current += 1;
    cancelPendingWrites();
  }, [cancelPendingWrites, date, entryMode, userId]);

  useEffect(() => {
    onRestoreRef.current = onRestore;
  }, [onRestore]);

  useEffect(() => {
    const updateNetworkState = () => setIsOffline(!navigator.onLine);
    window.addEventListener("online", updateNetworkState);
    window.addEventListener("offline", updateNetworkState);
    return () => {
      window.removeEventListener("online", updateNetworkState);
      window.removeEventListener("offline", updateNetworkState);
    };
  }, []);

  useEffect(() => {
    const generation = loadGenerationRef.current + 1;
    const editGeneration = editGenerationRef.current;
    loadGenerationRef.current = generation;
    writeGenerationRef.current += 1;

    if (!userId) {
      return;
    }

    let active = true;
    void Promise.resolve().then(() => {
      if (active && generation === loadGenerationRef.current) setStorageState("loading");
    });
    if (isCloudRecordLoading && !isOffline) {
      return () => {
        active = false;
      };
    }

    persistedActiveJobIdRef.current = null;
    void loadDraft(userId, date, entryMode)
      .then((stored) => {
        if (!active || generation !== loadGenerationRef.current) return;
        setIdentityLoadState({ identity, loadedIdentity: identity });
        setStorageState("ready");
        if (editGeneration !== editGenerationRef.current) return;
        const localUpdatedAt = stored ? Date.parse(stored.updatedAt) : Number.NaN;
        const restoredActiveAiJob = entryMode === "ai" ? stored?.activeAiJob : undefined;
        persistedActiveJobIdRef.current = restoredActiveAiJob?.jobId ?? null;
        if (stored && Number.isFinite(localUpdatedAt) && localUpdatedAt > cloudUpdatedAt) {
          const restoredDraft = editorDraftFromStored(stored);
          if (restoredActiveAiJob) {
            onRestoreRef.current(restoredDraft, stored.baseVersion, restoredActiveAiJob);
          } else {
            onRestoreRef.current(restoredDraft, stored.baseVersion);
          }
        }
      })
      .catch((error: unknown) => {
        if (!active || generation !== loadGenerationRef.current) return;
        setStorageState(storageStateForError(error));
      });

    return () => {
      active = false;
    };
  }, [cloudUpdatedAt, date, entryMode, identity, isCloudRecordLoading, isOffline, loadRetry, userId]);

  useEffect(() => {
    const activeMetadataChanged = persistedActiveJobIdRef.current !== (modeActiveAiJob?.jobId ?? null);
    if (
      !userId
      || (isCloudRecordLoading && !isOffline)
      || !isReadyForCurrentIdentity
      || (!isDirty && !modeActiveAiJob && !activeMetadataChanged)
    ) return;

    const generation = writeGenerationRef.current + 1;
    writeGenerationRef.current = generation;
    const effectWrites = new Set<ActiveWrite>();
    const timer = window.setTimeout(() => {
      if (writeTimerRef.current === timer) writeTimerRef.current = null;
      const controller = new AbortController();
      const write = saveDraft(
        storedDraftFromEditor(userId, date, draft, baseVersion, modeActiveAiJob, entryMode),
        { signal: controller.signal },
      ).then(() => {
        if (generation === writeGenerationRef.current) {
          persistedActiveJobIdRef.current = modeActiveAiJob?.jobId ?? null;
        }
      }).catch((error: unknown) => {
        if (isAbortError(error)) return;
        if (generation === writeGenerationRef.current) setStorageState(storageStateForError(error));
      });
      const activeWrite = { controller, promise: write };
      activeWritesRef.current.add(activeWrite);
      effectWrites.add(activeWrite);
      void write.finally(() => {
        activeWritesRef.current.delete(activeWrite);
        effectWrites.delete(activeWrite);
      });
    }, 400);
    writeTimerRef.current = timer;

    return () => {
      window.clearTimeout(timer);
      if (writeTimerRef.current === timer) writeTimerRef.current = null;
      if (generation === writeGenerationRef.current) writeGenerationRef.current += 1;
      abortActiveWrites(effectWrites);
    };
  }, [baseVersion, date, draft, entryMode, isCloudRecordLoading, isDirty, isOffline, isReadyForCurrentIdentity, modeActiveAiJob, userId]);

  async function flushCurrentDraft() {
    const activeWrites = cancelPendingWrites();
    const generation = loadGenerationRef.current;
    const snapshot = userId
      ? storedDraftFromEditor(userId, date, draft, baseVersion, modeActiveAiJob, entryMode)
      : null;
    await Promise.allSettled(activeWrites.map((write) => write.promise));
    if (!snapshot || storageState === "loading" || !hasLoadedCurrentIdentity) {
      throw new Error("Local draft storage is not ready. Keep the current draft open and retry.");
    }
    const controller = new AbortController();
    const activeWrite = {
      controller,
      promise: saveDraft(snapshot, { signal: controller.signal }),
    };
    activeWritesRef.current.add(activeWrite);
    try {
      await activeWrite.promise;
      if (generation === loadGenerationRef.current) {
        setStorageState("ready");
        persistedActiveJobIdRef.current = modeActiveAiJob?.jobId ?? null;
      }
    } catch (error) {
      if (!isAbortError(error) && generation === loadGenerationRef.current) {
        setStorageState(storageStateForError(error));
      }
      throw error;
    } finally {
      activeWritesRef.current.delete(activeWrite);
    }
  }

  async function deleteAfterCloudSave() {
    if (!userId) return;
    const activeWrites = cancelPendingWrites();
    await Promise.allSettled(activeWrites.map((write) => write.promise));
    const generation = loadGenerationRef.current;
    try {
      await deleteDraft(userId, date, entryMode);
    } catch (error) {
      if (generation === loadGenerationRef.current) setStorageState(storageStateForError(error));
    }
  }

  return {
    deleteAfterCloudSave,
    flushCurrentDraft,
    isOffline,
    isReadyForCurrentIdentity,
    retryDraftLoad,
    storageState,
  };
}

export { editorDraftFromStored, storedDraftFromEditor };
