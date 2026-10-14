"use client";

import confetti from "canvas-confetti";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, ImageDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MonthCalendar } from "@/features/calendar/month-calendar";
import { useAiGeneration } from "@/features/ai-generation/use-ai-generation";
import type { CheckInEntryMode } from "@/lib/domain/checkin";
import type { ActiveAiJob } from "@/features/ai-generation/types";
import type { AiGenerationResult } from "@/lib/domain/ai-generation";
import { useCheckInDraft } from "@/features/drafts/use-checkin-draft";
import { AppHeader } from "@/features/profile/app-header";
import { CurrentLearningPersona } from "@/features/profile/learning-persona";
import { KnowledgeWorkspace } from "@/features/knowledge-narratives/knowledge-workspace";
import type { AccountProfile } from "@/server/auth/ports";
import {
  ApiError,
  deleteCheckInImage,
  requestApi,
  uploadCheckInImage,
} from "./api";
import {
  CheckInEditor,
  draftFromRecord,
  isDraftDirty,
  type CheckInDraft,
  type MessageTone,
} from "./checkin-editor";
import {
  formatDate,
  formatUpdatedAt,
  getTodayKey,
  millisecondsUntilNextLocalMidnight,
  monthKeyForDate,
} from "./dates";
import { DirtySwitchDialog, useDialogFocus } from "./dirty-switch-dialog";
import { DailyEchoDialog } from "./daily-echo-dialog";
import { DailyEchoCompanion } from "./daily-echo-companion";
import { useDailyEchoReceipt } from "./use-daily-echo-receipt";
import { DailyTakeawayEntry } from "@/features/daily-takeaways/daily-takeaway-entry";
import type { ImageSelection } from "./image-note-uploader";
import { checkInKeys, setMonthRecord, useCheckIn, useMonthCheckIns, useSaveCheckIn } from "./queries";
import type { CheckInRecord } from "./types";
import {
  applyAiResultToDraft,
  clearDraftActiveAiJob,
} from "@/lib/indexed-db/drafts";

const muteStorageKey = "attention-journal-muted";
const calendarStorageKey = "aura-calendar-collapsed";

type CheckInWorkspaceProps = {
  initialDate: string;
  initialToday?: string;
  initialEntryMode?: CheckInEntryMode;
  initialProfile?: AccountProfile | null;
  userId?: string | null;
};

function entryIdentity(date: string, mode: CheckInEntryMode) {
  return `${date}:${mode}`;
}

function draftWithAiResult(draft: CheckInDraft, job: ActiveAiJob, result: AiGenerationResult): CheckInDraft {
  return { ...draft, attention: result.attention, summary: result.summary, sourceUrl: job.sourceUrl,
    userPrompt: draft.userPrompt ?? job.userPrompt ?? job.generationContext?.userPrompt ?? "",
    aiGenerationContext: job.generationContext ?? null };
}

type ConflictState = {
  entryMode: CheckInEntryMode;
  current: CheckInRecord | null;
  date: string;
};

function ConflictDialog({
  conflict,
  isBusy,
  onClose,
  onLoadCloudVersion,
}: {
  conflict: ConflictState;
  isBusy: boolean;
  onClose: () => void;
  onLoadCloudVersion: () => void | Promise<void>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const keepLocalButtonRef = useRef<HTMLButtonElement>(null);
  useDialogFocus({
    dialogRef,
    initialFocusRef: keepLocalButtonRef,
    onClose,
  });

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-labelledby="conflict-title" aria-modal="true" className="switch-dialog conflict-dialog" ref={dialogRef} role="dialog">
        <p className="eyebrow">CLOUD VERSION</p>
        <h2 id="conflict-title">云端记录已更新</h2>
        <p>请先查看云端版本，再决定是否保留当前本地内容。</p>
        {conflict.current ? (
          <div className="cloud-record" aria-label="云端记录">
            <strong>{conflict.current.attention}</strong>
            <span>版本 {conflict.current.version} · 云端更新于 {formatUpdatedAt(conflict.current.updatedAt)}</span>
            {conflict.current.summary ? <p>{conflict.current.summary}</p> : null}
          </div>
        ) : (
          <p className="cloud-record-empty">云端的这条记录已被删除。</p>
        )}
        <div className="dialog-actions">
          <button className="primary-button" disabled={isBusy} onClick={onClose} ref={keepLocalButtonRef} type="button">保留本地内容</button>
          <button className="secondary-button" disabled={isBusy} onClick={() => void onLoadCloudVersion()} type="button">载入云端版本</button>
        </div>
      </section>
    </div>
  );
}

function playCheckInChime() {
  if (typeof window === "undefined" || !window.AudioContext) return;
  const audioContext = new AudioContext();
  const gain = audioContext.createGain();
  gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.18, audioContext.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.45);
  gain.connect(audioContext.destination);

  [784, 1174].forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    oscillator.start(audioContext.currentTime + index * 0.08);
    oscillator.stop(audioContext.currentTime + 0.42);
  });

  window.setTimeout(() => void audioContext.close(), 600);
}

function launchCelebration() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;

  const colors = ["#14755f", "#ef654f", "#f0c54d", "#315e8a", "#ffffff"];
  confetti({
    particleCount: 110,
    spread: 82,
    startVelocity: 42,
    origin: { y: 0.72 },
    colors,
  });

  const endAt = Date.now() + 1500;
  function frame() {
    confetti({ particleCount: 4, angle: 60, spread: 62, origin: { x: 0, y: 0.72 }, colors });
    confetti({ particleCount: 4, angle: 120, spread: 62, origin: { x: 1, y: 0.72 }, colors });
    if (Date.now() < endAt) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return true;
}

function messageForError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "保存失败，请稍后再试";
}

function isDefinitiveSaveRejection(error: unknown) {
  if (!(error instanceof ApiError)) return false;
  if (
    error.status === 0 ||
    error.code === "NETWORK_ERROR" ||
    error.code === "MALFORMED_RESPONSE"
  ) {
    return false;
  }
  return [400, 401, 403, 404, 422].includes(error.status);
}

function recordSnapshot(record: CheckInRecord | null) {
  return record ? { ...record } : null;
}

export function CheckInWorkspace({
  initialDate,
  initialToday = initialDate,
  initialEntryMode = "manual",
  initialProfile = null,
  userId = null,
}: CheckInWorkspaceProps) {
  const queryClient = useQueryClient();
  const [today, setToday] = useState(initialToday);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [calendarCollapsed, setCalendarCollapsed] = useState(false);
  const knowledgeLeaveGuard = useRef<((leave: () => void) => void) | null>(null);
  const knowledgeListNavigation = useRef<(() => void) | null>(null);
  const [selectedDate, setSelectedDate] = useState(initialDate > initialToday ? initialToday : initialDate);
  const [entryMode, setEntryMode] = useState<CheckInEntryMode>(initialEntryMode);
  const entryModeRef = useRef<CheckInEntryMode>(initialEntryMode);
  const modeSwitchInFlightRef = useRef(false);
  const transientDraftsRef = useRef(new Map<string, { draft: CheckInDraft; record: CheckInRecord | null; version: number | null }>());
  const [month, setMonth] = useState(() => monthKeyForDate(initialDate > initialToday ? initialToday : initialDate));
  const [draft, setDraft] = useState<CheckInDraft>(() => draftFromRecord(null));
  const [draftBaseRecord, setDraftBaseRecord] = useState<CheckInRecord | null>(null);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [baseRecordExists, setBaseRecordExists] = useState(false);
  const [hydratedIdentity, setHydratedIdentity] = useState<string | null>(null);
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [logoutPending, setLogoutPending] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<MessageTone>("neutral");
  const [toast, setToast] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [isCelebrating, setIsCelebrating] = useState(false);
  const [echoDate, setEchoDate] = useState<string | null>(null);
  const shownEchoesRef = useRef(new Set<string>());
  const echoAccountId = userId ?? initialProfile?.id;
  const { receivedDate: receivedEchoDate, receive: receiveEcho, hasReceived: hasReceivedEcho } = useDailyEchoReceipt(echoAccountId, today);
  const [isSaving, setIsSaving] = useState(false);
  const [isCleaningUpImage, setIsCleaningUpImage] = useState(false);
  const [isAbandoningDraft, setIsAbandoningDraft] = useState(false);
  const [isPreparingImage, setIsPreparingImage] = useState(false);
  const [activeAiJob, setActiveAiJob] = useState<ActiveAiJob | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const todayRef = useRef(initialToday);
  const selectedDateRef = useRef(selectedDate);
  const draftRef = useRef(draft);
  const draftBaseRecordRef = useRef<CheckInRecord | null>(null);
  const editorLockedRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const logoutInFlightRef = useRef(false);
  const imageOperationRef = useRef(0);
  const imageCleanupInFlightRef = useRef(false);
  const draftAbandonInFlightRef = useRef(false);
  const imagePreparationInFlightRef = useRef(false);
  const ambiguousCandidatePathsRef = useRef(new Set<string>());
  const activeAiJobRef = useRef<ActiveAiJob | null>(null);
  const activeAiSavedRecordRef = useRef<{
    jobId: string;
    record: CheckInRecord | null;
  } | null>(null);
  const aiPersistenceRef = useRef<Promise<unknown>>(Promise.resolve());
  const readyDraftIdentityRef = useRef<string | null>(null);
  const pendingAiResultsRef = useRef(new Map<string, { job: ActiveAiJob; result: AiGenerationResult }>());
  const terminalAiJobIdsRef = useRef(new Set<string>());

  const monthQuery = useMonthCheckIns(month);
  const checkInQuery = useCheckIn(selectedDate, entryMode);
  const saveMutation = useSaveCheckIn();
  const hasSelectedRecordError = checkInQuery.isError;
  const isDialogActionBusy = isSaving || saveMutation.isPending || isCleaningUpImage || isPreparingImage || isAbandoningDraft;
  const selectedRecord = checkInQuery.data ?? null;
  const isDirty = isDraftDirty(draft, draftBaseRecord);
  const canSave = Boolean(draft.attention.trim());
  const aiGeneration = useAiGeneration({
    activeJob: activeAiJob,
    onActiveJobChange: (nextJob) => {
      const previousJob = activeAiJobRef.current;
      if (nextJob && nextJob.jobId !== previousJob?.jobId) {
        activeAiSavedRecordRef.current = {
          jobId: nextJob.jobId,
          record: recordSnapshot(
            queryClient.getQueryData<CheckInRecord | null>(checkInKeys.date(nextJob.targetDate, "ai"))
              ?? (selectedDateRef.current === nextJob.targetDate && entryModeRef.current === "ai" ? draftBaseRecordRef.current : null),
          ),
        };
      }
      activeAiJobRef.current = nextJob;
      setActiveAiJob(nextJob);
      if (!nextJob && previousJob && userId) {
        aiPersistenceRef.current = aiPersistenceRef.current.then(
          () => clearDraftActiveAiJob(userId, previousJob),
          () => clearDraftActiveAiJob(userId, previousJob),
        );
      }
    },
    onSucceeded: (result, targetDate, generationContext) => {
      const active = activeAiJobRef.current;
      if (!active || active.targetDate !== targetDate || terminalAiJobIdsRef.current.has(active.jobId)) return;
      const job = { ...active, generationContext: generationContext ?? active.generationContext };
      terminalAiJobIdsRef.current.add(job.jobId);
      const identity = entryIdentity(targetDate, "ai");
      if (readyDraftIdentityRef.current === identity && selectedDateRef.current === targetDate && entryModeRef.current === "ai" && !modeSwitchInFlightRef.current) {
        setDraft((current) => draftWithAiResult(current, job, result));
        setStatus("AI 小结已生成，请审阅后手动保存", "success");
      } else {
        // Incoming local reads must finish before changing the editor draft.
        pendingAiResultsRef.current.set(identity, { job, result });
        if (!userId) return;
        const cachedRecord = queryClient.getQueryData<CheckInRecord | null>(checkInKeys.date(targetDate, "ai"));
        // Keep the saved reflection available for the whole job, even after query cache eviction.
        const savedRecord = cachedRecord !== undefined
          ? cachedRecord
          : activeAiSavedRecordRef.current?.jobId === job.jobId
            ? activeAiSavedRecordRef.current.record
            : null;
        transientDraftsRef.current.delete(entryIdentity(targetDate, "ai"));
        const persistResult = () => applyAiResultToDraft(
          userId,
          job,
          result,
          savedRecord,
        );
        aiPersistenceRef.current = aiPersistenceRef.current.then(
          persistResult,
          persistResult,
        );
        showToast(`${formatDate(targetDate)}的 AI 小结已生成`);
      }
    },
    onTerminal: (jobId) => { terminalAiJobIdsRef.current.add(jobId); },
  });
  const {
    deleteAfterCloudSave,
    flushCurrentDraft,
    isOffline,
    isReadyForCurrentIdentity,
    retryDraftLoad,
    storageState: draftStorageState,
  } = useCheckInDraft({
    userId,
    date: selectedDate,
    entryMode,
    cloudRecord: checkInQuery.isSuccess ? selectedRecord : hasSelectedRecordError ? null : undefined,
    draft,
    isDirty,
    baseVersion,
    activeAiJob: entryMode === "ai" && activeAiJob?.targetDate === selectedDate ? activeAiJob : null,
    onRestore: (restoredDraft, restoredBaseVersion, restoredAiJob) => {
      if (selectedDateRef.current !== selectedDate || entryModeRef.current !== entryMode) return;
      const cloudSnapshot = recordSnapshot(checkInQuery.data ?? null);
      const pendingResult = pendingAiResultsRef.current.get(entryIdentity(selectedDate, entryMode));
      const nextDraft = pendingResult ? draftWithAiResult(restoredDraft, pendingResult.job, pendingResult.result) : restoredDraft;
      draftRef.current = nextDraft;
      draftBaseRecordRef.current = cloudSnapshot;
      setDraft(nextDraft);
      setDraftBaseRecord(cloudSnapshot);
      setBaseVersion(restoredBaseVersion);
      setBaseRecordExists(cloudSnapshot !== null);
      setHydratedIdentity(entryIdentity(selectedDate, entryMode));
      if (restoredAiJob && !terminalAiJobIdsRef.current.has(restoredAiJob.jobId)) {
        activeAiJobRef.current = restoredAiJob;
        activeAiSavedRecordRef.current = { jobId: restoredAiJob.jobId, record: cloudSnapshot };
        setActiveAiJob(restoredAiJob);
      }
      setStatus("已恢复本地草稿", "success");
    },
  });
  const isCloudReadFailure = hasSelectedRecordError && !isOffline;
  const isAwaitingSelectedRecord = (!isOffline && (hydratedIdentity !== entryIdentity(selectedDate, entryMode) || checkInQuery.isFetching)) || Boolean(userId && ((!isReadyForCurrentIdentity && draftStorageState !== "unavailable") || draftStorageState === "blocked"));
  const isEditorLocked = isDialogActionBusy || isAwaitingSelectedRecord || isCloudReadFailure;
  const isHeaderBusy = isDialogActionBusy || Boolean(conflict);

  useLayoutEffect(() => {
    readyDraftIdentityRef.current = (!userId || isReadyForCurrentIdentity)
      && hydratedIdentity === entryIdentity(selectedDate, entryMode)
      && !checkInQuery.isFetching
      && (!hasSelectedRecordError || isOffline)
      ? entryIdentity(selectedDate, entryMode)
      : null;
  }, [checkInQuery.isFetching, entryMode, hasSelectedRecordError, hydratedIdentity, isOffline, isReadyForCurrentIdentity, selectedDate, userId]);

  useEffect(() => {
    const identity = entryIdentity(selectedDate, entryMode);
    if (entryMode !== "ai" || readyDraftIdentityRef.current !== identity || modeSwitchInFlightRef.current) return;
    const pendingResult = pendingAiResultsRef.current.get(identity);
    if (!pendingResult) return;
    pendingAiResultsRef.current.delete(identity);
    setDraft((current) => draftWithAiResult(current, pendingResult.job, pendingResult.result));
    setStatus("AI 小结已生成，请审阅后手动保存", "success");
  }, [checkInQuery.isFetching, entryMode, hydratedIdentity, isOffline, isReadyForCurrentIdentity, selectedDate]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setIsMuted(window.localStorage.getItem(muteStorageKey) === "true");
        setCalendarCollapsed(window.localStorage.getItem(calendarStorageKey) === "true");
      } catch {
        // Reading and writing remain available when browser preferences are blocked.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    draftBaseRecordRef.current = draftBaseRecord;
  }, [draftBaseRecord]);

  useEffect(() => {
    editorLockedRef.current = isEditorLocked;
  }, [isEditorLocked]);

  const hydrateDraft = useCallback((record: CheckInRecord | null, date: string | null) => {
    const snapshot = recordSnapshot(record);
    const nextDraft = draftFromRecord(snapshot);
    draftRef.current = nextDraft;
    draftBaseRecordRef.current = snapshot;
    setDraft(nextDraft);
    setDraftBaseRecord(snapshot);
    setBaseVersion(snapshot?.version ?? null);
    setBaseRecordExists(snapshot !== null);
    setHydratedIdentity(date ? entryIdentity(date, entryModeRef.current) : null);
  }, []);

  useEffect(() => {
    if (isOffline && hasSelectedRecordError && hydratedIdentity !== entryIdentity(selectedDate, entryMode)) {
      if (isDraftDirty(draftRef.current, draftBaseRecordRef.current)) {
        setHydratedIdentity(entryIdentity(selectedDate, entryMode));
      } else {
        hydrateDraft(null, selectedDate);
      }
    }
  }, [entryMode, hasSelectedRecordError, hydratedIdentity, hydrateDraft, isOffline, selectedDate]);

  useEffect(() => {
    if (!checkInQuery.isSuccess) return;
    const needsInitialHydration = hydratedIdentity !== entryIdentity(selectedDate, entryMode);
    const isClean = !isDraftDirty(draftRef.current, draftBaseRecordRef.current);
    if (!needsInitialHydration && (checkInQuery.isFetching || !isClean)) return;
    const record = checkInQuery.data ?? null;
    const timer = window.setTimeout(() => {
      if (selectedDateRef.current !== selectedDate || entryModeRef.current !== entryMode) return;
      if (hydratedIdentity !== entryIdentity(selectedDate, entryMode) && checkInQuery.isFetching) {
        hydrateDraft(record, selectedDate);
        return;
      }
      if (!checkInQuery.isFetching && !isDraftDirty(draftRef.current, draftBaseRecordRef.current)) {
        hydrateDraft(record, selectedDate);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [entryMode, checkInQuery.data, checkInQuery.isFetching, checkInQuery.isSuccess, hydrateDraft, hydratedIdentity, selectedDate]);

  useEffect(() => {
    let midnightTimer: number | null = null;

    function refreshLocalToday() {
      const browserToday = getTodayKey();
      const previousToday = todayRef.current;
      if (browserToday !== previousToday) {
        todayRef.current = browserToday;
        setToday(browserToday);

        const draftIsClean = !isDraftDirty(
          draftRef.current,
          draftBaseRecordRef.current,
        );
        if (
          selectedDateRef.current === previousToday &&
          draftIsClean &&
          !saveInFlightRef.current &&
          !draftAbandonInFlightRef.current &&
          !imageCleanupInFlightRef.current &&
          !imagePreparationInFlightRef.current
        ) {
          const cached = queryClient.getQueryData<CheckInRecord | null>(
            checkInKeys.date(browserToday, entryModeRef.current),
          );
          imageOperationRef.current += 1;
          readyDraftIdentityRef.current = null;
          selectedDateRef.current = browserToday;
          setMonth(monthKeyForDate(browserToday));
          setSelectedDate(browserToday);
          hydrateDraft(
            cached ?? null,
            cached === undefined ? null : browserToday,
          );
          setPendingDate(null);
        }
      }

      midnightTimer = window.setTimeout(
        refreshLocalToday,
        millisecondsUntilNextLocalMidnight(),
      );
    }

    refreshLocalToday();
    return () => {
      if (midnightTimer !== null) window.clearTimeout(midnightTimer);
    };
  }, [hydrateDraft, queryClient]);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    imagePreparationInFlightRef.current = false;
  }, []);

  function setStatus(nextMessage: string, tone: MessageTone = "neutral") {
    setMessage(nextMessage);
    setMessageTone(tone);
  }

  function showToast(nextToast: string) {
    setToast(nextToast);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 2600);
  }

  function hasShownDailyEcho(date: string) {
    return shownEchoesRef.current.has(`${echoAccountId ?? "session"}:${date}`) || hasReceivedEcho(date);
  }

  function openDailyEcho(date: string) {
    shownEchoesRef.current.add(`${echoAccountId ?? "session"}:${date}`);
    // Remember today's presentation, not whether a record already existed.
    // Reviewing an older card must not overwrite today's marker.
    if (date === todayRef.current) receiveEcho(date);
    setEchoDate(date);
  }

  function scrollToEditor() {
    window.requestAnimationFrame(() => {
      document.getElementById("entry-editor")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    });
  }

  async function switchEntryMode(nextMode: CheckInEntryMode) {
    if (nextMode === entryModeRef.current || editorLockedRef.current || modeSwitchInFlightRef.current || conflict) return;
    const date = selectedDateRef.current;
    const previousMode = entryModeRef.current;
    modeSwitchInFlightRef.current = true;
    readyDraftIdentityRef.current = null;
    editorLockedRef.current = true;
    setIsCleaningUpImage(true);
    try {
      if (userId && (isDraftDirty(draftRef.current, draftBaseRecordRef.current) || (previousMode === "ai" && activeAiJobRef.current?.targetDate === date))) {
        // Serialize the outgoing snapshot before any AI result arriving during this switch.
        const flush = () => flushCurrentDraft();
        aiPersistenceRef.current = aiPersistenceRef.current.then(flush, flush);
        await aiPersistenceRef.current;
      } else if (!userId) {
        transientDraftsRef.current.set(entryIdentity(date, previousMode), {
          draft: draftRef.current, record: draftBaseRecordRef.current, version: baseVersion,
        });
      }
      await aiPersistenceRef.current;
      const cached = queryClient.getQueryData<CheckInRecord | null>(checkInKeys.date(date, nextMode));
      imageOperationRef.current += 1;
      entryModeRef.current = nextMode;
      setEntryMode(nextMode);
      const transient = !userId ? transientDraftsRef.current.get(entryIdentity(date, nextMode)) : undefined;
      if (transient) {
        draftRef.current = transient.draft;
        draftBaseRecordRef.current = transient.record;
        setDraft(transient.draft);
        setDraftBaseRecord(transient.record);
        setBaseVersion(transient.version);
        setBaseRecordExists(transient.record !== null);
        setHydratedIdentity(entryIdentity(date, nextMode));
      } else {
        hydrateDraft(cached ?? null, cached === undefined ? null : date);
      }
      setStatus(nextMode === "ai" ? "已切换到 AI 提炼，内容独立保存" : "已切换到手动记录，内容独立保存");
    } catch {
      aiPersistenceRef.current = aiPersistenceRef.current.catch(() => undefined);
      setStatus("草稿暂时无法保存，请保留当前页面并重试切换", "error");
    } finally {
      modeSwitchInFlightRef.current = false;
      editorLockedRef.current = false;
      setIsCleaningUpImage(false);
    }
  }

  async function openCalendarRecord(mode: CheckInEntryMode) {
    if (editorLockedRef.current || modeSwitchInFlightRef.current || conflict) return;
    await switchEntryMode(mode);
    if (entryModeRef.current === mode && !editorLockedRef.current && !conflict) scrollToEditor();
  }

  function openDate(date: string) {
    if (editorLockedRef.current || imageCleanupInFlightRef.current) return;
    const cached = queryClient.getQueryData<CheckInRecord | null>(checkInKeys.date(date, entryModeRef.current));
    imageOperationRef.current += 1;
    readyDraftIdentityRef.current = null;
    imagePreparationInFlightRef.current = false;
    setIsPreparingImage(false);
    selectedDateRef.current = date;
    setMonth(monthKeyForDate(date));
    setSelectedDate(date);
    hydrateDraft(cached ?? null, cached === undefined ? null : date);
    setPendingDate(null);
    setStatus(cached ? `已打开${formatDate(date)}的学习记录` : `${formatDate(date)}还没有记录`);
    scrollToEditor();
  }

  function isCurrentImageOperation(operation: number, date = selectedDateRef.current) {
    return operation === imageOperationRef.current && date === selectedDateRef.current;
  }

  async function cleanupPendingImage(path: string, quiet = false, operation = imageOperationRef.current) {
    if (ambiguousCandidatePathsRef.current.has(path)) return false;
    if (imageCleanupInFlightRef.current) return false;
    imageCleanupInFlightRef.current = true;
    editorLockedRef.current = true;
    setIsCleaningUpImage(true);
    setStatus("正在清理临时图片…");
    try {
      await deleteCheckInImage(path);
      return true;
    } catch {
      if (!quiet && isCurrentImageOperation(operation)) {
        setStatus("图片临时文件清理失败，它会在稍后过期", "error");
      }
      return false;
    } finally {
      imageCleanupInFlightRef.current = false;
      editorLockedRef.current = saveInFlightRef.current || imagePreparationInFlightRef.current || draftAbandonInFlightRef.current;
      setIsCleaningUpImage(false);
    }
  }

  async function abandonLocalDraft(record = selectedRecord, operation = imageOperationRef.current) {
    if (draftAbandonInFlightRef.current) return false;
    draftAbandonInFlightRef.current = true;
    editorLockedRef.current = true;
    setIsAbandoningDraft(true);
    try {
      const uploadedImagePath = draftRef.current.uploadedImagePath;
      if (uploadedImagePath) {
        await cleanupPendingImage(uploadedImagePath, false, operation);
      }
      if (!isCurrentImageOperation(operation)) return false;
      await deleteAfterCloudSave();
      if (!isCurrentImageOperation(operation)) return false;
      const activeDate = selectedDateRef.current;
      const latestRecord = queryClient.getQueryData<CheckInRecord | null>(
        checkInKeys.date(activeDate, entryModeRef.current),
      );
      hydrateDraft(latestRecord === undefined ? record : latestRecord, activeDate);
      return true;
    } finally {
      draftAbandonInFlightRef.current = false;
      editorLockedRef.current = saveInFlightRef.current || imageCleanupInFlightRef.current || imagePreparationInFlightRef.current;
      setIsAbandoningDraft(false);
    }
  }

  function requestDateChange(date: string) {
    if (date > getTodayKey()) return;
    if (editorLockedRef.current || imageCleanupInFlightRef.current) return;
    if (date === selectedDate) {
      scrollToEditor();
      return;
    }
    if (isDirty) {
      setPendingDate(date);
      return;
    }
    openDate(date);
  }

  function selectToday() {
    if (editorLockedRef.current || imageCleanupInFlightRef.current) return;
    if (today === selectedDate) {
      setMonth(monthKeyForDate(today));
      scrollToEditor();
      return;
    }
    requestDateChange(today);
  }

  async function handleImageChange(selection: ImageSelection, identity: string) {
    const operation = imageOperationRef.current + 1;
    imageOperationRef.current = operation;
    const isCurrentOperation = () => (
      operation === imageOperationRef.current &&
      identity === entryIdentity(selectedDateRef.current, entryModeRef.current) &&
      !saveInFlightRef.current &&
      !imageCleanupInFlightRef.current
    );

    if (!isCurrentOperation()) return;
    const uploadedImagePath = draftRef.current.uploadedImagePath;
    if (uploadedImagePath) {
      await cleanupPendingImage(uploadedImagePath, false, operation);
    }
    if (!isCurrentOperation()) return;
    setDraft((current) => {
      if (!isCurrentOperation()) return current;
      return {
        ...current,
        imageFile: selection.file,
        removeImage: selection.removeImage,
        uploadedImagePath: null,
      };
    });
    if (!isCurrentOperation()) return;
    setStatus(
      isOffline
        ? "图片修改已保存为本地草稿，联网后可完成打卡"
        : selection.file
          ? "图片笔记已加入，记得完成保存"
          : "图片将在保存后移除",
    );
  }

  async function saveCurrentRecord({ showEcho = true }: { showEcho?: boolean } = {}) {
    if (selectedDate > getTodayKey()) {
      setStatus("未来日期不能记录，请选择今天或更早的日期", "error");
      return false;
    }
    if (isOffline) {
      setStatus(
        draftStorageState === "unavailable"
          ? "浏览器草稿保存失败，请保持页面开启并稍后重试"
          : "离线，内容已保存在此浏览器",
        draftStorageState === "unavailable" ? "error" : "neutral",
      );
      return false;
    }
    if (saveInFlightRef.current || imageCleanupInFlightRef.current || imagePreparationInFlightRef.current || editorLockedRef.current) return false;
    const activeDraft = draft;
    const activeRecord = draftBaseRecord;
    const activeRecordExists = baseRecordExists;
    const activeDate = selectedDate;
    const attention = activeDraft.attention.trim();
    if (!attention) {
      setStatus("请先填写今日知识主题", "error");
      return false;
    }

    let pendingImagePath = activeDraft.uploadedImagePath;
    saveInFlightRef.current = true;
    editorLockedRef.current = true;
    setIsSaving(true);
    setStatus("正在写入这一天…");
    try {
      if (activeDraft.imageFile && !pendingImagePath) {
        pendingImagePath = await uploadCheckInImage(activeDate, activeDraft.imageFile);
        const uploadedPath = pendingImagePath;
        setDraft((current) =>
          current.imageFile === activeDraft.imageFile
            ? { ...current, uploadedImagePath: uploadedPath }
            : current,
        );
      }

      const record = await saveMutation.mutateAsync({
        date: activeDate,
        input: {
          entryMode: entryModeRef.current,
          attention,
          sourceUrl: activeDraft.sourceUrl.trim(),
          ...(entryModeRef.current === "ai" ? {
            userPrompt: (activeDraft.userPrompt ?? "").trim(),
            aiGenerationContext: activeDraft.aiGenerationContext ?? null,
          } : {}),
          summary: activeDraft.summary.trim(),
          inspiration: activeDraft.inspiration.trim(),
          imagePath: activeDraft.removeImage
            ? null
            : pendingImagePath ?? activeRecord?.imagePath ?? null,
          imageName: activeDraft.removeImage
            ? ""
            : activeDraft.imageFile?.name ?? activeRecord?.imageName ?? "",
          version: baseVersion,
        },
      });

      if (pendingImagePath) {
        ambiguousCandidatePathsRef.current.delete(pendingImagePath);
      }
      const pendingAiJob = activeAiJobRef.current;
      if (entryModeRef.current === "ai" && pendingAiJob?.targetDate === activeDate) {
        activeAiSavedRecordRef.current = { jobId: pendingAiJob.jobId, record: recordSnapshot(record) };
      }
      hydrateDraft(record, activeDate);
      await deleteAfterCloudSave();
      setStatus(
        activeRecordExists
          ? `${formatDate(activeDate)}的修改已保存`
          : `${formatDate(activeDate)}打卡完成`,
        "success",
      );
      void queryClient.invalidateQueries({ queryKey: checkInKeys.date(activeDate, entryModeRef.current) });

      if (showEcho && activeDate === todayRef.current && !hasShownDailyEcho(activeDate)) openDailyEcho(activeDate);

      if (!activeRecordExists) {
        if (!isMuted) playCheckInChime();
        const animated = launchCelebration();
        setIsCelebrating(true);
        window.setTimeout(() => setIsCelebrating(false), animated ? 1900 : 900);
      } else {
        showToast("修改已保存到云端");
      }
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code === "VERSION_CONFLICT") {
        if (pendingImagePath) {
          const uploadedPath = pendingImagePath;
          setDraft((current) =>
            current.imageFile === activeDraft.imageFile
              ? { ...current, uploadedImagePath: uploadedPath }
              : current,
          );
        }
        setPendingDate(null);
        setLogoutPending(false);
        setConflict({ current: error.current ?? null, date: activeDate, entryMode: entryModeRef.current });
        queryClient.setQueryData(checkInKeys.date(activeDate, entryModeRef.current), error.current ?? null);
        setMonthRecord(queryClient, error.current ?? null, activeDate, entryModeRef.current);
        setStatus(error.message, "error");
        return false;
      }

      if (pendingImagePath) {
        if (isDefinitiveSaveRejection(error)) {
          const deleted = await cleanupPendingImage(pendingImagePath, true);
          if (deleted) {
            setDraft((current) =>
              current.uploadedImagePath === pendingImagePath
                ? { ...current, uploadedImagePath: null }
                : current,
            );
          }
        } else {
          ambiguousCandidatePathsRef.current.add(pendingImagePath);
        }
      }
      setStatus(messageForError(error), "error");
      return false;
    } finally {
      saveInFlightRef.current = false;
      editorLockedRef.current = false;
      setIsSaving(false);
    }
  }

  async function saveAndSwitch() {
    const targetDate = pendingDate;
    if (await saveCurrentRecord({ showEcho: false })) {
      if (targetDate) openDate(targetDate);
    }
  }

  async function discardAndSwitch() {
    if (editorLockedRef.current || imageCleanupInFlightRef.current || imagePreparationInFlightRef.current) return;
    const targetDate = pendingDate;
    const operation = imageOperationRef.current + 1;
    imageOperationRef.current = operation;
    if (await abandonLocalDraft(selectedRecord, operation)) {
      if (targetDate) openDate(targetDate);
    }
  }

  async function logout() {
    if (draftAbandonInFlightRef.current || imageCleanupInFlightRef.current || imagePreparationInFlightRef.current || saveInFlightRef.current || logoutInFlightRef.current) return;
    logoutInFlightRef.current = true;
    editorLockedRef.current = true;
    setIsSaving(true);
    try {
      await requestApi<Record<string, never>>("/api/auth/logout", {
        method: "POST",
        body: JSON.stringify({}),
      });
      window.location.assign("/login");
    } catch (error) {
      setStatus(messageForError(error), "error");
    } finally {
      logoutInFlightRef.current = false;
      editorLockedRef.current = false;
      setIsSaving(false);
    }
  }

  async function saveAndLogout() {
    if (await saveCurrentRecord({ showEcho: false })) await logout();
  }

  async function discardAndLogout() {
    if (draftAbandonInFlightRef.current || saveInFlightRef.current || logoutInFlightRef.current || imageCleanupInFlightRef.current || imagePreparationInFlightRef.current) return;
    const operation = imageOperationRef.current + 1;
    imageOperationRef.current = operation;
    if (await abandonLocalDraft(selectedRecord, operation)) await logout();
  }

  async function loadCloudVersion() {
    if (!conflict || imageCleanupInFlightRef.current || imagePreparationInFlightRef.current || editorLockedRef.current) return;
    const operation = imageOperationRef.current + 1;
    imageOperationRef.current = operation;
    const cloudRecord = conflict.current;
    const uploadedImagePath = draftRef.current.uploadedImagePath;
    if (uploadedImagePath) {
      await cleanupPendingImage(uploadedImagePath, false, operation);
    }
    if (!isCurrentImageOperation(operation, conflict.date)) return;
    queryClient.setQueryData(checkInKeys.date(conflict.date, conflict.entryMode), cloudRecord);
    setMonthRecord(queryClient, cloudRecord, conflict.date, conflict.entryMode);
    hydrateDraft(cloudRecord, conflict.date);
    setConflict(null);
    setStatus(cloudRecord ? "已载入云端版本" : "云端记录已不存在", "neutral");
    void queryClient.invalidateQueries({ queryKey: checkInKeys.date(conflict.date, conflict.entryMode) });
  }

  return (
    <main className="app-page">
      <section className="page-shell">
        <AppHeader
          initialProfile={initialProfile}
          isBusy={isHeaderBusy}
          isDateSelectionDisabled={isEditorLocked}
          isCelebrating={isCelebrating}
          isMuted={isMuted}
          onRequestLogout={() => {
            if (isHeaderBusy) return;
            const leave = () => { if (isDirty) setLogoutPending(true); else void logout(); };
            if (knowledgeLeaveGuard.current) knowledgeLeaveGuard.current(leave);
            else leave();
          }}
          onSelectToday={() => {
            const leave = () => { setKnowledgeOpen(false); selectToday(); };
            if (knowledgeLeaveGuard.current) knowledgeLeaveGuard.current(leave);
            else leave();
          }}
          onOpenKnowledge={() => {
            if (knowledgeOpen) knowledgeListNavigation.current?.();
            else setKnowledgeOpen(true);
          }}
          knowledgeOpen={knowledgeOpen}
          onToggleMuted={() => {
            if (isHeaderBusy) return;
            const nextMuted = !isMuted;
            setIsMuted(nextMuted);
            window.localStorage.setItem(muteStorageKey, String(nextMuted));
            setStatus(nextMuted ? "打卡提示音已关闭" : "打卡提示音已开启");
          }}
          today={today}
        />
        {receivedEchoDate ? <DailyEchoCompanion date={receivedEchoDate} today={today} onOpen={() => openDailyEcho(receivedEchoDate)} /> : null}
        {knowledgeOpen ? <KnowledgeWorkspace today={today} entryMode={entryMode} emptyIllustration={<CurrentLearningPersona initialProfile={initialProfile} />} leaveGuardRef={knowledgeLeaveGuard} listNavigationRef={knowledgeListNavigation} userId={userId ?? initialProfile?.id ?? "current-user"} onClose={() => {
          setKnowledgeOpen(false);
          requestAnimationFrame(() => document.getElementById("knowledge-entry")?.focus());
        }} /> : null}
        <div hidden={knowledgeOpen}>
          <DailyTakeawayEntry userId={userId ?? initialProfile?.id ?? "current-user"} />
        </div>
        <div className="workspace-view-toolbar" hidden={knowledgeOpen}>
          <span><CalendarDays aria-hidden="true" size={16} />{formatDate(selectedDate)}</span>
          <div className="workspace-toolbar-actions">
            {draftBaseRecord || monthQuery.data?.some(item => item.date === selectedDate) ? (
              <button
                aria-label="查看打卡纪念卡"
                className="echo-reopen"
                disabled={isEditorLocked}
                onClick={() => openDailyEcho(selectedDate)}
                type="button"
              >
                <ImageDown aria-hidden="true" size={17} />今日回响
              </button>
            ) : null}
            <button
              aria-controls="learning-calendar"
              aria-expanded={!calendarCollapsed}
              className="calendar-visibility-toggle"
              onClick={() => {
                const next = !calendarCollapsed;
                setCalendarCollapsed(next);
                try { window.localStorage.setItem(calendarStorageKey, String(next)); } catch { /* Preference is optional. */ }
              }}
              type="button"
            >
              {calendarCollapsed ? <PanelLeftOpen aria-hidden="true" size={17} /> : <PanelLeftClose aria-hidden="true" size={17} />}
              {calendarCollapsed ? "展开日历" : "收起日历"}
            </button>
          </div>
        </div>
        <div className={`workspace-grid${calendarCollapsed ? " calendar-collapsed" : ""}`} hidden={knowledgeOpen}>
          <div className="calendar-pane" id="learning-calendar" hidden={calendarCollapsed}>
          <MonthCalendar
            activeEntryMode={entryMode}
            onSelectEntryMode={(mode) => void openCalendarRecord(mode)}
            errorMessage={monthQuery.isError ? messageForError(monthQuery.error) : ""}
            isLoading={monthQuery.isPending}
            isRetrying={monthQuery.isFetching}
            month={month}
            disabled={isEditorLocked}
            onMonthChange={(nextMonth) => {
              if (!editorLockedRef.current && !imageCleanupInFlightRef.current) setMonth(nextMonth);
            }}
            onRetry={() => void monthQuery.refetch()}
            onSelectDate={requestDateChange}
            onSelectToday={selectToday}
            selectedDate={selectedDate}
            summaries={monthQuery.data}
            today={today}
          />
          </div>
          <CheckInEditor
            entryMode={entryMode}
            onEntryModeChange={(nextMode) => void switchEntryMode(nextMode)}
            aiActiveJob={entryMode === "ai" ? aiGeneration.activeJob : null}
            aiError={aiGeneration.error}
            aiIsLongRunning={aiGeneration.isLongRunning}
            aiQuotaRemaining={aiGeneration.quotaRemaining}
            aiStage={aiGeneration.stage}
            aiProgress={aiGeneration.progress}
            aiAttemptCount={aiGeneration.attemptCount}
            aiRetryMessage={aiGeneration.retryMessage}
            date={selectedDate}
            draft={draft}
            isDirty={isDirty}
            isLoading={isAwaitingSelectedRecord || isCloudReadFailure}
            isSaving={isSaving || saveMutation.isPending}
            isCleaningUpImage={isCleaningUpImage || isAbandoningDraft}
            isPreparingImage={isPreparingImage}
            isRetryingRecord={checkInQuery.isFetching}
            isOffline={isOffline}
            draftStorageState={draftStorageState}
            loadError={isCloudReadFailure ? messageForError(checkInQuery.error) : ""}
            message={message}
            messageTone={messageTone}
            onDraftChange={(change) => {
              if (!editorLockedRef.current) {
                if (entryModeRef.current === "ai" && ((change.sourceUrl !== undefined && change.sourceUrl !== draft.sourceUrl) || (change.userPrompt !== undefined && change.userPrompt !== draft.userPrompt))) {
                  aiGeneration.clearError();
                }
                setDraft((current) => ({ ...current, ...change }));
              }
            }}
            onAiCancel={() => void aiGeneration.cancel()}
            onAiGenerate={() => {
              if (entryModeRef.current !== "ai" || editorLockedRef.current || selectedDate > getTodayKey()) return;
              void aiGeneration.generate({
                sourceUrl: draft.sourceUrl.trim(),
                userPrompt: draft.userPrompt ?? "",
                targetDate: selectedDate,
              });
            }}
            onImageChange={handleImageChange}
            onImageError={(nextMessage) => setStatus(nextMessage, "error")}
            onImagePreparationChange={(isPreparing, identity) => {
              if (identity !== entryIdentity(selectedDateRef.current, entryModeRef.current)) return;
              imagePreparationInFlightRef.current = isPreparing;
              if (isPreparing) editorLockedRef.current = true;
              setIsPreparingImage(isPreparing);
            }}
            onReset={async () => {
              if (editorLockedRef.current || imageCleanupInFlightRef.current || imagePreparationInFlightRef.current) return;
              const operation = imageOperationRef.current + 1;
              imageOperationRef.current = operation;
              if (await abandonLocalDraft(selectedRecord, operation)) {
                setStatus("已还原未保存的修改");
              }
            }}
            onRetryRecord={() => {
              if (!draftAbandonInFlightRef.current && !imageCleanupInFlightRef.current && !imagePreparationInFlightRef.current) {
                void checkInQuery.refetch();
              }
            }}
            onRetryDraft={retryDraftLoad}
            onSubmit={() => saveCurrentRecord()}
            record={draftBaseRecord}
          />
        </div>
      </section>

      {toast ? <div aria-live="polite" className="light-toast" role="status">{toast}</div> : null}
      {echoDate ? <DailyEchoDialog key={echoDate} date={echoDate} onClose={() => setEchoDate(null)} /> : null}
      {isCelebrating && !echoDate ? (
        <div aria-live="polite" className="celebration-banner" role="status">
          <span><Check aria-hidden="true" size={18} strokeWidth={3} /></span>
          这一天的学习收获已收下
        </div>
      ) : null}

      {pendingDate && !conflict ? (
        <DirtySwitchDialog
          description={
            canSave
              ? `先处理当前内容，再打开${formatDate(pendingDate)}。`
              : "补全今日知识主题后保存，或放弃当前修改后继续。"
          }
          discardLabel="放弃修改"
          onCancel={() => {
            if (!editorLockedRef.current && !imageCleanupInFlightRef.current && !imagePreparationInFlightRef.current) {
              setPendingDate(null);
            }
          }}
          onDiscard={discardAndSwitch}
          onSave={saveAndSwitch}
          isBusy={isEditorLocked}
          saveDisabled={!canSave}
          saveLabel="保存并切换"
          title="尚未保存"
        />
      ) : null}

      {logoutPending && !conflict ? (
        <DirtySwitchDialog
          description={
            canSave
              ? "保存当前内容后退出，或放弃这次修改。"
              : "补全今日知识主题后保存，或直接放弃这次修改。"
          }
          discardLabel="放弃修改并退出"
          onCancel={() => {
            if (!draftAbandonInFlightRef.current && !saveInFlightRef.current && !logoutInFlightRef.current && !imageCleanupInFlightRef.current && !imagePreparationInFlightRef.current) {
              setLogoutPending(false);
            }
          }}
          onDiscard={discardAndLogout}
          onSave={saveAndLogout}
          isBusy={isDialogActionBusy}
          saveDisabled={!canSave || isAwaitingSelectedRecord || hasSelectedRecordError}
          saveLabel="保存并退出"
          title="退出前还有修改没有保存"
        />
      ) : null}

      {conflict ? (
        <ConflictDialog
          conflict={conflict}
          isBusy={isCleaningUpImage || isPreparingImage}
          onClose={() => {
            if (!imageCleanupInFlightRef.current && !imagePreparationInFlightRef.current) {
              setBaseVersion(conflict.current?.version ?? null);
              setBaseRecordExists(conflict.current !== null);
              setConflict(null);
            }
          }}
          onLoadCloudVersion={loadCloudVersion}
        />
      ) : null}
    </main>
  );
}
