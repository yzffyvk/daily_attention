import { describe, expect, it } from 'vitest';
import { createDeepSeekProvider } from '@/supabase/functions/_shared/ai/deepseek';
import { parseKnowledgeStructure, serializeStructuredSummary, structuredSummarySchema } from '@/lib/domain/knowledge-structure';
import { relationSource, relationSummaryFixture } from '../../helpers/knowledge-structure-fixture';
const sourceText = relationSource.repeat(5);
const input = { sourceTitle: '上下文工程', sourceText, anonymousUserId: 'ab'.repeat(32), userPrompt: '', promptVersion: 'knowledge-relations-v2' };
function providerFor(result: unknown, capture?: (body: Record<string, unknown>) => void) {
  return createDeepSeekProvider({ apiKey: 'test-key', fetchImpl: async (_url, init) => {
    capture?.(JSON.parse(init!.body as string));
    return new Response(JSON.stringify({ model: 'deepseek-v4-pro', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }], usage: { prompt_tokens: 200, completion_tokens: 100 } }));
  } });
}
describe('relation-aware generation', () => {
  it('generates editable source-grounded relations from a structured model response', async () => {
    const result = await providerFor(relationSummaryFixture()).generate(input);
    const structure = parseKnowledgeStructure(result.result.summary);
    expect(structure?.relations.find(edge => edge.kind === '权衡')?.condition).toBe('改写位置之后的缓存失效');
    expect(result.result.inspiration).toBe('');
    expect(result.providerCallCount).toBe(1);
  });
  it('uses the actual source fragment when the model only added a terminal full stop', async () => {
    const output = relationSummaryFixture();
    output.structure.nodes[3].evidence = '压缩替换较早的消息历史。';
    let calls = 0;
    const result = await providerFor(output, () => { calls++; }).generate(input);
    expect(parseKnowledgeStructure(result.result.summary)?.nodes[3].evidence).toBe('压缩替换较早的消息历史');
    expect(calls).toBe(1);
  });
  it('restores source quotation marks without accepting changed words', async () => {
    const output = relationSummaryFixture();
    output.structure.nodes[3].evidence = '压缩保留"关键事实"。';
    const result = await providerFor(output).generate({ ...input, sourceText: sourceText + '压缩保留“关键事实”。' });
    expect(parseKnowledgeStructure(result.result.summary)?.nodes[3].evidence).toBe('压缩保留“关键事实”。');
    await expect(providerFor(output).generate({ ...input, sourceText: sourceText + '压缩丢弃“关键事实”。' })).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  });
  it('preserves an already exact double-quoted literal when a single-quoted literal appears first', async () => {
    const output = relationSummaryFixture();
    output.structure.nodes[3].evidence = '"main"';
    const result = await providerFor(output).generate({ ...input, sourceText: sourceText + `C语言中 'main' 是多字符常量，"main" 是字符串常量。` });
    expect(parseKnowledgeStructure(result.result.summary)?.nodes[3].evidence).toBe('"main"');
  });
  it('does not substitute a single-quoted literal for a missing double-quoted one', async () => {
    const output = relationSummaryFixture();
    output.structure.nodes[3].evidence = '"main"';
    await expect(providerFor(output).generate({ ...input, sourceText: sourceText + `C语言中 'main' 是多字符常量。` })).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  });
  it('keeps user requirements outside source data and supports all ten material types', async () => {
    let body: Record<string, unknown> = {};
    await providerFor(relationSummaryFixture(), value => { body = value; }).generate({ ...input, userPrompt: '面向初学者' });
    const messages = body.messages as { role: string; content: string }[];
    expect(JSON.parse(messages[1].content)).toMatchObject({ userRequirements: '面向初学者', source: { text: sourceText } });
    expect(messages[0].content).toContain('演化与历史');
    expect(messages[0].content).toContain('学习顺序');
    expect(messages[0].content).not.toContain(sourceText);
  });
  it('rejects a relationship whose evidence was invented', async () => {
    const output = relationSummaryFixture();
    output.structure.relations[0].evidence = '资料没有提供这段支持';
    await expect(providerFor(output).generate(input)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID', retryable: true });
  });
  it('repairs invalid structure once with specific feedback and counts both real calls', async () => {
    const invalid = relationSummaryFixture();
    invalid.structure.relations[0].evidence = '资料没有提供这段支持';
    const requests: { messages: { role: string; content: string }[]; thinking: { type: string }; max_tokens: number }[] = [];
    const provider = createDeepSeekProvider({ apiKey: 'test-key', fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init!.body as string));
      return Response.json({ model: 'deepseek-v4-pro', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(requests.length === 1 ? invalid : relationSummaryFixture()) } }], usage: { prompt_tokens: 200, completion_tokens: 100 } });
    } });
    const result = await provider.generate(input);
    expect(result.providerCallCount).toBe(2);
    expect(result.usage).toMatchObject({ promptTokens: 400, completionTokens: 200 });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ thinking: { type: 'enabled' }, max_tokens: 16384 });
    expect(requests[1]).toMatchObject({ thinking: { type: 'disabled' }, max_tokens: 8192 });
    expect(requests[1].messages.at(-1)?.content).toContain('relations[0].evidence');
    expect(requests[1].messages.at(-2)).toMatchObject({ role: 'assistant', content: JSON.stringify(invalid) });
    expect(parseKnowledgeStructure(result.result.summary)).not.toBeNull();
  });
  it('stops after one failed repair and preserves the usage of both responses', async () => {
    const invalid = relationSummaryFixture();
    invalid.structure.relations[0].evidence = '资料没有提供这段支持';
    let calls = 0;
    const provider = providerFor(invalid, () => { calls++; });
    await expect(provider.generate(input)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID', providerCallCount: 2, usage: { promptTokens: 400, completionTokens: 200 } });
    expect(calls).toBe(2);
  });
  it('provides actual nearby source text when an evidence quote was incorrectly joined', async () => {
    const invalid = relationSummaryFixture();
    invalid.structure.relations[0].evidence = '上下文包含系统提示词和消息历史，这里拼接了原文没有的内容';
    const requests: { messages: { content: string }[] }[] = [];
    const provider = createDeepSeekProvider({ apiKey: 'test-key', fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init!.body as string));
      return Response.json({ model: 'deepseek-v4-pro', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(requests.length === 1 ? invalid : relationSummaryFixture()) } }], usage: { prompt_tokens: 200, completion_tokens: 100 } });
    } });
    await provider.generate(input);
    expect(requests[1].messages.at(-1)?.content).toContain('原文片段');
    expect(requests[1].messages.at(-1)?.content).toContain('上下文包含系统提示词和消息历史');
  });
  it('counts the repair response usage even when its output is truncated', async () => {
    const invalid = relationSummaryFixture();
    invalid.structure.relations[0].evidence = '资料没有提供这段支持';
    let calls = 0;
    const provider = createDeepSeekProvider({ apiKey: 'test-key', fetchImpl: async () => {
      calls++;
      return Response.json({ model: 'deepseek-v4-pro', choices: [{ finish_reason: calls === 1 ? 'stop' : 'length', message: { content: JSON.stringify(invalid) } }], usage: { prompt_tokens: 200, completion_tokens: 100 } });
    } });
    await expect(provider.generate(input)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID', providerCallCount: 2, usage: { promptTokens: 400, completionTokens: 200 } });
  });
  it('repairs a truncated initial JSON once without repeating the reasoning phase', async () => {
    let calls = 0;
    const provider = createDeepSeekProvider({ apiKey: 'test-key', fetchImpl: async () => {
      calls++;
      return Response.json({ model: 'deepseek-v4-pro', choices: [{ finish_reason: calls === 1 ? 'length' : 'stop', message: { content: calls === 1 ? '{"attention":' : JSON.stringify(relationSummaryFixture()) } }], usage: { prompt_tokens: 200, completion_tokens: 100 } });
    } });
    const result = await provider.generate(input);
    expect(result.providerCallCount).toBe(2);
    expect(parseKnowledgeStructure(result.result.summary)).not.toBeNull();
  });
  it('rejects a document whose embedded headings would detach explanations from nodes', async () => {
    const output = relationSummaryFixture();
    output.structure.nodes[0].explanation = '解释内容。\n### 意外的节点\n这段解释不应静默丢失。';
    await expect(providerFor(output).generate(input)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID', retryable: true });
  });
  it('rejects oversized output instead of silently cutting relationships or explanations', async () => {
    const output = relationSummaryFixture();
    output.structure.nodes.forEach(node => { node.explanation = '有效解释。'.repeat(140); });
    output.distinctions = '关系边界。'.repeat(240);
    output.structure.relations.forEach(edge => { edge.condition = '必要条件。'.repeat(36); });
    expect(serializeStructuredSummary(structuredSummarySchema.parse(output)).length).toBeGreaterThan(4800);
    await expect(providerFor(output).generate(input)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  });
  it('reports evidence and length problems together so one repair can address both', async () => {
    const invalid = relationSummaryFixture();
    invalid.structure.nodes.forEach(node => { node.explanation = '解'.repeat(700); });
    invalid.distinctions = '辨'.repeat(1200);
    invalid.structure.relations.forEach(edge => { edge.condition = '条'.repeat(180); });
    invalid.structure.relations[0].evidence = '上下文包含系统提示词和消息历史，拼接的内容';
    const requests: { messages: { content: string }[] }[] = [];
    const provider = createDeepSeekProvider({ apiKey: 'test-key', fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init!.body as string));
      return Response.json({ model: 'deepseek-v4-pro', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(requests.length === 1 ? invalid : relationSummaryFixture()) } }], usage: { prompt_tokens: 200, completion_tokens: 100 } });
    } });
    await provider.generate(input);
    expect(requests[1].messages.at(-1)?.content).toContain('relations[0].evidence');
    expect(requests[1].messages.at(-1)?.content).toContain('4800');
  });
});
