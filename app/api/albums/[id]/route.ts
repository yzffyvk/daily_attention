import { learningAlbumUpdateSchema } from "@/lib/domain/learning-record";
import { createLearningRequestContext, learningSuccess, learningServiceFailure, sessionFailure, parseLearningBody, parseRecordId, notFound } from "@/server/learning/http";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, routeContext: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const context = await createLearningRequestContext(); if (!context) return sessionFailure(requestId);
    const id = await parseRecordId(routeContext, requestId); if ("response" in id) return id.response;
    const parsed = await parseLearningBody(request, learningAlbumUpdateSchema, requestId); if ("response" in parsed) return parsed.response;
    const album = await context.repository.updateAlbum(context.userId, id.id, parsed.data);
    return album ? learningSuccess(album, requestId) : notFound(requestId);
  } catch (error) { return learningServiceFailure(error, requestId); }
}
export async function DELETE(_request: Request, routeContext: RouteContext) {
  const requestId = crypto.randomUUID();
  try {
    const context = await createLearningRequestContext(); if (!context) return sessionFailure(requestId);
    const id = await parseRecordId(routeContext, requestId); if ("response" in id) return id.response;
    const deleted = await context.repository.deleteAlbum(context.userId, id.id);
    return deleted ? learningSuccess({ id: deleted }, requestId) : notFound(requestId);
  } catch (error) { return learningServiceFailure(error, requestId); }
}
