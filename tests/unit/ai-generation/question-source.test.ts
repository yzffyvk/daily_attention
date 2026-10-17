import { describe, expect, it } from "vitest";
import { indexQuestionSource, normalizeQuestionViews } from "../../../supabase/functions/_shared/ai/question-source.ts";
import { questionSummaryFixture } from "../../helpers/knowledge-questions-fixture";
import { questionSummarySchema, type QuestionSummary } from "../../../lib/domain/knowledge-questions.ts";

describe("question source references", () => {
  it.each([
    ['机制', '机制'], [' 机制 ', '机制'], ['方法', '方案'], [' 方法 ', '方案'], ['区别', '概念'],
    ['策略', '概念'], ['unknown', '概念'], ['constructor', '概念'], ['', '概念'], ['   ', '概念'],
    [null, '概念'], [42, '概念'], [{ label: '机制' }, '概念'], [[], '概念'],
  ])('normalizes generated node role %j while preserving the complete document', (role, expected) => {
    const original = questionSummaryFixture();
    const raw = structuredClone(original);
    Object.assign(raw.structure.nodes[0], { role });
    const before = structuredClone(raw);
    const normalized = normalizeQuestionViews(raw);
    expect(questionSummarySchema.safeParse(normalized).success).toBe(true);
    expect(normalized).toEqual({ ...original, structure: { ...original.structure,
      nodes: original.structure.nodes.map((node, index) => index === 0 ? { ...node, role: expected } : node),
    } });
    expect(raw).toEqual(before);
  });

  it('defaults a missing generated role without weakening the saved document schema', () => {
    const raw = questionSummaryFixture();
    Reflect.deleteProperty(raw.structure.nodes[0], 'role');
    expect(questionSummarySchema.safeParse(raw).success).toBe(false);
    const normalized = normalizeQuestionViews(raw);
    expect(questionSummarySchema.safeParse(normalized).success).toBe(true);
    expect(normalized.structure.nodes[0].role).toBe('概念');
    expect(raw.structure.nodes[0]).not.toHaveProperty('role');
  });

  it('continues repairing view references after defaulting an unknown role', () => {
    const raw = questionSummaryFixture();
    Object.assign(raw.structure.nodes[0], { role: '策略' });
    raw.structure.questions[1].views[0].referenceNodeIds = [];
    const normalized = normalizeQuestionViews(raw);
    expect(questionSummarySchema.safeParse(normalized).success).toBe(true);
    expect(normalized.structure.nodes[0].role).toBe('概念');
    expect(normalized.structure.questions[1].views[0].referenceNodeIds).toEqual(['n1']);
    expect(normalized.structure.relations).toEqual(raw.structure.relations);
  });

  it('derives foreign-node badges from existing ownership without changing view membership', () => {
    const original: QuestionSummary = questionSummaryFixture();
    const raw = structuredClone(original);
    raw.structure.questions[1].views[0].referenceNodeIds = [];
    expect(questionSummarySchema.safeParse(raw).success).toBe(false);
    expect(normalizeQuestionViews(raw)).toEqual(original);
    expect(raw.structure.questions[1].views[0].referenceNodeIds).toEqual([]);
  });
  it('moves a misplaced question-link reference to its existing local view', () => {
    const original: QuestionSummary = questionSummaryFixture();
    const firstNode = original.structure.nodes[0];
    original.structure.nodes.push({ ...firstNode, id: 'n3', name: '具体对象' });
    const view = original.structure.questions[0].views[0];
    view.nodeIds.push('n3'); view.readingOrder.push('n3');
    original.structure.relations.push({ ...original.structure.relations[0], id: 'e2', from: firstNode.id, to: 'n3', kind: '作用' });
    original.structure.questionLinks.push({ fromQuestionId: 'q1', toQuestionId: 'q2', label: '错误挂载', relationIds: ['e2'] });
    expect(questionSummarySchema.safeParse(original).success).toBe(false);
    const normalized = normalizeQuestionViews(original);
    expect(questionSummarySchema.safeParse(normalized).success).toBe(true);
    expect(normalized.structure.questions[0].views[0].relationIds).toContain('e2');
    expect(normalized.structure.questionLinks).toEqual(original.structure.questionLinks.slice(0, -1));
    expect(normalized.structure.nodes).toEqual(original.structure.nodes);
    expect(normalized.structure.relations).toEqual(original.structure.relations);
  });
  it('normalizes a tradeoff display to comparison without changing its content or relations', () => {
    const original: QuestionSummary = questionSummaryFixture();
    const raw = structuredClone(original) as unknown as { structure: { questions: { views: { diagramKind: string }[] }[] } };
    raw.structure.questions[0].views[0].diagramKind = 'tradeoff';
    const normalized = normalizeQuestionViews(raw);
    expect(questionSummarySchema.safeParse(normalized).success).toBe(true);
    const expected = structuredClone(original);
    expected.structure.questions[0].views[0].diagramKind = 'comparison';
    expect(normalized).toEqual(expected);
    expect(raw.structure.questions[0].views[0].diagramKind).toBe('tradeoff');
    raw.structure.questions[0].views[0].diagramKind = 'unknown';
    expect(questionSummarySchema.safeParse(normalizeQuestionViews(raw)).success).toBe(false);
  });
  it('normalizes the observed constraint label to the condition category without changing its claim', () => {
    const original: QuestionSummary = questionSummaryFixture();
    const raw = structuredClone(original) as unknown as { structure: { relations: { kind: string }[] } };
    raw.structure.relations[0].kind = '约束';
    const normalized = normalizeQuestionViews(raw);
    expect(questionSummarySchema.safeParse(normalized).success).toBe(true);
    expect(normalized.structure.relations[0]).toEqual({ ...original.structure.relations[0], kind: '条件' });
    expect(raw.structure.relations[0].kind).toBe('约束');
    raw.structure.relations[0].kind = '未知关系';
    expect(questionSummarySchema.safeParse(normalizeQuestionViews(raw)).success).toBe(false);
  });
  it("indexes complete original text and resolves bounded exact excerpts including Markdown", () => {
    const source = "# 原文\n\n一个**消息列表**包含 `system` 和 `tool`。\n\n" + "较长的一段原文，有必要保留所有限定条件。".repeat(30);
    const result = indexQuestionSource(source);
    expect(result.fragments.map(x => x.text).join("")).toBe(source);
    expect(result.fragments.every(x => x.text.length <= 180)).toBe(true);
    expect(result.text).toContain("[S0001]");
    expect(result.resolve("S0001")).toBe(result.fragments[0].text.replace(/\s+/gu, " ").trim());
    expect(result.resolve("S9999")).toBeNull();
    expect(result.resolve("invented quotation")).toBeNull();
  });
  it("only attaches an existing uncovered relation where both endpoints already exist", () => {
    const original: QuestionSummary = questionSummaryFixture();
    const view = original.structure.questions[1].views[0];
    view.relationIds = [];
    original.structure.questionLinks = [];
    expect(questionSummarySchema.safeParse(original).success).toBe(false);
    const normalized = normalizeQuestionViews(original);
    expect(questionSummarySchema.safeParse(normalized).success).toBe(true);
    expect(normalized.structure.questions[1].views[0].relationIds).toEqual(['e1']);
    expect(normalized.structure.relations).toEqual(original.structure.relations);
    expect(original.structure.questions[1].views[0].relationIds).toEqual([]);
  });
  it('moves an invalid view reference only to a view that already includes both endpoints', () => {
    const original: QuestionSummary = questionSummaryFixture();
    original.structure.questions[0].views[0].relationIds = ['e1'];
    original.structure.questions[1].views[0].relationIds = [];
    original.structure.questionLinks = [];
    const normalized = normalizeQuestionViews(original);
    expect(questionSummarySchema.safeParse(normalized).success).toBe(true);
    expect(normalized.structure.questions[0].views[0].relationIds).toEqual([]);
    expect(normalized.structure.questions[1].views[0].relationIds).toEqual(['e1']);
    expect(normalized.structure.questions.map(q => q.views.map(v => v.nodeIds))).toEqual(original.structure.questions.map(q => q.views.map(v => v.nodeIds)));
    expect(normalized.structure.relations).toEqual(original.structure.relations);
  });
  it("does not invent nodes or cross-view endpoints to cover a relation", () => {
    const original: QuestionSummary = questionSummaryFixture();
    original.structure.nodes[1].homeQuestionId = 'q1';
    original.structure.questions[0].views.push({ ...original.structure.questions[0].views[0], id: 'v3', nodeIds: ['n2'], readingOrder: ['n2'] });
    original.structure.questions[1].views[0].relationIds = [];
    original.structure.questionLinks = [];
    original.structure.questions[1].views[0].nodeIds = ['n2'];
    original.structure.questions[1].views[0].referenceNodeIds = ['n2'];
    original.structure.questions[1].views[0].readingOrder = ['n2'];
    original.structure.questions[1].views[0].contextNotes = [];
    expect(questionSummarySchema.safeParse(normalizeQuestionViews(original)).success).toBe(false);
  });
  it('keeps an existing cross-question edge as a navigation link without expanding local diagrams', () => {
    const original: QuestionSummary = questionSummaryFixture();
    const view = original.structure.questions[1].views[0];
    view.nodeIds = ['n2']; view.referenceNodeIds = []; view.contextNotes = []; view.readingOrder = ['n2']; view.relationIds = [];
    original.structure.questionLinks = [];
    const normalized = normalizeQuestionViews(original);
    expect(questionSummarySchema.safeParse(normalized).success).toBe(true);
    expect(normalized.structure.questionLinks).toEqual([{ fromQuestionId: 'q2', toQuestionId: 'q1', label: original.structure.relations[0].label, relationIds: ['e1'] }]);
    expect(normalized.structure.questions).toEqual(original.structure.questions);
    expect(normalized.structure.relations).toEqual(original.structure.relations);
  });
});
