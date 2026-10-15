import { moveLearningRecordsSchema } from "@/lib/domain/learning-record";
import { createLearningRequestContext, learningSuccess, learningServiceFailure, sessionFailure, parseLearningBody } from "@/server/learning/http";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const context = await createLearningRequestContext(); if (!context) return sessionFailure(requestId);
    const parsed = await parseLearningBody(request, moveLearningRecordsSchema, requestId); if ("response" in parsed) return parsed.response;
    return learningSuccess({ moved: await context.repository.move(parsed.data.recordIds, parsed.data.albumId) }, requestId);
  } catch (error) { return learningServiceFailure(error, requestId); }
}
