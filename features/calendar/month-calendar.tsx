"use client";

import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { dateKey, formatCalendarDate, formatMonth, monthDate, monthKeyForDate, shiftMonth } from "@/features/checkins/dates";
import type { CheckInSummary } from "@/features/checkins/types";

type MonthCalendarProps = {
  month: string;
  selectedDate: string;
  summaries: CheckInSummary[];
  today: string;
  disabled?: boolean;
  onMonthChange: (month: string) => void;
  onSelectDate: (date: string) => void;
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
  summaries,
  today,
  disabled = false,
  onMonthChange,
  onSelectDate,
}: MonthCalendarProps) {
  const current = monthDate(month);
  const year = current.getFullYear();
  const monthIndex = current.getMonth();
  const firstWeekday = current.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const summaryByDate = new Map(summaries.map((summary) => [summary.date, summary]));
  const isCurrentMonth = month === monthKeyForDate(today);

  return (
    <section className="calendar-section" aria-labelledby="calendar-title">
      <div className="calendar-heading">
        <div>
          <p className="eyebrow">ATTENTION MAP</p>
          <h2 id="calendar-title">{formatMonth(month)}</h2>
          <p className="section-description">选一天，记录或回看当日的学习收获</p>
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
        </div>
      </div>

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
          const selected = date === selectedDate;
          const isToday = date === today;
          return (
            <button
              aria-label={calendarLabel(date, summary, selected, isToday)}
              aria-pressed={selected}
              className={`calendar-cell${summary ? " recorded" : ""}${isToday ? " today" : ""}${selected ? " selected" : ""}`}
              disabled={disabled}
              key={date}
              onClick={() => onSelectDate(date)}
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
            </button>
          );
        })}
      </div>
      <div className="calendar-legend">
        <span><i className="legend-dot recorded-dot" />已打卡</span>
        <span><i className="legend-dot selected-dot" />当前选中</span>
        <span><i className="legend-dot today-dot" />今天</span>
      </div>
    </section>
  );
}
