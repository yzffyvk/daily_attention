import type { CheckInSummary } from "./types";

export function getTodayKey(now = new Date()) {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export function millisecondsUntilNextLocalMidnight(now = new Date()) {
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  );
  return Math.max(1, nextMidnight.getTime() - now.getTime());
}

export function dateKey(year: number, monthIndex: number, day: number) {
  return [
    year,
    String(monthIndex + 1).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

export function monthKeyForDate(date: string) {
  return date.slice(0, 7);
}

export function monthDate(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1, 12);
}

export function shiftMonth(month: string, amount: number) {
  const value = monthDate(month);
  value.setMonth(value.getMonth() + amount);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

export function formatDate(date: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T12:00:00`));
}

export function formatUpdatedAt(updatedAt: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(updatedAt));
}

export function formatMonth(month: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
  }).format(monthDate(month));
}

export function formatCalendarDate(date: string) {
  const [, month, day] = date.split("-").map(Number);
  return `${month}月${day}日`;
}

function dayNumber(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function keyFromDayNumber(day: number) {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export function calculateStreak(summaries: CheckInSummary[], today: string) {
  const dates = new Set(summaries.map((summary) => summary.date));
  let cursor = dayNumber(today);
  let streak = 0;

  if (!dates.has(today)) cursor -= 1;
  while (dates.has(keyFromDayNumber(cursor))) {
    streak += 1;
    cursor -= 1;
  }

  return streak;
}
