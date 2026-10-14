import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelAiGeneration,
  createAiGeneration,
  getAiGeneration,
} from "@/features/ai-generation/api";

function success(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data, requestId: "request-id" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("AI generation browser API", () => {
  it("sends quota consumption consent only when the caller explicitly confirms", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(success({ jobId: "job-1", status: "cancelled", stage: "complete" })));
    vi.stubGlobal("fetch", fetchMock);
    await cancelAiGeneration("job-1");
    await cancelAiGeneration("job-1", true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ confirmQuotaConsumption: false });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ confirmQuotaConsumption: true });
  });

  it("sends the caller's stable idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success({
      jobId: "10000000-0000-4000-8000-000000000001",
      status: "queued",
      pollAfterMs: 1500,
      quota: { used: 1, reserved: 1, consumed: 0, limit: 5, remaining: 4 },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await createAiGeneration({
      sourceUrl: "https://example.com/article",
      targetDate: "2026-08-02",
      idempotencyKey: "20000000-0000-4000-8000-000000000001",
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/ai/generations", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        sourceUrl: "https://example.com/article",
        targetDate: "2026-08-02",
        idempotencyKey: "20000000-0000-4000-8000-000000000001",
      }),
    }));
  });

  it("passes abort signals to polling and supports cancellation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(success({ jobId: "job-1", status: "queued", stage: "queued" }))
      .mockResolvedValueOnce(success({ jobId: "job-1", status: "cancelled", stage: "complete" }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await getAiGeneration("job-1", controller.signal);
    await cancelAiGeneration("job-1");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/ai/generations/job-1", expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
    const pollingSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(pollingSignal.aborted).toBe(false);
    controller.abort();
    expect(pollingSignal.aborted).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/ai/generations/job-1", expect.objectContaining({
      method: "DELETE",
    }));
  });
});
