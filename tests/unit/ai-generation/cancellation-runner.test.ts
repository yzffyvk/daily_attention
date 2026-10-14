import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAiJob, type AiJobRunnerPorts } from '@/supabase/functions/_shared/ai/runner';

afterEach(() => vi.useRealTimers());
const job = { id: '10000000-0000-4000-8000-000000000976', userId: '00000000-0000-4000-8000-000000000976', sourceUrl: 'https://example.com/cancel', attemptCount: 1 };
const generated = { result: { attention: '主题', summary: '小结', inspiration: '', sourceTitle: '资料', warnings: [] }, usage: { promptTokens: 1, completionTokens: 1, promptCacheHitTokens: 0, promptCacheMissTokens: 1, reasoningTokens: 0 }, providerCallCount: 1, model: 'test', systemFingerprint: null };
type CancellationPorts = AiJobRunnerPorts & { isCancelled: (jobId: string) => Promise<boolean> };
function ports(): CancellationPorts {
  return {
    claim: vi.fn().mockResolvedValue(job), isCancelled: vi.fn().mockResolvedValue(false),
    loadSource: vi.fn().mockResolvedValue({ title: '资料', text: '正文', contentDigestHex: 'ab'.repeat(32) }),
    begin: vi.fn().mockResolvedValue(undefined), anonymousUserId: vi.fn().mockResolvedValue('ab'.repeat(32)),
    generate: vi.fn().mockResolvedValue(generated), complete: vi.fn().mockResolvedValue(undefined),
    markFetchFailure: vi.fn().mockResolvedValue(undefined), markProviderFailure: vi.fn().mockResolvedValue(undefined),
  };
}
describe('cancelled AI execution', () => {
  it('does not fetch or generate after cancellation wins immediately after claim', async () => {
    const p = ports(); vi.mocked(p.isCancelled).mockResolvedValue(true);
    await expect(runAiJob(job.id, p)).resolves.toBe('ignored');
    expect(p.loadSource).not.toHaveBeenCalled(); expect(p.begin).not.toHaveBeenCalled(); expect(p.generate).not.toHaveBeenCalled();
  });
  it('does not start a model when cancellation wins during source loading', async () => {
    const p = ports(); let cancelled = false;
    p.isCancelled = async () => cancelled;
    p.loadSource = async () => { cancelled = true; return { title: '资料', text: '正文', contentDigestHex: 'ab'.repeat(32) }; };
    await expect(runAiJob(job.id, p)).resolves.toBe('ignored');
    expect(p.begin).not.toHaveBeenCalled(); expect(p.generate).not.toHaveBeenCalled(); expect(p.markFetchFailure).not.toHaveBeenCalled();
  });
  it('keeps preparation before the quota-consuming model boundary', async () => {
    const p = ports(); let cancelled = false;
    p.isCancelled = async () => cancelled;
    p.anonymousUserId = async () => { cancelled = true; return 'ab'.repeat(32); };
    await expect(runAiJob(job.id, p)).resolves.toBe('ignored');
    expect(p.begin).not.toHaveBeenCalled(); expect(p.generate).not.toHaveBeenCalled();
  });
  it('aborts an in-flight model and avoids retries or saving its late result', async () => {
    vi.useFakeTimers(); const p = ports(); let cancelled = false; let signal: AbortSignal | undefined;
    p.isCancelled = async () => cancelled;
    p.generate = vi.fn(async input => {
      signal = (input as typeof input & { signal?: AbortSignal }).signal;
      if (!signal) return generated;
      return new Promise<typeof generated>((_, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    });
    const running = runAiJob(job.id, p);
    await vi.advanceTimersByTimeAsync(0); cancelled = true;
    await vi.advanceTimersByTimeAsync(1000);
    await expect(running).resolves.toBe('ignored');
    expect(signal?.aborted).toBe(true); expect(p.complete).not.toHaveBeenCalled(); expect(p.markProviderFailure).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('treats a cancelled completion race as cancellation instead of a model failure', async () => {
    const p = ports(); let cancelled = false;
    p.isCancelled = async () => cancelled;
    p.complete = vi.fn(async () => { cancelled = true; throw new Error('AI_JOB_INVALID_TRANSITION'); });
    await expect(runAiJob(job.id, p)).resolves.toBe('ignored');
    expect(p.markProviderFailure).not.toHaveBeenCalled();
  });
});
