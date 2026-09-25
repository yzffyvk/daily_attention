import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeSummaryView } from '@/features/checkins/knowledge-summary-view';
import { structuredSummarySchema, serializeStructuredSummary } from '@/lib/domain/knowledge-structure';
import { relationSummaryFixture } from '../../helpers/knowledge-structure-fixture';
const summary = () => serializeStructuredSummary(structuredSummarySchema.parse(relationSummaryFixture()));
afterEach(cleanup);
describe('relationship reading experience', () => {
  it('makes relationship labels and tradeoff conditions visible in the skeleton', () => {
    render(<KnowledgeSummaryView value={summary()} />);
    const graph = screen.getByRole('region', { name: '知识关系骨架' });
    expect(within(graph).getByText('精简与重组')).toBeVisible();
    expect(within(graph).getByText('权衡长度与缓存复用')).toBeVisible();
    expect(within(graph).getByText('改写位置之后的缓存失效')).toBeVisible();
    expect(screen.getByText('如何在有限窗口内提供有效上下文？')).toBeVisible();
  });
  it('selects a concept, filters adjacent relations and follows another endpoint', async () => {
    const user = userEvent.setup();
    render(<KnowledgeSummaryView value={summary()} />);
    await user.click(within(screen.getByRole('group', { name: '骨架节点' })).getByRole('button', { name: '上下文压缩' }));
    const detail = screen.getByRole('region', { name: '节点解释' });
    expect(within(detail).getByText('替换较早的消息历史，并保留必要信息。')).toBeVisible();
    const graph = screen.getByRole('region', { name: '知识关系骨架' });
    expect(within(graph).queryByText('包含')).not.toBeInTheDocument();
    await user.click(within(graph).getByRole('button', { name: '展开 KV Cache' }));
    expect(within(detail).getByText('复用稳定前缀的计算结果。')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '全部关系' }));
    expect(within(graph).getByText('包含')).toBeVisible();
  });
  it('labels learning order separately and exposes supporting excerpts', async () => {
    const user = userEvent.setup();
    render(<KnowledgeSummaryView value={summary()} />);
    expect(screen.getByText('建议阅读顺序')).toBeVisible();
    expect(screen.getByText('帮助理解的顺序，不代表执行或因果关系')).toBeVisible();
    await user.click(screen.getAllByText('查看关系依据')[0]);
    expect(screen.getByText('上下文包含系统提示词和消息历史', { selector: 'blockquote' })).toBeVisible();
  });
  it('keeps a source-truncation notice visible beside a valid relation graph', () => {
    const notice = '资料范围：本次只读取了开头部分，后续内容未纳入。';
    render(<KnowledgeSummaryView value={notice + '\n\n' + summary()} />);
    expect(screen.getByText(notice)).toBeVisible();
    expect(screen.getByRole('region', { name: '知识关系骨架' })).toBeVisible();
  });
  it('resets selected node when a different document arrives', async () => {
    const user = userEvent.setup();
    const view = render(<KnowledgeSummaryView value={summary()} />);
    await user.click(within(screen.getByRole('group', { name: '骨架节点' })).getByRole('button', { name: '上下文压缩' }));
    view.rerender(<KnowledgeSummaryView value='普通笔记' />);
    expect(screen.queryByRole('region', { name: '知识关系骨架' })).not.toBeInTheDocument();
    expect(screen.getByText('普通笔记')).toBeVisible();
  });
});
