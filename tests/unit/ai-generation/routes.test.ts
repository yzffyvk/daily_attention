import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiJobWithQuota } from "@/server/ai/repository";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  enabled: vi.fn(),
  trigger: vi.fn(),
  consume: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@/server/ai/http", async () => {
  const actual = await vi.importActual<typeof import("@/server/ai/http")>("@/server/ai/http");
  return {
    ...actual,
    createAiRequestContext: mocks.context,
    isAiGenerationEnabled: mocks.enabled,
    triggerAiWorker: mocks.trigger,
  };
});
vi.mock("@/server/rate-limit/service", () => ({ consumeRateLimit: mocks.consume }));
vi.mock("@/server/ai/service", () => ({
  createGeneration: mocks.create,
  getGeneration: mocks.get,
  cancelGeneration: mocks.cancel,
  toAiGenerationJobData: (job: unknown) => job,
}));

import { POST } from "@/app/api/ai/generations/route";
import { DELETE, GET } from "@/app/api/ai/generations/[jobId]/route";

const userId = "00000000-0000-4000-8000-000000000001";
const jobId = "10000000-0000-4000-8000-000000000001";
const requestBody = {
  sourceUrl: "https://example.com/article",
  targetDate: "2026-07-31",
  idempotencyKey: "20000000-0000-4000-8000-000000000001",
};
const result = {
  job: { id: jobId, userId, status: "queued" },
  quota: { used: 1, reserved: 1, consumed: 0, limit: 5, remaining: 4 },
} as AiJobWithQuota;

function postRequest(body: unknown = requestBody) {
  return new Request("https://example.test/api/ai/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.5",
    },
    body: JSON.stringify(body),
  });
}

function routeContext(id = jobId) {
  return { params: Promise.resolve({ jobId: id }) };
}

describe("AI generation routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue({ userId, admin: {}, repository: {} });
    mocks.enabled.mockReturnValue(true);
    mocks.create.mockResolvedValue(result);
    mocks.get.mockResolvedValue(result.job);
    mocks.cancel.mockResolvedValue({ ...result.job, status: "cancelled" });
  });

  it.each([
    ["POST", () => POST(postRequest())],
    ["GET", () => GET(new Request(`https://example.test/api/ai/generations/${jobId}`), routeContext())],
    ["DELETE", () => DELETE(new Request(`https://example.test/api/ai/generations/${jobId}`, { method: "DELETE" }), routeContext())],
  ])("returns 401 for unauthenticated %s", async (_method, invoke) => {
    mocks.context.mockResolvedValue(null);
    const response = await invoke();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SESSION_EXPIRED" },
    });
  });

  it("returns a default-disabled feature response", async () => {
    mocks.enabled.mockReturnValue(false);

    const response = await POST(postRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FEATURE_DISABLED" },
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("creates a queued job with quota and triggers the worker", async () => {
    const response = await POST(postRequest());

    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        jobId,
        status: "queued",
        pollAfterMs: 1500,
        quota: result.quota,
      },
    });
    expect(mocks.consume).toHaveBeenCalledWith(
      "aiGenerate",
      `${userId}:203.0.113.5`,
      {},
    );
    expect(mocks.create).toHaveBeenCalled();
  });

  it("maps the daily quota error without leaking database details", async () => {
    mocks.create.mockRejectedValue({
      code: "P0001",
      message: "DAILY_AI_LIMIT_REACHED",
      details: "private.ai_daily_quotas",
    });

    const response = await POST(postRequest());
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error.code).toBe("DAILY_AI_LIMIT_REACHED");
    expect(JSON.stringify(body)).not.toContain("ai_daily_quotas");
  });

  it("returns a foreign job as 403 and rejects cancellation after start", async () => {
    mocks.get.mockRejectedValue(new Error("FORBIDDEN_JOB"));
    const foreign = await GET(
      new Request(`https://example.test/api/ai/generations/${jobId}`),
      routeContext(),
    );
    expect(foreign.status).toBe(403);

    mocks.cancel.mockRejectedValue(new Error("JOB_ALREADY_STARTED"));
    const started = await DELETE(
      new Request(`https://example.test/api/ai/generations/${jobId}`, { method: "DELETE" }),
      routeContext(),
    );
    expect(started.status).toBe(409);
  });
});
