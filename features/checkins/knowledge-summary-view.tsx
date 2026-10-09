"use client";

import { ChevronDown, Layers3, Lightbulb } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { QuestionStructureView } from "./question-structure-view";
import { KnowledgeStructureView } from "./knowledge-structure-view";
import { parseKnowledgeSummary, type KnowledgeNode } from "@/lib/domain/knowledge-summary";

function flattenNodes(nodes: KnowledgeNode[]): KnowledgeNode[] {
  return nodes.flatMap(node => [node, ...flattenNodes(node.children)]);
}

function leafCount(node: KnowledgeNode): number {
  return node.children.length ? node.children.reduce((count, child) => count + leafCount(child), 0) : 1;
}

function KnowledgeText({ value }: { value: string }) {
  return <div className="knowledge-prose">{value.split(/\n\s*\n/u).filter(Boolean).map((block, index) => (
    <p key={index}>{block.replace(/^#{1,6}\s+/gmu, "").replace(/\*\*(.*?)\*\*/gu, "$1")}</p>
  ))}</div>;
}

function KnowledgeBranch({ node, selectedId, onSelect }: {
  node: KnowledgeNode;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <li className={`knowledge-node${node.children.length ? " has-children" : ""}${selectedId === node.id ? " is-selected" : ""}`} style={{ "--node-weight": leafCount(node) } as CSSProperties}>
      <button
        aria-label={node.label}
        aria-pressed={selectedId === node.id}
        className="knowledge-node-label"
        onClick={() => onSelect(node.id)}
        type="button"
      >
        <strong>{node.label}</strong>
        {node.description ? <span>{node.description}</span> : null}
      </button>
      {node.children.length ? (
        <ul className="knowledge-children">
          {node.children.map(child => <KnowledgeBranch key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} />)}
        </ul>
      ) : null}
    </li>
  );
}

export function KnowledgeSummaryView({ value, title }: { value: string; title?: string }) {
  const document = useMemo(() => parseKnowledgeSummary(value), [value]);
  const nodes = useMemo(() => flattenNodes(document.roots), [document.roots]);
  const [selection, setSelection] = useState<{ source: string; id: string } | null>(null);
  const defaultNode = nodes.filter(node => node !== document.roots[0] && node.children.length).sort((a, b) => b.children.length - a.children.length)[0]
    ?? nodes.find(node => node.details.length)
    ?? nodes[0];
  const selected = (selection?.source === value ? nodes.find(node => node.id === selection.id) : null) ?? defaultNode;

  if (!value.trim()) return (
    <div className="knowledge-empty">
      <Layers3 aria-hidden="true" size={28} />
      <h4>让知识的结构先清晰起来</h4>
      <p>添加资料后，先看主旨与骨架，再沿着节点阅读解释。</p>
    </div>
  );

  return (
    <div className="knowledge-summary-view">
      {document.thesis ? <p className="knowledge-thesis">{document.thesis}</p> : null}
      {document.questions ? <>
        {document.questions.warnings.map((warning, index) => <p key={index} className="knowledge-structure-notes">{warning}</p>)}
        <QuestionStructureView structure={document.questions.structure} title={title} />
      </> : document.structure ? <>
        {document.unmapped ? <div className="knowledge-structure-notes"><KnowledgeText value={document.unmapped} /></div> : null}
        <KnowledgeStructureView structure={document.structure} title={title} />
      </> : selected ? (
        <div className="knowledge-reader-grid">
          <section aria-label="知识结构图" className="knowledge-map">
            <p className="knowledge-map-hint"><Layers3 aria-hidden="true" size={15} /> 点击节点，沿着骨架展开理解</p>
            <ul className={`knowledge-roots${document.roots.length === 1 ? " single-root" : ""}`}>
              {document.roots.map(node => <KnowledgeBranch key={node.id} node={node} selectedId={selected.id} onSelect={id => setSelection({ source: value, id })} />)}
            </ul>
            {document.unmapped ? <div className="knowledge-structure-notes"><KnowledgeText value={document.unmapped} /></div> : null}
          </section>
          <section aria-label="节点解释" className="knowledge-node-detail" aria-live="polite">
            <p className="knowledge-detail-eyebrow">正在理解</p>
            <h4>{selected.label}</h4>
            {selected.description ? <p className="knowledge-detail-description">{selected.description}</p> : null}
            {selected.details.map((detail, index) => <KnowledgeText key={index} value={detail} />)}
            {selected.children.length ? <ul className="knowledge-detail-children">{selected.children.map(child => {
              const preview = child.description || child.details[0]?.split(/(?<=[。！？])\s*/u)[0];
              return <li key={child.id}><button type="button" aria-label={`查看${child.label}的解释`} onClick={() => setSelection({ source: value, id: child.id })}>{child.label}</button>{preview ? <p>{preview}</p> : null}</li>;
            })}</ul> : null}
            {!selected.details.length && document.explanation ? <p className="knowledge-detail-guidance">更多解释和例子见下方的「沿骨架展开」。</p> : null}
          </section>
        </div>
      ) : (
        <div className="knowledge-reading-fallback">{/知识结构版本：/u.test(value) ? <p>结构格式已变更，以下保留完整小结内容。</p> : null}<KnowledgeText value={value} /></div>
      )}
      {(document.questions || document.structure || selected) && document.explanation ? (
        <details className="knowledge-explanation">
          <summary><span>沿骨架展开</span><span>阅读全部解释与例子 <ChevronDown aria-hidden="true" size={16} /></span></summary>
          <KnowledgeText value={document.explanation} />
        </details>
      ) : null}
      {(document.questions || document.structure || selected) && document.distinctions ? <section className="knowledge-distinctions" aria-label="关键辨析">
        <h4><Lightbulb aria-hidden="true" size={18} />关键辨析</h4>
        <KnowledgeText value={document.distinctions} />
      </section> : null}
      {(document.questions || document.structure || selected) ? <details className="knowledge-complete">
        <summary>查看完整小结</summary>
        <div className="knowledge-original" data-testid="complete-summary">{document.original}</div>
      </details> : null}
    </div>
  );
}
