import { describe, expect, it, vi } from "vitest";
import { createAiGenerationRepository } from "@/server/ai/repository";

const userId = "00000000-0000-4000-8000-000000000001";
const jobId = "10000000-0000-4000-8000-000000000001";

function rpcJob(overrides: Record<string, unknown> = {}) {
  return {
    id: jobId,
    user_id: userId,
    target_date: "2026-07-31",
    idempotency_key: "20000000-0000-4000-8000-000000000001",
    source_url: "https://example.com/article",
    source_host: "example.com",
    source_title: null,
    status: "queued",
    attempt_count: 0,
    provider_call_count: 0,
    attention: null,
    summary: null,
    inspiration: null,
    warnings: [],
    error_code: null,
    error_message: null,
    provider: "deepseek",
    model: "deepseek-v4-pro",
    thinking_enabled: true,
    reasoning_effort: "high",
    prompt_version: "ai-summary-v1",
    prompt_tokens: null,
    prompt_cache_hit_tokens: null,
    prompt_cache_miss_tokens: null,
    completion_tokens: null,
    reasoning_tokens: null,
    system_fingerprint: null,
    created_at: "2026-07-31T00:00:00.000Z",
    started_at: null,
    finished_at: null,
    result_expires_at: null,
    metadata_expires_at: "2026-10-29T00:00:00.000Z",
    updated_at: "2026-07-31T00:00:00.000Z",
    ...overrides,
  };
}

describe("AI generation repository", () => {
  it("creates a durable job and maps quota counts", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        job: rpcJob(),
        quota_used: 1,
        quota_reserved: 1,
        quota_consumed: 0,
        quota_remaining: 4,
      }],
      error: null,
    });
    const repository = createAiGenerationRepository({ rpc });

    await expect(repository.create({
      userId,
      targetDate: "2026-07-31",
      idempotencyKey: "20000000-0000-4000-8000-000000000001",
      sourceUrl: "https://example.com/article",
      sourceHost: "example.com",
    })).resolves.toMatchObject({
      job: { id: jobId, userId, status: "queued" },
      quota: { used: 1, reserved: 1, consumed: 0, limit: 5, remaining: 4 },
    });
    expect(rpc).toHaveBeenCalledWith("create_ai_generation_job", {
      target_user_id: userId,
      target_date: "2026-07-31",
      target_idempotency_key: "20000000-0000-4000-8000-000000000001",
      target_source_url: "https://example.com/article",
      target_source_host: "example.com",
    });
  });

  it("returns null for an unowned or missing job", async () => {
    const repository = createAiGenerationRepository({
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    await expect(repository.findOwned(userId, jobId)).resolves.toBeNull();
  });

  it("cancels through the ownership-scoped RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        job: rpcJob({ status: "cancelled", finished_at: "2026-07-31T01:00:00.000Z" }),
        quota_used: 0,
        quota_reserved: 0,
        quota_consumed: 0,
        quota_remaining: 5,
      }],
      error: null,
    });
    const repository = createAiGenerationRepository({ rpc });

    await expect(repository.cancelOwned(userId, jobId)).resolves.toMatchObject({
      status: "cancelled",
    });
    expect(rpc).toHaveBeenCalledWith("cancel_ai_generation_job", {
      target_user_id: userId,
      target_job_id: jobId,
    });
  });

  it("fails closed for malformed RPC data", async () => {
    const repository = createAiGenerationRepository({
      rpc: vi.fn().mockResolvedValue({
        data: [{ job: { id: jobId }, quota_used: 1 }],
        error: null,
      }),
    });

    await expect(repository.create({
      userId,
      targetDate: "2026-07-31",
      idempotencyKey: "20000000-0000-4000-8000-000000000001",
      sourceUrl: "https://example.com/article",
      sourceHost: "example.com",
    })).rejects.toThrow("Malformed AI generation RPC response");
  });

  it("preserves stable database errors for the HTTP mapper", async () => {
    const databaseError = { code: "P0001", message: "DAILY_AI_LIMIT_REACHED" };
    const repository = createAiGenerationRepository({
      rpc: vi.fn().mockResolvedValue({ data: null, error: databaseError }),
    });

    await expect(repository.create({
      userId,
      targetDate: "2026-07-31",
      idempotencyKey: "20000000-0000-4000-8000-000000000001",
      sourceUrl: "https://example.com/article",
      sourceHost: "example.com",
    })).rejects.toBe(databaseError);
  });
});
