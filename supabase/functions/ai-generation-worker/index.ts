import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createDeepSeekProvider } from "../_shared/ai/deepseek.ts";
import { extractLearningSource } from "../_shared/ai/extract.ts";
import {
  runAiJob,
  type AiJobRunResult,
  type AiJobRunnerPorts,
} from "../_shared/ai/runner.ts";
import { createSafeFetchClient } from "../_shared/ai/safe-fetch-client.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
};

const QUEUE_BATCH_LIMIT = 5;
const QUEUE_VISIBILITY_TIMEOUT_SECONDS = 180;
const WORKER_CONCURRENCY = 2;
const jsonHeaders = {
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json; charset=utf-8",
};

export type AiQueueMessage = {
  msgId: number;
  readCount: number;
  message: unknown;
};

export type AiWorkerDependencies = {
  triggerToken: string;
  readMessages(): Promise<AiQueueMessage[]>;
  runJob(jobId: string): Promise<AiJobRunResult>;
  deleteMessage(msgId: number): Promise<void>;
  delayMessage(msgId: number, delaySeconds: number): Promise<void>;
};

const jobPayloadSchema = z.object({ job_id: z.uuid() }).strict();
const queueRowSchema = z.object({
  msg_id: z.number().int().positive(),
  read_count: z.number().int().positive(),
  message: z.unknown(),
});
const claimedJobSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  source_url: z.string().url().max(2048),
  attempt_count: z.number().int().min(1).max(3),
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

async function digest(value: string) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

async function constantTimeEqual(left: string, right: string) {
  const [leftDigest, rightDigest] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest[index]! ^ rightDigest[index]!;
  }
  return difference === 0;
}

function bearerToken(request: Request) {
  const match = /^Bearer ([^\s]+)$/iu.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? "";
}

export function retryDelaySeconds(readCount: number) {
  if (readCount <= 1) return 5;
  if (readCount === 2) return 30;
  return 120;
}

async function mapWithConcurrency<T>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<void>,
) {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      await operation(values[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
}

export function createWorkerHandler(dependencies: AiWorkerDependencies) {
  return async function handleRequest(request: Request) {
    const requestId = crypto.randomUUID();
    if (!await constantTimeEqual(
      bearerToken(request),
      dependencies.triggerToken,
    )) {
      return jsonResponse({ ok: false, requestId }, 401);
    }
    if (request.method !== "POST") {
      return jsonResponse({ ok: false, requestId }, 405);
    }

    const counts = { received: 0, completed: 0, retryable: 0, failed: 0 };
    try {
      const messages = (await dependencies.readMessages()).slice(0, QUEUE_BATCH_LIMIT);
      counts.received = messages.length;
      await mapWithConcurrency(messages, WORKER_CONCURRENCY, async (delivery) => {
        const payload = jobPayloadSchema.safeParse(delivery.message);
        if (!payload.success) {
          try {
            await dependencies.deleteMessage(delivery.msgId);
          } catch {
            // The message becomes visible again; keep processing the batch.
          }
          counts.failed += 1;
          return;
        }

        try {
          const outcome = await dependencies.runJob(payload.data.job_id);
          if (outcome === "retryable") {
            await dependencies.delayMessage(
              delivery.msgId,
              retryDelaySeconds(delivery.readCount),
            );
            counts.retryable += 1;
          } else {
            await dependencies.deleteMessage(delivery.msgId);
            counts.completed += 1;
          }
        } catch {
          counts.failed += 1;
        }
      });

      return jsonResponse({ requestId, ...counts }, 200);
    } catch {
      return jsonResponse({ requestId, ...counts }, 500);
    }
  };
}

type RpcClient = {
  rpc: unknown;
};

async function rpc(
  client: RpcClient,
  name: string,
  params: Record<string, unknown>,
) {
  if (typeof client.rpc !== "function") throw new Error("AI_WORKER_RPC_UNAVAILABLE");
  const invoke = client.rpc as (
    targetName: string,
    targetParams: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
  const result = await invoke.call(client, name, params);
  if (result.error) throw new Error("AI_WORKER_RPC_FAILED");
  return result.data;
}

function singleRow(schema: z.ZodType, data: unknown) {
  const parsed = z.array(schema).length(1).safeParse(data);
  if (!parsed.success) throw new Error("AI_WORKER_RPC_MALFORMED");
  return parsed.data[0]!;
}

function namedDefaultSecretKey() {
  const rawKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!rawKeys) return undefined;
  try {
    const keys = JSON.parse(rawKeys) as Record<string, unknown>;
    return typeof keys.default === "string" ? keys.default : undefined;
  } catch {
    return undefined;
  }
}

function requiredEnvironment() {
  const environment = {
    supabaseUrl: Deno.env.get("SUPABASE_URL"),
    secretKey: namedDefaultSecretKey()
      ?? Deno.env.get("SUPABASE_SECRET_KEY")
      ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    deepSeekApiKey: Deno.env.get("DEEPSEEK_API_KEY"),
    userIdPepper: Deno.env.get("AI_USER_ID_PEPPER"),
    triggerToken: Deno.env.get("AI_WORKER_TRIGGER_TOKEN"),
    safeFetchUrl: Deno.env.get("SAFE_FETCH_GATEWAY_URL"),
    safeFetchToken: Deno.env.get("SAFE_FETCH_GATEWAY_TOKEN"),
  };
  if (
    !environment.supabaseUrl
    || !environment.secretKey
    || !environment.deepSeekApiKey
    || !environment.userIdPepper
    || !environment.triggerToken
    || !environment.safeFetchUrl
    || !environment.safeFetchToken
    || environment.userIdPepper.length < 32
    || environment.triggerToken.length < 32
    || environment.safeFetchToken.length < 32
  ) {
    throw new Error("FUNCTION_CONFIGURATION_ERROR");
  }
  return environment as { [Key in keyof typeof environment]: string };
}

async function hmacSha256Hex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createProductionDependencies(): AiWorkerDependencies {
  const environment = requiredEnvironment();
  const client = createClient(environment.supabaseUrl, environment.secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const safeFetch = createSafeFetchClient({
    baseUrl: environment.safeFetchUrl,
    token: environment.safeFetchToken,
  });
  const provider = createDeepSeekProvider({ apiKey: environment.deepSeekApiKey });

  const runnerPorts: AiJobRunnerPorts = {
    async claim(jobId) {
      const data = await rpc(client, "claim_ai_generation_job", { target_job_id: jobId });
      const parsed = z.array(claimedJobSchema).max(1).safeParse(data);
      if (!parsed.success) throw new Error("AI_WORKER_RPC_MALFORMED");
      const row = parsed.data[0];
      return row
        ? {
          id: row.id,
          userId: row.user_id,
          sourceUrl: row.source_url,
          attemptCount: row.attempt_count,
        }
        : null;
    },
    async loadSource(sourceUrl) {
      const fetched = await safeFetch(sourceUrl, AbortSignal.timeout(25_000));
      return extractLearningSource({ html: fetched.body, finalUrl: fetched.finalUrl });
    },
    async begin(jobId) {
      singleRow(
        claimedJobSchema.passthrough(),
        await rpc(client, "begin_ai_generation", { target_job_id: jobId }),
      );
    },
    anonymousUserId(userId) {
      return hmacSha256Hex(environment.userIdPepper, userId);
    },
    generate(input) {
      return provider.generate({ ...input, signal: AbortSignal.timeout(120_000) });
    },
    async complete(input) {
      await rpc(client, "complete_ai_generation_job", {
        target_job_id: input.jobId,
        target_succeeded: true,
        target_attention: input.result.attention,
        target_summary: input.result.summary,
        target_inspiration: input.result.inspiration,
        target_source_title: input.sourceTitle,
        target_warnings: input.result.warnings,
        target_error_code: null,
        target_error_message: null,
        target_provider_call_count: input.providerCallCount,
        target_prompt_tokens: input.usage.promptTokens,
        target_prompt_cache_hit_tokens: input.usage.promptCacheHitTokens,
        target_prompt_cache_miss_tokens: input.usage.promptCacheMissTokens,
        target_completion_tokens: input.usage.completionTokens,
        target_reasoning_tokens: input.usage.reasoningTokens,
        target_model: input.model,
        target_system_fingerprint: input.systemFingerprint,
        target_content_digest: `\\x${input.contentDigestHex}`,
      });
    },
    async markFetchFailure(input) {
      await rpc(client, "mark_ai_generation_fetch_failure", {
        target_job_id: input.jobId,
        target_error_code: input.code,
        target_error_message: input.message,
        target_retryable: input.retryable,
      });
    },
    async markProviderFailure(input) {
      await rpc(client, "mark_ai_generation_provider_failure", {
        target_job_id: input.jobId,
        target_error_code: input.code,
        target_error_message: input.message,
        target_retryable: input.retryable,
        target_provider_call_count: input.providerCallCount,
        target_prompt_tokens: input.usage.promptTokens,
        target_prompt_cache_hit_tokens: input.usage.promptCacheHitTokens,
        target_prompt_cache_miss_tokens: input.usage.promptCacheMissTokens,
        target_completion_tokens: input.usage.completionTokens,
        target_reasoning_tokens: input.usage.reasoningTokens,
      });
    },
  };

  return {
    triggerToken: environment.triggerToken,
    async readMessages() {
      const data = await rpc(client, "read_ai_generation_queue", {
        target_visibility_timeout: QUEUE_VISIBILITY_TIMEOUT_SECONDS,
        target_batch_limit: QUEUE_BATCH_LIMIT,
      });
      const parsed = z.array(queueRowSchema).max(QUEUE_BATCH_LIMIT).safeParse(data);
      if (!parsed.success) throw new Error("AI_WORKER_RPC_MALFORMED");
      return parsed.data.map((row) => ({
        msgId: row.msg_id,
        readCount: row.read_count,
        message: row.message,
      }));
    },
    runJob(jobId) {
      return runAiJob(jobId, runnerPorts);
    },
    async deleteMessage(msgId) {
      const deleted = await rpc(client, "delete_ai_generation_queue_message", {
        target_msg_id: msgId,
      });
      if (deleted !== true) throw new Error("AI_QUEUE_DELETE_FAILED");
    },
    async delayMessage(msgId, delaySeconds) {
      const delayed = await rpc(client, "delay_ai_generation_queue_message", {
        target_msg_id: msgId,
        target_delay_seconds: delaySeconds,
      });
      if (delayed !== true) throw new Error("AI_QUEUE_DELAY_FAILED");
    },
  };
}

const aiGenerationWorkerHandler = {
  fetch(request: Request) {
    try {
      return createWorkerHandler(createProductionDependencies())(request);
    } catch {
      return Promise.resolve(jsonResponse({ ok: false, requestId: crypto.randomUUID() }, 500));
    }
  },
};

export default aiGenerationWorkerHandler;
