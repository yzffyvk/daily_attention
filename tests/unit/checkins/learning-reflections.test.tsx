import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { LearningReflectionsEditor } from '@/features/checkins/learning-reflections';
import { polishReflection } from '@/features/ai-generation/api';
import { parseLearningReflections, serializeLearningReflections } from '@/lib/domain/learning-reflections';
vi.mock('@/features/ai-generation/api', () => ({ polishReflection: vi.fn() }));
afterEach(cleanup);
function Harness() {
  const [value, onChange] = useState('');
  return <LearningReflectionsEditor value={value} onChange={onChange} />;
}
it('preserves independent optional writing when switching tabs', async () => {
  const user = userEvent.setup(); render(<Harness />);
  await user.type(screen.getByRole('textbox'), '我的解释');
  await user.click(screen.getByRole('tab', { name: '新的理解' }));
  expect(screen.getByRole('textbox')).toHaveValue('');
  await user.type(screen.getByRole('textbox'), '新的理解内容');
  await user.click(screen.getByRole('tab', { name: '用自己的话解释' }));
  expect(screen.getByRole('textbox')).toHaveValue('我的解释');
  expect(screen.getByRole('textbox')).toHaveAttribute('id', 'inspiration');
});
it('supports arrow, Home and End keyboard focus', async () => {
  const user = userEvent.setup(); render(<Harness />);
  screen.getByRole('tab', { name: '用自己的话解释' }).focus();
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: '新的理解' })).toHaveFocus();
  await user.keyboard('{End}');
  expect(screen.getByRole('tab', { name: '有趣的思想点' })).toHaveFocus();
  await user.keyboard('{Home}');
  expect(screen.getByRole('tab', { name: '用自己的话解释' })).toHaveFocus();
});
it('derives date/parent resets and displays storage overflow without truncation', () => {
  const onChange = vi.fn();
  const { rerender } = render(<LearningReflectionsEditor value="旧内容" onChange={onChange} />);
  rerender(<LearningReflectionsEditor value={'长'.repeat(2001)} onChange={onChange} disabled />);
  expect(screen.getByRole('textbox')).toHaveValue('长'.repeat(2001));
  expect(screen.getByRole('textbox')).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('2000');
  expect(onChange).not.toHaveBeenCalled();
});

it('preserves an overflow edit and blocks native form validation until corrected', () => {
  render(<Harness />);
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '字'.repeat(2001) } });
  expect(input.value).toHaveLength(2001);
  expect(input.checkValidity()).toBe(false);
  expect(screen.getByRole('alert')).toBeVisible();
  fireEvent.change(input, { target: { value: '修正' } });
  expect(input.checkValidity()).toBe(true);
  expect(screen.queryByRole('alert')).toBeNull();
});
it('loads new parent values into the active tab and supports the summary action', async () => {
  const user = userEvent.setup(); const onToggleSummary = vi.fn();
  const { rerender } = render(<LearningReflectionsEditor value="旧解释" onChange={vi.fn()} onToggleSummary={onToggleSummary} />);
  await user.click(screen.getByRole('tab', { name: '新的理解' }));
  rerender(<LearningReflectionsEditor value="新日期解释" onChange={vi.fn()} onToggleSummary={onToggleSummary} summaryVisible={false} />);
  expect(screen.getByRole('textbox')).toHaveValue('');
  await user.click(screen.getByRole('tab', { name: '用自己的话解释' }));
  expect(screen.getByRole('textbox')).toHaveValue('新日期解释');
  await user.click(screen.getByRole('button', { name: '显示知识总结' }));
  expect(onToggleSummary).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: '显示知识总结' })).toHaveAttribute('aria-expanded', 'false');
});

it('uses approved guidance and exposes the summary visibility relationship', () => {
  render(<LearningReflectionsEditor value="" onChange={vi.fn()} onToggleSummary={vi.fn()} />);
  expect(screen.getByRole('region', { name: '我的理解与收获' })).toBeVisible();
  expect(screen.getByRole('heading', { name: '我的理解与收获' })).toBeVisible();
  expect(screen.getByText('选一个有感触的方向写，不必逐项回答。')).toBeVisible();
  expect(screen.getByText('切换栏目会保留已写内容，重新提炼不会覆盖你的收获。')).toBeVisible();
  expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', '从你的第一句话开始…');
  const toggle = screen.getByRole('button', { name: '暂时收起知识总结' });
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(toggle).toHaveAttribute('aria-controls', 'learning-summary-content');
  expect(screen.getByText('三个栏目合计最多2000字。', { exact: false })).toBeVisible();
});

it('adopts and undoes only the explanation while preserving the other two reflections', async () => {
  const user = userEvent.setup();
  const original = { explanation: '模型负责思考。', insights: '我新理解了运行循环。', ideas: '可以用验证改进效果。' };
  vi.mocked(polishReflection).mockResolvedValue({ polishedAnswer: '模型根据上下文做决策。', knowledgePoints: ['模型'], improvements: ['补充决策的表述。'], cautions: [] });
  let stored = serializeLearningReflections(original);
  function WithPolish() {
    const [value, setValue] = useState(serializeLearningReflections(original));
    return <LearningReflectionsEditor value={value} onChange={next => { stored = next; setValue(next); }} polishContext={{ topic: 'Agent', summary: '模型根据上下文选择行动。' }} />;
  }
  render(<WithPolish />);
  await user.click(screen.getByRole('button', { name: 'AI 润色' }));
  await screen.findByRole('region', { name: 'AI 润色建议' });
  expect(parseLearningReflections(stored)).toEqual(original);
  await user.click(screen.getByRole('button', { name: '采纳建议' }));
  expect(parseLearningReflections(stored)).toEqual({ ...original, explanation: '模型根据上下文做决策。' });
  expect(screen.getByRole('textbox')).toHaveFocus();
  await user.click(screen.getByRole('tab', { name: '新的理解' }));
  expect(screen.queryByRole('button', { name: 'AI 润色' })).not.toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue(original.insights);
  await user.click(screen.getByRole('tab', { name: '用自己的话解释' }));
  await user.click(screen.getByRole('button', { name: '撤销本次润色' }));
  expect(parseLearningReflections(stored)).toEqual(original);
});
