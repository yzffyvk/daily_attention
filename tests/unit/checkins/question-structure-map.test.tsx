import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionStructureMap } from '@/features/checkins/question-structure-map';
import type { KnowledgeStructure } from '@/lib/domain/knowledge-structure';
afterEach(cleanup);
const nodes = ['目标', '行动', '结果'].map(name => ({ name, role: '概念' as const, summary: name, explanation: name, evidence: '资料中的明确依据' }));
const edge = (from: string, to: string, kind: '流程' | '包含' | '反馈' | '区别' = '流程') => ({ from, to, kind, label: `${from}引出${to}`, condition: '', evidence: '资料中的明确依据' });
function draw(relations: KnowledgeStructure['relations']) {
  const structure: KnowledgeStructure = { coreQuestion: '如何行动？', contentTypes: ['运行机制与流程'], nodes, relations, readingOrder: ['结果', '行动', '目标'] };
  return render(<QuestionStructureMap structure={structure} selectedName={null} selectedEdge={null} onNode={vi.fn()} onEdge={vi.fn()} />);
}
describe('simple question diagrams', () => {
  it('orders a short chain by actual edge direction instead of editorial reading order', () => {
    const { container } = draw([edge('目标', '行动'), edge('行动', '结果')]);
    expect(container.querySelector('[data-diagram="chain"]')).toBeInTheDocument();
    expect([...container.querySelectorAll('.question-graph-node')].map(el => el.textContent)).toEqual(['目标', '行动', '结果']);
    expect(screen.getAllByRole('button', { name: /^查看关系/ })).toHaveLength(2);
  });
  it('uses containment grouping without network lines for a branched hierarchy', () => {
    const { container } = draw([edge('目标', '行动', '包含'), edge('目标', '结果', '包含')]);
    expect(container.querySelector('[data-diagram="hierarchy"]')).toBeInTheDocument();
    expect(container.querySelector('.question-hierarchy')).toHaveTextContent('目标');
    expect(container.querySelectorAll('.question-hierarchy-children .question-graph-node')).toHaveLength(2);
    expect(container.querySelector('.question-graph-lines')).not.toBeInTheDocument();
  });
  it('keeps cyclic relationships accessible one at a time instead of drawing all lines', async () => {
    const { container } = draw([edge('目标', '行动'), edge('行动', '结果'), edge('结果', '目标', '反馈')]);
    expect(container.querySelector('[data-diagram="relations"]')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: '骨架节点' })).getAllByRole('button')).toHaveLength(3);
    const user = userEvent.setup();
    for (const label of ['目标引出行动', '行动引出结果', '结果引出目标']) {
      expect(screen.getAllByRole('button', { name: /^查看关系/ })).toHaveLength(1);
      expect(screen.getByRole('button', { name: /^查看关系/ })).toHaveTextContent(label);
      if (label !== '结果引出目标') await user.click(screen.getByRole('button', { name: '下一条关系' }));
    }
    expect(screen.getByRole('button', { name: '下一条关系' })).toBeDisabled();
  });
  it('does not connect unrelated concepts just to make a diagram', () => {
    const { container } = draw([]);
    expect(container.querySelector('[data-diagram="concepts"]')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^查看关系/ })).not.toBeInTheDocument();
  });
});
