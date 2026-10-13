import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiGeneration } from "@/features/ai-generation/use-ai-generation";
import {
  cancelAiGeneration,
  createAiGeneration,
  getAiGeneration,
} from "@/features/ai-generation/api";

vi.mock("@/features/ai-generation/api", () => ({
  createAiGeneration: vi.fn(),
  getAiGeneration: vi.fn(),
  cancelAiGeneration: vi.fn(),
}));

const created = {
  jobId: "10000000-0000-4000-8000-000000000001",
  status: "queued" as const,
  pollAfterMs: 1500,
  quota: { used: 1, reserved: 1, consumed: 0, limit: 5 as const, remaining: 4 },
};

const result = {
  attention: "理解注意力机制",
  summary: "结构化知识小结",
  inspiration: "比较不同架构",
  sourceTitle: "示例资料",
  warnings: [],
};

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  vi.mocked(createAiGeneration).mockReset();
  vi.mocked(getAiGeneration).mockReset();
  vi.mocked(cancelAiGeneration).mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function options(overrides: Record<string, unknown> = {}) {
  return {
    activeJob: null,
    onActiveJobChange: vi.fn(),
    onSucceeded: vi.fn(),
    onTerminal: vi.fn(),
    ...overrides,
  };
}

describe("useAiGeneration", () => {
  it("keeps partial output separate from the draft and polls long generations every second", async () => {
    const activeJob = { jobId: created.jobId, targetDate: "2026-10-13", sourceUrl: "https://example.com", createdAt: new Date(Date.now() - 130_000).toISOString() };
    const progress = { phase: "writing" as const, preview: "正在生成的正文", updatedAt: new Date().toISOString() };
    vi.mocked(getAiGeneration).mockResolvedValueOnce({ jobId: created.jobId, status: "generating", stage: "generating", progress })
      .mockResolvedValueOnce({ jobId: created.jobId, status: "succeeded", stage: "complete", result });
    const input = options({ activeJob });
    const { result: hook } = renderHook(() => useAiGeneration(input));
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(hook.current.progress).toEqual(progress);
    expect(input.onSucceeded).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(input.onSucceeded).toHaveBeenCalledOnce();
    expect(hook.current.progress).toBeNull();
  });

  it("keeps retry context while clearing invalid output and continues polling the next attempt", async () => {
    const activeJob = { jobId: created.jobId, targetDate: "2026-10-13", sourceUrl: "https://example.com", createdAt: new Date().toISOString() };
    vi.mocked(getAiGeneration).mockResolvedValueOnce({ jobId: created.jobId, status: "generating", stage: "generating", progress: { phase: "writing", preview: "未完成", updatedAt: new Date().toISOString() } })
      .mockResolvedValueOnce({ jobId: created.jobId, status: "retryable", stage: "retrying", attemptCount: 1, retryMessage: "上一轮内容未通过校验，正在重新生成。" })
      .mockResolvedValueOnce({ jobId: created.jobId, status: "generating", stage: "generating", attemptCount: 2 })
      .mockResolvedValueOnce({ jobId: created.jobId, status: "succeeded", stage: "complete", result });
    const { result: hook } = renderHook(() => useAiGeneration(options({ activeJob })));
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(hook.current.progress?.preview).toBe("未完成");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(hook.current.progress).toBeNull();
    expect(hook.current.stage).toBe("retrying");
    expect(hook.current.retryMessage).toContain("校验");
    expect(hook.current.error).toBe("");
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(hook.current.attemptCount).toBe(2);
    expect(hook.current.retryMessage).toContain("校验");
    expect(hook.current.activeJob?.jobId).toBe(created.jobId);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(hook.current.activeJob).toBeNull();
    expect(hook.current.retryMessage).toBe("");
  });
  it("keeps the submitted prompt on retry and gives an edited prompt a new request key", async () => {
    vi.mocked(createAiGeneration).mockRejectedValue(new Error("network"));
    const { result: hook } = renderHook(() => useAiGeneration(options()));
    const request = { sourceUrl: "https://example.com/article", targetDate: "2026-09-23", userPrompt: "  解释使用边界  " };
    await act(() => hook.current.generate(request));
    await act(() => hook.current.retryCreate());
    await act(() => hook.current.generate({ ...request, userPrompt: "重点讲解实现步骤" }));
    const [first, retry, changed] = vi.mocked(createAiGeneration).mock.calls.map(([input]) => input);
    expect(first.userPrompt).toBe("解释使用边界");
    expect(retry).toEqual(first);
    expect(changed.userPrompt).toBe("重点讲解实现步骤");
    expect(changed.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("uses server generation context when restoring a completed job", async () => {
    const generationContext = { userPrompt: "解释使用边界", promptVersion: "knowledge-skeleton-user-prompt-v1" };
    vi.mocked(getAiGeneration).mockResolvedValue({ jobId: created.jobId, status: "succeeded", stage: "complete", result, generationContext });
    const input = options({ activeJob: { jobId: created.jobId, targetDate: "2026-09-23", sourceUrl: "https://example.com/article", createdAt: new Date().toISOString() } });
    renderHook(() => useAiGeneration(input));
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(input.onSucceeded).toHaveBeenCalledWith(result, "2026-09-23", generationContext);
  });
  it("submits the edited URL after a failure instead of retrying the stale payload", async () => {
    vi.mocked(createAiGeneration).mockRejectedValueOnce(new Error("链接不能包含片段"))
      .mockResolvedValueOnce(created);
    const {result: hook} = renderHook(() => useAiGeneration(options()));
    await act(() => hook.current.generate({sourceUrl:"https://example.com/#old",targetDate:"2026-09-06"}));
    expect(hook.current.error).toBe("链接不能包含片段");
    act(() => hook.current.clearError());
    expect(hook.current.error).toBe("");
    const sourceUrl = "https://datawhalechina.github.io/deepagents-in-action/chapters/ch08-long-term-memory/";
    await act(() => hook.current.generate({sourceUrl,targetDate:"2026-09-06"}));
    const calls = vi.mocked(createAiGeneration).mock.calls;
    expect(calls[1]![0].sourceUrl).toBe(sourceUrl);
    expect(calls[1]![0].idempotencyKey).not.toBe(calls[0]![0].idempotencyKey);
  });

  it("reuses the pending key when generating again with unchanged input", async () => {
    vi.mocked(createAiGeneration).mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(created);
    const {result: hook} = renderHook(() => useAiGeneration(options()));
    const request = {sourceUrl:"https://example.com/article",targetDate:"2026-09-06"};
    await act(() => hook.current.generate(request));
    await act(() => hook.current.generate(request));
    const calls = vi.mocked(createAiGeneration).mock.calls;
    expect(calls[1]![0].idempotencyKey).toBe(calls[0]![0].idempotencyKey);
  });
  it("reuses one idempotency key when a network create is retried", async () => {
    vi.mocked(createAiGeneration)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(created);
    const input = options();
    const { result: hook } = renderHook(() => useAiGeneration(input));

    await act(() => hook.current.generate({
      sourceUrl: "https://example.com/article",
      targetDate: "2026-08-02",
    }));
    await act(() => hook.current.retryCreate());

    expect(createAiGeneration).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createAiGeneration).mock.calls[0]![0].idempotencyKey)
      .toBe(vi.mocked(createAiGeneration).mock.calls[1]![0].idempotencyKey);
  });

  it("polls at 1500, 3000, then 5000 ms and applies success to the job date", async () => {
    vi.mocked(createAiGeneration).mockResolvedValue(created);
    vi.mocked(getAiGeneration)
      .mockResolvedValueOnce({ jobId: created.jobId, status: "queued", stage: "queued" })
      .mockResolvedValueOnce({ jobId: created.jobId, status: "fetching", stage: "fetching" })
      .mockResolvedValueOnce({ jobId: created.jobId, status: "succeeded", stage: "complete", result });
    const input = options();
    const { result: hook } = renderHook(() => useAiGeneration(input));

    await act(() => hook.current.generate({
      sourceUrl: "https://example.com/article",
      targetDate: "2026-08-02",
    }));
    await act(() => vi.advanceTimersByTimeAsync(1_500));
    expect(getAiGeneration).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(2_999));
    expect(getAiGeneration).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(getAiGeneration).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(5_000));

    expect(input.onSucceeded).toHaveBeenCalledWith(result, "2026-08-02", undefined);
    expect(input.onTerminal).toHaveBeenCalledWith(created.jobId);
  });

  it("restores an active job, uses 15 seconds while hidden, and aborts on unmount", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    const activeJob = {
      jobId: created.jobId,
      targetDate: "2026-08-01",
      sourceUrl: "https://example.com/restored",
      createdAt: new Date().toISOString(),
    };
    const pending = new Promise<never>(() => undefined);
    vi.mocked(getAiGeneration).mockReturnValue(pending);
    const { unmount } = renderHook(() => useAiGeneration(options({ activeJob })));

    await act(() => vi.advanceTimersByTimeAsync(14_999));
    expect(getAiGeneration).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(getAiGeneration).toHaveBeenCalledTimes(1);
    const signal = vi.mocked(getAiGeneration).mock.calls[0]![1];
    expect(signal).toBeDefined();
    if (!signal) throw new Error("Expected polling AbortSignal");
    expect(signal.aborted).toBe(false);

    unmount();
    expect(signal.aborted).toBe(true);
  });

  it("clears restored metadata when the server reports cancellation", async () => {
    const activeJob = {
      jobId: created.jobId,
      targetDate: "2026-08-01",
      sourceUrl: "https://example.com/restored",
      createdAt: new Date().toISOString(),
    };
    vi.mocked(getAiGeneration).mockResolvedValue({
      jobId: created.jobId,
      status: "cancelled",
      stage: "complete",
    });
    const input = options({ activeJob });
    renderHook(() => useAiGeneration(input));

    await act(() => vi.advanceTimersByTimeAsync(1_500));

    expect(input.onActiveJobChange).toHaveBeenCalledWith(null);
    expect(input.onTerminal).toHaveBeenCalledWith(created.jobId);
  });

  it("marks old restored jobs as long-running without failing them", async () => {
    const activeJob = {
      jobId: created.jobId,
      targetDate: "2026-08-01",
      sourceUrl: "https://example.com/restored",
      createdAt: new Date(Date.now() - 121_000).toISOString(),
    };
    const { result: hook } = renderHook(() => useAiGeneration(options({ activeJob })));

    await act(async () => Promise.resolve());

    expect(hook.current.isLongRunning).toBe(true);
    expect(hook.current.error).toBe("");
  });
});
