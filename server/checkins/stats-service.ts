import "server-only";

import type { CheckInStats } from "@/features/checkins/types";
import type { CheckInRepository } from "./repository";

export async function getCheckInStats(
  _userId: string,
  today: string,
  repository: CheckInRepository,
): Promise<CheckInStats> {
  return repository.getStats(today);
}
