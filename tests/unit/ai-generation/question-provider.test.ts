import { describe, expect, it } from 'vitest';
import { createDeepSeekProvider } from '@/supabase/functions/_shared/ai/deepseek';
import { parseQuestionSummary, serializeQuestionSummary } from '@/lib/domain/knowledge-questions';
import { questionSummaryFixture } from '../../helpers/knowledge-questions-fixture';
import { indexQuestionSource } from '@/supabase/functions/_shared/ai/question-source';
const sourceText = '计划列出行动步骤，检查用于验证结果。'.repeat(30);
const input = { sourceTitle: '工作方法', sourceText, anonymousUserId: 'ab'.repeat(32), userPrompt: '', promptVersion: 'knowledge-questions-v1' };
function provider(outputs: unknown[], requests: Record<string, unknown>[]) {
  return createDeepSeekProvider({ apiKey: 'test-key', fetchImpl: async (_url, init) => {
    requests.push(JSON.parse(init!.body as string));
    return Response.json({ model: 'test-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(outputs[Math.min(requests.length - 1, outputs.length - 1)]) } }], usage: { prompt_tokens: 100, completion_tokens: 80 } });
  } });
}
describe('question-led generation', () => {
  function nearLimit(size: number) {
    const output = questionSummaryFixture();
    for (let i = 3; i <= 22; i++) {
      output.structure.nodes.push({ ...output.structure.nodes[0], id: `n${i}`, name: `概念${i}`, explanation: '说明' });
      output.structure.questions[0].views[0].nodeIds.push(`n${i}`);
    }
    let remaining = size - serializeQuestionSummary(output).length;
    for (const node of output.structure.nodes) {
      const added = Math.min(remaining, 700 - node.explanation.length);
      node.explanation += '知'.repeat(added); remaining -= added;
    }
    expect(remaining).toBe(0);
    return output;
  }
  it('uses final persisted length including the source warning instead of an arbitrary reserved buffer', async () => {
    const requests: Record<string, unknown>[] = [];
    const result = await provider([nearLimit(11920)], requests).generate({ ...input, sourceTruncated: true });
    expect(result.result.summary.length).toBeLessThanOrEqual(12000);
    expect(result.result.summary).toContain('资料范围：原文较长');
    expect(parseQuestionSummary(result.result.summary)).not.toBeNull();
    expect(requests).toHaveLength(1);
  });
  it('still rejects a structure that exceeds the final limit after adding the source warning', async () => {
    await expect(provider([nearLimit(11999)], []).generate({ ...input, sourceTruncated: true }))
      .rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID', providerCallCount: 2 });
  });
  it('resolves source IDs to original excerpts and fills only existing view relations without another model call', async () => {
    const output = questionSummaryFixture();
    for (const key of ['questions', 'nodes', 'relations'] as const) for (const item of output.structure[key]) item.evidence = 'S0001';
    output.structure.questions[1].views[0].relationIds = [];
    output.structure.questionLinks = [];
    const requests: Record<string, unknown>[] = [];
    const result = await provider([output], requests).generate(input);
    const parsed = parseQuestionSummary(result.result.summary)!;
    expect(parsed.structure.questions[0].evidence).toBe(indexQuestionSource(sourceText).resolve('S0001'));
    expect(parsed.structure.questions[1].views[0].relationIds).toEqual(['e1']);
    expect(result.providerCallCount).toBe(1);
  });
  it('rejects unknown source IDs without inventing citations', async () => {
    const output = questionSummaryFixture(); output.structure.questions[0].evidence = 'S9999';
    await expect(provider([output], []).generate(input)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID', providerCallCount: 2 });
  });
  it('generates local question views with empty user requirements and current source', async () => {
    const requests: Record<string, unknown>[] = [];
    const result = await provider([questionSummaryFixture()], requests).generate(input);
    expect(parseQuestionSummary(result.result.summary)?.structure.questions).toHaveLength(2);
    const messages = requests[0].messages as { content: string }[];
    expect(JSON.parse(messages[1].content)).toMatchObject({ userRequirements: '', source: { text: indexQuestionSource(sourceText).text } });
    expect(messages[0].content).toContain('问题');
    expect(messages[0].content).not.toContain('chapter2');
    expect(result.providerCallCount).toBe(1);
  });
  it('drops a misplaced local reference while preserving the shared edge and its valid home view', async () => {
    const invalid = questionSummaryFixture(); invalid.structure.questions[0].views[0].relationIds = ['e1'];
    const requests: Record<string, unknown>[] = [];
    const result = await provider([invalid, questionSummaryFixture()], requests).generate(input);
    expect(result.providerCallCount).toBe(1);
    expect(result.usage.promptTokens).toBe(100);
    expect(parseQuestionSummary(result.result.summary)).not.toBeNull();
  });
  it('validates question evidence as well as nodes and edges', async () => {
    const invalid = questionSummaryFixture(); invalid.structure.questions[0].evidence = '原文不存在的依据';
    const requests: Record<string, unknown>[] = [];
    await expect(provider([invalid], requests).generate(input)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID', providerCallCount: 2 });
    expect(JSON.stringify(requests[1])).toContain('questions[0].evidence');
  });
  it.each(['', null])('recovers once when reasoning exhausts the budget with content %s', async content => {
    const requests: Record<string, unknown>[] = [];
    const p = createDeepSeekProvider({ apiKey: 'test-key', fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init!.body as string));
      const exhausted = requests.length === 1;
      return Response.json({ model: 'test-model', choices: [{ finish_reason: exhausted ? 'length' : 'stop', message: {
        content: exhausted ? content : JSON.stringify(questionSummaryFixture()),
        reasoning_content: exhausted ? 'private reasoning must not be forwarded' : undefined,
      } }], usage: { prompt_tokens: 100, completion_tokens: exhausted ? 16384 : 80, completion_tokens_details: { reasoning_tokens: exhausted ? 16384 : 0 } } });
    } });
    const result = await p.generate(input);
    expect(parseQuestionSummary(result.result.summary)).not.toBeNull();
    expect(result.providerCallCount).toBe(2);
    expect(result.usage).toMatchObject({ promptTokens: 200, completionTokens: 16464, reasoningTokens: 16384 });
    // The real long article used ~15k reasoning tokens before writing its JSON.
    // Leave room for the answer while keeping the non-thinking repair bounded.
    expect(requests[0]).toMatchObject({ max_tokens: 32768, thinking: { type: 'enabled' }, reasoning_effort: 'high' });
    expect(requests[1]).toMatchObject({ max_tokens: 16384 });
    expect(requests[1]).toMatchObject({ thinking: { type: 'disabled' } });
    expect(requests[1]).not.toHaveProperty('reasoning_effort');
    const messages = requests[1].messages as { role: string; content: string }[];
    expect(messages.filter(m => m.role === 'assistant')).toHaveLength(0);
    expect(JSON.parse(messages[1].content)).toMatchObject({ userRequirements: '', source: { text: indexQuestionSource(sourceText).text } });
    expect(JSON.stringify(requests[1])).not.toContain('private reasoning');
  });
  it('stops after the single repair if the model again returns no answer', async () => {
    let calls = 0;
    const p = createDeepSeekProvider({ apiKey: 'test-key', fetchImpl: async () => {
      calls++;
      return Response.json({ model: 'test-model', choices: [{ finish_reason: 'length', message: { content: '' } }], usage: { prompt_tokens: 100, completion_tokens: 16384 } });
    } });
    await expect(p.generate(input)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID', providerCallCount: 2, usage: { completionTokens: 32768 } });
    expect(calls).toBe(2);
  });
});
