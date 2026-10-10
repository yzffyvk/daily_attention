// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readWorkerScope } from "../../../services/ai-worker/scoped-worker.ts";
import { createProductionDependencies } from "../../../supabase/functions/ai-generation-worker/index.ts";

const scope = { userId: "11111111-1111-4111-8111-111111111111", createdAfter: "2026-09-27T11:38:00Z" };
const job = { msg_id: 1, read_count: 1, message: { job_id: "22222222-2222-4222-8222-222222222222" }, user_id: scope.userId, created_at: "2026-09-27T11:38:07Z" };
const environment: Record<string, string> = {
  NODE_ENV: "development", SUPABASE_URL: "https://scope-test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-key", DEEPSEEK_API_KEY: "test-key",
  AI_USER_ID_PEPPER: "pepper-with-at-least-thirty-two-characters", SAFE_FETCH_GATEWAY_URL: "https://gateway.example.com", SAFE_FETCH_GATEWAY_TOKEN: "token-with-at-least-thirty-two-characters",
};

describe("account scoped local worker", () => {
  it("keeps the existing deployment mode only when no scope was supplied", () => {
    expect(readWorkerScope(() => undefined)).toBeNull();
  });
  it.each([
    { AI_WORKER_USER_ID: scope.userId },
    { AI_WORKER_CREATED_AFTER: scope.createdAfter },
    { AI_WORKER_USER_ID: "", AI_WORKER_CREATED_AFTER: scope.createdAfter },
    { AI_WORKER_USER_ID: scope.userId, AI_WORKER_CREATED_AFTER: "invalid", NODE_ENV: "development" },
    { AI_WORKER_USER_ID: scope.userId, AI_WORKER_CREATED_AFTER: scope.createdAfter, NODE_ENV: "production" },
  ])("fails closed for incomplete/invalid local scope: %j", (env) => {
    expect(() => readWorkerScope((key) => (env as Record<string, string>)[key])).toThrow("AI_WORKER_SCOPE_INVALID");
  });
  it("accepts a complete local scope", () => {
    const env: Record<string, string> = { NODE_ENV: "development", AI_WORKER_USER_ID: scope.userId, AI_WORKER_CREATED_AFTER: scope.createdAfter };
    expect(readWorkerScope((key) => env[key])).toEqual(scope);
  });
  it("leases only the account scoped queue with the normal long-request lease", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json([job]));
    vi.stubGlobal("fetch", fetcher);
    try {
      const worker = createProductionDependencies(key => environment[key], { dedicatedWorker: true, scope });
      expect(await worker.readMessages()).toEqual([{ msgId: 1, readCount: 1, message: job.message }]);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(String(fetcher.mock.calls[0][0])).toContain("/read_owned_ai_generation_queue");
      expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ target_user_id: scope.userId, target_created_after: scope.createdAfter, target_visibility_timeout: 600, target_batch_limit: 2 });
    } finally { vi.unstubAllGlobals(); }
  });
  it.each([
    { ...job, user_id: "33333333-3333-4333-8333-333333333333" },
    { ...job, created_at: "2026-09-26T00:00:00Z" },
  ])("refuses the entire batch if a returned row is out of scope", async (invalidJob) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([job, invalidJob])));
    try {
      const worker = createProductionDependencies(key => environment[key], { dedicatedWorker: true, scope });
      await expect(worker.readMessages()).rejects.toThrow("AI_WORKER_SCOPE_MISMATCH");
    } finally { vi.unstubAllGlobals(); }
  });
});
