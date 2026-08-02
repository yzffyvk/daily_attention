import { describe, expect, it, vi } from "vitest";
import { createWorkerHandler } from "@/supabase/functions/ai-generation-worker/index";

const token = "worker-trigger-token-with-at-least-32-characters";

function request(authorization?: string) {
  return new Request("http://localhost/functions/v1/ai-generation-worker", {
    method: "POST",
    headers: authorization ? { Authorization: authorization } : {},
  });
}

describe("AI generation queue worker", () => {
  it.each([undefined, "Bearer wrong-token"])(
    "rejects missing or invalid trigger auth before reading the queue",
    async (authorization) => {
      const readMessages = vi.fn();
      const handler = createWorkerHandler({
        triggerToken: token,
        readMessages,
        runJob: vi.fn(),
        deleteMessage: vi.fn(),
        delayMessage: vi.fn(),
      });

      const response = await handler(request(authorization));

      expect(response.status).toBe(401);
      expect(readMessages).not.toHaveBeenCalled();
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
    const handler = createWorkerHandler({
      triggerToken: token,
      readMessages: vi.fn().mockResolvedValue(messages),
      runJob,
      deleteMessage,
      delayMessage,
    });

    const response = await handler(request(`Bearer ${token}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(maximumActive).toBe(2);
    expect(runJob).toHaveBeenCalledTimes(5);
    expect(deleteMessage).toHaveBeenCalledTimes(2);
    expect(delayMessage).toHaveBeenCalledTimes(3);
    expect(delayMessage).toHaveBeenCalledWith(3, 120);
    expect(body).toMatchObject({
      requestId: expect.any(String),
      received: 5,
      completed: 2,
      retryable: 3,
      failed: 0,
    });
  });

  it("deletes malformed messages and reports isolated processing failures", async () => {
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    const handler = createWorkerHandler({
      triggerToken: token,
      readMessages: vi.fn().mockResolvedValue([
        { msgId: 1, readCount: 1, message: { sourceUrl: "private" } },
        { msgId: 2, readCount: 1, message: { job_id: "10000000-0000-4000-8000-000000000002" } },
      ]),
      runJob: vi.fn().mockRejectedValue(new Error("internal raw body")),
      deleteMessage,
      delayMessage: vi.fn(),
    });

    const response = await handler(request(`Bearer ${token}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(deleteMessage).toHaveBeenCalledWith(1);
    expect(body).toMatchObject({ received: 2, completed: 0, retryable: 0, failed: 2 });
    expect(JSON.stringify(body)).not.toContain("raw body");
  });

  it("isolates a malformed-message deletion failure from the rest of the batch", async () => {
    const handler = createWorkerHandler({
      triggerToken: token,
      readMessages: vi.fn().mockResolvedValue([
        { msgId: 1, readCount: 1, message: {} },
        { msgId: 2, readCount: 1, message: { job_id: "10000000-0000-4000-8000-000000000002" } },
      ]),
      runJob: vi.fn().mockResolvedValue("completed"),
      deleteMessage: vi.fn(async (msgId: number) => {
        if (msgId === 1) throw new Error("queue unavailable");
      }),
      delayMessage: vi.fn(),
    });

    const response = await handler(request(`Bearer ${token}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      received: 2,
      completed: 1,
      failed: 1,
    });
  });
});
