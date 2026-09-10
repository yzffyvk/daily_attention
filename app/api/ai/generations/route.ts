import { createAiGenerationSchema } from "@/lib/domain/ai-generation";
import { requestIp } from "@/server/auth/request";
import {
  aiFailure,
  aiSuccess,
  aiValidationFailure,
  createAiRequestContext,
  isAiGenerationEnabled,
} from "@/server/ai/http";
import { createGeneration } from "@/server/ai/service";
import { consumeRateLimit } from "@/server/rate-limit/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    const context = await createAiRequestContext();
    if (!context) return aiFailure(new Error("SESSION_EXPIRED"), requestId);
    if (!isAiGenerationEnabled()) {
      return aiFailure(new Error("FEATURE_DISABLED"), requestId);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return aiValidationFailure(
        { message: "请求内容不正确", path: [] },
        requestId,
      );
    }
    const parsed = createAiGenerationSchema.safeParse(body);
    if (!parsed.success) {
      return aiValidationFailure(parsed.error.issues[0], requestId);
    }

    await consumeRateLimit(
      "aiGenerate",
      `${context.userId}:${requestIp(request)}`,
      context.admin,
    );
    const created = await createGeneration(
      context.userId,
      parsed.data,
      context.repository,
    );

    return aiSuccess({
      jobId: created.job.id,
      status: created.job.status,
      pollAfterMs: 1500,
      quota: created.quota,
    }, requestId, 202);
  } catch (error) {
    return aiFailure(error, requestId);
  }
}
