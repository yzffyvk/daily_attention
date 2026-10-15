'use client';

import { useCallback, useId, useRef, useState } from 'react';
import { ChevronDown, Maximize2, X } from 'lucide-react';
import { projectQuestionView, type QuestionStructure } from '@/lib/domain/knowledge-questions';
import { QuestionStructureMap } from './question-structure-map';
import { KnowledgeEdgeDetail } from './knowledge-structure-detail';
import { StructureReaderDialog } from './structure-reader-dialog';
import { QuestionMemoryOutline, QuestionPartExplanation, questionReadingParts, SummaryText } from './question-reading';
import { PendingReviewNotice } from './pending-review-notice';
import { PENDING_REVIEW_PREFIX } from '@/lib/domain/ai-review';

type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null;
type Props = { structure: QuestionStructure; title?: string; thesis?: string; warnings?: string[]; prompts?: string[] };

export function QuestionStructureView(props: Props) {
  return <QuestionReader key={JSON.stringify(props.structure)} {...props} />;
}

function QuestionReader({ structure: s, thesis, warnings = [], prompts = [] }: Props) {
  const parts = questionReadingParts(s);
  const sourceWarnings = warnings.filter(warning => !warning.startsWith(PENDING_REVIEW_PREFIX));
  const ordered = parts.map(part => part.question);
  const [questionId, setQuestionId] = useState<string | null>(null);
  const [viewId, setViewId] = useState(ordered[0].views[0].id);
  const [selection, setSelection] = useState<Selection>(null);
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [relationStep, setRelationStep] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const expandRef = useRef<HTMLButtonElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const detailTriggerRef = useRef<Selection>(null);
  const restoreFocus = useCallback(() => expandRef.current?.focus(), []);
  const prefix = useId();
  const question = ordered.find(q => q.id === questionId) ?? ordered[0];
  const view = question.views.find(v => v.id === viewId) ?? question.views[0];
  const local = projectQuestionView(s, question.id, view.id);
  const selected = selection?.kind === 'node' ? s.nodes.find(n => n.id === selection.id) : null;
  const edgeIndex = selection?.kind === 'edge' ? view.relationIds.indexOf(selection.id) : -1;
  const edge = edgeIndex >= 0 ? local.relations[edgeIndex] : null;
  const select = (next: Selection) => {
    if (!selection) detailTriggerRef.current = next;
    setSelection(next);
    requestAnimationFrame(() => detailRef.current?.focus());
  };
  const closeDetails = () => {
    setSelection(null);
    requestAnimationFrame(() => {
      const trigger = detailTriggerRef.current;
      // Fullscreen remounts the graph. Resolve the current button, not a detached DOM node.
      const button = trigger?.kind === 'node'
        ? [...readerRef.current?.querySelectorAll<HTMLButtonElement>('.question-graph-node') ?? []].find(el => el.getAttribute('aria-label') === s.nodes.find(n => n.id === trigger.id)?.name)
        : trigger?.kind === 'edge' ? readerRef.current?.querySelector<HTMLButtonElement>(`[data-edge-index="${view.relationIds.indexOf(trigger.id)}"]`) : null;
      button?.focus({ preventScroll: true });
    });
  };
  const onNode = (name: string) => select({ kind: 'node', id: s.nodes.find(n => n.name === name)!.id });
  const onEdge = (index: number) => select({ kind: 'edge', id: view.relationIds[index] });
  const content = <div className="relation-reader question-reader" ref={readerRef}>
    <header className="question-reader-toolbar">
      <span className="question-mainline-label">核心主线</span>
      {expanded ? <button type="button" className="structure-quiet-button" aria-label="关闭全屏阅读" onClick={() => setExpanded(false)}><X size={18} aria-hidden="true" />收起阅读</button>
        : <button type="button" className="structure-quiet-button" aria-label="展开阅读" aria-haspopup="dialog" ref={expandRef} onClick={() => setExpanded(true)}><Maximize2 size={16} aria-hidden="true" />展开阅读</button>}
    </header>
    <div className="question-mainline">
      <h4>{thesis || s.coreQuestion}</h4>
      {thesis ? <p>{s.coreQuestion}</p> : null}
    </div>
    <PendingReviewNotice warnings={warnings} structure={s} />
    {sourceWarnings.length ? <details className="question-warnings"><summary>资料范围与提醒（{sourceWarnings.length}）</summary>{sourceWarnings.map((warning, i) => <p key={i}>{warning}</p>)}</details> : null}
    <QuestionMemoryOutline parts={parts} />
    <p className="question-framework-hint">沿着同一骨架，展开原理、例子与适用条件。</p>
    <div className="question-sections" aria-label="全文记忆框架">
      {parts.map(({ question: q, label, nodes }) => {
        const open = q.id === questionId;
        const headingId = `${prefix}-question-${q.id}`, bodyId = `${prefix}-answer-${q.id}`;
        return <section key={q.id} className="question-section" data-open={open}>
          <h5 id={headingId}><button type="button" className="question-section-toggle" aria-label={`展开核心部分：${label}`} aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => {
            setQuestionId(open ? null : q.id); setViewId(q.views[0].id); setSelection(null); setDiagramOpen(false); setRelationStep(0);
          }}><span className="question-framework-marker" aria-hidden="true" /><span>{label}</span><ChevronDown size={19} aria-hidden="true" /></button></h5>
          {open ? <div id={bodyId} role="region" aria-labelledby={headingId} className="question-section-body">
            <h6 className="question-learning-question">{q.title}</h6>
            <p className="question-direct-answer"><SummaryText value={q.answer} /></p>
            <QuestionPartExplanation nodes={nodes} />
            <button type="button" className="question-diagram-toggle" aria-expanded={diagramOpen} aria-controls={diagramOpen ? `${bodyId}-diagram` : undefined} onClick={() => { setDiagramOpen(!diagramOpen); setSelection(null); }}>{diagramOpen ? '收起简图' : '查看简图'}<ChevronDown size={16} aria-hidden="true" /></button>
            {diagramOpen ? <div id={`${bodyId}-diagram`}>
            {q.views.length > 1 ? <div className="question-views" role="group" aria-label="本题局部视图">{q.views.map(v => <button type="button" key={v.id} aria-pressed={view.id === v.id} onClick={() => { setViewId(v.id); setSelection(null); setRelationStep(0); }}>{v.title}</button>)}</div> : null}
            <div className="question-diagram" aria-label="本题局部结构图">
              <QuestionStructureMap key={view.id} structure={local} selectedName={selected?.name ?? null} selectedEdge={edgeIndex >= 0 ? edgeIndex : null} onNode={onNode} onEdge={onEdge} onClear={() => setSelection(null)} step={relationStep} onStepChange={setRelationStep} />
            </div>
            {selected || edge ? <section ref={detailRef} tabIndex={-1} className="question-detail" aria-label={edge ? '关系解释' : '节点解释'}>
              <button type="button" className="question-detail-close" aria-label="收起详情" onClick={closeDetails}><X size={16} aria-hidden="true" />收起详情</button>
              {edge ? <KnowledgeEdgeDetail edge={edge} onNode={onNode} /> : selected ? <>
                <h5>{selected.name}</h5>
                <p>{selected.explanation || selected.summary}</p>
                <details className="structure-evidence"><summary tabIndex={0}>查看原文依据</summary><blockquote>{selected.evidence}</blockquote></details>
              </> : null}
            </section> : null}
            </div> : null}
            <details className="structure-source question-source"><summary tabIndex={0}>查看本题原文依据</summary><blockquote>{q.evidence}</blockquote></details>
          </div> : null}
        </section>;
      })}
    </div>
    {prompts.length ? <details className="question-recall"><summary tabIndex={0}>试着讲一遍</summary><ol>{prompts.map((prompt, index) => <li key={index}><SummaryText value={prompt} /></li>)}</ol></details> : null}
  </div>;
  return expanded ? <StructureReaderDialog restoreFocus={restoreFocus} onClose={() => setExpanded(false)}>{content}</StructureReaderDialog> : content;
}
