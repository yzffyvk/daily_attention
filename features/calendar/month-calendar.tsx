"use client";

import { ArrowUpRight, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import type { CheckInEntryMode } from "@/lib/domain/checkin";
import { dateKey, formatCalendarDate, formatMonth, monthDate, monthKeyForDate, shiftMonth } from "@/features/checkins/dates";
import type { CheckInSummary } from "@/features/checkins/types";
import "./month-calendar.css";

type MonthCalendarProps = {
  month: string;
  selectedDate: string;
  selectedDates?: string[];
  activeEntryMode?: CheckInEntryMode;
  onSelectEntryMode?: (mode: CheckInEntryMode) => void;
  onSelectRecord?: (id: string) => void;
  maxSelectedDates?: number;
  summaries: CheckInSummary[] | undefined;
  today: string;
  disabled?: boolean;
  errorMessage?: string;
  isLoading?: boolean;
  isRetrying?: boolean;
  onMonthChange: (month: string) => void;
  onRetry?: () => void;
  onSelectDate: (date: string) => void;
  onSelectToday?: () => void;
};

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];

function calendarLabel(
  date: string,
  summary: CheckInSummary | undefined,
  selected: boolean,
  today: boolean,
  future: boolean,
  records: CheckInSummary[],
) {
  const state = records.some(record => record.status !== undefined) ? `${records.length} 条记录，已完成 ${records.filter(record => record.status !== "pending").length} 条：${summary?.attention ?? ""}` : summary ? `已保存：${summary.attention}` : "暂无记录";
  const suffix = [selected ? "当前选中" : "", today ? "今天" : "", future ? "未到日期，未来日期不能记录" : ""]
    .filter(Boolean)
    .join("，");
  return `${formatCalendarDate(date)}，${state}${suffix ? `，${suffix}` : ""}`;
}

export function MonthCalendar({
  month,
  selectedDate,
  selectedDates,
  activeEntryMode,
  onSelectEntryMode,
  onSelectRecord,
  maxSelectedDates = 14,
  summaries,
  today,
  disabled = false,
  errorMessage = "",
  isLoading = false,
  isRetrying = false,
  onMonthChange,
  onRetry,
  onSelectDate,
  onSelectToday,
}: MonthCalendarProps) {
  const [previewDate, setPreviewDate] = useState<string | null>(null);
  const previewId = useId();
  const titleId = useId();
  const current = monthDate(month);
  const year = current.getFullYear();
  const monthIndex = current.getMonth();
  const firstWeekday = current.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const hasMonthData = summaries !== undefined;
  const groupedSummaries = new Map<string, CheckInSummary[]>();
  for (const summary of summaries ?? []) {
    if (!summary.date.startsWith(`${month}-`)) continue;
    groupedSummaries.set(summary.date, [...(groupedSummaries.get(summary.date) ?? []), summary]);
  }
  for (const records of groupedSummaries.values()) {
    records.sort((left, right) => Number(left.entryMode === "ai") - Number(right.entryMode === "ai"));
  }
  const summaryByDate = new Map([...groupedSummaries].map(([date, records]) => {
    if (records.length === 1) return [date, records[0]] as const;
    return [date, {
      ...records[0],
      attention: records.map(record => `${record.entryMode === "ai" ? "AI" : "手动"}：${record.attention}`).join(" · "),
      hasImage: records.some(record => record.hasImage),
    }] as const;
  }));
  const isCurrentMonth = month === monthKeyForDate(today);
  const isFutureMonth = month > monthKeyForDate(today);
  const recordedDays = [...groupedSummaries].filter(([date, records]) => date <= today && records.some(record => record.status !== "pending")).length;
  const selectedRecords = !selectedDates && selectedDate <= today ? groupedSummaries.get(selectedDate) ?? [] : [];
  const modeMissing = activeEntryMode && selectedRecords.length > 0 && !selectedRecords.some(record => (record.entryMode ?? "manual") === activeEntryMode);

  return (
    <section className="calendar-section" aria-labelledby={titleId} data-testid="month-calendar">
      <div className="calendar-heading">
        <div>
          <p className="eyebrow">LEARNING MAP</p>
          <h2 id={titleId}>{formatMonth(month)}</h2>
        </div>
        <div className="calendar-actions">
          <button
            aria-label="上个月"
            className="icon-button"
            disabled={disabled}
            onClick={() => onMonthChange(shiftMonth(month, -1))}
            title="上个月"
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={19} />
          </button>
          {!isCurrentMonth ? (
            <button
              className="month-reset"
              disabled={disabled}
              onClick={() => onMonthChange(monthKeyForDate(today))}
              type="button"
            >
              回到本月
            </button>
          ) : null}
          <button
            aria-label="下个月"
            className="icon-button"
            disabled={disabled}
            onClick={() => onMonthChange(shiftMonth(month, 1))}
            title="下个月"
            type="button"
          >
            <ChevronRight aria-hidden="true" size={19} />
          </button>
          {onSelectToday ? (
            <button className="month-reset" disabled={disabled} onClick={onSelectToday} type="button">
              回到今天
            </button>
          ) : null}
        </div>
      </div>

      <div className="calendar-context">
        {hasMonthData && !errorMessage ? <p className="calendar-month-progress" role="status" aria-label="本月学习积累">
          {isFutureMonth ? "这个月还未到来" : recordedDays > 0 ? <>本月已留下 <strong>{recordedDays} 天</strong>收获</> : "这个月的第一份收获，等你记下"}
        </p> : null}
        <p className="calendar-guidance">{selectedDates ? "选择 2–14 个已保存日期，可跨月、不连续选择" : "可记录今天及以前的收获"}</p>
      </div>

      {errorMessage ? (
        <div
          aria-label="月度记录读取失败"
          className="calendar-query-state error"
          role="alert"
        >
          <p>{errorMessage}</p>
          <button
            disabled={isRetrying}
            onClick={onRetry}
            type="button"
          >
            {isRetrying ? "正在重试月度记录…" : "重试月度记录"}
          </button>
        </div>
      ) : null}
      {!hasMonthData && !errorMessage ? (
        <div
          aria-label="正在读取月度记录"
          className="calendar-query-state"
          role="status"
        >
          {isLoading ? "正在读取这个月的学习记录…" : "正在准备这个月的学习记录…"}
        </div>
      ) : null}
      {hasMonthData ? (
        <>
          <div className="calendar-weekdays" aria-hidden="true">
            {weekdays.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>
          <div aria-label="月度学习日历" className="calendar-grid">
            {Array.from({ length: firstWeekday }, (_, index) => (
              <span aria-hidden="true" className="calendar-cell blank" key={`blank-${index}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, index) => {
              const day = index + 1;
              const date = dateKey(year, monthIndex, day);
              const summary = summaryByDate.get(date);
              const records = groupedSummaries.get(date) ?? [];
              const primaryRecord = records.find(record => (record.entryMode ?? "manual") === activeEntryMode) ?? records[0];
              const selected = selectedDates ? selectedDates.includes(date) : date === selectedDate;
              const isFuture = date > today;
              const dateDisabled = disabled || isFuture || Boolean(selectedDates && (!summary || (!selected && selectedDates.length >= maxSelectedDates)));
              const isToday = date === today;
              const completed = records.some(record => record.status !== "pending");
              const showPreview = !disabled && Boolean(summary) && previewDate === date;
              return (
                <button
                  aria-label={calendarLabel(date, summary, selected, isToday, isFuture, records)}
                  aria-pressed={selected}
                  aria-describedby={showPreview ? `${previewId}-${date}` : undefined}
                  className={`calendar-cell${completed ? " recorded" : summary ? " pending-records" : ""}${isToday ? " today" : ""}${selected ? " selected" : ""}${isFuture ? " future" : ""}`}
                  disabled={dateDisabled}
                  title={isFuture ? "未来日期不能记录" : undefined}
                  key={date}
                  onClick={() => onSelectDate(date)}
                  onPointerEnter={() => { if (!disabled && summary) setPreviewDate(date); }}
                  onPointerLeave={() => setPreviewDate(null)}
                  onFocus={() => { if (!disabled && summary) setPreviewDate(date); }}
                  onBlur={() => setPreviewDate(null)}
                  onKeyDown={(event) => { if (event.key === "Escape") setPreviewDate(null); }}
                  type="button"
                >
                  <span className="calendar-cell-top">
                    <b>{day}</b>
                    <span className="calendar-day-flags" aria-hidden="true">
                      {isToday ? <em className="calendar-today-mark">今</em> : null}
                      {completed ? <i><Check size={11} strokeWidth={2.5} /></i> : null}
                    </span>
                  </span>
                  <small>{primaryRecord?.attention ?? (isToday ? "记录今天" : "")}</small>
                  {records.length > 0 ? <span className="calendar-day-modes" aria-hidden="true">
                    {records.some(record => record.id) ? <span className="calendar-mode-mark">{records.length} 条</span> : records.map(record => <span className="calendar-mode-mark" key={record.entryMode ?? "manual"} title={record.entryMode === "ai" ? "AI 提炼" : "手动记录"}>{record.entryMode === "ai" ? "AI" : "手"}</span>)}
                  </span> : null}
                  {showPreview ? (
                    <span className="calendar-preview" id={`${previewId}-${date}`} role="tooltip">
                      <span>{formatCalendarDate(date)} · 学习记录</span>
                      {summary?.attention}
                    </span>
                  ) : null}
                </button>
              );
            })}
            {Array.from({ length: (7 - (firstWeekday + daysInMonth) % 7) % 7 }, (_, index) => (
              <span aria-hidden="true" className="calendar-cell blank" key={`end-blank-${index}`} />
            ))}
          </div>
          <div className="calendar-legend">
            <span><Check className="calendar-recorded-mark" size={12} strokeWidth={2.5} aria-hidden="true" />已记录</span>
            <span><i className="legend-dot selected-dot" />当前选中</span>
            <span><i className="calendar-today-mark" aria-hidden="true">今</i>今天</span>
            <span><i className="legend-dot future-dot" />未到日期</span>
          </div>
          {selectedRecords.length > 0 ? <section className="calendar-selected-records" aria-label={`${formatCalendarDate(selectedDate)}的收获`}>
            <h3>{formatCalendarDate(selectedDate)}的收获<span>{selectedRecords.length} 份记录</span></h3>
            {modeMissing ? <p className="calendar-mode-explanation">这天已保存{activeEntryMode === "manual" ? " AI 提炼" : "手动记录"}，{activeEntryMode === "manual" ? "手动记录" : "AI 提炼"}尚未保存。</p> : null}
            <ul>{selectedRecords.map(record => {
              const mode = record.entryMode ?? "manual";
              const modeLabel = mode === "ai" ? "AI 提炼" : "手动记录";
              return <li key={record.id ?? mode}>
                <div><span className="calendar-record-mode">{modeLabel}<span>{record.status === "pending" ? "待整理" : mode === activeEntryMode ? "当前方式" : "已保存"}</span></span><p>{record.attention}</p></div>
                {onSelectRecord && record.id ? <button className="calendar-open-record" disabled={disabled} type="button" aria-label={`查看记录 ${record.attention}`} onClick={() => onSelectRecord(record.id!)}>查看<ArrowUpRight aria-hidden="true" size={14} /></button> : onSelectEntryMode ? <button className="calendar-open-record" disabled={disabled} type="button" aria-label={`查看这天的 ${modeLabel}`} onClick={() => onSelectEntryMode(mode)}>查看<ArrowUpRight aria-hidden="true" size={14} /></button> : null}
              </li>;
            })}</ul>
          </section> : null}
        </>
      ) : null}
    </section>
  );
}
