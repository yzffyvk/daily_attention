'use client';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { LEARNING_REFLECTIONS_LIMIT, parseLearningReflections, serializeLearningReflections, type ReflectionKey } from '@/lib/domain/learning-reflections';
import { ReflectionPolish } from '@/features/ai-generation/reflection-polish';
const tabs: { key: ReflectionKey; label: string; prompt: string }[] = [
  { key: 'explanation', label: '用自己的话解释', prompt: '试着合上总结，用自己的话解释今天学到的内容。' },
  { key: 'insights', label: '新的理解', prompt: '新知道了什么，或哪个原有认识发生了变化？' },
  { key: 'ideas', label: '有趣的思想点', prompt: '记下让你好奇的联想、问题，或想进一步探索的点。' },
];
export function LearningReflectionsEditor({ value, onChange, disabled = false, prompts = [], polishContext, polishDisabled = false, summaryVisible = true, onToggleSummary }: {
  value: string; onChange: (value: string) => void; disabled?: boolean; prompts?: string[]; polishContext?: {topic: string; summary: string}; polishDisabled?: boolean; summaryVisible?: boolean; onToggleSummary?: () => void;
}) {
  const [active, setActive] = useState(0);
  const id = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const reflections = parseLearningReflections(value);
  const current = tabs[active];
  const overLimit = value.length > LEARNING_REFLECTIONS_LIMIT;
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    let next = active;
    if (event.key === 'ArrowRight') next = (active + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (active + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault(); setActive(next); tabRefs.current[next]?.focus();
  }
  return <section className="learning-reflections" aria-label="我的理解与收获">
    <div className="learning-reflections-header">
      <div><h3>我的理解与收获</h3><p className="learning-reflections-intro">选一个有感触的方向写，不必逐项回答。</p></div>
      {onToggleSummary && <button className="learning-reflections-summary-toggle" type="button" onClick={onToggleSummary} aria-pressed={!summaryVisible} aria-expanded={summaryVisible} aria-controls="learning-summary-content">{summaryVisible ? '暂时收起知识总结' : '显示知识总结'}</button>}
    </div>
    <div className="learning-reflections-tabs" role="tablist" aria-label="思考类型">
      {tabs.map((tab, index) => <button key={tab.key} ref={node => { tabRefs.current[index] = node; }} type="button" role="tab" id={`${id}-${tab.key}-tab`} aria-controls={`${id}-${tab.key}-panel`} aria-selected={index === active} tabIndex={index === active ? 0 : -1} disabled={disabled} onClick={() => setActive(index)} onKeyDown={onKeyDown}>{tab.label}</button>)}
    </div>
    {tabs.map((tab, index) => <div key={tab.key} className="learning-reflections-panel" role="tabpanel" id={`${id}-${tab.key}-panel`} aria-labelledby={`${id}-${tab.key}-tab`} hidden={index !== active}>
      {index === active && <>
        <label className="learning-reflections-label" htmlFor="inspiration">{current.label}<span className="learning-reflections-optional">（选填）</span></label>
        {current.key === 'explanation' && prompts.length > 1 ? (
          <ul id={`${id}-hint`} className="field-hint learning-hint reflection-prompts">
            {prompts.map((prompt, index) => <li key={index}>{prompt}</li>)}
          </ul>
        ) : <span id={`${id}-hint`} className="field-hint learning-hint">{current.key === 'explanation' ? prompts[0] || current.prompt : current.prompt}</span>}
        <textarea id="inspiration" name="inspiration" rows={6} placeholder="从你的第一句话开始…" value={reflections[current.key]} disabled={disabled} aria-describedby={`${id}-hint ${id}-limit`} aria-invalid={overLimit} ref={node => { node?.setCustomValidity(overLimit ? '三个栏目合计超过2000字，请减少内容后保存。' : ''); }} onChange={event => onChange(serializeLearningReflections({ ...reflections, [current.key]: event.target.value }))} />
      </>}
      {tab.key === 'explanation' && polishContext ? <ReflectionPolish
        input={{ ...polishContext, answer: reflections.explanation, maxLength: Math.max(0, LEARNING_REFLECTIONS_LIMIT - serializeLearningReflections({ ...reflections, explanation: '' }).length) }}
        disabled={disabled || polishDisabled}
        canApply={answer => serializeLearningReflections({ ...reflections, explanation: answer }).length <= LEARNING_REFLECTIONS_LIMIT}
        onApply={answer => {
          const next = serializeLearningReflections({ ...reflections, explanation: answer });
          if (next.length > LEARNING_REFLECTIONS_LIMIT) return false;
          onChange(next);
          document.getElementById('inspiration')?.focus();
          return true;
        }}
      /> : null}
    </div>)}
    <p className="learning-reflections-retention">切换栏目会保留已写内容，重新提炼不会覆盖你的收获。</p>
    <p id={`${id}-limit`} className={`learning-reflections-limit${overLimit ? ' is-over-limit' : ''}`} role={overLimit ? 'alert' : undefined}>{overLimit ? '三个栏目合计超过2000字，请减少内容后保存。' : '三个栏目合计最多2000字。'}<span> {value.length} / {LEARNING_REFLECTIONS_LIMIT}</span></p>
  </section>;
}
