'use client';

import { ArrowLeftRight, ArrowRight, ChevronRight } from 'lucide-react';
import type { KnowledgeConcept, KnowledgeRelation, KnowledgeStructure } from '@/lib/domain/knowledge-structure';
import { isSymmetric } from './structure-reader-model';

function Evidence({ value }: { value: string }) {
  // Explicit tabindex keeps this native disclosure in the shared dialog loop.
  return <details className="structure-evidence"><summary tabIndex={0}>查看原文依据</summary><blockquote>{value}</blockquote></details>;
}
function relationGroup(edge: KnowledgeRelation, node: string) {
  if (isSymmetric(edge)) return '比较与权衡';
  if (edge.kind === '包含') return edge.from === node ? '它包含什么' : '它属于什么';
  if (edge.kind === '分类') return edge.from === node ? '如何分类' : '它属于哪一类';
  if (edge.kind === '依赖' || edge.kind === '条件') return '依赖与条件';
  if (edge.kind === '支持' || edge.kind === '例证') return '论据与例证';
  if (edge.kind === '作用' && edge.from === node) return '它改变什么';
  if (['流程', '反馈', '演化', '因果'].includes(edge.kind)) return '如何流转';
  return '相关联系';
}
export function KnowledgeNodeDetail({ node, structure, onEdge }: {
  node: KnowledgeConcept; structure: KnowledgeStructure; onEdge: (index: number) => void;
}) {
  const groups = new Map<string, { edge: KnowledgeRelation; index: number }[]>();
  structure.relations.forEach((edge, index) => {
    if (edge.from !== node.name && edge.to !== node.name) return;
    const title = relationGroup(edge, node.name);
    groups.set(title, [...(groups.get(title) ?? []), { edge, index }]);
  });
  return <>
    <span className="structure-detail-role">{node.role}</span>
    <h4>{node.name}</h4>
    <p className="structure-detail-summary">{node.summary}</p>
    <p className="structure-detail-explanation">{node.explanation}</p>
    {[...groups].map(([title, items]) => <section className="structure-detail-relations" key={title}>
      <h5>{title}</h5>
      {items.map(({ edge, index }) => <div className="structure-detail-relationship" key={index}>
        <button type="button" onClick={() => onEdge(index)} aria-label={`了解关系：${edge.label}`}>
          <span className="structure-relation-endpoints"><span>{edge.from}</span>{isSymmetric(edge) ? <ArrowLeftRight size={15} aria-hidden="true" /> : <ArrowRight size={15} aria-hidden="true" />}<span>{edge.to}</span><small>{edge.kind}</small></span>
          <span className="structure-relation-label">{edge.label}<ChevronRight size={15} aria-hidden="true" /></span>
        </button>
        {edge.condition ? <p className="structure-condition">{edge.condition}</p> : null}
      </div>)}
    </section>)}
    {!groups.size ? <p className="structure-empty">资料未明确提供这个节点与其他节点的关系，可独立阅读。</p> : null}
    <Evidence value={node.evidence} />
  </>;
}

export function KnowledgeEdgeDetail({ edge, onNode }: { edge: KnowledgeRelation; onNode: (name: string) => void }) {
  return <>
    <span className="structure-detail-role">关系 · {edge.kind}</span>
    <h4>{edge.label}</h4>
    <div className="structure-edge-endpoints">
      <button type="button" onClick={() => onNode(edge.from)} aria-label={`展开 ${edge.from}`}>{edge.from}</button>
      {isSymmetric(edge) ? <ArrowLeftRight aria-label="双向关系" size={22} /> : <ArrowRight aria-label="关系方向" size={22} />}
      <button type="button" onClick={() => onNode(edge.to)} aria-label={`展开 ${edge.to}`}>{edge.to}</button>
    </div>
    {edge.condition ? <section className="structure-detail-relations"><h5>{edge.kind === '权衡' ? '需要权衡什么' : '成立条件与适用范围'}</h5><p className="structure-detail-explanation">{edge.condition}</p></section> : null}
    <Evidence value={edge.evidence} />
    <p className="structure-empty">点击两端节点，继续理解这条关系。</p>
  </>;
}
