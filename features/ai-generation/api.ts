import type { CreateAiGenerationInput } from "@/lib/domain/ai-generation";
import { reflectionPolishResultSchema, type ReflectionPolishInput } from "@/lib/domain/reflection-polish";
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
  const deadline = AbortSignal.timeout(10_000);
  return requestApi<AiGenerationJobData>(
    `/api/ai/generations/${encodeURIComponent(jobId)}`,
    { signal: signal ? AbortSignal.any([signal, deadline]) : deadline },
  );
}

export function cancelAiGeneration(jobId: string, confirmQuotaConsumption = false) {
  return requestApi<AiGenerationJobData>(
    `/api/ai/generations/${encodeURIComponent(jobId)}`,
    { method: "DELETE", body: JSON.stringify({ confirmQuotaConsumption }) },
  );
}

export async function polishReflection(input: ReflectionPolishInput, signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(65_000);
  const result = await requestApi<unknown>("/api/ai/reflection-polish", {
    method: "POST",
    body: JSON.stringify(input),
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  });
  return reflectionPolishResultSchema.parse(result);
}
