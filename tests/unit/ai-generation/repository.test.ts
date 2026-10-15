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

function rpcState(overrides: Record<string, unknown> = {}) {
  return { job: rpcJob(overrides), quota: { used: 1, reserved: 0, consumed: 1, limit: 5, remaining: 4 },
    cancellation: { freeRemaining: 0, requiresConfirmation: true, charged: null } };
}

describe("AI generation repository", () => {
  it('reads a successful draft with all source notices and review findings intact', async () => {
    const warnings = Array.from({ length: 23 }, (_, i) => `待核对：提醒${i}`);
    const rpc = vi.fn().mockResolvedValue({ data: rpcState({ status: 'succeeded', summary: '可读学习草稿', warnings }), error: null });
    await expect(createAiGenerationRepository({ rpc }).findOwned(userId, jobId)).resolves.toMatchObject({ warnings, summary: '可读学习草稿' });
  });
  it("binds creation and returned state to the exact record and content version", async () => {
    const recordId = "00000000-0000-4000-8000-000000000099";
    const rpc = vi.fn().mockResolvedValue({ data: [{
      job: rpcJob({ record_id: recordId, base_version: 7 }),
      quota_used: 1, quota_reserved: 1, quota_consumed: 0, quota_remaining: 4,
    }], error: null });
    const result = await createAiGenerationRepository({ rpc }).create({
      userId, recordId, targetDate: "2026-07-31", idempotencyKey: "20000000-0000-4000-8000-000000000001",
      sourceUrl: "https://example.com/article", sourceHost: "example.com",
    });
    expect(result.job).toMatchObject({ recordId, baseVersion: 7 });
    expect(rpc).toHaveBeenCalledWith("create_record_ai_generation_job", expect.objectContaining({ target_record_id: recordId }));
  });
  it("reads a completed long summary without dropping the generated result", async () => {
    const summary = '知'.repeat(30000);
    const rpc = vi.fn().mockResolvedValue({ data: rpcState({ status: 'succeeded', summary }), error: null });
    const repository = createAiGenerationRepository({ rpc });
    await expect(repository.findOwned(userId, jobId)).resolves.toMatchObject({ summary });
  });
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
      target_user_prompt: "",
    });
  });

  it("snapshots the trimmed user prompt and reads it with the stored version", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{
      job: rpcJob({ user_prompt: "聚焦实现细节", prompt_version: "knowledge-skeleton-user-prompt-v1" }),
      quota_used: 1, quota_reserved: 1, quota_consumed: 0, quota_remaining: 4,
    }], error: null });
    const repository = createAiGenerationRepository({ rpc });
    const created = await repository.create({
      userId, targetDate: "2026-07-31", idempotencyKey: "20000000-0000-4000-8000-000000000001",
      sourceUrl: "https://example.com/article", sourceHost: "example.com", userPrompt: "  聚焦实现细节  ",
    });
    expect(created.job).toMatchObject({ userPrompt: "聚焦实现细节", promptVersion: "knowledge-skeleton-user-prompt-v1" });
    expect(rpc.mock.calls[0][1].target_user_prompt).toBe("聚焦实现细节");
  });

  it("normalizes a legacy job without a stored user prompt to an empty prompt", async () => {
    const repository = createAiGenerationRepository({ rpc: async () => ({ data: rpcState(), error: null }) });
    expect(await repository.findOwned(userId, jobId)).toMatchObject({ userPrompt: "", promptVersion: "ai-summary-v1" });
  });

  it("returns null for an unowned or missing job", async () => {
    const repository = createAiGenerationRepository({
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    await expect(repository.findOwned(userId, jobId)).resolves.toBeNull();
  });

  it("cancels through the ownership-scoped RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...rpcState({ status: "cancelled", finished_at: "2026-07-31T01:00:00.000Z" }),
        quota: { used: 0, reserved: 0, consumed: 0, limit: 5, remaining: 5 },
        cancellation: { freeRemaining: 1, requiresConfirmation: false, charged: false } },
      error: null,
    });
    const repository = createAiGenerationRepository({ rpc });

    await expect(repository.cancelOwned(userId, jobId)).resolves.toMatchObject({
      status: "cancelled",
      quota: { remaining: 5 },
      cancellation: { freeRemaining: 1, charged: false },
    });
    expect(rpc).toHaveBeenCalledWith("cancel_ai_generation_job_v2", {
      target_user_id: userId,
      target_job_id: jobId,
      target_confirm_quota_consumption: false,
    });
  });

  it("reads the server cancellation policy and explicitly forwards paid confirmation", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: rpcState({ status: "generating" }), error: null });
    const repository = createAiGenerationRepository({ rpc });
    await expect(repository.findOwned(userId, jobId)).resolves.toMatchObject({
      cancellation: { freeRemaining: 0, requiresConfirmation: true }, quota: { remaining: 4 },
    });
    expect(rpc).toHaveBeenCalledWith("read_ai_generation_job_state", { target_user_id: userId, target_job_id: jobId });
    await repository.cancelOwned(userId, jobId, true);
    expect(rpc).toHaveBeenLastCalledWith("cancel_ai_generation_job_v2", {
      target_user_id: userId, target_job_id: jobId, target_confirm_quota_consumption: true,
    });
  });

  it("rejects inconsistent quota in cancellation responses", async () => {
    const repository = createAiGenerationRepository({ rpc: async () => ({
      data: { ...rpcState(), quota: { used: 1, reserved: 0, consumed: 1, limit: 5, remaining: 5 } }, error: null,
    }) });
    await expect(repository.cancelOwned(userId, jobId)).rejects.toThrow("Malformed AI generation RPC response");
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
