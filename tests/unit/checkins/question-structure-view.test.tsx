import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeSummaryView } from '@/features/checkins/knowledge-summary-view';
import { serializeQuestionSummary } from '@/lib/domain/knowledge-questions';
import { questionSummaryFixture } from '../../helpers/knowledge-questions-fixture';
afterEach(cleanup);
const summary = () => serializeQuestionSummary(questionSummaryFixture());
describe('question reader', () => {
  it('opens with the direct answer and only the first local graph', () => {
    render(<KnowledgeSummaryView value={summary()} />);
    expect(screen.getByRole('region', { name: '本题答案' })).toHaveTextContent('计划列出行动步骤。');
    const map = screen.getByRole('group', { name: '骨架节点' });
    expect(within(map).getAllByRole('button')).toHaveLength(1);
    expect(within(map).queryByRole('button', { name: '检查' })).not.toBeInTheDocument();
  });
  it('switches questions, scopes relations, follows a reference and returns to the original node', async () => {
    const user = userEvent.setup(); render(<KnowledgeSummaryView value={summary()} />);
    await user.click(screen.getByRole('button', { name: '阅读问题：如何检查？' }));
    expect(screen.getByRole('region', { name: '本题答案' })).toHaveTextContent('检查验证结果并改进计划');
    await user.click(within(screen.getByRole('group', { name: '骨架节点' })).getByRole('button', { name: '计划' }));
    expect(screen.getByRole('region', { name: '节点解释' })).toHaveTextContent('本题检查计划的结果');
    await user.click(screen.getByRole('button', { name: '查看完整解释：如何安排？' }));
    expect(within(screen.getByRole('group', { name: '骨架节点' })).getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('region', { name: '节点解释' }).querySelector('.structure-detail-content')).not.toHaveTextContent('验证并改进');
    await user.click(screen.getByRole('button', { name: '返回来源问题：如何检查？' }));
    expect(screen.getByRole('region', { name: '节点解释' })).toHaveTextContent('本题检查计划的结果');
  });
  it('preserves question position across fullscreen and restores focus', async () => {
    const user = userEvent.setup(); render(<KnowledgeSummaryView value={summary()} />);
    await user.click(screen.getByRole('button', { name: '阅读问题：如何检查？' }));
    await user.click(screen.getByRole('button', { name: '展开阅读' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: '展开阅读' })).toHaveFocus());
    expect(screen.getByRole('region', { name: '本题答案' })).toHaveTextContent('检查验证结果并改进计划');
  });
  it('shows all original text when a structured document was edited incompatibly', () => {
    render(<KnowledgeSummaryView value={summary() + '\n新增限定：仅用于这个实验。'} />);
    expect(screen.queryByRole('group', { name: '骨架节点' })).not.toBeInTheDocument();
    expect(screen.getByText(/新增限定：仅用于这个实验/)).toBeVisible();
  });
  it('includes the final question evidence in a single-question fullscreen keyboard loop', async () => {
    const v = questionSummaryFixture(); v.structure.questions.pop(); v.structure.nodes.pop(); v.structure.questionOrder = ['q1']; v.structure.relations = []; v.structure.questionLinks = [];
    const user = userEvent.setup(); render(<KnowledgeSummaryView value={serializeQuestionSummary(v)} />);
    await user.click(screen.getByRole('button', { name: '展开阅读' }));
    const button = within(screen.getByRole('group', { name: '本题概念' })).getByRole('button');
    button.focus(); await user.tab();
    expect(screen.getByText('查看本题原文依据')).toHaveFocus();
    await user.tab(); expect(screen.getByRole('button', { name: '关闭全屏阅读' })).toHaveFocus();
  });
});
