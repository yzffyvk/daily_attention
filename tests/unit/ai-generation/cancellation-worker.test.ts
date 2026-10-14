import { afterEach, describe, expect, it, vi } from "vitest";
import { createProductionDependencies } from "@/supabase/functions/ai-generation-worker/index";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const job = { id: "10000000-0000-4000-8000-000000000976", user_id: "00000000-0000-4000-8000-000000000976",
  source_url: "https://example.com/cancel", attempt_count: 1, user_prompt: "", prompt_version: "knowledge-skeleton-user-prompt-v1" };
const environment: Record<string, string> = {
  SUPABASE_URL: "https://cancel-test.supabase.co", SUPABASE_SECRET_KEY: "test-key", DEEPSEEK_API_KEY: "test-key",
  AI_USER_ID_PEPPER: "p".repeat(32), SAFE_FETCH_GATEWAY_URL: "https://gateway.example.com", SAFE_FETCH_GATEWAY_TOKEN: "t".repeat(32),
};

describe("production worker cancellation wiring", () => {
  it.each(["source", "model"])("aborts the actual %s HTTP request and writes no result or failure", async stage => {
    vi.useFakeTimers();
    let cancelled = false;
    let heldSignal: AbortSignal | null = null;
    const calls: string[] = [];
    const abortedRequest = (signal: AbortSignal) => {
      heldSignal = signal;
      return new Promise<Response>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    };
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/claim_ai_generation_job") || url.endsWith("/begin_ai_generation")) return Response.json([job]);
      if (url.endsWith("/read_ai_generation_job_execution_status")) return Response.json(cancelled ? "cancelled" : "generating");
      if (url.endsWith("/report_ai_generation_progress")) return Response.json(true);
      if (url.endsWith("/v1/fetch")) {
        if (stage === "source") return abortedRequest(init!.signal!);
        return Response.json({ finalUrl: job.source_url, contentType: "text/html",
          body: `<article><h1>资料</h1><p>${"这是可供学习的公开资料正文，重点保留知识框架。".repeat(30)}</p></article>` });
      }
      if (url.endsWith("/chat/completions")) return abortedRequest(init!.signal!);
      throw new Error(`Unexpected request ${url}`);
    });
    const dependencies = createProductionDependencies(key => environment[key], { dedicatedWorker: true });
    const running = dependencies.runJob(job.id);
    // Drain source parsing/HMAC microtasks until the selected HTTP request starts.
    for (let attempt = 0; attempt < 20 && !heldSignal; attempt++) await vi.advanceTimersByTimeAsync(0);
    expect(heldSignal).not.toBeNull();
    cancelled = true;
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(running).resolves.toBe("ignored");
    expect((heldSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(calls.filter(url => /complete_ai_generation_job|mark_ai_generation_.*failure/u.test(url))).toEqual([]);
    if (stage === "source") expect(calls.some(url => url.endsWith("/begin_ai_generation"))).toBe(false);
  });
});
