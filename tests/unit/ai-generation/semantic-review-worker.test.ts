import { describe, expect, it, vi } from 'vitest';
import { createProductionDependencies } from '@/supabase/functions/ai-generation-worker/index';
import { parseQuestionSummary } from '@/lib/domain/knowledge-questions';
import { questionSummaryFixture } from '../../helpers/knowledge-questions-fixture';

describe('semantic review production wiring', () => {
  it.each([
    { reviewerAvailable: true, roleFallback: false }, { reviewerAvailable: false, roleFallback: false },
    { reviewerAvailable: true, roleFallback: true }, { reviewerAvailable: false, roleFallback: true },
  ])('persists a readable result (reviewer=$reviewerAvailable, roleFallback=$roleFallback)', async ({ reviewerAvailable, roleFallback }) => {
    const draft = questionSummaryFixture();
    const framework = { attention: draft.attention, thesis: draft.thesis, coreQuestion: draft.structure.coreQuestion,
      parts: draft.structure.questions.map(q => ({ id: q.id, mainlineRole: q.mainlineRole, title: q.title, scope: q.scope, evidence: 'S0001', concepts: draft.structure.nodes.filter(n => n.homeQuestionId === q.id).map(n => ({ id: n.id, name: n.name, summary: n.summary, evidence: 'S0001' })) })) };
    if (roleFallback) Object.assign(draft.structure.nodes[0], { role: 'PRIVATE_ROLE_TEXT' });
    const report = { verdict: 'pass', checks: { mainline: 'pass', hierarchy: 'pass', ownership: 'pass', coverage: 'pass', explanation: 'pass', grounding: 'pass', recall: 'pass' }, issues: [] };
    const job = { id: '10000000-0000-4000-8000-000000000001', user_id: '00000000-0000-4000-8000-000000000001', source_url: 'https://example.com/article', attempt_count: 1, user_prompt: '', prompt_version: 'knowledge-recall-v2' };
    const env: Record<string, string> = { SUPABASE_URL: 'https://semantic-review-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-key', DEEPSEEK_API_KEY: 'test-key', AI_USER_ID_PEPPER: 'pepper-with-at-least-thirty-two-characters', SAFE_FETCH_GATEWAY_URL: 'https://fetch.example.com', SAFE_FETCH_GATEWAY_TOKEN: 'gateway-token-with-at-least-thirty-two-characters', AI_REVIEW_MODEL: 'deepseek-configured-review' };
    const requested: string[] = [], saved: Record<string, unknown>[] = [];
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/read_ai_generation_job_execution_status')) return Response.json('generating');
      if (url.endsWith('/claim_ai_generation_job') || url.endsWith('/begin_ai_generation')) return Response.json([job]);
      if (url.endsWith('/v1/fetch')) return Response.json({ finalUrl: job.source_url, contentType: 'text/html', body: `<html><head><title>工作方法</title></head><body><article><p>${'计划列出行动步骤，检查用于验证结果。'.repeat(30)}</p></article></body></html>` });
      if (url.endsWith('/report_ai_generation_progress')) return Response.json(null);
      if (url.endsWith('/chat/completions')) {
        requested.push(JSON.parse(init!.body as string).model);
        if (requested.length === 3 && !reviewerAvailable) return Response.json({ error: { code: 'unavailable' } }, { status: 503 });
        return Response.json({ model: requested.length === 3 ? 'deepseek-returned-actual' : 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify([framework, draft, report][requested.length - 1]) } }], usage: { prompt_tokens: 100, completion_tokens: 80 } });
      }
      if (url.endsWith('/complete_ai_generation_job')) { saved.push(JSON.parse(init!.body as string)); return Response.json([]); }
      throw new Error(`Unexpected endpoint: ${url}`);
    });
    try {
      await expect(createProductionDependencies(name => env[name], { dedicatedWorker: true }).runJob(job.id)).resolves.toBe('completed');
      expect(requested).toEqual(['deepseek-flash', 'deepseek-flash', 'deepseek-configured-review']);
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({ target_succeeded: true, target_provider_call_count: 3, target_prompt_tokens: reviewerAvailable ? 300 : 200, target_completion_tokens: reviewerAvailable ? 240 : 160 });
      if (roleFallback) {
        expect(parseQuestionSummary(saved[0].target_summary as string)!.structure.nodes[0].role).toBe('概念');
        expect(log.mock.calls.map(([line]) => JSON.parse(line))).toContainEqual({ event: 'ai_output_role_normalized', jobId: job.id,
          stage: 'writing', repair: false, paths: ['structure.nodes.0.role'], fallback: '概念' });
        expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_ROLE_TEXT');
      }
      if (reviewerAvailable) expect(log.mock.calls.map(([line]) => JSON.parse(line))).toContainEqual(expect.objectContaining({ event: 'ai_semantic_review', jobId: job.id, requestedModel: 'deepseek-configured-review', returnedModel: 'deepseek-returned-actual', verdict: 'pass' }));
      else {
        expect(saved[0].target_summary).toContain('复核未完成');
        expect((saved[0].target_warnings as string[]).join(' ')).toContain('待核对：');
      }
    } finally { log.mockRestore(); vi.unstubAllGlobals(); }
  });
});
