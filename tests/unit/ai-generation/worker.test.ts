import { describe, expect, it, vi } from "vitest";
import {
  assertAiProviderModeAllowed,
  createWorkerHandler,
  default as aiGenerationWorkerHandler,
  type AiWorkerDependencies,
} from "@/supabase/functions/ai-generation-worker/index";

const token = "worker-trigger-token-with-at-least-32-characters";

function request(authorization?: string) {
  return new Request("http://localhost/functions/v1/ai-generation-worker", {
    method: "POST",
    headers: authorization ? { Authorization: authorization } : {},
  });
}

function handlerWithCapturedTask(dependencies: AiWorkerDependencies) {
  let task: Promise<void> | null = null;
  const handler = createWorkerHandler(dependencies, (scheduled) => {
    task = scheduled;
  });
  return {
    handler,
    scheduledTask() {
      if (!task) throw new Error("Expected the queue batch to be scheduled");
      return task;
    },
  };
}

describe("AI generation queue worker", () => {
  it("acknowledges before the scheduled queue batch completes", async () => {
    let releaseJob!: () => void;
    const jobGate = new Promise<void>((resolve) => {
      releaseJob = resolve;
    });
    const runJob = vi.fn(async () => {
      await jobGate;
      return "completed" as const;
    });
    const captured = handlerWithCapturedTask({
      triggerToken: token,
      readMessages: vi.fn().mockResolvedValue([{
        msgId: 1,
        readCount: 1,
        message: { job_id: "10000000-0000-4000-8000-000000000001" },
      }]),
      runJob,
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      delayMessage: vi.fn(),
    });

    const responsePromise = captured.handler(request(`Bearer ${token}`));
    const firstResult = await Promise.race([
      responsePromise.then((response) => ({ kind: "response" as const, response })),
      new Promise<{ kind: "pending" }>((resolve) => {
        setTimeout(() => resolve({ kind: "pending" }), 20);
      }),
    ]);
    releaseJob();
    const response = await responsePromise;

    expect(firstResult.kind).toBe("response");
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      requestId: expect.any(String),
    });
    expect(captured.scheduledTask()).toBeInstanceOf(Promise);
    await captured.scheduledTask();
    expect(runJob).toHaveBeenCalledTimes(1);
  });

  it("rechecks the queue when the enqueue transaction is not visible immediately", async () => {
    vi.useFakeTimers();
    try {
      const readMessages = vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          msgId: 1,
          readCount: 1,
          message: { job_id: "10000000-0000-4000-8000-000000000001" },
        }]);
      const runJob = vi.fn().mockResolvedValue("completed");
      const captured = handlerWithCapturedTask({
        triggerToken: token,
        readMessages,
        runJob,
        deleteMessage: vi.fn().mockResolvedValue(undefined),
        delayMessage: vi.fn(),
      });

      const response = await captured.handler(request(`Bearer ${token}`));
      await vi.advanceTimersByTimeAsync(100);
      await captured.scheduledTask();

      expect(response.status).toBe(202);
      expect(readMessages).toHaveBeenCalledTimes(2);
      expect(runJob).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects fake provider mode outside explicit test bindings", () => {
    expect(() => assertAiProviderModeAllowed({ mode: "fake" }))
      .toThrow("FUNCTION_CONFIGURATION_ERROR");
    expect(() => assertAiProviderModeAllowed({
      mode: "fake",
      integrationTestBindings: "true",
    })).not.toThrow();
  });

  it("fails closed when production worker secrets are missing", async () => {
    vi.stubGlobal("Deno", { env: { get: vi.fn(() => undefined) } });

    const response = await aiGenerationWorkerHandler.fetch(
      request(`Bearer ${token}`),
    );

    expect(response.status).toBe(500);
    vi.unstubAllGlobals();
  });

  it.each([undefined, "Bearer wrong-token"])(
    "rejects missing or invalid trigger auth before reading the queue",
    async (authorization) => {
      const readMessages = vi.fn();
      const scheduleTask = vi.fn();
      const handler = createWorkerHandler({
        triggerToken: token,
        readMessages,
        runJob: vi.fn(),
        deleteMessage: vi.fn(),
        delayMessage: vi.fn(),
      }, scheduleTask);

      const response = await handler(request(authorization));

      expect(response.status).toBe(401);
      expect(readMessages).not.toHaveBeenCalled();
      expect(scheduleTask).not.toHaveBeenCalled();
    },
  );

  it("processes at most five messages with concurrency two", async () => {
    let active = 0;
    let maximumActive = 0;
    const runJob = vi.fn(async (jobId: string) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (jobId.endsWith("1")) return "completed" as const;
      if (jobId.endsWith("2")) return "ignored" as const;
      return "retryable" as const;
    });
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    const delayMessage = vi.fn().mockResolvedValue(undefined);
    const messages = Array.from({ length: 6 }, (_, index) => ({
      msgId: index + 1,
      readCount: index + 1,
      message: { job_id: `10000000-0000-4000-8000-00000000000${index + 1}` },
    }));
    const captured = handlerWithCapturedTask({
      triggerToken: token,
      readMessages: vi.fn().mockResolvedValue(messages),
      runJob,
      deleteMessage,
      delayMessage,
    });

    const response = await captured.handler(request(`Bearer ${token}`));
    await captured.scheduledTask();

    expect(response.status).toBe(202);
    expect(maximumActive).toBe(2);
    expect(runJob).toHaveBeenCalledTimes(5);
    expect(deleteMessage).toHaveBeenCalledTimes(2);
    expect(delayMessage).toHaveBeenCalledTimes(3);
    expect(delayMessage).toHaveBeenCalledWith(3, 120);
  });

  it("deletes malformed messages without exposing processing failures", async () => {
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    const captured = handlerWithCapturedTask({
      triggerToken: token,
      readMessages: vi.fn().mockResolvedValue([
        { msgId: 1, readCount: 1, message: { sourceUrl: "private" } },
        { msgId: 2, readCount: 1, message: { job_id: "10000000-0000-4000-8000-000000000002" } },
      ]),
      runJob: vi.fn().mockRejectedValue(new Error("internal raw body")),
      deleteMessage,
      delayMessage: vi.fn(),
    });

    const response = await captured.handler(request(`Bearer ${token}`));
    const body = await response.json();
    await captured.scheduledTask();

    expect(response.status).toBe(202);
    expect(deleteMessage).toHaveBeenCalledWith(1);
    expect(body).toMatchObject({ accepted: true, requestId: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain("raw body");
  });

  it("isolates a malformed-message deletion failure from the rest of the batch", async () => {
    const runJob = vi.fn().mockResolvedValue("completed");
    const captured = handlerWithCapturedTask({
      triggerToken: token,
      readMessages: vi.fn().mockResolvedValue([
        { msgId: 1, readCount: 1, message: {} },
        { msgId: 2, readCount: 1, message: { job_id: "10000000-0000-4000-8000-000000000002" } },
      ]),
      runJob,
      deleteMessage: vi.fn(async (msgId: number) => {
        if (msgId === 1) throw new Error("queue unavailable");
      }),
      delayMessage: vi.fn(),
    });

    const response = await captured.handler(request(`Bearer ${token}`));
    await expect(captured.scheduledTask()).resolves.toBeUndefined();

    expect(response.status).toBe(202);
    expect(runJob).toHaveBeenCalledTimes(1);
  });
});
