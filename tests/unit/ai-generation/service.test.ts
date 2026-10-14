import { describe, expect, it, vi } from "vitest";
import {
  cancelGeneration,
  createGeneration,
  getGeneration,
  toAiGenerationJobData,
} from "@/server/ai/service";
import type { AiGenerationRepository, AiJobWithQuota } from "@/server/ai/repository";

const input = {
  sourceUrl: "https://example.com/article",
  targetDate: "2026-07-31",
  idempotencyKey: "20000000-0000-4000-8000-000000000001",
};

const created = {
  job: {
    id: "10000000-0000-4000-8000-000000000001",
    userId: "00000000-0000-4000-8000-000000000001",
    status: "queued",
  },
  quota: { used: 1, reserved: 1, consumed: 0, limit: 5, remaining: 4 },
} as AiJobWithQuota;

function repository(overrides: Partial<AiGenerationRepository> = {}): AiGenerationRepository {
  return {
    create: vi.fn().mockResolvedValue(created),
    findOwned: vi.fn().mockResolvedValue(created.job),
    cancelOwned: vi.fn().mockResolvedValue({ ...created.job, status: "cancelled" }),
    ...overrides,
  };
}

describe("AI generation service", () => {
  it("keeps server quota settlement and cancellation metadata in the public response", async () => {
    const job = { ...created.job, status: "cancelled" as const, quota: { used: 0, reserved: 0, consumed: 0, limit: 5 as const, remaining: 5 },
      cancellation: { freeRemaining: 1, requiresConfirmation: false, charged: false } };
    const repo = repository({ cancelOwned: vi.fn().mockResolvedValue(job) });
    expect(toAiGenerationJobData(await cancelGeneration(job.userId, job.id, repo, true))).toMatchObject({ quota: job.quota, cancellation: job.cancellation });
    expect(repo.cancelOwned).toHaveBeenCalledWith(job.userId, job.id, true);
  });
  it("exposes retry context without turning an automatic retry into a terminal error", () => {
    const retry = toAiGenerationJobData({
      ...created.job, status: "retryable", attemptCount: 1, errorCode: "MODEL_OUTPUT_INVALID",
    });
    expect(retry.attemptCount).toBe(1);
    expect(retry.retryMessage).toContain("校验");
    expect(retry.error).toBeUndefined();
    const resumed = toAiGenerationJobData({
      ...created.job, status: "generating", attemptCount: 2, errorCode: null,
    });
    expect(resumed.attemptCount).toBe(2);
    expect(resumed.retryMessage).toBeUndefined();
  });
  it("exposes a preview only for an owned job that is still generating", async () => {
    const progress = { phase: "writing" as const, preview: "正文", updatedAt: new Date().toISOString() };
    const job = { ...created.job, status: "generating" as const, progress };
    expect(toAiGenerationJobData(job).progress).toEqual(progress);
    for (const status of ["queued", "fetching", "retryable", "failed", "cancelled"] as const) {
      expect(toAiGenerationJobData({ ...job, status }).progress).toBeUndefined();
    }
    await expect(getGeneration("foreign-user", job.id, repository({ findOwned: vi.fn().mockResolvedValue(null) }))).rejects.toThrow("FORBIDDEN_JOB");
  });
  it("keeps immutable generation metadata separate from editable generated content", () => {
    expect(toAiGenerationJobData({ ...created.job, userPrompt: "聚焦术语", promptVersion: "knowledge-skeleton-user-prompt-v1" }))
      .toMatchObject({ generationContext: { userPrompt: "聚焦术语", promptVersion: "knowledge-skeleton-user-prompt-v1" } });
    expect(toAiGenerationJobData({ ...created.job, promptVersion: "ai-summary-v1" }))
      .toMatchObject({ generationContext: { userPrompt: "", promptVersion: "ai-summary-v1" } });
  });

  it("forwards the normalized per-request prompt when creating a job", async () => {
    const repo = repository();
    await createGeneration(created.job.userId, { ...input, userPrompt: "  聚焦术语  " }, repo);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ userPrompt: "聚焦术语" }));
  });
  it("identifies an unavailable page-reading service in the public task response", () => {
    const result = toAiGenerationJobData({
      ...created.job, status: "failed", errorCode: "FETCH_SERVICE_UNAVAILABLE",
    });
    expect(result.error).toEqual({
      code: "FETCH_SERVICE_UNAVAILABLE",
      message: "网页读取服务暂时不可用，请稍后重试",
      retryable: false,
    });
  });

  it("returns the durable queued job without an external worker trigger", async () => {
    const order: string[] = [];
    const repo = repository({
      create: vi.fn(async () => {
        order.push("persisted");
        return created;
      }),
    });
    await expect(createGeneration(created.job.userId, input, repo))
      .resolves.toBe(created);
    expect(order).toEqual(["persisted"]);
  });

  it("propagates enqueue failure without reporting a successful job", async () => {
    await expect(createGeneration(
      created.job.userId,
      input,
      repository({create: vi.fn().mockRejectedValue(new Error("DB_UNAVAILABLE"))}),
    )).rejects.toThrow("DB_UNAVAILABLE");
  });

  it("does not reveal whether a foreign job exists", async () => {
    await expect(getGeneration(
      created.job.userId,
      created.job.id,
      repository({ findOwned: vi.fn().mockResolvedValue(null) }),
    )).rejects.toThrow("FORBIDDEN_JOB");
  });

  it("maps an illegal database cancellation to the public conflict", async () => {
    const repo = repository({
      cancelOwned: vi.fn().mockRejectedValue(
        { code: "P0001", message: "AI_JOB_INVALID_TRANSITION" },
      ),
    });

    await expect(cancelGeneration(created.job.userId, created.job.id, repo))
      .rejects.toThrow("JOB_ALREADY_STARTED");
  });
});
