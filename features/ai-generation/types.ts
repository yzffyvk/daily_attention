import type { AiGenerationResult } from "@/lib/domain/ai-generation";

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

export type CreateAiGenerationData = {
  jobId: string;
  status: AiGenerationStatus;
  pollAfterMs: number;
  quota: AiGenerationQuota;
};

export type AiGenerationTaskErrorCode =
  | "FETCH_TIMEOUT"
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
  jobId: string;
  status: AiGenerationStatus;
  stage: AiGenerationStage;
  result?: AiGenerationResult;
  error?: {
    code: AiGenerationTaskErrorCode;
    message: string;
    retryable: boolean;
  };
};
