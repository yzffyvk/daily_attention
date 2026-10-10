import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCheckIn, getCheckInStats, getMonthCheckIns, saveCheckIn } from "./api";
import { monthKeyForDate } from "./dates";
import type { CheckInEntryMode, CheckInInput } from "@/lib/domain/checkin";
import type { CheckInRecord, CheckInSummary } from "./types";

export const checkInKeys = {
  all: ["checkins"] as const,
  month: (month: string) => ["checkins", "month", month] as const,
  date: (date: string, entryMode: CheckInEntryMode = "manual") => ["checkins", "date", date, entryMode] as const,
  stats: (today: string) => ["checkins", "stats", today] as const,
  statsRoot: ["checkins", "stats"] as const,
};

export function useMonthCheckIns(month: string) {
  return useQuery({
    queryKey: checkInKeys.month(month),
    queryFn: () => getMonthCheckIns(month),
  });
}

export function useCheckIn(date: string, entryMode: CheckInEntryMode = "manual") {
  return useQuery({
    queryKey: checkInKeys.date(date, entryMode),
    queryFn: () => getCheckIn(date, entryMode),
  });
}

export function useCheckInStats(today: string) {
  return useQuery({
    queryKey: checkInKeys.stats(today),
    queryFn: () => getCheckInStats(today),
  });
}

function summaryFromRecord(record: CheckInRecord): CheckInSummary {
  return {
    date: record.date,
    entryMode: record.entryMode ?? "manual",
    attention: record.attention,
    hasImage: record.imagePath !== null,
    version: record.version,
    updatedAt: record.updatedAt,
  };
}

export function setMonthRecord(
  queryClient: ReturnType<typeof useQueryClient>,
  record: CheckInRecord | null,
  date: string,
  entryMode: CheckInEntryMode = record?.entryMode ?? "manual",
) {
  const month = monthKeyForDate(date);
  queryClient.setQueryData<CheckInSummary[]>(checkInKeys.month(month), (current) => {
    const withoutDate = (current ?? []).filter((summary) => summary.date !== date || (summary.entryMode ?? "manual") !== entryMode);
    if (!record) return withoutDate;
    return [...withoutDate, summaryFromRecord(record)].sort((left, right) =>
      left.date.localeCompare(right.date) || (left.entryMode ?? "manual").localeCompare(right.entryMode ?? "manual"),
    );
  });
}

export function useSaveCheckIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ date, input }: { date: string; input: CheckInInput }) =>
      saveCheckIn(date, input),
    onSuccess(record) {
      queryClient.setQueryData(checkInKeys.date(record.date, record.entryMode ?? "manual"), record);
      setMonthRecord(queryClient, record, record.date);
      void queryClient.invalidateQueries({ queryKey: checkInKeys.statsRoot });
    },
  });
}
