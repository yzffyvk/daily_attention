import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCheckIn, getMonthCheckIns, saveCheckIn } from "./api";
import { monthKeyForDate } from "./dates";
import type { CheckInInput } from "@/lib/domain/checkin";
import type { CheckInRecord, CheckInSummary } from "./types";

export const checkInKeys = {
  all: ["checkins"] as const,
  month: (month: string) => ["checkins", "month", month] as const,
  date: (date: string) => ["checkins", "date", date] as const,
};

export function useMonthCheckIns(month: string) {
  return useQuery({
    queryKey: checkInKeys.month(month),
    queryFn: () => getMonthCheckIns(month),
  });
}

export function useCheckIn(date: string) {
  return useQuery({
    queryKey: checkInKeys.date(date),
    queryFn: () => getCheckIn(date),
  });
}

function summaryFromRecord(record: CheckInRecord): CheckInSummary {
  return {
    date: record.date,
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
) {
  const month = monthKeyForDate(date);
  queryClient.setQueryData<CheckInSummary[]>(checkInKeys.month(month), (current) => {
    const withoutDate = (current ?? []).filter((summary) => summary.date !== date);
    if (!record) return withoutDate;
    return [...withoutDate, summaryFromRecord(record)].sort((left, right) =>
      left.date.localeCompare(right.date),
    );
  });
}

export function useSaveCheckIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ date, input }: { date: string; input: CheckInInput }) =>
      saveCheckIn(date, input),
    onSuccess(record) {
      queryClient.setQueryData(checkInKeys.date(record.date), record);
      setMonthRecord(queryClient, record, record.date);
    },
  });
}
