'use client';

import { useState } from 'react';
import { ArrowRight, ArrowLeftRight, GitBranch, BookOpen } from 'lucide-react';
import type { KnowledgeRelation, KnowledgeStructure } from '@/lib/domain/knowledge-structure';

const symmetric = new Set<KnowledgeRelation['kind']>(['对照', '权衡', '区别']);
const groups: { title: string; kinds: KnowledgeRelation['kind'][] }[] = [
  { title: '组成与分类', kinds: ['包含', '分类'] },
  { title: '作用、条件与依据', kinds: ['作用', '依赖', '因果', '条件', '支持', '例证'] },
  { title: '运行与演化', kinds: ['流程', '反馈', '演化'] },
  { title: '比较与权衡', kinds: ['对照', '权衡', '区别'] },
];

export function KnowledgeStructureView({ structure }: { structure: KnowledgeStructure }) {
  const [selection, setSelection] = useState<{ document: KnowledgeStructure; name: string } | null>(null);
  const selectedName = selection?.document === structure ? selection.name : null;
  const selected = structure.nodes.find(node => node.name === selectedName);
  const relations = selected ? structure.relations.filter(edge => edge.from === selected.name || edge.to === selected.name) : structure.relations;
  const select = (name: string) => setSelection({ document: structure, name });
  const relatedNames = new Set(relations.flatMap(edge => [edge.from, edge.to]));

  return <div className="relation-reader">
    <div className="relation-question">
      <span className="relation-eyebrow">这份资料要讲清什么</span>
      <h4>{structure.coreQuestion}</h4>
      <div className="relation-types">{structure.contentTypes.map(type => <span key={type}>{type}</span>)}</div>
    </div>
    {structure.readingOrder.length > 0 ? <details className="relation-reading-order" open>
      <summary><BookOpen size={14} aria-hidden="true" />建议阅读顺序</summary>
      <p>帮助理解的顺序，不代表执行或因果关系</p>
      <ol>{structure.readingOrder.map(name => <li key={name}><button type="button" onClick={() => select(name)}>{name}</button></li>)}</ol>
    </details> : null}
    <div className="relation-navigation" role="group" aria-label="骨架节点">
      <button type="button" className="relation-all" aria-pressed={!selected} onClick={() => setSelection(null)}>全部关系</button>
      {structure.nodes.map(node => <button
        type="button" key={node.name} aria-label={node.name} aria-pressed={selected?.name === node.name}
        data-related={!selected || relatedNames.has(node.name)} onClick={() => select(node.name)}
      ><small>{node.role}</small>{node.name}</button>)}
    </div>
    {selected ? <section className="relation-detail" aria-label="节点解释" aria-live="polite">
      <span className="relation-eyebrow">{selected.role} · {selected.summary}</span>
      <h4>{selected.name}</h4>
      <p>{selected.explanation}</p>
      <details><summary>查看节点依据</summary><blockquote>{selected.evidence}</blockquote></details>
    </section> : null}
    <section aria-label="知识关系骨架" className="relation-map">
      <div className="relation-map-heading"><GitBranch size={15} aria-hidden="true" /><span>{selected ? `与「${selected.name}」相连的关系` : '沿着关系理解骨架'}</span><small>{relations.length} 条关系</small></div>
      {groups.map(group => {
        const edges = relations.filter(edge => group.kinds.includes(edge.kind));
        if (!edges.length) return null;
        return <div className="relation-group" key={group.title}>
          <h5>{group.title}</h5>
          <ul>{edges.map(edge => <li className="relation-edge" key={JSON.stringify([edge.from, edge.kind, edge.to, edge.label])} data-kind={edge.kind}>
            <div className="relation-edge-line">
              <button type="button" aria-label={`展开 ${edge.from}`} aria-pressed={selectedName === edge.from} onClick={() => select(edge.from)}>{edge.from}</button>
              <span className="relation-link"><span>{edge.label}</span>{symmetric.has(edge.kind) ? <ArrowLeftRight size={18} aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}<small>{edge.kind === edge.label ? '' : edge.kind}</small></span>
              <button type="button" aria-label={`展开 ${edge.to}`} aria-pressed={selectedName === edge.to} onClick={() => select(edge.to)}>{edge.to}</button>
            </div>
            {edge.condition ? <p className="relation-condition">{edge.condition}</p> : null}
            <details className="relation-evidence"><summary>查看关系依据</summary><blockquote>{edge.evidence}</blockquote></details>
          </li>)}</ul>
        </div>;
      })}
      {!relations.length ? <p className="relation-empty">{selected ? '资料未明确说明该节点与其他节点的关系，可先阅读节点解释。' : '这些内容按独立主题保留，资料未明确提供节点间关系。'}</p> : null}
    </section>
  </div>;
}
