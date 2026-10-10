import { z } from "zod";

export type WorkerScope = { userId: string; createdAfter: string };

export function readWorkerScope(read: (key: string) => string | undefined): WorkerScope | null {
  const userId = read("AI_WORKER_USER_ID");
  const createdAfter = read("AI_WORKER_CREATED_AFTER");
  if (userId === undefined && createdAfter === undefined) return null;
  if (read("NODE_ENV") !== "development"
    || !z.uuid().safeParse(userId).success
    || !z.iso.datetime({ offset: true }).safeParse(createdAfter).success) {
    throw new Error("AI_WORKER_SCOPE_INVALID");
  }
  return { userId: userId!, createdAfter: createdAfter! };
}
