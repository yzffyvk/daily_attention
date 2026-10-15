import { learningAlbumInputSchema } from "@/lib/domain/learning-record";
import { createLearningRequestContext, learningSuccess, learningServiceFailure, sessionFailure, parseLearningBody } from "@/server/learning/http";
export const dynamic = "force-dynamic";
export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const context = await createLearningRequestContext(); if (!context) return sessionFailure(requestId);
    return learningSuccess(await context.repository.listAlbums(), requestId);
  } catch (error) { return learningServiceFailure(error, requestId); }
}
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const context = await createLearningRequestContext(); if (!context) return sessionFailure(requestId);
    const parsed = await parseLearningBody(request, learningAlbumInputSchema, requestId); if ("response" in parsed) return parsed.response;
    return learningSuccess(await context.repository.createAlbum(context.userId, parsed.data), requestId, 201);
  } catch (error) { return learningServiceFailure(error, requestId); }
}
