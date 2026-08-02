import { describe, expect, it, vi } from "vitest";
import { DeepSeekProviderError } from "@/supabase/functions/_shared/ai/deepseek";
import { SafeFetchClientError } from "@/supabase/functions/_shared/ai/safe-fetch-client";
import {
  runAiJob,
  type AiJobRunnerPorts,
} from "@/supabase/functions/_shared/ai/runner";

const job = {
  id: "10000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000001",
  sourceUrl: "https://example.com/article",
  attemptCount: 1,
};

const source = {
  title: "示例资料",
  text: "注意力机制通过查询、键和值计算相关性。".repeat(20),
  contentDigestHex: "ab".repeat(32),
};

const generated = {
  result: {
    attention: "理解注意力机制",
    summary: "结构化知识小结",
    inspiration: "继续比较不同架构",
    sourceTitle: "示例资料",
    warnings: [],
  },
  usage: {
    promptTokens: 100,
    promptCacheHitTokens: 20,
    promptCacheMissTokens: 80,
    completionTokens: 50,
    reasoningTokens: 10,
  },
  providerCallCount: 1,
  model: "deepseek-v4-pro",
  systemFingerprint: "fp-1",
};

function ports(overrides: Partial<AiJobRunnerPorts> = {}): AiJobRunnerPorts {
  return {
    claim: vi.fn().mockResolvedValue(job),
    loadSource: vi.fn().mockResolvedValue(source),
    begin: vi.fn().mockResolvedValue(undefined),
    anonymousUserId: vi.fn().mockResolvedValue("cd".repeat(32)),
    generate: vi.fn().mockResolvedValue(generated),
    complete: vi.fn().mockResolvedValue(undefined),
    markFetchFailure: vi.fn().mockResolvedValue(undefined),
    markProviderFailure: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("AI job runner", () => {
  it("ignores duplicate delivery after a terminal or unclaimable job", async () => {
    const runnerPorts = ports({ claim: vi.fn().mockResolvedValue(null) });

    await expect(runAiJob(job.id, runnerPorts)).resolves.toBe("ignored");
    expect(runnerPorts.loadSource).not.toHaveBeenCalled();
  });

  it("loads, consumes once, generates, and completes a valid job", async () => {
    const order: string[] = [];
    const runnerPorts = ports({
      begin: vi.fn(async () => { order.push("begin"); }),
      generate: vi.fn(async () => { order.push("generate"); return generated; }),
      complete: vi.fn(async () => { order.push("complete"); }),
    });

    await expect(runAiJob(job.id, runnerPorts)).resolves.toBe("completed");
    expect(order).toEqual(["begin", "generate", "complete"]);
    expect(runnerPorts.begin).toHaveBeenCalledTimes(1);
    expect(runnerPorts.complete).toHaveBeenCalledWith(expect.objectContaining({
      jobId: job.id,
      sourceTitle: source.title,
      contentDigestHex: source.contentDigestHex,
      providerCallCount: 1,
      usage: generated.usage,
      result: generated.result,
    }));
  });

  it("releases a reservation for a permanent pre-provider fetch failure", async () => {
    const runnerPorts = ports({
      loadSource: vi.fn().mockRejectedValue(
        new SafeFetchClientError("CONTENT_NOT_EXTRACTABLE"),
      ),
    });

    await expect(runAiJob(job.id, runnerPorts)).resolves.toBe("completed");
    expect(runnerPorts.markFetchFailure).toHaveBeenCalledWith({
      jobId: job.id,
      code: "CONTENT_NOT_EXTRACTABLE",
      message: "无法从该页面提取正文",
      retryable: false,
    });
    expect(runnerPorts.begin).not.toHaveBeenCalled();
  });

  it("keeps a transient fetch failure retryable while attempts remain", async () => {
    const runnerPorts = ports({
      loadSource: vi.fn().mockRejectedValue(new SafeFetchClientError("FETCH_TIMEOUT")),
    });

    await expect(runAiJob(job.id, runnerPorts)).resolves.toBe("retryable");
    expect(runnerPorts.markFetchFailure).toHaveBeenCalledWith(expect.objectContaining({
      code: "FETCH_TIMEOUT",
      retryable: true,
    }));
  });

  it("does not refund after provider start and exhausts the final attempt", async () => {
    const runnerPorts = ports({
      claim: vi.fn().mockResolvedValue({ ...job, attemptCount: 3 }),
      generate: vi.fn().mockRejectedValue(
        new DeepSeekProviderError("MODEL_SERVICE_ERROR", true),
      ),
    });

    await expect(runAiJob(job.id, runnerPorts)).resolves.toBe("completed");
    expect(runnerPorts.begin).toHaveBeenCalledTimes(1);
    expect(runnerPorts.markProviderFailure).toHaveBeenCalledWith(expect.objectContaining({
      jobId: job.id,
      code: "TASK_RETRY_EXHAUSTED",
      retryable: false,
      providerCallCount: 1,
    }));
    expect(runnerPorts.markFetchFailure).not.toHaveBeenCalled();
  });

  it("passes no raw page body or reasoning to persistence ports", async () => {
    const runnerPorts = ports();

    await runAiJob(job.id, runnerPorts);

    const persisted = JSON.stringify([
      (runnerPorts.complete as ReturnType<typeof vi.fn>).mock.calls,
      (runnerPorts.markFetchFailure as ReturnType<typeof vi.fn>).mock.calls,
      (runnerPorts.markProviderFailure as ReturnType<typeof vi.fn>).mock.calls,
    ]);
    expect(persisted).not.toContain("raw page body");
    expect(persisted).not.toContain("reasoning_content");
    expect(persisted).not.toContain(source.text);
  });
});
