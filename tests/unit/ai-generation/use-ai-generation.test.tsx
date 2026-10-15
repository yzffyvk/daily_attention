import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiGeneration } from "@/features/ai-generation/use-ai-generation";
import { ApiError } from "@/features/checkins/api";
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
  it("stops polling an expired task so the persisted candidate can be reloaded", async () => {
    const activeJob = { jobId: created.jobId, recordId: "00000000-0000-4000-8000-000000000099", targetDate: "2026-07-31", sourceUrl: "https://example.com/article", createdAt: new Date().toISOString() };
    vi.mocked(getAiGeneration).mockResolvedValue({ jobId: created.jobId, status: "succeeded", stage: "complete",
      error: { code: "RESULT_EXPIRED", message: "任务结果已过期", retryable: false } });
    const input = options({ activeJob });
    const { result: hook } = renderHook(() => useAiGeneration(input));
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(input.onTerminal).toHaveBeenCalledWith(created.jobId);
    expect(hook.current.activeJob).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(15000));
    expect(getAiGeneration).toHaveBeenCalledTimes(1);
  });
  it("targets and returns the exact record even when two records share a date", async () => {
    const recordId = "00000000-0000-4000-8000-000000000099";
    vi.mocked(createAiGeneration).mockResolvedValue({ ...created, recordId, baseVersion: 1 });
    vi.mocked(getAiGeneration).mockResolvedValue({ jobId: created.jobId, recordId, status: "succeeded", stage: "complete", result });
    const input = options();
    const { result: hook } = renderHook(() => useAiGeneration(input));
    await act(() => hook.current.generate({ recordId, sourceUrl: "https://example.com/article", targetDate: "2026-07-31" }));
    expect(createAiGeneration).toHaveBeenCalledWith(expect.objectContaining({ recordId }));
    expect(hook.current.activeJob?.recordId).toBe(recordId);
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(input.onSucceeded).toHaveBeenCalledWith(result, "2026-07-31", undefined, recordId);
  });
  it("can cancel a newly restored job while an older job cancellation is still pending", async () => {
    const activeJob = { jobId: created.jobId, targetDate: "2026-10-13", sourceUrl: "https://example.com", createdAt: new Date().toISOString() };
    const nextJob = { ...activeJob, jobId: "10000000-0000-4000-8000-000000000002", targetDate: "2026-10-14" };
    const responses = new Map<string, (value: Awaited<ReturnType<typeof cancelAiGeneration>>) => void>();
    vi.mocked(cancelAiGeneration).mockImplementation(id => new Promise(resolve => responses.set(id, resolve)));
    const input = options();
    const { result: hook, rerender } = renderHook(({ activeJob: current }) => useAiGeneration({ ...input, activeJob: current }), { initialProps: { activeJob } });
    let oldCancel!: Promise<void>;
    act(() => { oldCancel = hook.current.cancel(); });
    expect(hook.current.isCancelling).toBe(true);
    rerender({ activeJob: nextJob });
    expect(hook.current.isCancelling).toBe(false);
    let newCancel!: Promise<void>;
    act(() => { newCancel = hook.current.cancel(); });
    expect(cancelAiGeneration).toHaveBeenCalledTimes(2);
    await act(async () => {
      responses.get(activeJob.jobId)!({ jobId: activeJob.jobId, status: "cancelled", stage: "complete" });
      await oldCancel;
    });
    expect(hook.current.activeJob).toEqual(nextJob);
    expect(hook.current.isCancelling).toBe(true);
    expect(input.onTerminal).not.toHaveBeenCalled();
    await act(async () => {
      responses.get(nextJob.jobId)!({ jobId: nextJob.jobId, status: "cancelled", stage: "complete" });
      await newCancel;
    });
    expect(hook.current.activeJob).toBeNull();
    expect(input.onTerminal).toHaveBeenCalledExactlyOnceWith(nextJob.jobId);
  });
  it.each(["fetching", "generating", "retryable"] as const)("cancels %s without applying partial output and prevents duplicate requests", async (status) => {
    const activeJob = { jobId: created.jobId, targetDate: "2026-10-13", sourceUrl: "https://example.com", createdAt: new Date().toISOString() };
    vi.mocked(getAiGeneration).mockResolvedValue({ jobId: created.jobId, status, stage: status === "retryable" ? "retrying" : status, progress: { phase: "writing", preview: "预览", updatedAt: new Date().toISOString() }, cancellation: { freeRemaining: 2, requiresConfirmation: false, charged: null } });
    let complete!: (value: Awaited<ReturnType<typeof cancelAiGeneration>>) => void;
    vi.mocked(cancelAiGeneration).mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    const input = options({ activeJob });
    const { result: hook } = renderHook(() => useAiGeneration(input));
    await act(() => vi.advanceTimersByTimeAsync(1500));
    let pending!: Promise<void>;
    act(() => { pending = hook.current.cancel(); void hook.current.cancel(); });
    expect(hook.current.isCancelling).toBe(true);
    expect(hook.current.activeJob).toEqual(activeJob);
    expect(cancelAiGeneration).toHaveBeenCalledTimes(1);
    await act(async () => {
      complete({ jobId: created.jobId, status: "cancelled", stage: "complete", quota: { used: 0, reserved: 0, consumed: 0, limit: 5, remaining: 5 }, cancellation: { freeRemaining: 1, requiresConfirmation: false, charged: false } });
      await pending;
    });
    expect(hook.current.activeJob).toBeNull();
    expect(hook.current.progress).toBeNull();
    expect(hook.current.quotaRemaining).toBe(5);
    expect(hook.current.cancellationMessage).toMatch(/退回.*剩余 1 次/);
    expect(input.onSucceeded).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation for a charged cancellation while polling continues", async () => {
    const activeJob = { jobId: created.jobId, targetDate: "2026-10-13", sourceUrl: "https://example.com", createdAt: new Date().toISOString() };
    vi.mocked(getAiGeneration).mockResolvedValue({ jobId: created.jobId, status: "generating", stage: "generating", cancellation: { freeRemaining: 0, requiresConfirmation: true, charged: null } });
    const { result: hook } = renderHook(() => useAiGeneration(options({ activeJob })));
    await act(() => vi.advanceTimersByTimeAsync(1500));
    await act(() => hook.current.cancel());
    expect(hook.current.cancellationConfirmationRequired).toBe(true);
    expect(cancelAiGeneration).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(getAiGeneration).toHaveBeenCalledTimes(2);
    vi.mocked(cancelAiGeneration).mockResolvedValue({ jobId: created.jobId, status: "cancelled", stage: "complete", quota: { used: 1, reserved: 0, consumed: 1, limit: 5, remaining: 4 }, cancellation: { freeRemaining: 0, requiresConfirmation: false, charged: true } });
    await act(() => hook.current.cancel(true));
    expect(cancelAiGeneration).toHaveBeenCalledWith(created.jobId, true);
    expect(hook.current.cancellationMessage).toMatch(/扣除 1 次.*剩余 0 次/);
    expect(hook.current.quotaRemaining).toBe(4);
  });

  it("opens confirmation on a server policy race and keeps the job active after rejection", async () => {
    const activeJob = { jobId: created.jobId, targetDate: "2026-10-13", sourceUrl: "https://example.com", createdAt: new Date().toISOString() };
    vi.mocked(getAiGeneration).mockResolvedValue({ jobId: created.jobId, status: "generating", stage: "generating", cancellation: { freeRemaining: 1, requiresConfirmation: false, charged: null } });
    vi.mocked(cancelAiGeneration).mockRejectedValue(new ApiError("取消需确认", { code: "CANCELLATION_CONFIRMATION_REQUIRED", status: 409, requestId: "cancel" }));
    const input = options({ activeJob });
    const { result: hook } = renderHook(() => useAiGeneration(input));
    await act(() => vi.advanceTimersByTimeAsync(1500));
    await act(() => hook.current.cancel());
    expect(hook.current.cancellationConfirmationRequired).toBe(true);
    expect(hook.current.activeJob).toEqual(activeJob);
    expect(hook.current.isCancelling).toBe(false);
    expect(input.onTerminal).not.toHaveBeenCalled();
    act(() => hook.current.dismissCancellationConfirmation());
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(getAiGeneration).toHaveBeenCalledTimes(2);
  });

  it("keeps polling and the prior draft untouched when cancellation fails", async () => {
    const activeJob = { jobId: created.jobId, targetDate: "2026-10-13", sourceUrl: "https://example.com", createdAt: new Date().toISOString() };
    vi.mocked(getAiGeneration).mockResolvedValue({ jobId: created.jobId, status: "generating", stage: "generating" });
    vi.mocked(cancelAiGeneration).mockRejectedValue(new Error("网络暂时不可用"));
    const input = options({ activeJob });
    const { result: hook } = renderHook(() => useAiGeneration(input));
    await act(() => vi.advanceTimersByTimeAsync(1500));
    await act(() => hook.current.cancel());
    expect(hook.current.error).toBe("网络暂时不可用");
    expect(hook.current.activeJob).toEqual(activeJob);
    expect(input.onTerminal).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(getAiGeneration).toHaveBeenCalledTimes(2);
  });

  it("applies the generated result when completion wins the cancellation race", async () => {
    const activeJob = { jobId: created.jobId, targetDate: "2026-10-13", sourceUrl: "https://example.com", createdAt: new Date().toISOString() };
    vi.mocked(cancelAiGeneration).mockResolvedValue({ jobId: created.jobId, status: "succeeded", stage: "complete", result, quota: { used: 1, reserved: 0, consumed: 1, limit: 5, remaining: 4 } });
    const input = options({ activeJob });
    const { result: hook } = renderHook(() => useAiGeneration(input));
    await act(() => hook.current.cancel());
    expect(input.onSucceeded).toHaveBeenCalledWith(result, activeJob.targetDate, undefined);
    expect(hook.current.activeJob).toBeNull();
    expect(hook.current.cancellationMessage).toBe("");
    expect(input.onTerminal).toHaveBeenCalledOnce();
  });

  it("allows cancelling a new job while a stale cancellation response is still pending", async () => {
    const activeJob = { jobId: created.jobId, targetDate: "2026-10-13", sourceUrl: "https://example.com", createdAt: new Date().toISOString() };
    let completeOld!: (value: Awaited<ReturnType<typeof cancelAiGeneration>>) => void;
    vi.mocked(cancelAiGeneration).mockReturnValueOnce(new Promise((resolve) => { completeOld = resolve; }))
      .mockResolvedValueOnce({ jobId: "new-job", status: "cancelled", stage: "complete" });
    vi.mocked(getAiGeneration).mockResolvedValueOnce({ jobId: created.jobId, status: "succeeded", stage: "complete", result });
    vi.mocked(createAiGeneration).mockResolvedValue({ ...created, jobId: "new-job" });
    const input = options({ activeJob });
    const { result: hook } = renderHook(() => useAiGeneration(input));
    let oldCancel!: Promise<void>;
    act(() => { oldCancel = hook.current.cancel(); });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    await act(() => hook.current.generate({ sourceUrl: "https://example.com/new", targetDate: "2026-10-13" }));
    await act(() => hook.current.cancel());
    expect(hook.current.activeJob).toBeNull();
    expect(cancelAiGeneration).toHaveBeenCalledTimes(2);
    await act(async () => {
      completeOld({ jobId: created.jobId, status: "succeeded", stage: "complete", result });
      await oldCancel;
    });
    expect(input.onSucceeded).toHaveBeenCalledOnce();
  });

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
