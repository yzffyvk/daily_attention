import type {
  AiGenerationJobData,
  AiGenerationStage,
  AiGenerationTaskErrorCode,
} from "@/features/ai-generation/types";
import { aiGenerationTaskErrorMessages as taskErrorMessages, type CreateAiGenerationInput } from "@/lib/domain/ai-generation";
import type {
  AiGenerationRepository,
  AiJob,
  AiJobWithQuota,
} from "./repository";

const automaticRetryMessages: Partial<Record<AiGenerationTaskErrorCode, string>> = {
  MODEL_OUTPUT_INVALID: "上一轮内容未通过校验，正在重新生成。",
  MODEL_RATE_LIMITED: "AI 服务繁忙，正在等待重试。",
  MODEL_SERVICE_ERROR: "上一轮 AI 响应未完成，正在重新尝试。",
  FETCH_TIMEOUT: "上一轮读取资料超时，正在重新读取。",
  FETCH_SERVICE_UNAVAILABLE: "资料读取服务暂时不可用，正在等待重试。",
};

function isTaskErrorCode(value: string | null): value is AiGenerationTaskErrorCode {
  return value !== null && value in taskErrorMessages && value !== "RESULT_EXPIRED";
}

function publicError(message: string) {
  return new Error(message);
}

function errorMessage(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

export async function createGeneration(
  userId: string,
  input: CreateAiGenerationInput,
  repository: AiGenerationRepository,
): Promise<AiJobWithQuota> {
  const created = await repository.create({
    userId,
    ...(input.recordId ? { recordId: input.recordId } : {}),
    targetDate: input.targetDate,
    idempotencyKey: input.idempotencyKey,
    sourceUrl: input.sourceUrl,
    sourceHost: new URL(input.sourceUrl).hostname,
    userPrompt: input.userPrompt?.trim() ?? "",
  });

  return created;
}

export async function getGeneration(
  userId: string,
  jobId: string,
  repository: AiGenerationRepository,
) {
  const job = await repository.findOwned(userId, jobId);
  if (!job) throw publicError("FORBIDDEN_JOB");
  return job;
}

export async function cancelGeneration(
  userId: string,
  jobId: string,
  repository: AiGenerationRepository,
  confirmQuotaConsumption = false,
) {
  try {
    return await repository.cancelOwned(userId, jobId, confirmQuotaConsumption);
  } catch (error) {
    if (errorMessage(error) === "AI_JOB_INVALID_TRANSITION") {
      throw publicError("JOB_ALREADY_STARTED");
    }
    throw error;
  }
}

function stageFor(job: AiJob): AiGenerationStage {
  if (job.status === "queued") return "queued";
  if (job.status === "fetching") return "fetching";
  if (job.status === "generating") return "generating";
  if (job.status === "retryable") return "retrying";
  return "complete";
}

export function toAiGenerationJobData(job: AiJob): AiGenerationJobData {
  const base: AiGenerationJobData = {
    jobId: job.id,
    ...(job.recordId ? { recordId: job.recordId, baseVersion: job.baseVersion ?? undefined } : {}),
    status: job.status,
    stage: stageFor(job),
    attemptCount: job.attemptCount,
    ...(job.quota ? { quota: job.quota } : {}),
    ...(job.cancellation ? { cancellation: job.cancellation } : {}),
    ...(job.status === "retryable" ? {
      retryMessage: (isTaskErrorCode(job.errorCode) && automaticRetryMessages[job.errorCode])
        || "上一轮未完成，正在重新尝试。",
    } : {}),
    ...(job.status === "generating" && job.progress ? { progress: job.progress } : {}),
    generationContext: {
      userPrompt: job.userPrompt ?? "",
      promptVersion: job.promptVersion,
    },
  };

  if (job.status === "succeeded") {
    if (
      job.resultExpiresAt === null
      || job.attention === null
      || job.summary === null
      || job.inspiration === null
      || job.sourceTitle === null
    ) {
      return {
        ...base,
        error: {
          code: "RESULT_EXPIRED",
          message: taskErrorMessages.RESULT_EXPIRED,
          retryable: false,
        },
      };
    }
    return {
      ...base,
      result: {
        attention: job.attention,
        summary: job.summary,
        inspiration: job.inspiration,
        sourceTitle: job.sourceTitle,
        warnings: job.warnings,
      },
    };
  }

  if (job.status === "failed") {
    const code = isTaskErrorCode(job.errorCode)
      ? job.errorCode
      : "MODEL_SERVICE_ERROR";
    return {
      ...base,
      error: {
        code,
        message: taskErrorMessages[code],
        retryable: false,
      },
    };
  }

  return base;
}
