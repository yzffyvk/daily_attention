import "server-only";
import { z } from "zod";
import { createCheckInRequestContext, checkInFailure, checkInSuccess, checkInServiceFailure } from "@/server/checkins/http";
import { createLearningRepository } from "./repository";
import { assertOwnedImagePath, createCheckInImageUrl, removeCheckInImage } from "@/server/storage/service";
import type { LearningRecord } from "@/lib/domain/learning-record";
import { logServerError, operationalErrorFields } from "@/lib/server/logging";

export { checkInSuccess as learningSuccess, checkInFailure as learningFailure };
export async function createLearningRequestContext() {
  const context = await createCheckInRequestContext();
  return context ? { ...context, repository: createLearningRepository(context.supabase) } : null;
}
export type LearningRequestContext = NonNullable<Awaited<ReturnType<typeof createLearningRequestContext>>>;
export function sessionFailure(requestId: string) { return checkInFailure("SESSION_EXPIRED", "登录已失效，请重新登录", requestId, 401); }
export function notFound(requestId: string) { return checkInFailure("NOT_FOUND", "这条内容不存在或已删除", requestId, 404); }
export async function parseLearningBody<T>(request: Request, schema: z.ZodType<T>, requestId: string): Promise<{ data: T } | { response: Response }> {
  let body: unknown;
  try { body = await request.json(); } catch { return { response: checkInFailure("VALIDATION_ERROR", "请求内容不正确", requestId, 422) }; }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { response: checkInFailure("VALIDATION_ERROR", issue.message, requestId, 422, { field: issue.path[0]?.toString() }) };
  }
  return { data: parsed.data };
}
export async function parseRecordId(context: { params: Promise<{ id: string }> }, requestId: string): Promise<{ id: string } | { response: Response }> {
  const parsed = z.uuid().safeParse((await context.params).id);
  return parsed.success ? { id: parsed.data } : { response: checkInFailure("VALIDATION_ERROR", "内容标识不正确", requestId, 422) };
}
export async function withSignedImage(record: LearningRecord, context: LearningRequestContext): Promise<LearningRecord> {
  return { ...record, imageUrl: record.imagePath ? await createCheckInImageUrl(context.userId, record.imagePath, context.supabase) : null };
}
export function validateRecordImage(userId: string, imagePath: string | null | undefined) {
  if (imagePath != null) assertOwnedImagePath(userId, imagePath);
}
export async function cleanupRecordImage(path: string | null, context: LearningRequestContext, requestId: string) {
  if (!path) return;
  try {
    if (!await context.repository.imageIsReferenced(context.userId, path)) await removeCheckInImage(context.userId, path, context.supabase);
  } catch (error) {
    logServerError("learning record image cleanup failed", { requestId, ...operationalErrorFields(error) });
  }
}
export function learningServiceFailure(error: unknown, requestId: string) {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  if (message === "FORBIDDEN_IMAGE_PATH") return checkInFailure(message, "无权使用此图片", requestId, 403);
  if (["RECORD_NOT_FOUND", "ALBUM_NOT_FOUND"].includes(message)) return notFound(requestId);
  if (["STALE_AI_CANDIDATE", "CANDIDATE_NOT_FOUND"].includes(message)) return checkInFailure(message, "记录已变化或提炼结果已过期，请重新提炼", requestId, 409);
  if (message === "SOURCE_CHANGE_REQUIRES_NEW_RECORD") return checkInFailure(message, "已有总结的记录更换链接时，请新建记录", requestId, 409);
  if (["VERSION_CONFLICT", "IDEMPOTENCY_CONFLICT"].includes(message)) return checkInFailure(message, "云端记录已更新，请刷新后重试", requestId, 409);
  if (["INVALID_RECORD_INPUT", "FUTURE_CHECKIN_DATE", "IMMUTABLE_RECORD_IDENTITY"].includes(message)) return checkInFailure("VALIDATION_ERROR", "记录内容或日期不正确", requestId, 422);
  if (message === "SESSION_EXPIRED") return sessionFailure(requestId);
  return checkInServiceFailure(error, requestId);
}
