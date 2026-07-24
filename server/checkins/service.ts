import type { CheckInInput } from "@/lib/domain/checkin";
import type {
  CheckInRecord,
  VersionConflict,
} from "@/features/checkins/types";
import type { CheckInRepository } from "./repository";

type SaveCheckInResult =
  | { ok: true; record: CheckInRecord }
  | VersionConflict;

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

export async function saveCheckIn(
  userId: string,
  date: string,
  input: CheckInInput,
  repository: CheckInRepository,
): Promise<SaveCheckInResult> {
  const existing = await repository.findByDate(userId, date);

  if (!existing) {
    if (input.version !== null) {
      return { ok: false, reason: "VERSION_CONFLICT", current: null };
    }
    try {
      return {
        ok: true,
        record: await repository.insert(userId, date, input),
      };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return {
        ok: false,
        reason: "VERSION_CONFLICT",
        current: await repository.findByDate(userId, date),
      };
    }
  }

  if (input.version === null) {
    return {
      ok: false,
      reason: "VERSION_CONFLICT",
      current: existing,
    };
  }

  const updated = await repository.updateAtVersion(
    userId,
    date,
    input.version,
    input,
  );
  if (updated) return { ok: true, record: updated };

  return {
    ok: false,
    reason: "VERSION_CONFLICT",
    current: await repository.findByDate(userId, date),
  };
}
