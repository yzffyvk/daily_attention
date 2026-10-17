import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SummaryProse, SummaryText } from '@/features/checkins/question-reading';

afterEach(cleanup);

describe('formula emphasis in reading prose', () => {
  it('separates an explicitly emphasized formula from its explanation without losing its surrounding words', () => {
    const value = '现代 Agent 的最小工程实现是 **Agent = LLM + 上下文 + 工具**，加号表示工程组件的组合。\n\n**边界很重要**，环境不包含在公式内。';
    const { container } = render(<SummaryProse value={value} />);
    const formula = screen.getByText('Agent = LLM + 上下文 + 工具');
    const callout = formula.closest('.summary-formula-callout');
    expect(callout).not.toBeNull();
    expect(container).toHaveTextContent('现代 Agent 的最小工程实现是');
    expect(screen.getByText('现代 Agent 的最小工程实现是').closest('.summary-formula-callout')).toBeNull();
    expect(callout).toHaveTextContent('加号表示工程组件的组合。');
    expect(formula.tagName).toBe('STRONG');
    expect(screen.getByText('边界很重要').closest('.summary-formula-callout')).toBeNull();
    expect(container.querySelectorAll('.summary-formula-callout')).toHaveLength(1);
  });

  it('uses display spacing for the sentence boundary after a formula', () => {
    render(<SummaryProse value="**Agent = LLM + 上下文 + 工具**。这里的加号表示工程组件组合。" />);
    expect(screen.getByText('这里的加号表示工程组件组合。')).toBeVisible();
  });

  it.each(['LLM + 上下文 + 工具', 'Agent＝LLM＋上下文＋工具', '观察 → 思考 → 行动', 'F = ma'])('supports the emphasized composition %s', formula => {
    render(<SummaryProse value={`**${formula}**`} />);
    expect(screen.getByText(formula).closest('.summary-formula-callout')).not.toBeNull();
  });

  it('leaves headings, outlines and the compact answer inline', () => {
    const { rerender } = render(<SummaryText value="**Agent = LLM + 上下文 + 工具**" />);
    expect(screen.getByText('Agent = LLM + 上下文 + 工具').closest('.summary-formula-callout')).toBeNull();
    rerender(<SummaryProse value="**Agent = LLM + 上下文 + 工具**" emphasizeFormulas={false} />);
    expect(screen.getByText('Agent = LLM + 上下文 + 工具').closest('.summary-formula-callout')).toBeNull();
  });

  it('does not infer emphasis from ordinary text, code, URLs, or an incomplete equation', () => {
    const { container } = render(<SummaryProse value={'Agent = LLM + 上下文 + 工具\n\n`A = B + C`\n\n**https://example.com/?a=1**\n\n**C++**\n\n**x =**\n\n```text\n**A = B + C**\n```\n\n**<img src=x onerror=alert(1)>**'} />);
    expect(container.querySelector('.summary-formula-callout')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('A = B + C', { selector: 'code' })).toBeVisible();
  });
});
