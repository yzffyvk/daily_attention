import { describe, expect, it, vi } from "vitest";
import { DeepSeekProviderError } from "@/supabase/functions/_shared/ai/deepseek";
import { SafeFetchClientError } from "@/supabase/functions/_shared/ai/safe-fetch-client";
import { parseQuestionSummary, serializeQuestionSummary } from '@/lib/domain/knowledge-questions';
import { questionSummaryFixture } from '../../helpers/knowledge-questions-fixture';
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
  it('records reviewer identity against the job and keeps audit failures separate from acceptance', async () => {
    const audit = { stage: 'document' as const, requestedModel: 'deepseek-v4-pro', returnedModel: 'deepseek-flash', round: 1, verdict: 'pass' as const, issueCount: 0, durationMs: 2000, usage: generated.usage };
    const reportSemanticReview = vi.fn().mockRejectedValue(new Error('log unavailable'));
    const runnerPorts = ports({ reportSemanticReview, generate: async input => {
      await input.onSemanticReview?.(audit);
      return generated;
    } });
    await expect(runAiJob(job.id, runnerPorts)).resolves.toBe('completed');
    expect(reportSemanticReview).toHaveBeenCalledWith(job.id, audit);
    expect(runnerPorts.complete).toHaveBeenCalledOnce();
  });
  it("fences progress by attempt and keeps successful generation when preview storage fails", async () => {
    const progress = { phase: "writing" as const, preview: "正文", updatedAt: new Date().toISOString() };
    const reportProgress = vi.fn().mockRejectedValue(new Error("storage unavailable"));
    const runnerPorts = ports({ reportProgress, generate: async input => {
      await input.onProgress?.(progress);
      await input.onProgress?.({ ...progress, phase: "validating" });
      return generated;
    } });
    await expect(runAiJob(job.id, runnerPorts)).resolves.toBe("completed");
    expect(reportProgress).toHaveBeenCalledExactlyOnceWith(job.id, job.attemptCount, progress);
    expect(runnerPorts.complete).toHaveBeenCalledOnce();
    expect(runnerPorts.markProviderFailure).not.toHaveBeenCalled();
  });
  it("records all model calls and usage when a structured repair still fails", async () => {
    const runnerPorts = ports({ generate: vi.fn().mockRejectedValue(new DeepSeekProviderError("MODEL_OUTPUT_INVALID", true, { providerCallCount: 2, usage: generated.usage })) });
    await expect(runAiJob(job.id, runnerPorts)).resolves.toBe("retryable");
    expect(runnerPorts.markProviderFailure).toHaveBeenCalledWith(expect.objectContaining({ providerCallCount: 2, usage: generated.usage }));
  });
  it("forwards the claimed job's normalized requirements and prompt version to generation", async () => {
    let received: Parameters<AiJobRunnerPorts["generate"]>[0] | undefined;
    const runnerPorts = ports({
      claim: async () => ({ ...job, userPrompt: "  重点解释适用边界  ", promptVersion: "knowledge-skeleton-user-prompt-v1" }),
      generate: async (input) => { received = input; return generated; },
    });
    await expect(runAiJob(job.id, runnerPorts)).resolves.toBe("completed");
    expect(received).toEqual({
      sourceTitle: source.title,
      sourceText: source.text,
      sourceTruncated: false,
      anonymousUserId: "cd".repeat(32),
      userPrompt: "重点解释适用边界",
      promptVersion: "knowledge-skeleton-user-prompt-v1",
    });
  });

  it("normalizes missing requirements on older claimed jobs to an empty string", async () => {
    let received: Parameters<AiJobRunnerPorts["generate"]>[0] | undefined;
    const runnerPorts = ports({
      generate: async (input) => { received = input; return generated; },
    });
    await runAiJob(job.id, runnerPorts);
    expect(received).toMatchObject({ userPrompt: "" });
  });

  it("keeps a source truncation notice in the saved summary even when the model omits it", async () => {
    let saved: Parameters<AiJobRunnerPorts["complete"]>[0] | undefined;
    const runnerPorts = ports({
      loadSource: async () => ({ ...source, truncated: true }),
      generate: async () => ({ ...generated, result: { ...generated.result, summary: "知".repeat(30000), warnings: Array.from({ length: 10 }, (_, i) => `提示${i}`) } }),
      complete: async (input) => { saved = input; },
    });
    await expect(runAiJob(job.id, runnerPorts)).resolves.toBe("completed");
    expect(saved?.result.summary).toMatch(/^资料范围：/u);
    expect(saved?.result.summary).toContain("后续内容未纳入");
    expect(saved!.result.summary).toContain('知'.repeat(30000));
    expect(saved?.result.warnings[0]).toContain("后续内容未纳入");
    expect(saved!.result.warnings).toHaveLength(11);
  });

  it('adds truncation warnings without breaking the editable question document', async () => {
    const structured = questionSummaryFixture();
    const runnerPorts = ports({
      loadSource: async () => ({ ...source, truncated: true }),
      generate: async () => ({ ...generated, result: { ...generated.result, summary: serializeQuestionSummary(structured) } }),
    });
    await runAiJob(job.id, runnerPorts);
    const saved = vi.mocked(runnerPorts.complete).mock.calls[0][0];
    const parsed = parseQuestionSummary(saved.result.summary);
    expect(parsed?.structure).toEqual(structured.structure);
    expect(parsed?.warnings[0]).toContain('后续内容未纳入');
  });

  it("retries a stopped gateway before consuming the model quota", async () => {
    const runnerPorts = ports({
      loadSource: vi.fn().mockRejectedValue(new SafeFetchClientError("FETCH_SERVICE_UNAVAILABLE")),
    });
    await expect(runAiJob(job.id, runnerPorts)).resolves.toBe("retryable");
    expect(runnerPorts.markFetchFailure).toHaveBeenCalledWith(expect.objectContaining({
      code: "FETCH_SERVICE_UNAVAILABLE", retryable: true,
    }));
    expect(runnerPorts.begin).not.toHaveBeenCalled();
    expect(runnerPorts.generate).not.toHaveBeenCalled();
  });

  it("stops retrying an unavailable gateway after the final attempt with an accurate message", async () => {
    const runnerPorts = ports({
      claim: vi.fn().mockResolvedValue({ ...job, attemptCount: 3 }),
      loadSource: vi.fn().mockRejectedValue(new SafeFetchClientError("FETCH_SERVICE_UNAVAILABLE")),
    });
    await expect(runAiJob(job.id, runnerPorts)).resolves.toBe("completed");
    expect(runnerPorts.markFetchFailure).toHaveBeenCalledWith(expect.objectContaining({
      code: "FETCH_SERVICE_UNAVAILABLE", message: "网页读取服务暂时不可用，请稍后重试", retryable: false,
    }));
    expect(runnerPorts.begin).not.toHaveBeenCalled();
  });

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
