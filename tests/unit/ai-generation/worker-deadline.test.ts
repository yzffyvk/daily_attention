// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createProductionDependencies } from "@/supabase/functions/ai-generation-worker/index";

describe("real model request deadlines", () => {
  it.each([
    { dedicatedWorker: true, modelDelay: 200_000, expected: "completed" },
    { dedicatedWorker: true, modelDelay: 350_000, expected: "retryable" },
    { dedicatedWorker: false, modelDelay: 200_000, expected: "retryable" },
  ])("handles a $modelDelay ms model response with dedicated=$dedicatedWorker", async ({ dedicatedWorker, modelDelay, expected }) => {
    vi.useFakeTimers();
    // Native AbortSignal.timeout does not use Vitest's virtual clock.
    vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
      return controller.signal;
    });
    const environment: Record<string, string> = {
      SUPABASE_URL: "https://worker-deadline.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      DEEPSEEK_API_KEY: "test-api-key",
      AI_USER_ID_PEPPER: "pepper-with-at-least-thirty-two-characters",
      AI_WORKER_TRIGGER_TOKEN: "trigger-with-at-least-thirty-two-characters",
      SAFE_FETCH_GATEWAY_URL: "https://safe-fetch.example.com",
      SAFE_FETCH_GATEWAY_TOKEN: "gateway-with-at-least-thirty-two-characters",
    };
    const job = {
      id: "10000000-0000-4000-8000-000000000001",
      user_id: "00000000-0000-4000-8000-000000000001",
      source_url: "https://example.com/long-article",
      attempt_count: 1,
      user_prompt: "解释上下文管理的主要机制",
      prompt_version: "knowledge-skeleton-user-prompt-v1",
    };
    let startModel!: () => void;
    const modelStarted = new Promise<void>(resolve => { startModel = resolve; });
    let visibilitySeconds = 0;
    let completion: Record<string, unknown> | undefined;
    let failure: Record<string, unknown> | undefined;
    let settledAt = 0;
    const startedAt = Date.now();
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/read_ai_generation_queue")) {
        visibilitySeconds = JSON.parse(init!.body as string).target_visibility_timeout;
        return Response.json([]);
      }
      if (url.endsWith("/claim_ai_generation_job") || url.endsWith("/begin_ai_generation")) return Response.json([job]);
      if (url.endsWith("/v1/fetch")) return Response.json({
        finalUrl: job.source_url, contentType: "text/html",
        body: `<html><head><title>上下文管理</title></head><body><article>${"上下文需要保留任务状态与相关事实。".repeat(30)}</article></body></html>`,
      });
      if (url.endsWith("/chat/completions")) {
        startModel();
        await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(init?.signal?.reason); };
          const timer = setTimeout(() => { init?.signal?.removeEventListener("abort", abort); resolve(); }, modelDelay);
          init?.signal?.addEventListener("abort", abort, { once: true });
        });
        return Response.json({
          model: "deepseek-v4-pro",
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ attention: "上下文管理", summary: "长文提炼完成", inspiration: "", sourceTitle: "上下文管理", warnings: [] }) } }],
          usage: { prompt_tokens: 40_000, completion_tokens: 3_000 },
        });
      }
      if (url.endsWith("/complete_ai_generation_job")) {
        completion = JSON.parse(init!.body as string); settledAt = Date.now(); return Response.json([]);
      }
      if (url.endsWith("/mark_ai_generation_provider_failure")) {
        failure = JSON.parse(init!.body as string); settledAt = Date.now(); return Response.json([]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    try {
      const dependencies = createProductionDependencies(name => environment[name], { dedicatedWorker });
      await dependencies.readMessages();
      const work = dependencies.runJob(job.id);
      await modelStarted;
      await vi.advanceTimersByTimeAsync(modelDelay);
      expect(await work).toBe(expected);
      // The queue must not redeliver a task while its model request is still active.
      expect(settledAt - startedAt + 25_000).toBeLessThan(visibilitySeconds * 1000);
      if (expected === "completed") {
        expect(completion).toMatchObject({ target_succeeded: true, target_summary: "长文提炼完成" });
        expect(failure).toBeUndefined();
      } else {
        expect(completion).toBeUndefined();
        expect(failure).toMatchObject({ target_retryable: true, target_error_code: "MODEL_SERVICE_ERROR" });
      }
    } finally {
      vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
    }
  });
});
