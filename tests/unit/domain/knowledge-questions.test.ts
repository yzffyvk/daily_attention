import { describe, expect, it } from 'vitest';
import { questionSummaryFixture } from '../../helpers/knowledge-questions-fixture';
import { parseQuestionSummary, serializeQuestionSummary, questionSummarySchema, projectQuestionView } from '@/lib/domain/knowledge-questions';

describe('question-led knowledge documents', () => {
  it('roundtrips questions, local views, stable references and escaped editable text', () => {
    const value = questionSummaryFixture();
    value.structure.nodes[0].explanation = '第一行 | & <tag>\n第二行';
    const doc = serializeQuestionSummary(value);
    expect(parseQuestionSummary(doc)).toEqual(value);
    expect(doc).toContain('如何安排？');
    const renamed = doc.replaceAll('计划', '行动计划');
    expect(parseQuestionSummary(renamed)?.structure.relations[0].to).toBe('n1');
  });
  it('projects only explicit local members and uses shared names', () => {
    const { structure } = questionSummaryFixture();
    expect(projectQuestionView(structure, 'q1', 'v1').nodes.map(n => n.name)).toEqual(['计划']);
    expect(projectQuestionView(structure, 'q1', 'v1').relations).toEqual([]);
    expect(projectQuestionView(structure, 'q2', 'v2').relations[0]).toMatchObject({ from: '检查', to: '计划' });
  });
  it('rejects edges outside a local graph and unlabeled foreign nodes', () => {
    const value = questionSummaryFixture();
    value.structure.questions[0].views[0].relationIds = ['e1'];
    expect(questionSummarySchema.safeParse(value).success).toBe(false);
    const other = questionSummaryFixture();
    other.structure.questions[1].views[0].referenceNodeIds = [];
    expect(questionSummarySchema.safeParse(other).success).toBe(false);
  });
  it('rejects missing owners, uncovered relations and invalid reading order', () => {
    for (const mutate of [
      (v: ReturnType<typeof questionSummaryFixture>) => { v.structure.nodes[0].homeQuestionId = 'missing'; },
      (v: ReturnType<typeof questionSummaryFixture>) => { v.structure.questions[1].views[0].relationIds = []; v.structure.questionLinks = []; },
      (v: ReturnType<typeof questionSummaryFixture>) => { v.structure.questionOrder = ['q1', 'q1']; },
    ]) { const v = questionSummaryFixture(); mutate(v); expect(questionSummarySchema.safeParse(v).success).toBe(false); }
  });
  it('refuses to hide user-added prose or broken tables', () => {
    const doc = serializeQuestionSummary(questionSummaryFixture());
    expect(parseQuestionSummary(doc + '\n用户补充：上述结论不适用于所有情况。')).toBeNull();
    expect(parseQuestionSummary(doc.replace('验证并改进', '验证 | 改进'))).toBeNull();
  });
  it('supports a single question with independent concepts and no invented edges', () => {
    const v = questionSummaryFixture();
    v.structure.questions.pop(); v.structure.nodes.pop(); v.structure.relations = []; v.structure.questionLinks = []; v.structure.questionOrder = ['q1'];
    expect(questionSummarySchema.safeParse(v).success).toBe(true);
    expect(parseQuestionSummary(serializeQuestionSummary(v))).toEqual(v);
  });
});
