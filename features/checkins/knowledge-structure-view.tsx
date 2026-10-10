'use client';

import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, GitBranch, Maximize2, RotateCcw, X } from 'lucide-react';
import type { KnowledgeStructure } from '@/lib/domain/knowledge-structure';
import { buildReadingChapters } from './structure-reader-model';
import { KnowledgeStructureMap } from './knowledge-structure-map';
import { KnowledgeEdgeDetail, KnowledgeNodeDetail } from './knowledge-structure-detail';
import { StructureReaderDialog } from './structure-reader-dialog';

type Exploration = { kind: 'node'; name: string } | { kind: 'edge'; index: number } | { kind: 'overview' } | null;

export function KnowledgeStructureView({ structure, title }: { structure: KnowledgeStructure; title?: string }) {
  return <StructureReader key={JSON.stringify(structure)} structure={structure} title={title} />;
}

function StructureReader({ structure, title }: { structure: KnowledgeStructure; title?: string }) {
  const chapters = useMemo(() => buildReadingChapters(structure), [structure]);
  const route = chapters.flatMap(chapter => chapter.names);
  const [cursor, setCursor] = useState(0);
  const [exploration, setExploration] = useState<Exploration>(null);
  const [expanded, setExpanded] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const expandRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useCallback(() => expandRef.current?.focus(), []);
  const detailRef = useRef<HTMLElement>(null);
  const mapId = useId();
  const readingName = route[cursor];
  const selectedName = exploration?.kind === 'node' ? exploration.name : exploration ? null : readingName;
  const selected = structure.nodes.find(node => node.name === selectedName);
  const edgeIndex = exploration?.kind === 'edge' ? exploration.index : null;
  const edge = edgeIndex === null ? null : structure.relations[edgeIndex];
  const chapterIndex = Math.max(0, chapters.findIndex(chapter => chapter.names.includes(selectedName ?? readingName)));
  const chapter = chapters[chapterIndex];
  const focusDetails = () => requestAnimationFrame(() => {
    // Move keyboard focus to the destination when it is stacked below the map.
    const panel = detailRef.current;
    if (panel && panel.closest('.relation-reader')!.getBoundingClientRect().width < 1000) panel.focus({ preventScroll: false });
  });
  const read = (name: string) => { setCursor(route.indexOf(name)); setExploration(null); focusDetails(); };
  const exploreNode = (name: string) => { setExploration({ kind: 'node', name }); focusDetails(); };
  const exploreEdge = (index: number) => { setExploration({ kind: 'edge', index }); focusDetails(); };
  const returnToReading = () => { setExploration(null); focusDetails(); };
  const content = <div className="relation-reader">
    <header className="structure-reader-heading">
      <div><span className="relation-eyebrow">AI 提炼 · 结构阅读</span><h4>{expanded ? title || '知识骨架' : '先看整体，再沿主线理解'}</h4></div>
      {expanded ? <button className="structure-quiet-button" type="button" onClick={() => setExpanded(false)} aria-label="关闭全屏阅读"><X size={18} aria-hidden="true" />收起阅读</button>
        : <button className="structure-quiet-button" type="button" onClick={() => setExpanded(true)} ref={expandRef} aria-label="展开阅读" aria-haspopup="dialog"><Maximize2 size={16} aria-hidden="true" />展开阅读</button>}
    </header>
    <div className="relation-question"><p>{structure.coreQuestion}</p><div className="relation-types">{structure.contentTypes.map(type => <span key={type}>{type}</span>)}</div></div>
    <nav className="structure-reading-route" aria-label="建议阅读顺序">
      <div className="structure-route-caption"><span><BookOpen size={14} aria-hidden="true" />建议阅读顺序</span><small>帮助理解的顺序，不代表执行或因果关系</small></div>
      <ol>{chapters.map((item, index) => <li key={item.id}>
        <button type="button" aria-label={`阅读 ${item.title}`} aria-current={index === chapterIndex && exploration?.kind !== 'overview' ? 'step' : undefined} onClick={() => read(item.names[0])}>
          <span className="structure-step-number">{String(index + 1).padStart(2, '0')}</span>
          <span><strong>{item.title}</strong><small title={item.names.join(' · ')}>{item.names.join(' · ')}</small></span>
          <span className="structure-step-count">{item.names.length}</span>
        </button>
      </li>)}</ol>
    </nav>
    <div className="structure-reader-panes">
      <section className="structure-map-panel" aria-label="知识关系骨架" data-open={mapOpen}>
        <header className="structure-map-heading"><div><h4><GitBranch size={18} aria-hidden="true" />结构全貌</h4><p>{edge ? `${edge.from} · ${edge.kind} · ${edge.to}` : selected ? `当前${exploration ? '探索' : '阅读'}：${selected.name}` : '查看节点之间的全部联系'}</p></div><button type="button" className="structure-quiet-button structure-overview" onClick={() => setExploration({ kind: 'overview' })}><RotateCcw size={14} aria-hidden="true" />回看整体</button></header>
        <button type="button" className="structure-map-disclosure" aria-controls={mapId} aria-expanded={mapOpen} onClick={() => setMapOpen(!mapOpen)}><span>{mapOpen ? '收起结构图' : '展开结构图'}<small>{structure.nodes.length} 个节点 · {structure.relations.length} 条关系</small></span><ChevronDown size={18} aria-hidden="true" /></button>
        <div className="structure-map-body" id={mapId}>
          <KnowledgeStructureMap structure={structure} selectedName={selectedName ?? null} selectedEdge={edgeIndex} onNode={exploreNode} onEdge={exploreEdge} />
          <div className="structure-map-legend"><span><i data-line="composition" />包含 / 分类</span><span><ArrowRight size={22} aria-hidden="true" />有向关系</span><span><i data-line="symmetric" />对照 / 权衡 / 区别</span></div>
          <p className="structure-map-hint">点节点读解释，点连线看关系。布局保持不变，亮起的是当前联系。</p>
        </div>
      </section>
      <section ref={detailRef} tabIndex={-1} className="structure-detail-panel" aria-label={edge ? '关系解释' : selected ? '节点解释' : '阅读概览'}>
        <div className="structure-detail-topline"><span>{exploration ? '自由探索' : `${String(chapterIndex + 1).padStart(2, '0')} · ${chapter.title}`}</span><small>{exploration ? '阅读位置已保留' : `${cursor + 1} / ${route.length} 个节点`}</small></div>
        {exploration && exploration.kind !== 'overview' ? <button type="button" className="structure-return" aria-label={`返回阅读：${readingName}`} onClick={returnToReading}><ArrowLeft size={14} aria-hidden="true" />返回阅读：{readingName}</button> : null}
        {selected && !exploration ? <div className="structure-chapter-nodes" role="group" aria-label="本段节点">{chapter.names.map(name => <button type="button" key={name} aria-pressed={selectedName === name} onClick={() => read(name)}>{name}</button>)}</div> : null}
        <div className="structure-detail-content" key={edge ? `edge-${edgeIndex}` : selectedName ?? 'overview'}>
          {edge ? <KnowledgeEdgeDetail edge={edge} onNode={exploreNode} /> : selected ? <KnowledgeNodeDetail node={selected} structure={structure} onEdge={exploreEdge} /> : <>
            <span className="structure-detail-role">全貌</span><h4>从整体找到下一步</h4><p className="structure-detail-summary">{structure.nodes.length} 个节点，{structure.relations.length} 条关系。沿阅读路线逐段理解，也可以直接探索感兴趣的节点。</p>
            <ol className="structure-overview-chapters">{chapters.map(item => <li key={item.id}><button type="button" onClick={() => read(item.names[0])}><strong>{item.title}</strong><span>{item.names.join(' · ')}</span><ArrowRight size={16} aria-hidden="true" /></button></li>)}</ol>
            {!structure.relations.length ? <p className="structure-empty">资料未明确提供节点间关系，这些内容按独立主题保留。</p> : null}
            <button type="button" className="structure-return" onClick={returnToReading} aria-label={`继续阅读：${readingName}`}>继续阅读：{readingName}<ArrowRight size={16} aria-hidden="true" /></button>
          </>}
        </div>
        {!exploration ? <footer className="structure-reading-controls">
          <button type="button" disabled={cursor === 0} onClick={() => read(route[cursor - 1])} aria-label={cursor ? `上一节点：${route[cursor - 1]}` : '已是第一个节点'}><ArrowLeft size={17} aria-hidden="true" /><span><small>上一节点</small>{route[cursor - 1] ?? '阅读起点'}</span></button>
          {cursor < route.length - 1 ? <button type="button" onClick={() => read(route[cursor + 1])} aria-label={`下一节点：${route[cursor + 1]}`}><span><small>下一节点</small>{route[cursor + 1]}</span><ArrowRight size={17} aria-hidden="true" /></button> : <button type="button" onClick={() => setExploration({ kind: 'overview' })}>读完了，回看整体<ArrowRight size={17} aria-hidden="true" /></button>}
        </footer> : null}
      </section>
    </div>
  </div>;
  return expanded ? <StructureReaderDialog restoreFocus={restoreFocus} onClose={() => setExpanded(false)}>{content}</StructureReaderDialog> : content;
}
