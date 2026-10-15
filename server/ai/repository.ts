import "server-only";

import { z } from "zod";
import { AI_RESULT_WARNING_LIMIT } from '@/lib/domain/ai-review';
import type { AiCancellationInfo, AiGenerationQuota, AiGenerationStatus } from "@/features/ai-generation/types";
import { dateKeySchema } from "@/lib/domain/checkin";
import { aiUserPromptSchema } from "@/lib/domain/ai-prompt";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { aiGenerationProgressSchema, type AiGenerationProgress } from "@/lib/domain/ai-progress";

const statusSchema = z.enum([
  "queued",
  "fetching",
  "generating",
  "retryable",
  "succeeded",
  "failed",
  "cancelled",
]);

const timestampSchema = z.iso.datetime({ offset: true });
const jobSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  target_date: dateKeySchema,
  idempotency_key: z.uuid(),
  source_url: z.string().min(1).max(2048),
  source_host: z.string().min(1).max(253),
  source_title: z.string().max(300).nullable(),
  status: statusSchema,
  attempt_count: z.number().int().min(0).max(3),
  provider_call_count: z.number().int().nonnegative(),
  attention: z.string().max(120).nullable(),
  summary: z.string().nullable(),
  inspiration: z.string().max(2000).nullable(),
  warnings: z.array(z.string()).max(AI_RESULT_WARNING_LIMIT),
  error_code: z.string().max(80).nullable(),
  error_message: z.string().nullable(),
  provider: z.string().min(1),
  model: z.string().min(1).max(160),
  thinking_enabled: z.boolean(),
  reasoning_effort: z.enum(["high", "max"]),
  prompt_version: z.string().min(1).max(40),
  user_prompt: aiUserPromptSchema.optional().default(""),
  prompt_tokens: z.number().int().nonnegative().nullable(),
  prompt_cache_hit_tokens: z.number().int().nonnegative().nullable(),
  prompt_cache_miss_tokens: z.number().int().nonnegative().nullable(),
  completion_tokens: z.number().int().nonnegative().nullable(),
  reasoning_tokens: z.number().int().nonnegative().nullable(),
  system_fingerprint: z.string().max(255).nullable(),
  created_at: timestampSchema,
  started_at: timestampSchema.nullable(),
  finished_at: timestampSchema.nullable(),
  result_expires_at: timestampSchema.nullable(),
  metadata_expires_at: timestampSchema,
  updated_at: timestampSchema,
  progress: aiGenerationProgressSchema.nullable().optional().catch(null),
});

const jobWithQuotaSchema = z.object({
  job: jobSchema,
  quota_used: z.number().int().min(0).max(5),
  quota_reserved: z.number().int().min(0).max(5),
  quota_consumed: z.number().int().min(0).max(5),
  quota_remaining: z.number().int().min(0).max(5),
}).superRefine((value, context) => {
  if (
    value.quota_used !== value.quota_reserved + value.quota_consumed
    || value.quota_remaining !== 5 - value.quota_used
  ) {
    context.addIssue({ code: "custom", message: "inconsistent AI quota" });
  }
});

const jobStateSchema = z.object({
  job: jobSchema,
  quota: z.object({
    used: z.number().int().min(0).max(5), reserved: z.number().int().min(0).max(5),
    consumed: z.number().int().min(0).max(5), limit: z.literal(5), remaining: z.number().int().min(0).max(5),
  }).refine(q => q.used === q.reserved + q.consumed && q.remaining === 5 - q.used),
  cancellation: z.object({
    freeRemaining: z.number().int().min(0).max(2), requiresConfirmation: z.boolean(), charged: z.boolean().nullable(),
  }),
});

type RpcClient = {
  rpc: unknown;
};

function rpc(
  client: RpcClient,
  name: string,
  params: Record<string, unknown>,
): PromiseLike<{ data: unknown; error: unknown }> {
  if (typeof client.rpc !== "function") {
    throw new Error("AI generation RPC client is unavailable");
  }
  const invoke = client.rpc as (
    targetName: string,
    targetParams: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
  return invoke.call(client, name, params);
}

export type AiJob = {
  id: string;
  userId: string;
  targetDate: string;
  idempotencyKey: string;
  sourceUrl: string;
  sourceHost: string;
  sourceTitle: string | null;
  status: AiGenerationStatus;
  attemptCount: number;
  providerCallCount: number;
  attention: string | null;
  summary: string | null;
  inspiration: string | null;
  warnings: string[];
  errorCode: string | null;
  errorMessage: string | null;
  provider: string;
  model: string;
  thinkingEnabled: boolean;
  reasoningEffort: "high" | "max";
  promptVersion: string;
  userPrompt?: string;
  promptTokens: number | null;
  promptCacheHitTokens: number | null;
  promptCacheMissTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  systemFingerprint: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  resultExpiresAt: string | null;
  metadataExpiresAt: string;
  updatedAt: string;
  progress?: AiGenerationProgress | null;
  quota?: AiGenerationQuota;
  cancellation?: AiCancellationInfo;
};

export type AiJobWithQuota = {
  job: AiJob;
  quota: {
    used: number;
    reserved: number;
    consumed: number;
    limit: 5;
    remaining: number;
  };
};

export type CreateAiJob = {
  userId: string;
  targetDate: string;
  idempotencyKey: string;
  sourceUrl: string;
  sourceHost: string;
  userPrompt?: string;
};

export interface AiGenerationRepository {
  create(input: CreateAiJob): Promise<AiJobWithQuota>;
  findOwned(userId: string, jobId: string): Promise<AiJob | null>;
  cancelOwned(userId: string, jobId: string, confirmQuotaConsumption?: boolean): Promise<AiJob>;
}

function mapJob(row: z.infer<typeof jobSchema>): AiJob {
  return {
    id: row.id,
    userId: row.user_id,
    targetDate: row.target_date,
    idempotencyKey: row.idempotency_key,
    sourceUrl: row.source_url,
    sourceHost: row.source_host,
    sourceTitle: row.source_title,
    status: row.status,
    attemptCount: row.attempt_count,
    providerCallCount: row.provider_call_count,
    attention: row.attention,
    summary: row.summary,
    inspiration: row.inspiration,
    warnings: row.warnings,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    provider: row.provider,
    model: row.model,
    thinkingEnabled: row.thinking_enabled,
    reasoningEffort: row.reasoning_effort,
    promptVersion: row.prompt_version,
    userPrompt: row.user_prompt,
    promptTokens: row.prompt_tokens,
    promptCacheHitTokens: row.prompt_cache_hit_tokens,
    promptCacheMissTokens: row.prompt_cache_miss_tokens,
    completionTokens: row.completion_tokens,
    reasoningTokens: row.reasoning_tokens,
    systemFingerprint: row.system_fingerprint,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    resultExpiresAt: row.result_expires_at,
    metadataExpiresAt: row.metadata_expires_at,
    updatedAt: row.updated_at,
    progress: row.progress ?? null,
  };
}

function mapWithQuota(row: z.infer<typeof jobWithQuotaSchema>): AiJobWithQuota {
  return {
    job: mapJob(row.job),
    quota: {
      used: row.quota_used,
      reserved: row.quota_reserved,
      consumed: row.quota_consumed,
      limit: 5,
      remaining: row.quota_remaining,
    },
  };
}

function oneWithQuota(data: unknown) {
  const parsed = z.array(jobWithQuotaSchema).length(1).safeParse(data);
  if (!parsed.success) throw new Error("Malformed AI generation RPC response");
  return parsed.data[0];
}

function mapState(data: unknown): AiJob {
  const parsed = jobStateSchema.safeParse(data);
  if (!parsed.success) throw new Error("Malformed AI generation RPC response");
  return { ...mapJob(parsed.data.job), quota: parsed.data.quota, cancellation: parsed.data.cancellation };
}

export function createAiGenerationRepository(
  client: RpcClient = createAdminSupabase(),
): AiGenerationRepository {
  return {
    async create(input) {
      const { data, error } = await rpc(client, "create_ai_generation_job", {
        target_user_id: input.userId,
        target_date: input.targetDate,
        target_idempotency_key: input.idempotencyKey,
        target_source_url: input.sourceUrl,
        target_source_host: input.sourceHost,
        target_user_prompt: aiUserPromptSchema.parse(input.userPrompt ?? ""),
      });
      if (error) throw error;
      return mapWithQuota(oneWithQuota(data));
    },

    async findOwned(userId, jobId) {
      const { data, error } = await rpc(client, "read_ai_generation_job_state", {
        target_user_id: userId,
        target_job_id: jobId,
      });
      if (error) throw error;
      return data === null ? null : mapState(data);
    },

    async cancelOwned(userId, jobId, confirmQuotaConsumption = false) {
      const { data, error } = await rpc(client, "cancel_ai_generation_job_v2", {
        target_user_id: userId,
        target_job_id: jobId,
        target_confirm_quota_consumption: confirmQuotaConsumption,
      });
      if (error) throw error;
      return mapState(data);
    },
  };
}
