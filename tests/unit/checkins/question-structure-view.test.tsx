import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeSummaryView } from '@/features/checkins/knowledge-summary-view';
import { serializeQuestionSummary, type QuestionSummary } from '@/lib/domain/knowledge-questions';
import { questionSummaryFixture } from '../../helpers/knowledge-questions-fixture';
afterEach(cleanup);
const summary = () => serializeQuestionSummary(questionSummaryFixture());
describe('question reader', () => {
  it('shows the complete recall outline in reading order without repeating borrowed concepts', () => {
    const document = questionSummaryFixture();
    document.structure.questionOrder.reverse();
    render(<KnowledgeSummaryView value={serializeQuestionSummary(document)} />);
    const outline = within(screen.getByRole('region', { name: '记忆骨架' }));
    const branches = outline.getAllByRole('list', { name: /的记忆线索$/ });
    expect(branches.map(branch => branch.getAttribute('aria-label'))).toEqual(['验证行动的记忆线索', '明确行动的记忆线索']);
    expect(within(branches[0]).getByText('检查', { exact: true })).toBeVisible();
    expect(within(branches[0]).queryByText('计划', { exact: true })).not.toBeInTheDocument();
    expect(outline.getAllByText('计划', { exact: true })).toHaveLength(1);
    expect(outline.getByText('安排步骤', { exact: true })).toBeVisible();
    expect(screen.queryByText('列出下一步行动。', { exact: true })).not.toBeInTheDocument();
  });
  it('explains the selected branch in prose without requiring its graph to be opened', async () => {
    const document = questionSummaryFixture();
    document.structure.nodes[1].explanation = '先比较 **实际结果** 与目标。\n\n发现差距后，调整下一次行动。';
    document.prompts = ['只看明确行动、验证行动，能否解释两者如何配合？'];
    render(<KnowledgeSummaryView value={serializeQuestionSummary(document)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '展开核心部分：验证行动' }));
    const branch = within(screen.getByRole('region', { name: '验证行动' }));
    expect(branch.getByText('实际结果', { exact: true }).tagName).toBe('STRONG');
    expect(branch.getByText('发现差距后，调整下一次行动。', { exact: true }).tagName).toBe('P');
    expect(branch.queryByText('列出下一步行动。', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '骨架节点' })).not.toBeInTheDocument();
    await user.click(screen.getByText('试着讲一遍', { exact: true }));
    expect(screen.getByText(document.prompts[0], { exact: true })).toBeVisible();
  });
  it('starts with the whole framework and reveals questions and diagrams only on demand', async () => {
    const user = userEvent.setup(); render(<KnowledgeSummaryView value={summary()} />);
    expect(screen.getByRole('heading', { name: '先明确行动，再检查结果。' })).toBeVisible();
    expect(screen.getByRole('button', { name: '展开核心部分：明确行动' })).toBeVisible();
    expect(screen.getByRole('button', { name: '展开核心部分：验证行动' })).toBeVisible();
    expect(screen.queryByText('计划列出行动步骤。', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '骨架节点' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '展开核心部分：明确行动' }));
    expect(screen.getAllByText('如何安排？', { exact: true })).toHaveLength(1);
    expect(screen.getAllByText('计划列出行动步骤。', { exact: true })).toHaveLength(1);
    expect(screen.queryByRole('group', { name: '骨架节点' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '查看简图' }));
    expect(within(screen.getByRole('group', { name: '骨架节点' })).getAllByRole('button')).toHaveLength(1);
  });
  it('switches questions and opens a shared concept in place without repeated relationship panels', async () => {
    const user = userEvent.setup(); render(<KnowledgeSummaryView value={summary()} />);
    await user.click(screen.getByRole('button', { name: '展开核心部分：验证行动' }));
    expect(screen.getAllByText('检查验证结果并改进计划。', { exact: true })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '查看简图' }));
    expect(screen.queryByRole('group', { name: '本图关系' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '跨问题联系' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '本题概念' })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole('group', { name: '骨架节点' })).getByRole('button', { name: '计划' }));
    expect(screen.getByRole('region', { name: '节点解释' })).toHaveTextContent('列出下一步行动。');
    expect(screen.queryByText('它属于什么')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /查看完整解释/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '收起详情' }));
    expect(screen.queryByRole('region', { name: '节点解释' })).not.toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('group', { name: '骨架节点' })).getByRole('button', { name: '计划' })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: /查看关系：检查.*计划/ }));
    expect(screen.getByRole('region', { name: '关系解释' })).toHaveTextContent('获得结果后');
  });
  it('preserves question position across fullscreen and restores focus', async () => {
    const user = userEvent.setup(); render(<KnowledgeSummaryView value={summary()} />);
    await user.click(screen.getByRole('button', { name: '展开核心部分：验证行动' }));
    await user.click(screen.getByRole('button', { name: '展开阅读' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: '展开阅读' })).toHaveFocus());
    expect(screen.getByRole('button', { name: '展开核心部分：验证行动' })).toHaveAttribute('aria-expanded', 'true');
  });
  it('restores node focus after moving an open detail into fullscreen', async () => {
    const user = userEvent.setup(); render(<KnowledgeSummaryView value={summary()} />);
    await user.click(screen.getByRole('button', { name: '展开核心部分：明确行动' }));
    await user.click(screen.getByRole('button', { name: '查看简图' }));
    await user.click(screen.getByRole('button', { name: '计划' }));
    await user.click(screen.getByRole('button', { name: '展开阅读' }));
    expect(screen.getByRole('region', { name: '节点解释' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '收起详情' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '计划' })).toHaveFocus());
  });
  it('preserves a later relationship and its detail focus across fullscreen', async () => {
    const v: QuestionSummary = questionSummaryFixture();
    v.structure.relations.push({ ...v.structure.relations[0], id: 'e2', from: 'n1', to: 'n2', kind: '依赖', label: '提供检查标准' });
    v.structure.questions[1].views[0].relationIds.push('e2');
    const user = userEvent.setup(); render(<KnowledgeSummaryView value={serializeQuestionSummary(v)} />);
    await user.click(screen.getByRole('button', { name: '展开核心部分：验证行动' }));
    await user.click(screen.getByRole('button', { name: '查看简图' }));
    await user.click(screen.getByRole('button', { name: '下一条关系' }));
    await user.click(screen.getByRole('button', { name: /查看关系：计划.*检查/ }));
    await user.click(screen.getByRole('button', { name: '展开阅读' }));
    expect(screen.getByRole('region', { name: '逐条理解关系' })).toHaveTextContent('关系 2 / 2');
    await user.click(screen.getByRole('button', { name: '收起详情' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /查看关系：计划.*检查/ })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.getByRole('region', { name: '逐条理解关系' })).toHaveTextContent('关系 2 / 2');
  });
  it('keeps all six existing questions accessible instead of truncating to the prompt target', async () => {
    const v: QuestionSummary = questionSummaryFixture();
    for (let i = 3; i <= 6; i++) {
      v.structure.questions.push({ ...v.structure.questions[0], id: `q${i}`, mainlineRole: `核心部分${i}`, title: `问题${i}？`, answer: `答案${i}。`, views: [{ ...v.structure.questions[0].views[0], id: `v${i}`, referenceNodeIds: ['n1'] }] });
      v.structure.questionOrder.push(`q${i}`);
    }
    render(<KnowledgeSummaryView value={serializeQuestionSummary(v)} />);
    expect(screen.getAllByRole('button', { name: /^展开核心部分：/ })).toHaveLength(6);
    await userEvent.setup().click(screen.getByRole('button', { name: '展开核心部分：核心部分6' }));
    expect(screen.getByText('答案6。', { exact: true })).toBeVisible();
  });
  it('shows all original text when a structured document was edited incompatibly', () => {
    render(<KnowledgeSummaryView value={summary() + '\n新增限定：仅用于这个实验。'} />);
    expect(screen.queryByRole('group', { name: '骨架节点' })).not.toBeInTheDocument();
    expect(screen.getByText(/新增限定：仅用于这个实验/)).toBeVisible();
  });
  it('includes the recall entry after the final question evidence in the fullscreen keyboard loop', async () => {
    const v = questionSummaryFixture(); v.structure.questions.pop(); v.structure.nodes.pop(); v.structure.questionOrder = ['q1']; v.structure.relations = []; v.structure.questionLinks = [];
    const user = userEvent.setup(); render(<KnowledgeSummaryView value={serializeQuestionSummary(v)} />);
    await user.click(screen.getByRole('button', { name: '展开阅读' }));
    await user.click(screen.getByRole('button', { name: '展开核心部分：明确行动' }));
    screen.getByText('查看本题原文依据').focus();
    await user.tab(); expect(screen.getByText('试着讲一遍', { exact: true })).toHaveFocus();
    await user.tab(); expect(screen.getByRole('button', { name: '关闭全屏阅读' })).toHaveFocus();
  });
});
