import type { CreateAiGenerationInput } from "@/lib/domain/ai-generation";
import { requestApi } from "@/features/checkins/api";
import type {
  AiGenerationJobData,
  CreateAiGenerationData,
} from "./types";

export function createAiGeneration(input: CreateAiGenerationInput) {
  return requestApi<CreateAiGenerationData>("/api/ai/generations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getAiGeneration(jobId: string, signal?: AbortSignal) {
  return requestApi<AiGenerationJobData>(
    `/api/ai/generations/${encodeURIComponent(jobId)}`,
    { signal },
  );
}

export function cancelAiGeneration(jobId: string) {
  return requestApi<AiGenerationJobData>(
    `/api/ai/generations/${encodeURIComponent(jobId)}`,
    { method: "DELETE" },
  );
}
