"use client";

/* eslint-disable @next/next/no-img-element */
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

type User = {
  displayName: string;
  avatarUrl: string;
};

type CheckIn = {
  id: string;
  date: string;
  attention: string;
  sourceUrl: string;
  summary: string;
  inspiration: string;
  imageName: string;
  imageUrl: string;
};

type Draft = {
  attention: string;
  sourceUrl: string;
  summary: string;
  inspiration: string;
  imageName: string;
  imageDataUrl: string;
  removeImage: boolean;
};

type LegacyCheckIn = Partial<CheckIn> & {
  topic?: string;
  note?: string;
  imageDataUrl?: string;
};

const LEGACY_STORAGE_KEY = "ai-learning-checkins-v1";

const emptyDraft: Draft = {
  attention: "",
  sourceUrl: "",
  summary: "",
  inspiration: "",
  imageName: "",
  imageDataUrl: "",
  removeImage: false,
};

function getTodayKey() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function getDateKey(year: number, month: number, day: number) {
  return [
    year,
    String(month + 1).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function getDateNumber(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function getKeyFromDateNumber(dateNumber: number) {
  return new Date(dateNumber * 86400000).toISOString().slice(0, 10);
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T12:00:00`));
}

function calculateStreak(items: CheckIn[]) {
  const dates = new Set(items.map((item) => item.date));
  let cursor = getDateNumber(getTodayKey());
  let count = 0;

  if (!dates.has(getTodayKey())) cursor -= 1;
  while (dates.has(getKeyFromDateNumber(cursor))) {
    count += 1;
    cursor -= 1;
  }
  return count;
}

function draftFromRecord(record?: CheckIn): Draft {
  if (!record) return emptyDraft;
  return {
    attention: record.attention,
    sourceUrl: record.sourceUrl,
    summary: record.summary,
    inspiration: record.inspiration,
    imageName: record.imageName,
    imageDataUrl: "",
    removeImage: false,
  };
}

async function compressImage(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("无法读取图片"));
    });

    const maxEdge = 1280;
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理图片");

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function requestCheckIns(): Promise<CheckIn[]> {
  const response = await fetch("/api/checkins", { cache: "no-store" });
  const payload = (await response.json()) as { checkIns?: CheckIn[]; error?: string };
  if (!response.ok) throw new Error(payload.error || "记录加载失败");
  return payload.checkIns ?? [];
}

export function AttentionApp({
  user,
  signOutHref,
}: {
  user: User;
  signOutHref: string;
}) {
  const today = getTodayKey();
  const now = new Date();
  const [records, setRecords] = useState<CheckIn[]>([]);
  const [selectedDate, setSelectedDate] = useState(today);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [calendarDate, setCalendarDate] = useState(
    () => new Date(now.getFullYear(), now.getMonth(), 1),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [imageInputKey, setImageInputKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        let nextRecords = await requestCheckIns();
        const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);

        if (nextRecords.length === 0 && legacy) {
          const parsed = JSON.parse(legacy) as LegacyCheckIn[];
          if (Array.isArray(parsed)) {
            await Promise.all(
              parsed
                .filter((item) => item.date)
                .map((item) =>
                  fetch(`/api/checkins/${item.date}`, {
                    method: "PUT",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      attention: item.attention ?? item.topic ?? "AI 学习记录",
                      sourceUrl: item.sourceUrl ?? "",
                      summary: item.summary ?? item.note ?? "",
                      inspiration: item.inspiration ?? "",
                      imageName: item.imageName ?? "",
                      imageDataUrl: item.imageDataUrl ?? "",
                    }),
                  }),
                ),
            );
            nextRecords = await requestCheckIns();
            window.localStorage.removeItem(LEGACY_STORAGE_KEY);
          }
        }

        if (cancelled) return;
        setRecords(nextRecords);
        setDraft(draftFromRecord(nextRecords.find((item) => item.date === today)));
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "记录加载失败");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [today]);

  const streak = useMemo(() => calculateStreak(records), [records]);
  const selectedRecord = records.find((item) => item.date === selectedDate);
  const hasTodayRecord = records.some((item) => item.date === today);
  const totalRecords = records.length;

  const calendar = useMemo(() => {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const recordMap = new Map(records.map((item) => [item.date, item]));

    return {
      year,
      month,
      firstWeekday,
      days: Array.from({ length: daysInMonth }, (_, index) => {
        const day = index + 1;
        const date = getDateKey(year, month, day);
        return {
          day,
          date,
          today: date === today,
          selected: date === selectedDate,
          record: recordMap.get(date),
        };
      }),
    };
  }, [calendarDate, records, selectedDate, today]);

  function selectDate(date: string) {
    const record = records.find((item) => item.date === date);
    setSelectedDate(date);
    setDraft(draftFromRecord(record));
    setMessage(record ? `已打开${formatDate(date)}的学习记录` : `${formatDate(date)}还没有记录`);
    window.requestAnimationFrame(() => {
      document.getElementById("entry-editor")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function selectToday() {
    setCalendarDate(new Date(now.getFullYear(), now.getMonth(), 1));
    selectDate(today);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const attention = draft.attention.trim();
    const summary = draft.summary.trim();
    if (!attention || !summary) return;

    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/checkins/${selectedDate}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attention,
          sourceUrl: draft.sourceUrl.trim(),
          summary,
          inspiration: draft.inspiration.trim(),
          imageName: draft.imageName,
          imageDataUrl: draft.imageDataUrl,
          removeImage: draft.removeImage,
        }),
      });
      const payload = (await response.json()) as { checkIn?: CheckIn; error?: string };
      if (!response.ok || !payload.checkIn) {
        throw new Error(payload.error || "保存失败");
      }

      setRecords((current) => [
        payload.checkIn!,
        ...current.filter((item) => item.date !== selectedDate),
      ]);
      setDraft(draftFromRecord(payload.checkIn));
      setImageInputKey((current) => current + 1);
      setMessage(`${formatDate(selectedDate)}已保存`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
      setMessage("请选择 10MB 以内的图片");
      return;
    }

    setMessage("正在整理图片笔记…");
    try {
      const imageDataUrl = await compressImage(file);
      setDraft((current) => ({
        ...current,
        imageDataUrl,
        imageName: file.name,
        removeImage: false,
      }));
      setMessage("图片笔记已添加，保存后同步");
    } catch {
      setMessage("图片读取失败，请换一张重试");
    }
  }

  const previewImage = draft.imageDataUrl
    ? draft.imageDataUrl
    : !draft.removeImage
      ? selectedRecord?.imageUrl
      : "";

  return (
    <main className="app-page">
      <section className="page-shell">
        <header className="app-header">
          <div className="header-copy">
            <div className="header-meta">
              <p className="eyebrow">{formatDate(today)}</p>
              <span className={`today-status${hasTodayRecord ? " complete" : ""}`}>
                <i aria-hidden="true" />
                {hasTodayRecord ? "今日已完成" : "今日待打卡"}
              </span>
            </div>
            <h1>
              今天你<span>attention</span>了吗？
            </h1>
            <p className="hero-copy">
              把每天学到的一点新知，积累成看得见的成长。
            </p>
            <button className="today-button" type="button" onClick={selectToday}>
              {hasTodayRecord ? "回看今日记录" : "开始今日打卡"}
              <span aria-hidden="true">↗</span>
            </button>
          </div>
          <div className="account-panel">
            <div className="streak-block">
              <span>连续专注</span>
              <div><strong>{streak}</strong><span>天</span></div>
              <small>保持你的学习节奏</small>
            </div>
            <div className="total-block">
              <span>累计记录</span>
              <strong>{totalRecords}</strong>
            </div>
            <div className="account-row">
              <span className="wechat-account">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <i aria-hidden="true">微</i>
                )}
                <b>{user.displayName}</b>
              </span>
              <a href={signOutHref}>退出</a>
            </div>
          </div>
        </header>

        <section className="calendar-section" aria-labelledby="calendar-title">
          <div className="calendar-heading">
            <div>
              <p className="eyebrow">ATTENTION MAP</p>
              <h2 id="calendar-title">
                {new Intl.DateTimeFormat("zh-CN", {
                  year: "numeric",
                  month: "long",
                }).format(calendarDate)}
              </h2>
              <p className="section-description">选一天，记录或回看当日的学习收获</p>
            </div>
            <div className="calendar-actions">
              <button
                type="button"
                aria-label="上个月"
                title="上个月"
                onClick={() =>
                  setCalendarDate(new Date(calendar.year, calendar.month - 1, 1))
                }
              >
                ←
              </button>
              <button
                type="button"
                className="month-reset"
                onClick={() =>
                  setCalendarDate(new Date(now.getFullYear(), now.getMonth(), 1))
                }
              >
                回到本月
              </button>
              <button
                type="button"
                aria-label="下个月"
                title="下个月"
                onClick={() =>
                  setCalendarDate(new Date(calendar.year, calendar.month + 1, 1))
                }
              >
                →
              </button>
            </div>
          </div>

          <div className="calendar-weekdays" aria-hidden="true">
            {["日", "一", "二", "三", "四", "五", "六"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="calendar-grid" role="grid" aria-label="月度学习日历">
            {Array.from({ length: calendar.firstWeekday }, (_, index) => (
              <span
                className="calendar-cell blank"
                aria-hidden="true"
                key={`blank-${index}`}
              />
            ))}
            {calendar.days.map((item) => (
              <button
                type="button"
                role="gridcell"
                className={`calendar-cell${item.record ? " recorded" : ""}${item.today ? " today" : ""}${item.selected ? " selected" : ""}`}
                aria-label={`${item.day}日${item.record ? `，已保存：${item.record.attention}` : "，暂无记录"}`}
                onClick={() => selectDate(item.date)}
                key={item.date}
              >
                <span className="calendar-cell-top">
                  <b>{item.day}</b>
                  {item.record ? <i aria-hidden="true">✓</i> : null}
                </span>
                <small>{item.record?.attention ?? (item.today ? "记录今天" : "")}</small>
              </button>
            ))}
          </div>
          <div className="calendar-legend">
            <span><i className="legend-dot recorded-dot" />已保存完整记录</span>
            <span><i className="legend-dot selected-dot" />当前选中</span>
            <span><i className="legend-dot today-dot" />今天</span>
          </div>
        </section>

        <section className="editor-section" id="entry-editor" aria-labelledby="editor-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">DAILY ATTENTION</p>
              <h2 id="editor-title">
                {selectedRecord ? "查看并编辑" : "新建记录"} · {formatDate(selectedDate)}
              </h2>
              <p className="section-description">
                {selectedRecord ? "继续补充你的理解与灵感" : "从一句话开始，完成一次轻量复盘"}
              </p>
            </div>
            {selectedRecord ? <span className="saved-pill">已保存</span> : null}
          </div>

          {isLoading ? (
            <p className="loading-state">正在读取你的学习记录…</p>
          ) : (
            <form className="checkin-form" onSubmit={handleSubmit}>
              <div className="form-grid">
                <label>
                  今日 attention <em>必填</em>
                  <span className="field-hint">用一句话总结当天学习的内容</span>
                  <input
                    maxLength={80}
                    placeholder="例如：理解了 Transformer 中的注意力机制"
                    value={draft.attention}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        attention: event.target.value,
                      }))
                    }
                  />
                  <span className="character-count">{draft.attention.length}/80</span>
                </label>

                <label>
                  学习资料来源
                  <span className="field-hint">文章、视频、课程或工具链接</span>
                  <input
                    type="url"
                    inputMode="url"
                    placeholder="https://"
                    value={draft.sourceUrl}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        sourceUrl: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>

              <label>
                学习知识点小结 <em>必填</em>
                <textarea
                  maxLength={500}
                  placeholder="写下关键概念、你的理解，以及还没想明白的问题"
                  value={draft.summary}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      summary: event.target.value,
                    }))
                  }
                />
                <span className="character-count">{draft.summary.length}/500</span>
              </label>

              <div className="upload-field">
                <div>
                  <span className="field-label">图片笔记</span>
                  <span className="field-hint">
                    上传脑图、手写笔记或截图，最大 10MB
                  </span>
                </div>
                {previewImage ? (
                  <div className="image-preview">
                    <img
                      src={previewImage}
                      alt={draft.imageName || "学习图片笔记"}
                    />
                    <div>
                      <span>{draft.imageName || "图片笔记"}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setDraft((current) => ({
                            ...current,
                            imageDataUrl: "",
                            imageName: "",
                            removeImage: true,
                          }));
                          setImageInputKey((current) => current + 1);
                        }}
                      >
                        移除图片
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="upload-button">
                    <input
                      key={imageInputKey}
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                    />
                    <span aria-hidden="true">＋</span>
                    选择图片
                  </label>
                )}
              </div>

              <label>
                灵感记录
                <textarea
                  className="short-textarea"
                  maxLength={300}
                  placeholder="它让你联想到了什么？接下来想试试什么？"
                  value={draft.inspiration}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      inspiration: event.target.value,
                    }))
                  }
                />
                <span className="character-count">{draft.inspiration.length}/300</span>
              </label>

              <div className="form-actions">
                <div>
                  <button
                    className="primary-button"
                    disabled={
                      isSaving || !draft.attention.trim() || !draft.summary.trim()
                    }
                    type="submit"
                  >
                    {isSaving
                      ? "正在保存…"
                      : selectedRecord
                        ? "保存修改"
                        : "完成今日打卡"}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => setDraft(draftFromRecord(selectedRecord))}
                  >
                    还原
                  </button>
                </div>
                <span className="save-hint">记录会安全同步到你的账号</span>
              </div>
              {message ? (
                <p className="save-message" role="status" aria-live="polite">
                  {message}
                </p>
              ) : null}
            </form>
          )}
        </section>
      </section>
    </main>
  );
}
