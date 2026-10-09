'use client';

import { useId, useMemo } from 'react';
import type { QuestionView } from '@/lib/domain/knowledge-questions';
import type { KnowledgeStructure } from '@/lib/domain/knowledge-structure';
import { isStructural, isSymmetric, layoutKnowledgeStructure } from './structure-reader-model';

export function KnowledgeStructureMap({ structure, selectedName, selectedEdge, onNode, onEdge, diagramKind, referenceLabels = {} }: {
  diagramKind?: QuestionView['diagramKind']; referenceLabels?: Record<string, string>;
  structure: KnowledgeStructure; selectedName: string | null; selectedEdge: number | null;
  onNode: (name: string) => void; onEdge: (index: number) => void;
}) {
  const layout = useMemo(() => layoutKnowledgeStructure(structure, diagramKind), [structure, diagramKind]);
  const arrowId = useId();
  const edgeActive = (index: number) => selectedEdge !== null ? index === selectedEdge :
    Boolean(selectedName && [structure.relations[index].from, structure.relations[index].to].includes(selectedName));
  const related = new Set(structure.relations.flatMap((edge, index) => edgeActive(index) ? [edge.from, edge.to] : []));
  const hasSelection = selectedName !== null || selectedEdge !== null;

  return <div className="structure-map-scroll" tabIndex={0} role="group" aria-label="可滚动结构图">
    <div className="structure-map-canvas" style={{ width: layout.width, height: layout.height }}>
      {layout.columns.map((column, index) => <span className="structure-column-label" key={index} style={{ left: column.x, width: column.width }}>{column.title}</span>)}
      {/* SVG is the data diagram: paths encode stored relationships, not artwork. */}
      <svg className="structure-map-lines" width={layout.width} height={layout.height} aria-label="节点之间的关系">
        <defs><marker id={arrowId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 8 4 L 0 8 Z" fill="context-stroke" /></marker></defs>
        {layout.edges.map(position => {
          const edge = structure.relations[position.index];
          const symmetric = isSymmetric(edge), active = edgeActive(position.index);
          const label = position.wideLabel ? (edge.label.length > 14 ? `${edge.label.slice(0, 13)}…` : edge.label) : edge.kind;
          const labelWidth = position.wideLabel ? 180 : 40;
          return <g key={position.index} className="structure-map-edge" role="button" tabIndex={0}
            aria-label={`查看关系：${edge.from} ${symmetric ? '↔' : '→'} ${edge.to}（${edge.kind}）`}
            aria-pressed={selectedEdge === position.index} data-active={active} data-muted={hasSelection && !active}
            data-label-on-node={position.labelOnNode !== false}
            data-structural={isStructural(edge)} data-symmetric={symmetric}
            onClick={() => onEdge(position.index)} onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEdge(position.index); }
            }}>
            <title>{`${edge.from} ${symmetric ? '↔' : '→'} ${edge.to}：${edge.label}${edge.condition ? `；${edge.condition}` : ''}`}</title>
            <path className="structure-edge-hit" d={position.path} />
            <path className="structure-edge-stroke" d={position.path} markerEnd={!isStructural(edge) && !symmetric ? `url(#${arrowId})` : undefined} />
            <g className="structure-edge-label" transform={`translate(${position.labelX},${position.labelY})`}>
              <rect x={-labelWidth / 2} y="-11" width={labelWidth} height="21" rx="4" />
              <text textAnchor="middle" dominantBaseline="central">{label}</text>
            </g>
          </g>;
        })}
      </svg>
      <div role="group" aria-label="骨架节点">
        {layout.nodes.map(position => {
          const node = structure.nodes.find(item => item.name === position.name)!;
          return <button key={node.name} type="button" className="structure-map-node" aria-label={node.name}
            aria-pressed={selectedName === node.name} data-related={related.has(node.name)}
            data-muted={hasSelection && node.name !== selectedName && !related.has(node.name)}
            title={`${node.name}：${node.summary}`} style={{ left: position.x, top: position.y, width: position.width, height: position.height }}
            onClick={() => onNode(node.name)}>
            <span className={referenceLabels[node.name] ? 'structure-node-reference' : 'structure-node-role'}>{referenceLabels[node.name] || node.role}</span><strong>{node.name}</strong><span className="structure-node-summary">{node.summary}</span>
          </button>;
        })}
      </div>
    </div>
  </div>;
}
