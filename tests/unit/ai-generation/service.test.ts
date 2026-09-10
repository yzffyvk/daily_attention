import { describe, expect, it, vi } from "vitest";
import {
  cancelGeneration,
  createGeneration,
  getGeneration,
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
