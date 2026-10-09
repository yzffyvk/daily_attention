'use client';

import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, GitBranch, Maximize2, X } from 'lucide-react';
import { projectQuestionView, type QuestionStructure } from '@/lib/domain/knowledge-questions';
import { KnowledgeStructureMap } from './knowledge-structure-map';
import { KnowledgeEdgeDetail, KnowledgeNodeDetail } from './knowledge-structure-detail';
import { StructureReaderDialog } from './structure-reader-dialog';

type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null;
type Position = { questionId: string; viewId: string; selection: Selection };
const kindLabels = { composition: '组成与分类', flow: '运行流程', causal: '因果关系', comparison: '并列对照', decision: '条件与行动', argument: '观点与依据', timeline: '阶段演化', concepts: '概念与边界', 'problem-solution': '问题与方案', case: '案例路径' };

export function QuestionStructureView({ structure, title }: { structure: QuestionStructure; title?: string }) {
  return <QuestionReader key={JSON.stringify(structure)} structure={structure} title={title} />;
}

function QuestionReader({ structure: s, title }: { structure: QuestionStructure; title?: string }) {
  const ordered = s.questionOrder.map(id => s.questions.find(q => q.id === id)!);
  const [position, setPosition] = useState<Position>({ questionId: ordered[0].id, viewId: ordered[0].views[0].id, selection: null });
  const [history, setHistory] = useState<Position[]>([]);
  const [expanded, setExpanded] = useState(false), [mapOpen, setMapOpen] = useState(false);
  const expandRef = useRef<HTMLButtonElement>(null), detailRef = useRef<HTMLElement>(null);
  const restoreFocus = useCallback(() => expandRef.current?.focus(), []);
  const mapId = useId();
  const question = ordered.find(q => q.id === position.questionId)!;
  const questionIndex = ordered.indexOf(question);
  const view = question.views.find(v => v.id === position.viewId)!;
  const local = useMemo(() => projectQuestionView(s, position.questionId, position.viewId), [s, position.questionId, position.viewId]);
  const selected = position.selection?.kind === 'node' ? s.nodes.find(n => n.id === position.selection!.id) : null;
  const edgeIndex = position.selection?.kind === 'edge' ? view.relationIds.indexOf(position.selection.id) : -1;
  const edge = edgeIndex >= 0 ? local.relations[edgeIndex] : null;
  const owner = selected ? ordered.find(q => q.id === selected.homeQuestionId)! : null;
  const contextNote = selected ? view.contextNotes.find(n => n.nodeId === selected.id)?.text : null;
  const referenceLabels = Object.fromEntries(view.referenceNodeIds.map(id => {
    const n = s.nodes.find(n => n.id === id)!;
    return [n.name, `引自问题 ${ordered.findIndex(q => q.id === n.homeQuestionId) + 1}`];
  }));
  const focusDetails = () => requestAnimationFrame(() => {
    const panel = detailRef.current;
    if (panel && panel.closest('.relation-reader')!.getBoundingClientRect().width < 1000) panel.focus({ preventScroll: false });
  });
  const select = (selection: Selection) => { setPosition(p => ({ ...p, selection })); focusDetails(); };
  const onNode = (name: string) => select({ kind: 'node', id: s.nodes.find(n => n.name === name)!.id });
  const onEdge = (index: number) => select({ kind: 'edge', id: view.relationIds[index] });
  const openQuestion = (id: string, nodeId?: string, follow = false) => {
    const q = ordered.find(q => q.id === id)!;
    const target = nodeId ? q.views.find(v => v.nodeIds.includes(nodeId))! : q.views[0];
    setHistory(h => follow ? [...h, position] : []);
    setPosition({ questionId: id, viewId: target.id, selection: nodeId ? { kind: 'node', id: nodeId } : null });
    focusDetails();
  };
  const back = () => { setPosition(history.at(-1)!); setHistory(h => h.slice(0, -1)); focusDetails(); };
  const crossLinks = s.questionLinks.filter(l => l.fromQuestionId === question.id || l.toQuestionId === question.id);
  const content = <div className="relation-reader question-reader">
    <header className="structure-reader-heading">
      <div><span className="relation-eyebrow">AI 提炼 · 问题阅读</span><h4>{expanded ? title || '知识骨架' : '带着问题，逐步理解'}</h4></div>
      {expanded ? <button type="button" className="structure-quiet-button" aria-label="关闭全屏阅读" onClick={() => setExpanded(false)}><X size={18} aria-hidden="true" />收起阅读</button>
        : <button type="button" className="structure-quiet-button" aria-label="展开阅读" aria-haspopup="dialog" ref={expandRef} onClick={() => setExpanded(true)}><Maximize2 size={16} aria-hidden="true" />展开阅读</button>}
    </header>
    <div className="relation-question"><span className="question-mainline-label">核心主线</span><p>{s.coreQuestion}</p></div>
    {ordered.length > 1 ? <nav className="structure-reading-route question-route" aria-label="问题阅读路线">
      <div className="structure-route-caption"><span><BookOpen size={14} aria-hidden="true" />文章回答了哪些问题</span><small>编号是建议阅读顺序，不代表因果</small></div>
      <ol>{ordered.map((q, i) => <li key={q.id}><button type="button" aria-label={`阅读问题：${q.title}`} aria-current={q.id === question.id ? 'step' : undefined} onClick={() => openQuestion(q.id)}>
        <span className="structure-step-number">{String(i + 1).padStart(2, '0')}</span><span><strong>{q.title}</strong><small>{q.mainlineRole}</small><span className="question-answer-preview">{q.answer}</span></span>
      </button></li>)}</ol>
    </nav> : null}
    <div className="question-current-heading" aria-live="polite"><span>问题 {questionIndex + 1} / {ordered.length}</span><h3>{question.title}</h3><p>{question.answer}</p></div>
    {history.length ? <button type="button" className="structure-return" aria-label={`返回来源问题：${ordered.find(q => q.id === history.at(-1)!.questionId)!.title}`} onClick={back}><ArrowLeft size={15} aria-hidden="true" />返回来源问题：{ordered.find(q => q.id === history.at(-1)!.questionId)!.title}</button> : null}
    {question.views.length > 1 ? <div className="question-views" role="group" aria-label="本题局部视图">{question.views.map(v => <button type="button" key={v.id} aria-pressed={view.id === v.id} onClick={() => { setPosition(p => ({ ...p, viewId: v.id, selection: null })); }}>{v.title}</button>)}</div> : null}
    <div className="structure-reader-panes">
      <section className="structure-map-panel" aria-label="本题局部结构图" data-open={mapOpen}>
        <header className="structure-map-heading"><div><h4><GitBranch size={18} aria-hidden="true" />{view.title}</h4><p>{kindLabels[view.diagramKind]} · 只展示本题需要的关系</p></div></header>
        <button type="button" className="structure-map-disclosure" aria-controls={mapId} aria-expanded={mapOpen} onClick={() => setMapOpen(!mapOpen)}><span>{mapOpen ? '收起结构图' : '展开结构图'}<small>{local.nodes.length} 个节点 · {local.relations.length} 条关系</small></span><ChevronDown size={18} aria-hidden="true" /></button>
        <div className="structure-map-body" id={mapId}>
          {view.diagramKind === 'comparison' || !local.relations.length ? <div className="question-concept-grid" role="group" aria-label="骨架节点">{local.nodes.map(n => <button key={n.name} type="button" aria-label={n.name} aria-pressed={selected?.name === n.name} onClick={() => onNode(n.name)}><small>{referenceLabels[n.name] || n.role}</small><strong>{n.name}</strong><span>{n.summary}</span></button>)}</div>
            : <KnowledgeStructureMap structure={local} selectedName={selected?.name ?? null} selectedEdge={edgeIndex >= 0 ? edgeIndex : null} onNode={onNode} onEdge={onEdge} diagramKind={view.diagramKind} referenceLabels={referenceLabels} />}
          {!local.relations.length ? <p className="structure-map-hint">资料未明确提供这些概念之间的关系，按独立内容阅读。</p> : <div className="question-local-relations" role="group" aria-label="本图关系">{local.relations.map((e, i) => <button key={view.relationIds[i]} type="button" aria-pressed={edgeIndex === i} onClick={() => onEdge(i)}><strong>{e.from}</strong><span>{e.label}</span><strong>{e.to}</strong>{e.condition ? <small>{e.condition}</small> : null}</button>)}</div>}
          {view.referenceNodeIds.length ? <p className="structure-map-hint">标记“引自问题”的概念与原问题共享解释，可点击查看来源。</p> : null}
        </div>
      </section>
      <section ref={detailRef} tabIndex={-1} className="structure-detail-panel" aria-label={edge ? '关系解释' : selected ? '节点解释' : '本题答案'}>
        <div className="structure-detail-topline"><span>{edge ? '理解关系' : selected ? '探索概念' : '本题答案'}</span><small>{question.mainlineRole}</small></div>
        {position.selection ? <button type="button" className="structure-return" onClick={() => select(null)}><ArrowLeft size={14} aria-hidden="true" />回到本题答案</button> : null}
        <div className="structure-detail-content">
          {edge ? <KnowledgeEdgeDetail edge={edge} onNode={onNode} /> : selected ? <>
            {contextNote ? <p className="question-context-note">{contextNote}</p> : null}
            {owner && owner.id !== question.id ? <div className="question-reference"><span>引用自问题 {ordered.indexOf(owner) + 1}：{owner.title}</span><button type="button" aria-label={`查看完整解释：${owner.title}`} onClick={() => openQuestion(owner.id, selected.id, true)}>查看完整解释<ArrowRight size={14} aria-hidden="true" /></button></div> : null}
            <KnowledgeNodeDetail node={selected} structure={local} onEdge={onEdge} />
          </> : <>
            <h4>{question.title}</h4><p className="structure-detail-summary">{question.answer}</p><p className="question-scope">本题范围：{question.scope}</p>
            <div className="question-reading-nodes" role="group" aria-label="本题概念">{[...new Set([...view.readingOrder, ...view.nodeIds])].map(id => { const n = s.nodes.find(n => n.id === id)!; return <button key={id} type="button" onClick={() => onNode(n.name)}><strong>{n.name}</strong><span>{view.contextNotes.find(c => c.nodeId === id)?.text || n.summary}</span><ArrowRight size={14} aria-hidden="true" /></button>; })}</div>
            <details className="structure-source"><summary tabIndex={0}>查看本题原文依据</summary><blockquote>{question.evidence}</blockquote></details>
          </>}
        </div>
        {crossLinks.length ? <section className="question-cross-links" aria-label="跨问题联系"><h5>与其他问题的联系</h5>{crossLinks.map((l, i) => {
          const targetId = l.fromQuestionId === question.id ? l.toQuestionId : l.fromQuestionId;
          const target = ordered.find(q => q.id === targetId)!;
          return <details key={i}><summary tabIndex={0}>{l.label}</summary>{l.relationIds.map(id => { const e = s.relations.find(e => e.id === id)!; return <div key={id}><p>{s.nodes.find(n => n.id === e.from)!.name} · {e.label} · {s.nodes.find(n => n.id === e.to)!.name}</p>{e.condition ? <p>条件：{e.condition}</p> : null}<blockquote>{e.evidence}</blockquote></div>; })}<button type="button" onClick={() => openQuestion(targetId, undefined, true)}>前往问题 {ordered.indexOf(target) + 1}：{target.title}<ArrowRight size={14} aria-hidden="true" /></button></details>;
        })}</section> : null}
      </section>
    </div>
    {ordered.length > 1 ? <footer className="structure-reading-controls question-controls"><button type="button" disabled={questionIndex === 0} onClick={() => openQuestion(ordered[questionIndex - 1].id)}><ArrowLeft size={17} aria-hidden="true" /><span><small>上一问题</small>{ordered[questionIndex - 1]?.title ?? '阅读起点'}</span></button><button type="button" disabled={questionIndex === ordered.length - 1} onClick={() => openQuestion(ordered[questionIndex + 1].id)}><span><small>下一问题</small>{ordered[questionIndex + 1]?.title ?? '已到最后一个问题'}</span><ArrowRight size={17} aria-hidden="true" /></button></footer> : null}
  </div>;
  return expanded ? <StructureReaderDialog restoreFocus={restoreFocus} onClose={() => setExpanded(false)}>{content}</StructureReaderDialog> : content;
}
