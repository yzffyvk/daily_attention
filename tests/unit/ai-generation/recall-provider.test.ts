import { describe, expect, it, vi } from 'vitest';
import { createDeepSeekProvider } from '@/supabase/functions/_shared/ai/deepseek';
import { parseQuestionSummary } from '@/lib/domain/knowledge-questions';
import { questionSummaryFixture } from '../../helpers/knowledge-questions-fixture';

const sourceText = '计划列出行动步骤，检查用于验证结果。'.repeat(30);
const input = { sourceTitle: '工作方法', sourceText, anonymousUserId: 'ab'.repeat(32), userPrompt: '讲清作用原理', promptVersion: 'knowledge-recall-v1' };
const framework = () => ({
  attention: '计划与检查', thesis: '先明确行动，再检查结果。', coreQuestion: '如何安排并检查行动？',
  parts: [
    { id: 'q1', mainlineRole: '明确行动', title: '如何安排？', scope: '行动安排', evidence: 'S0001',
      concepts: [{ id: 'n1', name: '计划', summary: '安排步骤', evidence: 'S0001' }] },
    { id: 'q2', mainlineRole: '验证行动', title: '如何检查？', scope: '结果验证', evidence: 'S0001',
      concepts: [{ id: 'n2', name: '检查', summary: '验证结果', evidence: 'S0001' }] },
  ],
});

function fakeProvider(outputs: unknown[], requests: Record<string, unknown>[], beforeResponse?: (call: number) => void) {
  return createDeepSeekProvider({ apiKey: 'test-key', fetchImpl: async (_url, init) => {
    requests.push(JSON.parse(init!.body as string));
    beforeResponse?.(requests.length);
    return Response.json({ model: 'test-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(outputs[Math.min(requests.length - 1, outputs.length - 1)]) } }], usage: { prompt_tokens: 100, completion_tokens: 80 } });
  } });
}

describe('recall-first distillation', () => {
  it('plans the framework before writing and counts both calls without publishing a partial plan', async () => {
    const requests: Record<string, unknown>[] = [];
    const progress = vi.fn();
    const result = await fakeProvider([framework(), framework(), questionSummaryFixture()], requests, call => {
      if (call === 3) expect(progress.mock.calls.every(([event]) => event.preview === '')).toBe(true);
    }).generate({ ...input, onProgress: progress });
    expect(result.providerCallCount).toBe(3);
    expect(result.usage).toMatchObject({ promptTokens: 300, completionTokens: 240 });
    const body = JSON.parse((requests[2].messages as { content: string }[])[1].content);
    expect(JSON.parse((requests[1].messages as { content: string }[])[1].content).draftFramework).toEqual(framework());
    expect(body.framework).toEqual(framework());
    expect(body.userRequirements).toBe('讲清作用原理');
    expect(body.source.text).toContain('[S0001]');
    expect(parseQuestionSummary(result.result.summary)?.structure.questionOrder).toEqual(['q1', 'q2']);
  });
  it('repairs a changed framework without replanning or silently dropping the new content', async () => {
    const changed = questionSummaryFixture();
    changed.structure.nodes.push({ ...changed.structure.nodes[0], id: 'n3', name: '额外概念' });
    changed.structure.questions[0].views[0].nodeIds.push('n3');
    const requests: Record<string, unknown>[] = [];
    const result = await fakeProvider([framework(), framework(), changed, questionSummaryFixture()], requests).generate(input);
    expect(result.providerCallCount).toBe(4);
    expect(result.usage.promptTokens).toBe(400);
    const repair = requests[3].messages as { content: string }[];
    expect(repair.at(-1)?.content).toContain('骨架');
    expect(JSON.parse(repair[1].content).framework).toEqual(framework());
    expect(parseQuestionSummary(result.result.summary)?.structure.questions[0].mainlineRole).toBe('明确行动');
  });
  it('fills stable framework fields by id while preserving the generated explanations', async () => {
    const written = questionSummaryFixture();
    written.thesis = '正文改写了标题';
    written.structure.questions[0].mainlineRole = '另一个标题';
    written.structure.nodes[0].name = '同一概念的别名';
    written.structure.nodes[0].summary = '同一提示的改写';
    written.structure.nodes[0].explanation = '列出下一步行动，并明确要检查的结果。';
    const result = await fakeProvider([framework(), framework(), written], []).generate(input);
    const parsed = parseQuestionSummary(result.result.summary)!;
    expect(result.providerCallCount).toBe(3);
    expect(parsed.thesis).toBe('先明确行动，再检查结果。');
    expect(parsed.structure.questions[0].mainlineRole).toBe('明确行动');
    expect(parsed.structure.nodes[0]).toMatchObject({ name: '计划', summary: '安排步骤', explanation: '列出下一步行动，并明确要检查的结果。' });
  });
  it('repairs swapped concept ids before canonical names can hide mismatched explanations', async () => {
    const swapped = questionSummaryFixture();
    const [plan, check] = swapped.structure.nodes;
    swapped.structure.nodes = [{ ...check, id: plan.id, homeQuestionId: plan.homeQuestionId }, { ...plan, id: check.id, homeQuestionId: check.homeQuestionId }];
    const requests: Record<string, unknown>[] = [];
    const result = await fakeProvider([framework(), framework(), swapped, questionSummaryFixture()], requests).generate(input);
    expect(result.providerCallCount).toBe(4);
    expect((requests[3].messages as { content: string }[]).at(-1)?.content).toContain('概念编号');
    expect(parseQuestionSummary(result.result.summary)!.structure.nodes[0]).toMatchObject({ name: '计划', explanation: '列出下一步行动。' });
  });
  it('rejects an unsupported framework citation with one shared repair allowance', async () => {
    const unsupported = framework(); unsupported.parts[0].evidence = 'S9999';
    const requests: Record<string, unknown>[] = [];
    await expect(fakeProvider([unsupported], requests).generate(input)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID', providerCallCount: 2, usage: { promptTokens: 200 } });
    expect(requests).toHaveLength(2);
  });
  it('passes the draft through an editor before asking for the learning prose', async () => {
    const directory = framework();
    directory.parts[0].mainlineRole = '工具通用设计原则';
    directory.parts[0].concepts[0].summary = '本章展开主动调用三类，其余留到第六章。';
    const requests: Record<string, unknown>[] = [];
    const result = await fakeProvider([directory, framework(), questionSummaryFixture()], requests).generate(input);
    expect(result.providerCallCount).toBe(3);
    expect(JSON.parse((requests[1].messages as { content: string }[])[1].content)).not.toHaveProperty('framework');
    expect(JSON.parse((requests[1].messages as { content: string }[])[1].content).draftFramework.parts[0].mainlineRole).toBe('工具通用设计原则');
    expect(JSON.parse((requests[2].messages as { content: string }[])[1].content).framework.parts[0].mainlineRole).toBe('明确行动');
  });
  it('shares one repair across planning, editing and writing', async () => {
    const invalid = framework(); invalid.parts[0].evidence = 'S9999';
    const changed = questionSummaryFixture(); changed.structure.nodes[0].id = 'unknown';
    const requests: Record<string, unknown>[] = [];
    await expect(fakeProvider([invalid, framework(), framework(), changed], requests).generate(input)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID', providerCallCount: 4, usage: { promptTokens: 400 } });
    expect(requests).toHaveLength(4);
  });
  it('stops before the writing call when cancellation arrives after planning', async () => {
    const controller = new AbortController();
    const requests: Record<string, unknown>[] = [];
    await expect(fakeProvider([framework(), questionSummaryFixture()], requests, () => controller.abort()).generate({ ...input, signal: controller.signal })).rejects.toMatchObject({ code: 'MODEL_SERVICE_ERROR', providerCallCount: 1, usage: { promptTokens: 100 } });
    expect(requests).toHaveLength(1);
  });
  it('preserves consumed usage when the deadline arrives after a framework repair', async () => {
    const invalid = framework(); invalid.parts[0].evidence = 'S9999';
    const controller = new AbortController();
    const requests: Record<string, unknown>[] = [];
    await expect(fakeProvider([invalid, framework()], requests, call => {
      if (call === 2) controller.abort(new DOMException('model deadline', 'TimeoutError'));
    }).generate({ ...input, signal: controller.signal })).rejects.toMatchObject({ code: 'MODEL_SERVICE_ERROR', providerCallCount: 2, usage: { promptTokens: 200, completionTokens: 160 } });
    expect(requests).toHaveLength(2);
  });
});
