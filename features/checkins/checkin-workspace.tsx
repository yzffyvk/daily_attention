"use client";

import confetti from "canvas-confetti";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MonthCalendar } from "@/features/calendar/month-calendar";
import { AppHeader } from "@/features/profile/app-header";
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
import { formatDate, getTodayKey, monthKeyForDate, calculateStreak } from "./dates";
import { DirtySwitchDialog, useDialogFocus } from "./dirty-switch-dialog";
import type { ImageSelection } from "./image-note-uploader";
import { checkInKeys, setMonthRecord, useCheckIn, useMonthCheckIns, useSaveCheckIn } from "./queries";
import type { CheckInRecord } from "./types";

const muteStorageKey = "attention-journal-muted";

type CheckInWorkspaceProps = {
  initialDate: string;
  initialProfile?: AccountProfile | null;
};

type ConflictState = {
  current: CheckInRecord | null;
  date: string;
};

function ConflictDialog({
  conflict,
  onClose,
  onLoadCloudVersion,
}: {
  conflict: ConflictState;
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
            <span>版本 {conflict.current.version} · {formatDate(conflict.current.date)}</span>
            {conflict.current.summary ? <p>{conflict.current.summary}</p> : null}
          </div>
        ) : (
          <p className="cloud-record-empty">云端的这条记录已被删除。</p>
        )}
        <div className="dialog-actions">
          <button className="primary-button" onClick={onClose} ref={keepLocalButtonRef} type="button">保留本地内容</button>
          <button className="secondary-button" onClick={() => void onLoadCloudVersion()} type="button">载入云端版本</button>
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

export function CheckInWorkspace({ initialDate, initialProfile = null }: CheckInWorkspaceProps) {
  const queryClient = useQueryClient();
  const [today] = useState(getTodayKey);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [month, setMonth] = useState(() => monthKeyForDate(initialDate));
  const [draft, setDraft] = useState<CheckInDraft>(() => draftFromRecord(null));
  const [hydratedDate, setHydratedDate] = useState<string | null>(null);
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [logoutPending, setLogoutPending] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<MessageTone>("neutral");
  const [toast, setToast] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [isCelebrating, setIsCelebrating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const toastTimerRef = useRef<number | null>(null);
  const selectedDateRef = useRef(initialDate);
  const draftRef = useRef(draft);
  const editorLockedRef = useRef(false);
  const saveInFlightRef = useRef(false);

  const monthQuery = useMonthCheckIns(month);
  const currentMonth = monthKeyForDate(today);
  const currentMonthQuery = useMonthCheckIns(currentMonth);
  const checkInQuery = useCheckIn(selectedDate);
  const saveMutation = useSaveCheckIn();
  const isEditorLocked = isSaving || saveMutation.isPending;
  const selectedRecord = checkInQuery.data ?? null;
  const monthSummaries = monthQuery.data ?? [];
  const todaySummaries = useMemo(
    () => (currentMonth === month ? monthQuery.data ?? [] : currentMonthQuery.data ?? []),
    [currentMonth, currentMonthQuery.data, month, monthQuery.data],
  );
  const isDirty = isDraftDirty(draft, selectedRecord);
  const canSave = Boolean(draft.attention.trim());
  const hasTodayRecord = todaySummaries.some((summary) => summary.date === today);
  const streak = useMemo(
    () => calculateStreak(todaySummaries, today),
    [today, todaySummaries],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsMuted(window.localStorage.getItem(muteStorageKey) === "true");
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
    editorLockedRef.current = isEditorLocked;
  }, [isEditorLocked]);

  useEffect(() => {
    if (!checkInQuery.isSuccess || hydratedDate === selectedDate) return;
    const timer = window.setTimeout(() => {
      setDraft((current) =>
        isDraftDirty(current, null) ? current : draftFromRecord(selectedRecord),
      );
      setHydratedDate(selectedDate);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [checkInQuery.isSuccess, hydratedDate, selectedDate, selectedRecord]);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
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

  function openDate(date: string) {
    if (editorLockedRef.current) return;
    const cached = queryClient.getQueryData<CheckInRecord | null>(checkInKeys.date(date));
    selectedDateRef.current = date;
    setMonth(monthKeyForDate(date));
    setSelectedDate(date);
    setDraft(draftFromRecord(cached));
    setHydratedDate(cached === undefined ? null : date);
    setPendingDate(null);
    setStatus(cached ? `已打开${formatDate(date)}的学习记录` : `${formatDate(date)}还没有记录`);
    scrollToEditor();
  }

  async function cleanupPendingImage(path: string, quiet = false) {
    try {
      await deleteCheckInImage(path);
    } catch {
      if (!quiet) {
        setStatus("图片临时文件清理失败，它会在稍后过期", "error");
      }
    }
  }

  async function abandonLocalDraft(record = selectedRecord) {
    if (draft.uploadedImagePath) {
      await cleanupPendingImage(draft.uploadedImagePath);
    }
    setDraft(draftFromRecord(record));
  }

  function requestDateChange(date: string) {
    if (editorLockedRef.current) return;
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
    if (editorLockedRef.current) return;
    if (today === selectedDate) {
      setMonth(currentMonth);
      scrollToEditor();
      return;
    }
    requestDateChange(today);
  }

  async function handleImageChange(selection: ImageSelection, identity: string) {
    if (identity !== selectedDateRef.current || editorLockedRef.current) return;
    const uploadedImagePath = draftRef.current.uploadedImagePath;
    if (uploadedImagePath) {
      await cleanupPendingImage(uploadedImagePath);
    }
    if (identity !== selectedDateRef.current || editorLockedRef.current) return;
    setDraft((current) => {
      if (identity !== selectedDateRef.current || editorLockedRef.current) return current;
      return {
        ...current,
        imageFile: selection.file,
        removeImage: selection.removeImage,
        uploadedImagePath: null,
      };
    });
    if (identity !== selectedDateRef.current || editorLockedRef.current) return;
    setStatus(selection.file ? "图片笔记已加入，记得完成保存" : "图片将在保存后移除");
  }

  async function saveCurrentRecord() {
    if (saveInFlightRef.current) return false;
    const activeDraft = draft;
    const activeRecord = selectedRecord;
    const activeDate = selectedDate;
    const attention = activeDraft.attention.trim();
    if (!attention) {
      setStatus("请先填写今日 attention", "error");
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
          attention,
          sourceUrl: activeDraft.sourceUrl.trim(),
          summary: activeDraft.summary.trim(),
          inspiration: activeDraft.inspiration.trim(),
          imagePath: activeDraft.removeImage
            ? null
            : pendingImagePath ?? activeRecord?.imagePath ?? null,
          imageName: activeDraft.removeImage
            ? ""
            : activeDraft.imageFile?.name ?? activeRecord?.imageName ?? "",
          version: activeRecord?.version ?? null,
        },
      });

      setDraft(draftFromRecord(record));
      setHydratedDate(activeDate);
      setStatus(
        activeRecord
          ? `${formatDate(activeDate)}的修改已保存`
          : `${formatDate(activeDate)}打卡完成`,
        "success",
      );
      void queryClient.invalidateQueries({ queryKey: checkInKeys.date(activeDate) });

      if (!activeRecord) {
        if (!isMuted) playCheckInChime();
        const animated = launchCelebration();
        setIsCelebrating(true);
        window.setTimeout(() => setIsCelebrating(false), animated ? 1900 : 900);
      } else {
        showToast("修改已保存到云端");
      }
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
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
        setConflict({ current: error.current ?? null, date: activeDate });
        queryClient.setQueryData(checkInKeys.date(activeDate), error.current ?? null);
        setMonthRecord(queryClient, error.current ?? null, activeDate);
        setStatus(error.message, "error");
        return false;
      }

      if (pendingImagePath) {
        await cleanupPendingImage(pendingImagePath, true);
        setDraft((current) =>
          current.uploadedImagePath === pendingImagePath
            ? { ...current, uploadedImagePath: null }
            : current,
        );
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
    if (await saveCurrentRecord()) {
      if (targetDate) openDate(targetDate);
    }
  }

  async function discardAndSwitch() {
    const targetDate = pendingDate;
    await abandonLocalDraft();
    if (targetDate) openDate(targetDate);
  }

  async function logout() {
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
      editorLockedRef.current = false;
      setIsSaving(false);
    }
  }

  async function saveAndLogout() {
    if (await saveCurrentRecord()) await logout();
  }

  async function loadCloudVersion() {
    if (!conflict) return;
    const cloudRecord = conflict.current;
    if (draft.uploadedImagePath) {
      await cleanupPendingImage(draft.uploadedImagePath);
    }
    queryClient.setQueryData(checkInKeys.date(conflict.date), cloudRecord);
    setMonthRecord(queryClient, cloudRecord, conflict.date);
    setDraft(draftFromRecord(cloudRecord));
    setHydratedDate(conflict.date);
    setConflict(null);
    setStatus(cloudRecord ? "已载入云端版本" : "云端记录已不存在", "neutral");
    void queryClient.invalidateQueries({ queryKey: checkInKeys.date(conflict.date) });
  }

  return (
    <main className="app-page">
      <section className="page-shell">
        <AppHeader
          hasTodayRecord={hasTodayRecord}
          initialProfile={initialProfile}
          isDateSelectionDisabled={isEditorLocked}
          isCelebrating={isCelebrating}
          isMuted={isMuted}
          onRequestLogout={() => {
            if (isDirty) setLogoutPending(true);
            else void logout();
          }}
          onSelectToday={selectToday}
          onToggleMuted={() => {
            const nextMuted = !isMuted;
            setIsMuted(nextMuted);
            window.localStorage.setItem(muteStorageKey, String(nextMuted));
            setStatus(nextMuted ? "打卡提示音已关闭" : "打卡提示音已开启");
          }}
          streak={streak}
          today={today}
          totalRecords={todaySummaries.length}
        />
        <MonthCalendar
          month={month}
          disabled={isEditorLocked}
          onMonthChange={setMonth}
          onSelectDate={requestDateChange}
          selectedDate={selectedDate}
          summaries={monthSummaries}
          today={today}
        />
        <CheckInEditor
          date={selectedDate}
          draft={draft}
          isDirty={isDirty}
          isLoading={checkInQuery.isLoading}
          isSaving={isEditorLocked}
          message={message || (monthQuery.error ? messageForError(monthQuery.error) : "")}
          messageTone={message ? messageTone : monthQuery.error ? "error" : messageTone}
          onDraftChange={(change) => {
            if (!editorLockedRef.current) {
              setDraft((current) => ({ ...current, ...change }));
            }
          }}
          onImageChange={handleImageChange}
          onImageError={(nextMessage) => setStatus(nextMessage, "error")}
          onReset={async () => {
            if (editorLockedRef.current) return;
            await abandonLocalDraft();
            setStatus("已还原未保存的修改");
          }}
          onSubmit={saveCurrentRecord}
          record={selectedRecord}
        />
      </section>

      {toast ? <div aria-live="polite" className="light-toast" role="status">{toast}</div> : null}
      {isCelebrating ? (
        <div aria-live="polite" className="celebration-banner" role="status">
          <span><Check aria-hidden="true" size={18} strokeWidth={3} /></span>
          这一天的 attention 已收下
        </div>
      ) : null}

      {pendingDate && !conflict ? (
        <DirtySwitchDialog
          description={
            canSave
              ? `先处理当前内容，再打开${formatDate(pendingDate)}。`
              : "补全今日 attention 后保存，或放弃当前修改后继续。"
          }
          discardLabel="放弃修改"
          onCancel={() => setPendingDate(null)}
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
              : "补全今日 attention 后保存，或直接放弃这次修改。"
          }
          discardLabel="放弃修改并退出"
          onCancel={() => setLogoutPending(false)}
          onDiscard={async () => {
            await abandonLocalDraft();
            await logout();
          }}
          onSave={saveAndLogout}
          isBusy={isEditorLocked}
          saveDisabled={!canSave}
          saveLabel="保存并退出"
          title="退出前还有修改没有保存"
        />
      ) : null}

      {conflict ? <ConflictDialog conflict={conflict} onClose={() => setConflict(null)} onLoadCloudVersion={loadCloudVersion} /> : null}
    </main>
  );
}
