import { describe, expect, it, vi } from "vitest";
import {
  assertAiProviderModeAllowed,
  createProductionDependencies,
  createWorkerHandler,
  default as aiGenerationWorkerHandler,
  type AiWorkerDependencies,
} from "@/supabase/functions/ai-generation-worker/index";

const token = "worker-trigger-token-with-at-least-32-characters";

function request(authorization?: string) {
  return new Request("http://localhost/functions/v1/ai-generation-worker", {
    method: "POST",
    headers: authorization ? { Authorization: authorization } : {},
  });
}

function handlerWithCapturedTask(dependencies: AiWorkerDependencies) {
  let task: Promise<void> | null = null;
  const handler = createWorkerHandler(dependencies, (scheduled) => {
    task = scheduled;
  });
  return {
    handler,
    scheduledTask() {
      if (!task) throw new Error("Expected the queue batch to be scheduled");
      return task;
    },
  };
}

describe("AI generation queue worker", () => {
  it.each([
    { dedicatedWorker: false, userPrompt: "重点解释适用边界" },
    { dedicatedWorker: true, userPrompt: "重点解释适用边界" },
    { dedicatedWorker: false, userPrompt: "" },
    { dedicatedWorker: true, userPrompt: "" },
  ])("maps the immutable RPC prompt/version through the production worker (dedicated=$dedicatedWorker, prompt=$userPrompt)", async ({ dedicatedWorker, userPrompt }) => {
    const modelRequests: { messages: { content: string }[] }[] = [];
    const persisted: Record<string, unknown>[] = [];
    const jobRow = {
      id: "10000000-0000-4000-8000-000000000001",
      user_id: "00000000-0000-4000-8000-000000000001",
      source_url: "https://example.com/article",
      attempt_count: 1,
      user_prompt: userPrompt,
      prompt_version: "knowledge-skeleton-user-prompt-v1",
    };
    const environment: Record<string, string> = {
      SUPABASE_URL: `https://project-${dedicatedWorker ? "node" : "edge"}-${userPrompt ? "prompt" : "empty"}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      DEEPSEEK_API_KEY: "deepseek-test-api-key",
      AI_USER_ID_PEPPER: "pepper-with-at-least-thirty-two-characters",
      AI_WORKER_TRIGGER_TOKEN: token,
      SAFE_FETCH_GATEWAY_URL: "https://safe-fetch.example.com",
      SAFE_FETCH_GATEWAY_TOKEN: "gateway-token-with-at-least-thirty-two-characters",
    };
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/read_ai_generation_job_execution_status")) return Response.json("generating");
      if (url.endsWith("/claim_ai_generation_job") || url.endsWith("/begin_ai_generation")) {
        return Response.json([jobRow]);
      }
      if (url.endsWith("/v1/fetch")) {
        return Response.json({
          finalUrl: jobRow.source_url,
          contentType: "text/html",
          body: `<html><head><title>示例资料</title></head><body><article><p>${"注意力机制通过查询、键和值计算相关性。".repeat(20)}</p></article></body></html>`,
        });
      }
      if (url.endsWith("/chat/completions")) {
        modelRequests.push(JSON.parse(init!.body as string));
        return Response.json({
          model: "deepseek-v4-pro",
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
            attention: "注意力机制", summary: "示例知识小结", inspiration: "", sourceTitle: "示例资料", warnings: [],
          }) } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        });
      }
      if (url.endsWith("/complete_ai_generation_job")) {
        persisted.push(JSON.parse(init!.body as string));
        return Response.json([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    try {
      const dependencies = createProductionDependencies((name) => environment[name], { dedicatedWorker });
      await expect(dependencies.runJob(jobRow.id)).resolves.toBe("completed");
      expect(modelRequests).toHaveLength(1);
      expect(JSON.parse(modelRequests[0]!.messages[1]!.content)).toMatchObject({
        userRequirements: userPrompt,
        source: { dataType: "untrusted_web_source", title: "示例资料" },
      });
      expect(persisted).toHaveLength(1);
      expect(persisted[0]).toMatchObject({ target_succeeded: true, target_provider_call_count: 1 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("acknowledges before the scheduled queue batch completes", async () => {
    let releaseJob!: () => void;
    const jobGate = new Promise<void>((resolve) => {
      releaseJob = resolve;
    });
    const runJob = vi.fn(async () => {
      await jobGate;
      return "completed" as const;
    });
    const captured = handlerWithCapturedTask({
      triggerToken: token,
      readMessages: vi.fn().mockResolvedValue([{
        msgId: 1,
        readCount: 1,
        message: { job_id: "10000000-0000-4000-8000-000000000001" },
      }]),
      runJob,
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      delayMessage: vi.fn(),
    });

    const responsePromise = captured.handler(request(`Bearer ${token}`));
    const firstResult = await Promise.race([
      responsePromise.then((response) => ({ kind: "response" as const, response })),
      new Promise<{ kind: "pending" }>((resolve) => {
        setTimeout(() => resolve({ kind: "pending" }), 20);
      }),
    ]);
    releaseJob();
    const response = await responsePromise;

    expect(firstResult.kind).toBe("response");
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      requestId: expect.any(String),
    });
    expect(captured.scheduledTask()).toBeInstanceOf(Promise);
    await captured.scheduledTask();
    expect(runJob).toHaveBeenCalledTimes(1);
  });

  it("rechecks the queue when the enqueue transaction is not visible immediately", async () => {
    vi.useFakeTimers();
    try {
      const readMessages = vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          msgId: 1,
          readCount: 1,
          message: { job_id: "10000000-0000-4000-8000-000000000001" },
        }]);
      const runJob = vi.fn().mockResolvedValue("completed");
      const captured = handlerWithCapturedTask({
        triggerToken: token,
        readMessages,
        runJob,
        deleteMessage: vi.fn().mockResolvedValue(undefined),
        delayMessage: vi.fn(),
      });

      const response = await captured.handler(request(`Bearer ${token}`));
      await vi.advanceTimersByTimeAsync(100);
      await captured.scheduledTask();

      expect(response.status).toBe(202);
      expect(readMessages).toHaveBeenCalledTimes(2);
      expect(runJob).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects fake provider mode outside explicit test bindings", () => {
    expect(() => assertAiProviderModeAllowed({ mode: "fake" }))
      .toThrow("FUNCTION_CONFIGURATION_ERROR");
    expect(() => assertAiProviderModeAllowed({
      mode: "fake",
      integrationTestBindings: "true",
    })).not.toThrow();
  });

  it("fails closed when production worker secrets are missing", async () => {
    vi.stubGlobal("Deno", { env: { get: vi.fn(() => undefined) } });

    const response = await aiGenerationWorkerHandler.fetch(
      request(`Bearer ${token}`),
    );

    expect(response.status).toBe(500);
    vi.unstubAllGlobals();
  });

  it.each([undefined, "Bearer wrong-token"])(
    "rejects missing or invalid trigger auth before reading the queue",
    async (authorization) => {
      const readMessages = vi.fn();
      const scheduleTask = vi.fn();
      const handler = createWorkerHandler({
        triggerToken: token,
        readMessages,
        runJob: vi.fn(),
        deleteMessage: vi.fn(),
        delayMessage: vi.fn(),
      }, scheduleTask);

      const response = await handler(request(authorization));

      expect(response.status).toBe(401);
      expect(readMessages).not.toHaveBeenCalled();
      expect(scheduleTask).not.toHaveBeenCalled();
    },
  );

  it("processes at most five messages with concurrency two", async () => {
    let active = 0;
    let maximumActive = 0;
    const runJob = vi.fn(async (jobId: string) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (jobId.endsWith("1")) return "completed" as const;
      if (jobId.endsWith("2")) return "ignored" as const;
      return "retryable" as const;
    });
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    const delayMessage = vi.fn().mockResolvedValue(undefined);
    const messages = Array.from({ length: 6 }, (_, index) => ({
      msgId: index + 1,
      readCount: index + 1,
      message: { job_id: `10000000-0000-4000-8000-00000000000${index + 1}` },
    }));
    const captured = handlerWithCapturedTask({
      triggerToken: token,
      readMessages: vi.fn().mockResolvedValue(messages),
      runJob,
      deleteMessage,
      delayMessage,
    });

    const response = await captured.handler(request(`Bearer ${token}`));
    await captured.scheduledTask();

    expect(response.status).toBe(202);
    expect(maximumActive).toBe(2);
    expect(runJob).toHaveBeenCalledTimes(5);
    expect(deleteMessage).toHaveBeenCalledTimes(2);
    expect(delayMessage).toHaveBeenCalledTimes(3);
    expect(delayMessage).toHaveBeenCalledWith(3, 120);
  });

  it("deletes malformed messages without exposing processing failures", async () => {
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    const captured = handlerWithCapturedTask({
      triggerToken: token,
      readMessages: vi.fn().mockResolvedValue([
        { msgId: 1, readCount: 1, message: { sourceUrl: "private" } },
        { msgId: 2, readCount: 1, message: { job_id: "10000000-0000-4000-8000-000000000002" } },
      ]),
      runJob: vi.fn().mockRejectedValue(new Error("internal raw body")),
      deleteMessage,
      delayMessage: vi.fn(),
    });

    const response = await captured.handler(request(`Bearer ${token}`));
    const body = await response.json();
    await captured.scheduledTask();

    expect(response.status).toBe(202);
    expect(deleteMessage).toHaveBeenCalledWith(1);
    expect(body).toMatchObject({ accepted: true, requestId: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain("raw body");
  });

  it("isolates a malformed-message deletion failure from the rest of the batch", async () => {
    const runJob = vi.fn().mockResolvedValue("completed");
    const captured = handlerWithCapturedTask({
      triggerToken: token,
      readMessages: vi.fn().mockResolvedValue([
        { msgId: 1, readCount: 1, message: {} },
        { msgId: 2, readCount: 1, message: { job_id: "10000000-0000-4000-8000-000000000002" } },
      ]),
      runJob,
      deleteMessage: vi.fn(async (msgId: number) => {
        if (msgId === 1) throw new Error("queue unavailable");
      }),
      delayMessage: vi.fn(),
    });

    const response = await captured.handler(request(`Bearer ${token}`));
    await expect(captured.scheduledTask()).resolves.toBeUndefined();

    expect(response.status).toBe(202);
    expect(runJob).toHaveBeenCalledTimes(1);
  });
});
