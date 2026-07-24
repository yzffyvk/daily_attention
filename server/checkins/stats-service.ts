import "server-only";

import type { CheckInStats } from "@/features/checkins/types";
import type { CheckInRepository } from "./repository";

function dayNumber(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function dateFromDayNumber(day: number) {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export async function getCheckInStats(
  userId: string,
  today: string,
  repository: CheckInRepository,
): Promise<CheckInStats> {
  const dates = await repository.findAllDates(userId);
  const dateSet = new Set(dates);
  let cursor = dayNumber(today);
  let currentStreak = 0;

  if (!dateSet.has(today)) cursor -= 1;
  while (dateSet.has(dateFromDayNumber(cursor))) {
    currentStreak += 1;
    cursor -= 1;
  }

  return {
    totalCount: dates.length,
    currentStreak,
    hasTodayRecord: dateSet.has(today),
  };
}
