"use client";

import { useEffect, useRef, useState } from "react";
import type { CheckInDraft } from "@/features/checkins/checkin-editor";
import type { CheckInRecord } from "@/features/checkins/types";
import {
  deleteDraft,
  loadDraft,
  saveDraft,
  type StoredDraft,
} from "@/lib/indexed-db/drafts";

type DraftStorageState = "loading" | "ready" | "unavailable";

type ActiveWrite = {
  controller: AbortController;
  promise: Promise<void>;
};

type UseCheckInDraftOptions = {
  userId: string | null;
  date: string;
  cloudRecord: CheckInRecord | null | undefined;
  draft: CheckInDraft;
  isDirty: boolean;
  baseVersion: number | null;
  onRestore: (draft: CheckInDraft, baseVersion: number | null) => void;
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
  };
}

export function useCheckInDraft({
  userId,
  date,
  cloudRecord,
  draft,
  isDirty,
  baseVersion,
  onRestore,
}: UseCheckInDraftOptions) {
  const [storageState, setStorageState] = useState<DraftStorageState>("loading");
  const [isOffline, setIsOffline] = useState(() =>
    typeof navigator !== "undefined" && !navigator.onLine,
  );
  const loadGenerationRef = useRef(0);
  const editGenerationRef = useRef(0);
  const writeGenerationRef = useRef(0);
  const writeTimerRef = useRef<number | null>(null);
  const activeWritesRef = useRef(new Set<ActiveWrite>());
  const onRestoreRef = useRef(onRestore);
  const isCloudRecordLoading = cloudRecord === undefined;
  const cloudUpdatedAt = cloudRecord
    ? Date.parse(cloudRecord.updatedAt)
    : Number.NEGATIVE_INFINITY;

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
    if (isDirty) editGenerationRef.current += 1;
  }, [draft, isDirty]);

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
        if (stored && Number.isFinite(localUpdatedAt) && localUpdatedAt > cloudUpdatedAt) {
          onRestoreRef.current(editorDraftFromStored(stored), stored.baseVersion);
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
    if (!userId || (isCloudRecordLoading && !isOffline) || storageState !== "ready" || !isDirty) return;

    const generation = writeGenerationRef.current + 1;
    writeGenerationRef.current = generation;
    const effectWrites = new Set<ActiveWrite>();
    const timer = window.setTimeout(() => {
      if (writeTimerRef.current === timer) writeTimerRef.current = null;
      const controller = new AbortController();
      const write = saveDraft(
        storedDraftFromEditor(userId, date, draft, baseVersion),
        { signal: controller.signal },
      ).catch((error: unknown) => {
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
  }, [baseVersion, date, draft, isCloudRecordLoading, isDirty, isOffline, storageState, userId]);

  async function deleteAfterCloudSave() {
    if (!userId) return;
    writeGenerationRef.current += 1;
    if (writeTimerRef.current !== null) {
      window.clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
    }
    const activeWrites = [...activeWritesRef.current];
    abortActiveWrites(activeWritesRef.current);
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
