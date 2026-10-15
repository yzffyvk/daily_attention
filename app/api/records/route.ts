import { createLearningRecordSchema, learningRecordQuerySchema } from "@/lib/domain/learning-record";
import { createLearningRequestContext, learningSuccess, learningFailure, learningServiceFailure, sessionFailure, parseLearningBody, validateRecordImage, withSignedImage } from "@/server/learning/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const context = await createLearningRequestContext();
    if (!context) return sessionFailure(requestId);
    const parsed = learningRecordQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return learningFailure("VALIDATION_ERROR", parsed.error.issues[0].message, requestId, 422);
    const result = await context.repository.list(context.userId, parsed.data);
    return learningSuccess({ ...result, records: await Promise.all(result.records.map(record => withSignedImage(record, context))) }, requestId);
  } catch (error) { return learningServiceFailure(error, requestId); }
}
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const context = await createLearningRequestContext();
    if (!context) return sessionFailure(requestId);
    const parsed = await parseLearningBody(request, createLearningRecordSchema, requestId);
    if ("response" in parsed) return parsed.response;
    validateRecordImage(context.userId, parsed.data.imagePath);
    const record = await context.repository.create(parsed.data);
    return learningSuccess(await withSignedImage(record, context), requestId, 201);
  } catch (error) { return learningServiceFailure(error, requestId); }
}
