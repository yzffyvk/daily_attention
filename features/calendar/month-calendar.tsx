"use client";

import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import { dateKey, formatCalendarDate, formatMonth, monthDate, monthKeyForDate, shiftMonth } from "@/features/checkins/dates";
import type { CheckInSummary } from "@/features/checkins/types";

type MonthCalendarProps = {
  month: string;
  selectedDate: string;
  selectedDates?: string[];
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
) {
  const state = summary ? `已保存：${summary.attention}` : "暂无记录";
  const suffix = [selected ? "当前选中" : "", today ? "今天" : ""]
    .filter(Boolean)
    .join("，");
  return `${formatCalendarDate(date)}，${state}${suffix ? `，${suffix}` : ""}`;
}

export function MonthCalendar({
  month,
  selectedDate,
  selectedDates,
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
    groupedSummaries.set(summary.date, [...(groupedSummaries.get(summary.date) ?? []), summary]);
  }
  const summaryByDate = new Map([...groupedSummaries].map(([date, records]) => {
    if (records.length === 1) return [date, records[0]] as const;
    const ordered = [...records].sort((left, right) => Number(left.entryMode === "ai") - Number(right.entryMode === "ai"));
    return [date, {
      ...ordered[0],
      attention: ordered.map(record => `${record.entryMode === "ai" ? "AI" : "手动"}：${record.attention}`).join(" · "),
      hasImage: ordered.some(record => record.hasImage),
    }] as const;
  }));
  const isCurrentMonth = month === monthKeyForDate(today);

  return (
    <section className="calendar-section" aria-labelledby={titleId} data-testid="month-calendar">
      <div className="calendar-heading">
        <div>
          <p className="eyebrow">LEARNING MAP</p>
          <h2 id={titleId}>{formatMonth(month)}</h2>
          <p className="section-description">{selectedDates ? "选择 2–14 个已保存日期，可跨月、不连续选择" : "选一天，记录或回看当日的学习收获"}</p>
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
              const selected = selectedDates ? selectedDates.includes(date) : date === selectedDate;
              const dateDisabled = disabled || Boolean(selectedDates && (!summary || (!selected && selectedDates.length >= maxSelectedDates)));
              const isToday = date === today;
              const showPreview = !disabled && Boolean(summary) && previewDate === date;
              return (
                <button
                  aria-label={calendarLabel(date, summary, selected, isToday)}
                  aria-pressed={selected}
                  aria-describedby={showPreview ? `${previewId}-${date}` : undefined}
                  className={`calendar-cell${summary ? " recorded" : ""}${isToday ? " today" : ""}${selected ? " selected" : ""}`}
                  disabled={dateDisabled}
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
                    {summary ? (
                      <i aria-hidden="true"><Check size={13} strokeWidth={3} /></i>
                    ) : null}
                  </span>
                  <small>{summary?.attention ?? (isToday ? "记录今天" : "")}</small>
                  {isToday ? <em>今天</em> : null}
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
            <span><i className="legend-dot recorded-dot" />已记录</span>
            <span><i className="legend-dot selected-dot" />当前选中</span>
            <span><i className="legend-dot today-dot" />今天</span>
          </div>
        </>
      ) : null}
    </section>
  );
}
