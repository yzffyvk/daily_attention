import { z } from "zod";
import type { AiGenerationProgress } from "../../../../lib/domain/ai-progress.ts";
import { AI_RESULT_WARNING_LIMIT } from "../../../../lib/domain/ai-review.ts";

export const AI_QUESTION_PROMPT_VERSION = "knowledge-questions-v1";
export const AI_RECALL_PROMPT_VERSION = "knowledge-recall-v1";
export const AI_REVIEWED_RECALL_PROMPT_VERSION = "knowledge-recall-v2";
export const AI_RELATION_PROMPT_VERSION = "knowledge-relations-v2";
export const AI_SUMMARY_PROMPT_VERSION = "knowledge-skeleton-user-prompt-v1";
export const AI_LEGACY_PROMPT_VERSION = "ai-summary-v1";

export const aiGenerationResultSchema = z.object({
  attention: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1),
  inspiration: z.string().trim().max(2000),
  sourceTitle: z.string().trim().min(1).max(300),
  warnings: z.array(z.string().trim().min(1).max(500)).max(AI_RESULT_WARNING_LIMIT),
}).strict();

export type AiGenerationResult = z.infer<typeof aiGenerationResultSchema>;

export type AiUsage = {
  promptTokens: number;
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
  completionTokens: number;
  reasoningTokens: number;
};

export type AiReviewAudit = {
  stage: 'document';
  requestedModel: string;
  returnedModel: string;
  round: number;
  verdict: 'pass' | 'revise' | 'invalid';
  issueCount: number;
  durationMs: number;
  usage: AiUsage;
};

export type AiValidationAudit = {
  stage: 'framework' | 'writing' | 'review' | 'revision';
  repair: boolean;
  reason: 'output_truncated' | 'json_invalid' | 'schema_invalid' | 'source_invalid' | 'framework_mismatch' | 'roundtrip_mismatch';
  issues: { path: string; code: string }[];
};

export type AiSummaryProviderResult = {
  result: AiGenerationResult;
  usage: AiUsage;
  providerCallCount: number;
  model: string;
  systemFingerprint: string | null;
  semanticReview?: { requestedModel: string; returnedModel: string | null; rounds: number; verdict: 'pass' | 'needs_review' | 'unavailable' };
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
    onProgress?: (progress: AiGenerationProgress) => Promise<void> | void;
    onSemanticReview?: (audit: AiReviewAudit) => Promise<void> | void;
    onValidationFailure?: (audit: AiValidationAudit) => Promise<void> | void;
  }): Promise<AiSummaryProviderResult>;
}
