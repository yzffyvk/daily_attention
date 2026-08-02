"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CheckInDraft } from "@/features/checkins/checkin-editor";
import type { CheckInRecord } from "@/features/checkins/types";
import type { ActiveAiJob } from "@/features/ai-generation/types";
import {
  deleteDraft,
  loadDraft,
  saveDraft,
  type StoredDraft,
} from "@/lib/indexed-db/drafts";

export type DraftStorageState = "loading" | "ready" | "unavailable";

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

function abortActiveWrites(activeWrites: Set<ActiveWrite>) {
  for (const write of activeWrites) write.controller.abort();
}

function editorDraftsMatch(left: CheckInDraft, right: CheckInDraft) {
  return (
    left.attention === right.attention
    && left.sourceUrl === right.sourceUrl
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
    summary: stored.summary,
    inspiration: stored.inspiration,
    imageFile,
    removeImage: stored.removeImage,
    uploadedImagePath: null,
  };
}

function storedDraftFromEditor(
  userId: string,
  date: string,
  draft: CheckInDraft,
  baseVersion: number | null,
  activeAiJob: ActiveAiJob | null = null,
): StoredDraft {
  return {
    userId,
    date,
    attention: draft.attention,
    sourceUrl: draft.sourceUrl,
    summary: draft.summary,
    inspiration: draft.inspiration,
    imageBlob: draft.imageFile,
    imageName: draft.imageFile?.name ?? "",
    removeImage: draft.removeImage,
    baseVersion,
    updatedAt: new Date().toISOString(),
    ...(activeAiJob ? { activeAiJob } : {}),
  };
}

export function useCheckInDraft({
  userId,
  date,
  cloudRecord,
  draft,
  isDirty,
  baseVersion,
  activeAiJob = null,
  onRestore,
}: UseCheckInDraftOptions) {
  const [storageState, setStorageState] = useState<DraftStorageState>("loading");
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

  useLayoutEffect(() => () => {
    cancelPendingWrites();
  }, [cancelPendingWrites, date, userId]);

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

    void loadDraft(userId, date)
      .then((stored) => {
        if (!active || generation !== loadGenerationRef.current) return;
        setStorageState("ready");
        if (editGeneration !== editGenerationRef.current) return;
        const localUpdatedAt = stored ? Date.parse(stored.updatedAt) : Number.NaN;
        persistedActiveJobIdRef.current = stored?.activeAiJob?.jobId ?? null;
        if (stored && Number.isFinite(localUpdatedAt) && localUpdatedAt > cloudUpdatedAt) {
          const restoredDraft = editorDraftFromStored(stored);
          if (stored.activeAiJob) {
            onRestoreRef.current(restoredDraft, stored.baseVersion, stored.activeAiJob);
          } else {
            onRestoreRef.current(restoredDraft, stored.baseVersion);
          }
        }
      })
      .catch(() => {
        if (!active || generation !== loadGenerationRef.current) return;
        setStorageState("unavailable");
      });

    return () => {
      active = false;
    };
  }, [cloudUpdatedAt, date, isCloudRecordLoading, isOffline, userId]);

  useEffect(() => {
    const activeMetadataChanged = persistedActiveJobIdRef.current !== activeAiJob?.jobId;
    if (
      !userId
      || (isCloudRecordLoading && !isOffline)
      || storageState !== "ready"
      || (!isDirty && !activeAiJob && !activeMetadataChanged)
    ) return;

    const generation = writeGenerationRef.current + 1;
    writeGenerationRef.current = generation;
    const effectWrites = new Set<ActiveWrite>();
    const timer = window.setTimeout(() => {
      if (writeTimerRef.current === timer) writeTimerRef.current = null;
      const controller = new AbortController();
      const write = saveDraft(
        storedDraftFromEditor(userId, date, draft, baseVersion, activeAiJob),
        { signal: controller.signal },
      ).then(() => {
        if (generation === writeGenerationRef.current) {
          persistedActiveJobIdRef.current = activeAiJob?.jobId ?? null;
        }
      }).catch((error: unknown) => {
        if (isAbortError(error)) return;
        if (generation === writeGenerationRef.current) setStorageState("unavailable");
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
  }, [activeAiJob, baseVersion, date, draft, isCloudRecordLoading, isDirty, isOffline, storageState, userId]);

  async function deleteAfterCloudSave() {
    if (!userId) return;
    const activeWrites = cancelPendingWrites();
    await Promise.allSettled(activeWrites.map((write) => write.promise));
    const generation = loadGenerationRef.current;
    try {
      await deleteDraft(userId, date);
    } catch {
      if (generation === loadGenerationRef.current) setStorageState("unavailable");
    }
  }

  return {
    deleteAfterCloudSave,
    isOffline,
    storageState,
  };
}

export { editorDraftFromStored, storedDraftFromEditor };
