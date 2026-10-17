import { describe, expect, it } from 'vitest';
import { createDeepSeekProvider } from '@/supabase/functions/_shared/ai/deepseek';
import { questionSummaryFixture } from '../../helpers/knowledge-questions-fixture';

const input = { sourceTitle: '工作方法', sourceText: '计划列出行动步骤，检查用于验证结果。'.repeat(30), anonymousUserId: 'ab'.repeat(32), promptVersion: 'knowledge-recall-v2' };
const draft = questionSummaryFixture();
const framework = { attention: draft.attention, thesis: draft.thesis, coreQuestion: draft.structure.coreQuestion, parts: draft.structure.questions.map(q => ({ id: q.id, mainlineRole: q.mainlineRole, title: q.title, scope: q.scope, evidence: 'S0001', concepts: draft.structure.nodes.filter(n => n.homeQuestionId === q.id).map(n => ({ id: n.id, name: n.name, summary: n.summary, evidence: 'S0001' })) })) };

describe('AI output validation diagnostics', () => {
  it('keeps a successful repaired draft when the diagnostic sink throws', async () => {
    const invalid = structuredClone(draft); invalid.structure.nodes[0].evidence = 'abc';
    const report = { verdict: 'pass', checks: { mainline: 'pass', hierarchy: 'pass', ownership: 'pass', coverage: 'pass', explanation: 'pass', grounding: 'pass', recall: 'pass' }, issues: [] };
    const outputs = [framework, invalid, draft, report];
    let calls = 0;
    const provider = createDeepSeekProvider({ apiKey: 'test-key', fetchImpl: async () => Response.json({ model: 'actual-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(outputs[calls++]) } }], usage: { prompt_tokens: 100, completion_tokens: 80 } }) });
    const result = await provider.generate({ ...input, onValidationFailure: () => { throw new Error('audit unavailable'); } });
    expect(result.semanticReview?.verdict).toBe('pass');
    expect(result.providerCallCount).toBe(4);
    expect(result.result.summary).toContain('检查实际结果，找出差距。');
  });

  it('identifies rejected writing fields on both attempts without logging document text', async () => {
    const invalid = structuredClone(draft); invalid.structure.nodes[0].explanation = 'PRIVATE_SOURCE_TEXT';
    invalid.structure.nodes[0].evidence = 'abc';
    let calls = 0;
    const audits: unknown[] = [];
    const provider = createDeepSeekProvider({ apiKey: 'test-key', fetchImpl: async () => Response.json({ model: 'writer-actual', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(++calls === 1 ? framework : invalid) } }], usage: { prompt_tokens: 100, completion_tokens: 80 } }) });
    await expect(provider.generate({ ...input, onValidationFailure: audit => { audits.push(audit); } })).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID', providerCallCount: 3 });
    expect(audits).toEqual([
      { stage: 'writing', repair: false, reason: 'schema_invalid', issues: [{ path: 'structure.nodes.0.evidence', code: 'too_small' }] },
      { stage: 'writing', repair: true, reason: 'schema_invalid', issues: [{ path: 'structure.nodes.0.evidence', code: 'too_small' }] },
    ]);
    expect(JSON.stringify(audits)).not.toContain('PRIVATE_SOURCE_TEXT');
  });

  it('identifies a truncated planning response before preserving cancellation', async () => {
    let calls = 0;
    const audits: unknown[] = [];
    const provider = createDeepSeekProvider({ apiKey: 'test-key', fetchImpl: async () => {
      calls++;
      return Response.json({ model: 'writer-actual', choices: [{ finish_reason: calls === 1 ? 'length' : 'stop', message: { content: calls === 1 ? '{"attention":' : JSON.stringify(framework) } }], usage: { prompt_tokens: 100, completion_tokens: 80 } });
    } });
    const controller = new AbortController();
    await expect(provider.generate({ ...input, signal: controller.signal, onValidationFailure: audit => { audits.push(audit); controller.abort(); throw new Error('audit storage offline'); } })).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
    expect(audits).toEqual([{ stage: 'framework', repair: false, reason: 'output_truncated', issues: [] }]);
  });
});
