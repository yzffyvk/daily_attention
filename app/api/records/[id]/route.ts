import { z } from "zod";
import { updateLearningRecordSchema } from "@/lib/domain/learning-record";
import { createLearningRequestContext, learningSuccess, learningFailure, learningServiceFailure, sessionFailure, parseLearningBody, parseRecordId, validateRecordImage, withSignedImage, notFound, cleanupRecordImage, type LearningRequestContext } from "@/server/learning/http";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };
async function failureWithCurrent(error: unknown, id: string, context: LearningRequestContext, requestId: string) {
  if (error && typeof error === "object" && "message" in error && error.message === "VERSION_CONFLICT") {
    const current = await context.repository.find(context.userId, id);
    return learningFailure("VERSION_CONFLICT", "云端记录已更新，请确认后重试", requestId, 409, { current: current ? await withSignedImage(current, context) : null });
  }
  return learningServiceFailure(error, requestId);
}
export async function GET(_request: Request, routeContext: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const context = await createLearningRequestContext(); if (!context) return sessionFailure(requestId);
    const parsed = await parseRecordId(routeContext, requestId); if ("response" in parsed) return parsed.response;
    const record = await context.repository.find(context.userId, parsed.id);
    return record ? learningSuccess(await withSignedImage(record, context), requestId) : notFound(requestId);
  } catch (error) { return learningServiceFailure(error, requestId); }
}
export async function PATCH(request: Request, routeContext: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const context = await createLearningRequestContext(); if (!context) return sessionFailure(requestId);
    const parsed = await parseRecordId(routeContext, requestId); if ("response" in parsed) return parsed.response;
    const body = await parseLearningBody(request, updateLearningRecordSchema, requestId); if ("response" in body) return body.response;
    validateRecordImage(context.userId, body.data.imagePath);
    const previous = await context.repository.find(context.userId, parsed.id); if (!previous) return notFound(requestId);
    try {
      const record = await context.repository.update(parsed.id, body.data);
      if (previous.imagePath !== record.imagePath) await cleanupRecordImage(previous.imagePath, context, requestId);
      return learningSuccess(await withSignedImage(record, context), requestId);
    } catch (error) { return await failureWithCurrent(error, parsed.id, context, requestId); }
  } catch (error) { return learningServiceFailure(error, requestId); }
}
export async function DELETE(request: Request, routeContext: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const context = await createLearningRequestContext(); if (!context) return sessionFailure(requestId);
    const parsed = await parseRecordId(routeContext, requestId); if ("response" in parsed) return parsed.response;
    const version = z.coerce.number().int().positive().safeParse(new URL(request.url).searchParams.get("version"));
    if (!version.success) return learningFailure("VALIDATION_ERROR", "请提供记录版本", requestId, 422);
    try {
      const deleted = await context.repository.delete(parsed.id, version.data);
      await cleanupRecordImage(deleted.imagePath, context, requestId);
      return learningSuccess({ id: parsed.id }, requestId);
    } catch (error) { return await failureWithCurrent(error, parsed.id, context, requestId); }
  } catch (error) { return learningServiceFailure(error, requestId); }
}
