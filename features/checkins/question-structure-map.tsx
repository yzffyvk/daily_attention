'use client';

import { Fragment, useState } from 'react';
import { ArrowDown, ArrowLeftRight, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import type { KnowledgeStructure } from '@/lib/domain/knowledge-structure';
import { questionDiagram } from './question-diagram-model';
import { isSymmetric } from './structure-reader-model';

type Props = {
  structure: KnowledgeStructure;
  selectedName: string | null;
  selectedEdge: number | null;
  onNode: (name: string) => void;
  onEdge: (index: number) => void;
  onClear?: () => void;
  step?: number;
  onStepChange?: (index: number) => void;
};

export function QuestionStructureMap({ structure, selectedName, selectedEdge, onNode, onEdge, onClear, step, onStepChange }: Props) {
  const [localStep, setLocalStep] = useState(0);
  const diagram = questionDiagram(structure);
  const index = Math.min(step ?? localStep, structure.relations.length - 1);
  const changeStep = (next: number) => { setLocalStep(next); onStepChange?.(next); onClear?.(); };
  const node = (name: string) => <button key={name} type="button" className="question-graph-node" aria-label={name} aria-pressed={selectedName === name} onClick={() => onNode(name)}>{name}</button>;
  const relation = (i: number) => {
    const edge = structure.relations[i];
    return <button type="button" className="question-graph-label" data-edge-index={i} aria-label={`查看关系：${edge.from} ${isSymmetric(edge) ? '↔' : '→'} ${edge.to}（${edge.label}）`} aria-pressed={selectedEdge === i} onClick={() => onEdge(i)}>
      <span>{edge.label}</span>{edge.condition ? <small>有适用条件</small> : null}
    </button>;
  };
  const hierarchy = (name: string) => <div className="question-hierarchy" key={name}>
    {node(name)}
    <div className="question-hierarchy-children">{structure.relations.flatMap((edge, i) => edge.from === name ? [<div className="question-hierarchy-branch" key={i}>{relation(i)}{hierarchy(edge.to)}</div>] : [])}</div>
  </div>;
  const focused = structure.relations[index];
  return <div className="question-graph" data-diagram={diagram.kind}>
    {diagram.kind === 'chain' ? <div className="question-simple-chain" role="group" aria-label="骨架节点">
      {diagram.names.map((name, i) => <Fragment key={name}>{node(name)}{i < diagram.edges.length ? <div className="question-chain-link">{relation(diagram.edges[i])}<ArrowDown size={18} aria-hidden="true" /></div> : null}</Fragment>)}
    </div> : diagram.kind === 'hierarchy' ? <div role="group" aria-label="骨架节点">{hierarchy(diagram.root)}</div>
      : diagram.kind === 'comparison' ? <div className="question-comparison" role="group" aria-label="骨架节点">{node(focused.from)}<div className="question-compare-link">{relation(0)}<ArrowLeftRight size={20} aria-hidden="true" /></div>{node(focused.to)}</div>
        : <>
          <div className="question-concepts" role="group" aria-label="骨架节点">{structure.nodes.map(n => node(n.name))}</div>
          {focused ? <section className="question-relation-step" aria-label="逐条理解关系">
            <div className="question-relation-nav">
              <span aria-live="polite">关系 {index + 1} / {structure.relations.length}</span>
              {structure.relations.length > 1 ? <div>
                <button type="button" aria-label="上一条关系" disabled={index === 0} onClick={() => changeStep(index - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
                <button type="button" aria-label="下一条关系" disabled={index === structure.relations.length - 1} onClick={() => changeStep(index + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
              </div> : null}
            </div>
            <div className="question-relation-endpoints"><span>{focused.from}</span>{isSymmetric(focused) ? <ArrowLeftRight size={20} aria-hidden="true" /> : <ArrowRight size={20} aria-hidden="true" />}<span>{focused.to}</span></div>
            {relation(index)}
          </section> : null}
        </>}
  </div>;
}
