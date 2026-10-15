import type { AiGenerationResult } from "@/lib/domain/ai-generation";
import type { AiGenerationContext } from "@/lib/domain/ai-prompt";
import type { AiGenerationProgress } from "@/lib/domain/ai-progress";

export type AiGenerationStatus =
  | "queued"
  | "fetching"
  | "generating"
  | "retryable"
  | "succeeded"
  | "failed"
  | "cancelled";

export type AiGenerationStage =
  | "queued"
  | "fetching"
  | "generating"
  | "retrying"
  | "complete";

export type AiGenerationQuota = {
  used: number;
  reserved: number;
  consumed: number;
  limit: 5;
  remaining: number;
};

export type AiCancellationInfo = {
  freeRemaining: number;
  requiresConfirmation: boolean;
  charged: boolean | null;
};

export type CreateAiGenerationData = {
  recordId?: string;
  baseVersion?: number;
  generationContext?: AiGenerationContext;
  jobId: string;
  status: AiGenerationStatus;
  pollAfterMs: number;
  quota: AiGenerationQuota;
};

export type ActiveAiJob = {
  recordId?: string;
  userPrompt?: string;
  generationContext?: AiGenerationContext;
  jobId: string;
  targetDate: string;
  sourceUrl: string;
  createdAt: string;
};

export type AiGenerationTaskErrorCode =
  | "FETCH_TIMEOUT"
  | "FETCH_SERVICE_UNAVAILABLE"
  | "TOO_MANY_REDIRECTS"
  | "RESPONSE_TOO_LARGE"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "CONTENT_NOT_EXTRACTABLE"
  | "CONTENT_BLOCKED"
  | "MODEL_RATE_LIMITED"
  | "MODEL_OUTPUT_INVALID"
  | "MODEL_SERVICE_ERROR"
  | "TASK_RETRY_EXHAUSTED"
  | "RESULT_EXPIRED";

export type AiGenerationJobData = {
  recordId?: string;
  baseVersion?: number;
  generationContext?: AiGenerationContext;
  jobId: string;
  status: AiGenerationStatus;
  stage: AiGenerationStage;
  attemptCount?: number;
  retryMessage?: string;
  result?: AiGenerationResult;
  progress?: AiGenerationProgress;
  error?: {
    code: AiGenerationTaskErrorCode;
    message: string;
    retryable: boolean;
  };
  quota?: AiGenerationQuota;
  cancellation?: AiCancellationInfo;
};
