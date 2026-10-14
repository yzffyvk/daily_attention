import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  job: { id: jobId, userId, status: "queued", userPrompt: "", promptVersion: "knowledge-skeleton-user-prompt-v1" },
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
  afterEach(() => vi.useRealTimers());
  it("rejects tomorrow before consuming rate limits or creating a job", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T15:59:59Z"));
    const response = await POST(postRequest({ ...requestBody, targetDate: "2026-10-15" }));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR", details: { field: "targetDate" } } });
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
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

  it("creates a queued job with quota without dispatching an Edge Function", async () => {
    const response = await POST(postRequest());

    expect(response.status).toBe(202);
    expect(mocks.create).toHaveBeenCalledWith(userId, { ...requestBody, userPrompt: "" }, {});
    expect(mocks.trigger).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        jobId,
        status: "queued",
        pollAfterMs: 1500,
        quota: result.quota,
        generationContext: { userPrompt: "", promptVersion: "knowledge-skeleton-user-prompt-v1" },
      },
    });
    expect(mocks.consume).toHaveBeenCalledWith(
      "aiGenerate",
      `${userId}:203.0.113.5`,
      {},
    );
    expect(mocks.create).toHaveBeenCalled();
  });

  it("passes the full article URL without its section anchor to job creation", async () => {
    const response = await POST(postRequest({...requestBody, sourceUrl: requestBody.sourceUrl + "#skills"}));
    expect(response.status).toBe(202);
    expect(mocks.create).toHaveBeenCalledWith(userId, { ...requestBody, userPrompt: "" }, {});
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

  it("defaults an empty cancellation body to no quota confirmation", async () => {
    const response = await DELETE(new Request(`https://example.test/api/ai/generations/${jobId}`, { method: "DELETE" }), routeContext());
    expect(response.status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith(userId, jobId, {}, false);
  });

  it("forwards explicit quota confirmation and returns a completion that won the race", async () => {
    mocks.cancel.mockResolvedValue({ status: "succeeded", result: { summary: "已完成" } });
    const response = await DELETE(new Request(`https://example.test/api/ai/generations/${jobId}`, {
      method: "DELETE", body: JSON.stringify({ confirmQuotaConsumption: true }),
    }), routeContext());
    expect(mocks.cancel).toHaveBeenCalledWith(userId, jobId, {}, true);
    await expect(response.json()).resolves.toMatchObject({ ok: true, data: { status: "succeeded" } });
  });

  it.each(['{"confirmQuotaConsumption":"true"}', '{', '{"confirmQuotaConsumption":true,"unexpected":true}', ' '.repeat(513)])("rejects invalid or oversized cancellation body", async body => {
    const response = await DELETE(new Request(`https://example.test/api/ai/generations/${jobId}`, { method: "DELETE", body }), routeContext());
    expect(response.status).toBe(422);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("returns an actionable confirmation conflict when free cancellations are exhausted", async () => {
    mocks.cancel.mockRejectedValue({ code: "P0001", message: "CANCELLATION_CONFIRMATION_REQUIRED" });
    const response = await DELETE(new Request(`https://example.test/api/ai/generations/${jobId}`, { method: "DELETE" }), routeContext());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "CANCELLATION_CONFIRMATION_REQUIRED", message: expect.stringContaining("1 次 AI 额度") } });
  });
});
