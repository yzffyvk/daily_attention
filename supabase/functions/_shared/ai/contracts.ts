import { z } from "zod";
import { SUMMARY_MAX_LENGTH } from "../../../../lib/domain/summary-limits.ts";

export const AI_QUESTION_PROMPT_VERSION = "knowledge-questions-v1";
export const AI_RELATION_PROMPT_VERSION = "knowledge-relations-v2";
export const AI_SUMMARY_PROMPT_VERSION = "knowledge-skeleton-user-prompt-v1";
export const AI_LEGACY_PROMPT_VERSION = "ai-summary-v1";

export const aiGenerationResultSchema = z.object({
  attention: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(SUMMARY_MAX_LENGTH),
  inspiration: z.string().trim().max(2000),
  sourceTitle: z.string().trim().min(1).max(300),
  warnings: z.array(z.string().trim().min(1).max(500)).max(10),
}).strict();

export type AiGenerationResult = z.infer<typeof aiGenerationResultSchema>;

export type AiUsage = {
  promptTokens: number;
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
  completionTokens: number;
  reasoningTokens: number;
};

export type AiSummaryProviderResult = {
  result: AiGenerationResult;
  usage: AiUsage;
  providerCallCount: number;
  model: string;
  systemFingerprint: string | null;
};

export interface AiSummaryProvider {
  generate(input: {
    sourceTitle: string;
    sourceText: string;
    sourceTruncated?: boolean;
    userPrompt?: string;
    promptVersion?: string;
    anonymousUserId: string;
    signal?: AbortSignal;
  }): Promise<AiSummaryProviderResult>;
}
