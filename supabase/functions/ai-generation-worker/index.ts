import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AI_LEGACY_PROMPT_VERSION } from "../_shared/ai/contracts.ts";
import { createDeepSeekProvider } from "../_shared/ai/deepseek.ts";
import { extractLearningSource } from "../_shared/ai/extract.ts";
import {
  runAiJob,
  type AiJobRunResult,
  type AiJobRunnerPorts,
} from "../_shared/ai/runner.ts";
import { createSafeFetchClient } from "../_shared/ai/safe-fetch-client.ts";
import { dedicatedAiTiming } from "../_shared/ai/timeouts.ts";
import { sourceDownloadUrl } from "../_shared/ai/source-url.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
};

declare const EdgeRuntime: {
  waitUntil(task: Promise<unknown>): void;
};

const QUEUE_BATCH_LIMIT = 5;
const QUEUE_VISIBILITY_TIMEOUT_SECONDS = 180;
const QUEUE_VISIBILITY_GRACE_MS = 100;
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

export type BackgroundTaskScheduler = (task: Promise<void>) => void;

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
  user_prompt: z.string().trim().max(1000).default(""),
  prompt_version: z.string().min(1).max(40).default(AI_LEGACY_PROMPT_VERSION),
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

export async function processQueueBatch(dependencies: AiWorkerDependencies) {
  let messages = await dependencies.readMessages();
  if (messages.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, QUEUE_VISIBILITY_GRACE_MS));
    messages = await dependencies.readMessages();
  }
  messages = messages.slice(0, QUEUE_BATCH_LIMIT);
  await mapWithConcurrency(messages, WORKER_CONCURRENCY, async (delivery) => {
    const payload = jobPayloadSchema.safeParse(delivery.message);
    if (!payload.success) {
      try {
        await dependencies.deleteMessage(delivery.msgId);
      } catch {
        // The message becomes visible again; keep processing the batch.
      }
      return;
    }

    try {
      const outcome = await dependencies.runJob(payload.data.job_id);
      if (outcome === "retryable") {
        await dependencies.delayMessage(
          delivery.msgId,
          retryDelaySeconds(delivery.readCount),
        );
      } else {
        await dependencies.deleteMessage(delivery.msgId);
      }
    } catch {
      // Keep processing the rest of the batch. The message becomes visible again.
    }
  });
}

export function createWorkerHandler(
  dependencies: AiWorkerDependencies,
  scheduleTask: BackgroundTaskScheduler,
) {
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

    scheduleTask(processQueueBatch(dependencies));
    return jsonResponse({ accepted: true, requestId }, 202);
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

type ReadEnvironment = (name: string) => string | undefined;

import { assertAiProviderModeAllowed, readSupabaseWorkerKey } from "../_shared/ai/environment.ts";
export { assertAiProviderModeAllowed } from "../_shared/ai/environment.ts";

function requiredEnvironment(readEnvironment: ReadEnvironment, requireTriggerToken: boolean) {
  const environment = {
    supabaseUrl: readEnvironment("SUPABASE_URL") ?? readEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    secretKey: readSupabaseWorkerKey(readEnvironment),
    deepSeekApiKey: readEnvironment("DEEPSEEK_API_KEY"),
    userIdPepper: readEnvironment("AI_USER_ID_PEPPER"),
    triggerToken: readEnvironment("AI_WORKER_TRIGGER_TOKEN") ?? "",
    safeFetchUrl: readEnvironment("SAFE_FETCH_GATEWAY_URL"),
    safeFetchToken: readEnvironment("SAFE_FETCH_GATEWAY_TOKEN"),
    providerMode: readEnvironment("AI_PROVIDER_MODE") ?? "deepseek",
  };
  assertAiProviderModeAllowed({
    mode: environment.providerMode,
    nodeEnv: readEnvironment("NODE_ENV"),
    integrationTestBindings: readEnvironment("INTEGRATION_TEST_BINDINGS"),
  });
  if (
    !environment.supabaseUrl
    || !environment.secretKey
    || (environment.providerMode === "deepseek" && !environment.deepSeekApiKey)
    || !environment.userIdPepper
    || !environment.safeFetchUrl
    || !environment.safeFetchToken
    || environment.userIdPepper.length < 32
    || (requireTriggerToken && environment.triggerToken.length < 32)
    || environment.safeFetchToken.length < 32
  ) {
    throw new Error("FUNCTION_CONFIGURATION_ERROR");
  }
  return {
    ...environment,
    deepSeekApiKey: environment.deepSeekApiKey ?? "",
  } as { [Key in keyof typeof environment]: string };
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

export function createProductionDependencies(
  readEnvironment: ReadEnvironment = (name) => Deno.env.get(name),
  options: { dedicatedWorker?: boolean; scope?: { userId: string; createdAfter: string } | null } = {},
): AiWorkerDependencies {
  const environment = requiredEnvironment(readEnvironment, !options.dedicatedWorker);
  const client = createClient(environment.supabaseUrl, environment.secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { fetch: (input, init) => fetch(input, {
      ...init, signal: AbortSignal.timeout(10_000),
    }) },
  });
  const safeFetch = createSafeFetchClient({
    baseUrl: environment.safeFetchUrl,
    token: environment.safeFetchToken,
    allowLoopbackHttp: options.dedicatedWorker === true
      && readEnvironment("NODE_ENV") === "development",
  });
  const provider = environment.providerMode === "fake"
    ? {
      async generate(input: { sourceTitle: string }) {
        return {
          result: {
            attention: `已整理：${input.sourceTitle}`.slice(0, 120),
            summary: "这是测试环境生成的确定性知识小结。",
            inspiration: "请在保存前继续补充自己的理解。",
            sourceTitle: input.sourceTitle,
            warnings: ["测试环境结果"],
          },
          usage: {
            promptTokens: 0,
            promptCacheHitTokens: 0,
            promptCacheMissTokens: 0,
            completionTokens: 0,
            reasoningTokens: 0,
          },
          providerCallCount: 1,
          model: "fake-ai-provider",
          systemFingerprint: null,
        };
      },
    }
    : createDeepSeekProvider({ apiKey: environment.deepSeekApiKey });

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
          userPrompt: row.user_prompt,
          promptVersion: row.prompt_version,
        }
        : null;
    },
    async loadSource(sourceUrl) {
      const fetched = await safeFetch(sourceDownloadUrl(sourceUrl), AbortSignal.timeout(25_000));
      return extractLearningSource({ html: fetched.body, finalUrl: fetched.finalUrl, contentType: fetched.contentType });
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
      const timeoutMs = options.dedicatedWorker ? dedicatedAiTiming.modelTimeoutMs : 120_000;
      return provider.generate({ ...input, signal: AbortSignal.timeout(timeoutMs) });
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
      const data = await rpc(client, options.scope ? "read_owned_ai_generation_queue" : "read_ai_generation_queue", {
        ...(options.scope ? { target_user_id: options.scope.userId, target_created_after: options.scope.createdAfter } : {}),
        target_visibility_timeout: options.dedicatedWorker
          ? dedicatedAiTiming.queueVisibilitySeconds
          : QUEUE_VISIBILITY_TIMEOUT_SECONDS,
        // Dedicated workers claim only as many deliveries as can start immediately.
        target_batch_limit: options.dedicatedWorker ? WORKER_CONCURRENCY : QUEUE_BATCH_LIMIT,
      });
      if (options.scope) {
        const scoped = z.array(queueRowSchema.extend({ user_id: z.uuid(), created_at: z.iso.datetime({ offset: true }) })).max(WORKER_CONCURRENCY).safeParse(data);
        if (!scoped.success || scoped.data.some(row => row.user_id !== options.scope!.userId
          || Date.parse(row.created_at) < Date.parse(options.scope!.createdAfter))) {
          throw new Error("AI_WORKER_SCOPE_MISMATCH");
        }
      }
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
      return createWorkerHandler(
        createProductionDependencies(),
        (task) => EdgeRuntime.waitUntil(task),
      )(request);
    } catch {
      return Promise.resolve(jsonResponse({ ok: false, requestId: crypto.randomUUID() }, 500));
    }
  },
};

export default aiGenerationWorkerHandler;
