import { describe, expect, it, vi } from 'vitest';
import { createDeepSeekProvider } from '@/supabase/functions/_shared/ai/deepseek';
import { parseQuestionSummary } from '@/lib/domain/knowledge-questions';
import { questionSummaryFixture } from '../../helpers/knowledge-questions-fixture';
import type { SemanticReview } from '@/supabase/functions/_shared/ai/semantic-review';

const input = { sourceTitle: '工作方法', sourceText: '计划列出行动步骤，检查用于验证结果。'.repeat(30), anonymousUserId: 'ab'.repeat(32), userPrompt: '讲清作用原理', promptVersion: 'knowledge-recall-v2' };
function framework() {
  const doc = questionSummaryFixture();
  return { attention: doc.attention, thesis: doc.thesis, coreQuestion: doc.structure.coreQuestion,
    parts: doc.structure.questions.map(q => ({ id: q.id, mainlineRole: q.mainlineRole, title: q.title, scope: q.scope, evidence: 'S0001',
      concepts: doc.structure.nodes.filter(n => n.homeQuestionId === q.id).map(n => ({ id: n.id, name: n.name, summary: n.summary, evidence: 'S0001' })) })) };
}
function passed(): SemanticReview {
  return { verdict: 'pass', checks: { mainline: 'pass', hierarchy: 'pass', ownership: 'pass', coverage: 'pass', explanation: 'pass', grounding: 'pass', recall: 'pass' }, issues: [] };
}
function revise(): SemanticReview {
  return { verdict: 'revise', checks: { ...passed().checks, explanation: 'fail' }, issues: [{ dimension: 'explanation', severity: 'major', target: { kind: 'node', id: 'n2' }, problem: '解释只有名称，没有说明如何验证。', sourceIds: ['S0001'], instruction: '说明检查实际结果、寻找差距的过程。' }] };
}
function setup(outputs: unknown[], config: { reviewModel?: string } = {}, before?: (call: number) => void, reviewFinishReason = 'stop') {
  const requests: { model: string; stream: boolean; messages: { content: string }[] }[] = [];
  const provider = createDeepSeekProvider({ apiKey: 'test-key', ...config, fetchImpl: async (_url, init) => {
    const body = JSON.parse(init!.body as string); requests.push(body); before?.(requests.length);
    const content = JSON.stringify(outputs[Math.min(requests.length - 1, outputs.length - 1)]);
    return Response.json({ model: body.model === 'deepseek-flash' ? 'writer-actual' : 'reviewer-actual', choices: [{ finish_reason: body.model === 'deepseek-flash' ? 'stop' : reviewFinishReason, message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 80 } });
  } });
  return { provider, requests };
}

describe('semantic acceptance of finished recall documents', () => {
  it('delivers a complete long explanation without rejecting it or paying for a format rewrite', async () => {
    const draft = questionSummaryFixture();
    const explanation = '将实际结果与目标逐项对照，分析差距的原因，再用这些反馈调整下一次行动。'.repeat(30);
    draft.structure.nodes[1].explanation = explanation;
    const { provider, requests } = setup([framework(), draft, passed()]);
    const result = await provider.generate(input);
    const saved = parseQuestionSummary(result.result.summary)!;
    expect(saved.structure.nodes[1].explanation).toBe(explanation);
    expect(result.semanticReview?.verdict).toBe('pass');
    expect(result.providerCallCount).toBe(3);
    expect(requests[2].model).toBe('deepseek-v4-pro');
  });

  it('requires a separate Pro review of the exact validated document against the full original source', async () => {
    const { provider, requests } = setup([framework(), questionSummaryFixture(), passed()]);
    const audit = vi.fn(), progress = vi.fn();
    const result = await provider.generate({ ...input, onSemanticReview: audit, onProgress: progress });
    expect(requests.map(r => r.model)).toEqual(['deepseek-flash', 'deepseek-flash', 'deepseek-v4-pro']);
    expect(requests[2].stream).toBe(false);
    const body = JSON.parse(requests[2].messages[1].content);
    expect(body.draft).toEqual(parseQuestionSummary(result.result.summary));
    expect(body.source.text).toContain('[S0001]');
    expect(body.userRequirements).toBe(input.userPrompt);
    expect(result).toMatchObject({ providerCallCount: 3, usage: { promptTokens: 300, completionTokens: 240 }, semanticReview: { requestedModel: 'deepseek-v4-pro', returnedModel: 'reviewer-actual', rounds: 1, verdict: 'pass' } });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ requestedModel: 'deepseek-v4-pro', returnedModel: 'reviewer-actual', verdict: 'pass' }));
    expect(progress.mock.calls.some(([event]) => event.phase === 'validating' && event.preview === '')).toBe(true);
  });
  it('revises the specific failures and rechecks the revised document before returning', async () => {
    const fixed = questionSummaryFixture(); fixed.structure.nodes[1].explanation = '将实际结果与计划对照，找出差距。';
    const { provider, requests } = setup([framework(), questionSummaryFixture(), revise(), fixed, passed()]);
    const result = await provider.generate(input);
    expect(result.providerCallCount).toBe(5);
    expect(result.usage.promptTokens).toBe(500);
    const revision = JSON.parse(requests[3].messages[1].content);
    expect(revision.semanticReview).toEqual(revise());
    expect(revision.draft.structure.nodes[1].explanation).toBe('检查实际结果，找出差距。');
    expect(JSON.parse(requests[4].messages[1].content).draft.structure.nodes[1].explanation).toBe(fixed.structure.nodes[1].explanation);
    expect(parseQuestionSummary(result.result.summary)!.structure.nodes[1].explanation).toBe(fixed.structure.nodes[1].explanation);
    expect(result.semanticReview?.rounds).toBe(2);
  });
  it('allows a grounded mainline correction rather than binding the rejected mainline back in', async () => {
    const report = revise(); report.checks.mainline = 'fail'; report.checks.explanation = 'pass'; report.issues[0] = { ...report.issues[0], dimension: 'mainline', target: { kind: 'document', id: null }, problem: '主线过于空泛。', instruction: '明确计划与检查的不同作用。' };
    const fixed = questionSummaryFixture(); fixed.thesis = '计划明确要做什么，检查判断实际结果是否达到要求。';
    const { provider } = setup([framework(), questionSummaryFixture(), report, fixed, passed()]);
    expect(parseQuestionSummary((await provider.generate(input)).result.summary)!.thesis).toBe(fixed.thesis);
  });
  it('delivers an editable draft with specific unresolved issues when the final review still requests revision', async () => {
    const { provider, requests } = setup([framework(), questionSummaryFixture(), revise(), questionSummaryFixture(), revise()]);
    const result = await provider.generate(input);
    expect(result).toMatchObject({ providerCallCount: 5, usage: { promptTokens: 500 }, semanticReview: { verdict: 'needs_review', rounds: 2 } });
    const document = parseQuestionSummary(result.result.summary)!;
    expect(document.structure.nodes[1].explanation).toBe('检查实际结果，找出差距。');
    expect(document.warnings).toEqual(result.result.warnings);
    expect(document.warnings.join(' ')).toContain('检查');
    expect(document.warnings.join(' ')).toContain('解释只有名称，没有说明如何验证。');
    expect(requests).toHaveLength(5);
  });
  it.each(['contradictory-pass', 'unknown-target', 'invented-source'])('repairs invalid review data rather than trusting %s', async kind => {
    const invalid = kind === 'contradictory-pass' ? { ...passed(), issues: revise().issues } : revise();
    if (kind === 'unknown-target') invalid.issues[0].target.id = 'missing';
    if (kind === 'invented-source') invalid.issues[0].sourceIds = ['S9999'];
    const { provider } = setup([framework(), questionSummaryFixture(), invalid, passed()]);
    expect((await provider.generate(input)).providerCallCount).toBe(4);
  });
  it('delivers the valid draft without claiming semantic acceptance when the review report is malformed', async () => {
    const { provider, requests } = setup([framework(), questionSummaryFixture(), { verdict: 'pass' }]);
    const result = await provider.generate(input);
    expect(result).toMatchObject({ providerCallCount: 4, semanticReview: { verdict: 'unavailable' } });
    expect(result.result.warnings.join(' ')).toContain('复核未完成');
    expect(parseQuestionSummary(result.result.summary)).not.toBeNull();
    expect(requests).toHaveLength(4);
  });
  it.each(['length', 'content_filter', 'unexpected'])('records returned reviewer model even when finish_reason is %s', async reason => {
    const { provider } = setup([framework(), questionSummaryFixture(), passed()], {}, undefined, reason);
    const audit = vi.fn();
    expect((await provider.generate({ ...input, onSemanticReview: audit })).semanticReview?.verdict).toBe('unavailable');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ requestedModel: 'deepseek-v4-pro', returnedModel: 'reviewer-actual', verdict: 'invalid' }));
    expect(audit).toHaveBeenCalledTimes(reason === 'length' ? 2 : 1);
  });
  it('preserves the valid draft with a visible pending-review notice if Pro is unavailable', async () => {
    const { provider } = setup([framework(), questionSummaryFixture(), passed()], {}, call => { if (call === 3) throw new Error('network unavailable'); });
    const result = await provider.generate(input);
    expect(result).toMatchObject({ providerCallCount: 3, usage: { promptTokens: 200 }, semanticReview: { verdict: 'unavailable' } });
    expect(result.result.warnings.join(' ')).toContain('复核未完成');
    expect(result.result.warnings.join(' ')).not.toContain('network unavailable');
  });
  it('keeps the previous valid draft if semantic revision corrupts the document structure', async () => {
    const { provider, requests } = setup([framework(), questionSummaryFixture(), revise(), { broken: true }]);
    const result = await provider.generate(input);
    expect(parseQuestionSummary(result.result.summary)!.structure.nodes).toEqual(questionSummaryFixture().structure.nodes);
    expect(result.semanticReview?.verdict).toBe('needs_review');
    expect(result.result.warnings.join(' ')).toContain('解释只有名称，没有说明如何验证。');
    expect(requests).toHaveLength(5);
  });
  it('returns the valid draft if the model deadline arrives during review, without issuing more calls', async () => {
    const controller = new AbortController();
    const { provider, requests } = setup([framework(), questionSummaryFixture(), revise()], {}, call => { if (call === 3) controller.abort(new DOMException('deadline', 'TimeoutError')); });
    const result = await provider.generate({ ...input, signal: controller.signal });
    expect(parseQuestionSummary(result.result.summary)).not.toBeNull();
    expect(result.semanticReview?.verdict).toBe('needs_review');
    expect(result.providerCallCount).toBe(3);
    expect(requests).toHaveLength(3);
  });
  it('does not invent a result if no valid draft was ever produced', async () => {
    const { provider } = setup([framework(), { broken: true }]);
    await expect(provider.generate(input)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  });
  it('allows minor prose improvements once the framework and core facts pass, without another model call', async () => {
    const report = passed();
    report.issues = [{ ...revise().issues[0], severity: 'minor', problem: '个别句子略有重复，不影响理解。', instruction: '有需要时精简重复措辞。' }];
    const { provider, requests } = setup([framework(), questionSummaryFixture(), report]);
    const result = await provider.generate(input);
    expect(result.semanticReview?.verdict).toBe('pass');
    expect(result.result.warnings.join(' ')).toContain('个别句子略有重复');
    expect(result.result.warnings.join(' ')).not.toContain('待核对：');
    expect(requests).toHaveLength(3);
  });
  it.each(['mainline', 'hierarchy', 'ownership', 'coverage', 'recall'] as const)('requires revision for a failed framework %s check', async dimension => {
    const report = passed(); report.verdict = 'revise'; report.checks[dimension] = 'fail';
    report.issues = [{ ...revise().issues[0], dimension, target: { kind: 'document', id: null }, problem: '骨架分工或归属不明确。' }];
    const { provider } = setup([framework(), questionSummaryFixture(), report, questionSummaryFixture(), passed()]);
    expect((await provider.generate(input)).providerCallCount).toBe(5);
  });
  it('preserves every source notice and review issue when delivering a pending-review draft', async () => {
    const document = questionSummaryFixture(); document.warnings = Array.from({ length: 10 }, (_, i) => `资料范围提醒${i}`);
    const report = revise(); report.issues = Array.from({ length: 12 }, (_, i) => ({ ...report.issues[0], problem: `待完善解释${i}` }));
    const { provider } = setup([framework(), document, report, document, report]);
    const result = await provider.generate(input);
    expect(result.result.warnings).toHaveLength(23);
    for (const warning of document.warnings) expect(result.result.warnings).toContain(warning);
    for (const issue of report.issues) expect(result.result.warnings.join(' ')).toContain(issue.problem);
    expect(parseQuestionSummary(result.result.summary)?.warnings).toEqual(result.result.warnings);
  });
  it('keeps multiline review findings readable and round-trippable in the saved draft', async () => {
    const report = revise(); report.issues[0].problem = '第一处解释不足。\n第二处需要核对。';
    const { provider } = setup([framework(), questionSummaryFixture(), report, questionSummaryFixture(), report]);
    const result = await provider.generate(input);
    expect(parseQuestionSummary(result.result.summary)?.warnings.join(' ')).toContain('第一处解释不足。 第二处需要核对。');
  });
  it('honors cancellation before semantic revision and preserves review usage', async () => {
    const controller = new AbortController();
    const { provider, requests } = setup([framework(), questionSummaryFixture(), revise()], {}, call => { if (call === 3) controller.abort(); });
    await expect(provider.generate({ ...input, signal: controller.signal })).rejects.toMatchObject({ code: 'MODEL_SERVICE_ERROR', providerCallCount: 3, usage: { promptTokens: 300 } });
    expect(requests).toHaveLength(3);
  });
  it('supports an explicit reviewer model without changing the writing model', async () => {
    const { provider, requests } = setup([framework(), questionSummaryFixture(), passed()], { reviewModel: 'deepseek-custom-review' });
    await provider.generate(input);
    expect(requests[1].model).toBe('deepseek-flash'); expect(requests[2].model).toBe('deepseek-custom-review');
  });
  it.each([['方法', '方案'], ['区别', '概念']])('normalizes the display role alias %s without spending a model repair', async (role, expected) => {
    const draft = questionSummaryFixture();
    const written = { ...draft, structure: { ...draft.structure, nodes: draft.structure.nodes.map((node, i) => i === 0 ? { ...node, role } : node) } };
    const { provider } = setup([framework(), written, passed()]);
    const result = await provider.generate(input);
    expect(result.providerCallCount).toBe(3);
    expect(parseQuestionSummary(result.result.summary)!.structure.nodes[0].role).toBe(expected);
    expect(parseQuestionSummary(result.result.summary)!.structure.nodes[0].explanation).toBe(draft.structure.nodes[0].explanation);
  });
  it('derives a missing home-view membership from explicit ownership without changing prose or relations', async () => {
    const written = questionSummaryFixture();
    written.structure.questions[0].views[0].nodeIds = ['n2'];
    written.structure.questions[0].views[0].readingOrder = ['n2'];
    const { provider } = setup([framework(), written, passed()]);
    const result = await provider.generate(input);
    const parsed = parseQuestionSummary(result.result.summary)!;
    expect(result.providerCallCount).toBe(3);
    expect(parsed.structure.questions[0].views[0].nodeIds).toContain('n1');
    expect(parsed.structure.nodes).toEqual(written.structure.nodes);
    expect(parsed.structure.relations[0]).toEqual(written.structure.relations[0]);
  });
});
