import { z } from "zod";
import {
  aiFailure,
  aiSuccess,
  aiValidationFailure,
  createAiRequestContext,
  isAiGenerationEnabled,
} from "@/server/ai/http";
import {
  cancelGeneration,
  getGeneration,
  toAiGenerationJobData,
} from "@/server/ai/service";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

const jobIdSchema = z.uuid("任务标识格式不正确");

export const dynamic = "force-dynamic";

async function requestContext(
  routeContext: RouteContext,
  requestId: string,
): Promise<
  | { ok: false; response: Response }
  | {
      ok: true;
      context: NonNullable<Awaited<ReturnType<typeof createAiRequestContext>>>;
      jobId: string;
    }
> {
  const context = await createAiRequestContext();
  if (!context) {
    return {
      ok: false,
      response: aiFailure(new Error("SESSION_EXPIRED"), requestId),
    };
  }
  if (!isAiGenerationEnabled()) {
    return {
      ok: false,
      response: aiFailure(new Error("FEATURE_DISABLED"), requestId),
    };
  }

  const { jobId } = await routeContext.params;
  const parsed = jobIdSchema.safeParse(jobId);
  if (!parsed.success) {
    return {
      ok: false,
      response: aiValidationFailure(
        { message: parsed.error.issues[0].message, path: ["jobId"] },
        requestId,
      ),
    };
  }
  return { ok: true, context, jobId: parsed.data };
}

export async function GET(
  _request: Request,
  routeContext: RouteContext,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    const parsed = await requestContext(routeContext, requestId);
    if (!parsed.ok) return parsed.response;
    const job = await getGeneration(
      parsed.context.userId,
      parsed.jobId,
      parsed.context.repository,
    );
    return aiSuccess(toAiGenerationJobData(job), requestId);
  } catch (error) {
    return aiFailure(error, requestId);
  }
}

export async function DELETE(
  _request: Request,
  routeContext: RouteContext,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    const parsed = await requestContext(routeContext, requestId);
    if (!parsed.ok) return parsed.response;
    const job = await cancelGeneration(
      parsed.context.userId,
      parsed.jobId,
      parsed.context.repository,
    );
    return aiSuccess(toAiGenerationJobData(job), requestId);
  } catch (error) {
    return aiFailure(error, requestId);
  }
}
