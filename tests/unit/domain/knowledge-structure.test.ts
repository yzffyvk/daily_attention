import { describe, expect, it } from 'vitest';
import { relationSource, relationSummaryFixture } from '../../helpers/knowledge-structure-fixture';
import { structuredSummarySchema, serializeStructuredSummary, parseKnowledgeStructure, hasSourceEvidence } from '@/lib/domain/knowledge-structure';
import { parseKnowledgeSummary } from '@/lib/domain/knowledge-summary';

describe('relation-aware knowledge summaries', () => {
  it('keeps valid legacy graphs readable after a user expands the summary beyond 5000 characters', () => {
    const input = relationSummaryFixture();
    input.distinctions = '辨'.repeat(1200);
    input.structure.nodes.forEach(node => { node.explanation = '解'.repeat(700); node.summary = '定'.repeat(120); node.evidence = '据'.repeat(180); });
    input.structure.relations.forEach(edge => { edge.condition = '条'.repeat(180); edge.evidence = '据'.repeat(180); });
    const valid = structuredSummarySchema.parse(input), text = serializeStructuredSummary(valid);
    expect(text.length).toBeGreaterThan(5000);
    expect(text.length).toBeLessThanOrEqual(12000);
    expect(parseKnowledgeStructure(text)).toEqual(valid.structure);
  });
  it('round-trips cross-relations, conditions, evidence and reading guidance through editable text', () => {
    const input = structuredSummarySchema.parse(relationSummaryFixture());
    const text = serializeStructuredSummary(input);
    expect(parseKnowledgeStructure(text)).toEqual(input.structure);
    expect(parseKnowledgeSummary(text).structure).toEqual(input.structure);
    expect(parseKnowledgeSummary(text).prompts).toEqual(input.prompts);
    expect(parseKnowledgeSummary(text).original).toBe(text);
  });
  it('preserves pipe, backslash and angle bracket text without treating it as HTML', () => {
    const input = relationSummaryFixture();
    input.structure.nodes[0].summary = 'A | B \\ C <tag> &amp;';
    const valid = structuredSummarySchema.parse(input);
    expect(parseKnowledgeStructure(serializeStructuredSummary(valid))).toEqual(valid.structure);
  });
  it('keeps a complete supporting sentence when its necessary context exceeds 100 characters', () => {
    const input = relationSummaryFixture();
    input.structure.nodes[0].evidence = '保留连续原文中的必要条件。'.repeat(10);
    expect(input.structure.nodes[0].evidence.length).toBeGreaterThan(100);
    const parsed = structuredSummarySchema.parse(input);
    expect(parseKnowledgeStructure(serializeStructuredSummary(parsed))).toEqual(parsed.structure);
  });
  it('compacts table spacing before rejecting a near-limit document without losing any content', () => {
    const input = relationSummaryFixture();
    input.distinctions = '辨'.repeat(1200);
    input.structure.nodes.forEach(node => { node.explanation = '解'.repeat(650); });
    input.structure.relations.forEach(edge => { edge.condition = '条'.repeat(120); });
    input.structure.nodes[0].summary += '补'.repeat(44);
    const parsed = structuredSummarySchema.parse(input);
    const text = serializeStructuredSummary(parsed);
    expect(text.length).toBeLessThanOrEqual(4800);
    expect(parseKnowledgeStructure(text)).toEqual(parsed.structure);
    expect(text).toContain(input.distinctions);
  });
  it.each(['dangling', 'duplicate', 'cycle', 'unknown-order'])('rejects misleading structure: %s', problem => {
    const input = relationSummaryFixture();
    if (problem === 'dangling') input.structure.relations[0].to = 'missing';
    if (problem === 'duplicate') input.structure.nodes[1].name = '上下文';
    if (problem === 'cycle') input.structure.relations.push({ ...input.structure.relations[0], from: '消息历史', to: '上下文' });
    if (problem === 'unknown-order') input.structure.readingOrder.push('missing');
    expect(structuredSummarySchema.safeParse(input).success).toBe(false);
  });
  it('permits a feedback cycle but does not confuse it with containment', () => {
    const input = relationSummaryFixture();
    input.structure.relations.push({ ...input.structure.relations[0], from: '消息历史', to: '上下文', kind: '反馈', label: '反馈' });
    expect(structuredSummarySchema.safeParse(input).success).toBe(true);
  });
  it('keeps a problem distinct from the mechanism that addresses it', () => {
    const input = relationSummaryFixture();
    const data = { ...input, structure: { ...input.structure, nodes: input.structure.nodes.map((node, index) => index === 0 ? { ...node, role: '问题' } : node) } };
    expect(structuredSummarySchema.safeParse(data).success).toBe(true);
  });
  it('rejects invented evidence and permits whitespace-normalized source excerpts', () => {
    const input = structuredSummarySchema.parse(relationSummaryFixture());
    expect(hasSourceEvidence(input.structure, relationSource.replaceAll(' ', '\n'))).toBe(true);
    input.structure.relations[0].evidence = '这是原文没有说过的话';
    expect(hasSourceEvidence(input.structure, relationSource)).toBe(false);
  });
  it('falls back to the complete edited text when a relation target was deleted', () => {
    const text = serializeStructuredSummary(structuredSummarySchema.parse(relationSummaryFixture()));
    const edited = text.replace('| 消息历史 | 组成 | 持续增长的交互记录 | 消息历史 |\n', '');
    expect(parseKnowledgeStructure(edited)).toBeNull();
    expect(parseKnowledgeSummary(edited).original).toBe(edited);
    expect(parseKnowledgeSummary(edited).roots).toEqual([]);
  });
  it('does not silently discard relationship rows after an inserted blank line', () => {
    const text = serializeStructuredSummary(structuredSummarySchema.parse(relationSummaryFixture()));
    const edited = text.replace('| 上下文压缩 | 作用 |', '\n| 上下文压缩 | 作用 |');
    expect(parseKnowledgeStructure(edited)).toBeNull();
    expect(parseKnowledgeSummary(edited).original).toBe(edited);
  });
  it('preserves a manually added boundary instead of displaying a graph that omits it', () => {
    const text = serializeStructuredSummary(structuredSummarySchema.parse(relationSummaryFixture()));
    const boundary = '补充边界：上述压缩关系只适用于较早历史，不适用于当前输入。';
    const edited = text.replace('阅读顺序：', `${boundary}\n\n阅读顺序：`);
    expect(parseKnowledgeStructure(edited)).toBeNull();
    expect(parseKnowledgeSummary(edited).unmapped).toContain(boundary);
    expect(parseKnowledgeSummary(edited).original).toBe(edited);
  });
  it('keeps old tree notes available without fabricating typed relations', () => {
    const text = '一句话主旨：知识\n主要骨架：\n系统\n├─ 部件甲\n└─ 部件乙';
    expect(parseKnowledgeSummary(text).roots[0].children).toHaveLength(2);
    expect(parseKnowledgeSummary(text).structure).toBeNull();
  });
});
