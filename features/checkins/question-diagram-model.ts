import type { KnowledgeStructure } from '@/lib/domain/knowledge-structure';
import { isStructural, isSymmetric } from './structure-reader-model';

type Diagram = { kind: 'concepts' | 'comparison' | 'relations' } | { kind: 'chain'; names: string[]; edges: number[] } | { kind: 'hierarchy'; root: string };

// Choose a simple form only when the stored edges actually support it.
// Mixed relations and cycles remain available one at a time, never rewritten into a false flow.
export function questionDiagram(structure: KnowledgeStructure): Diagram {
  const { nodes, relations } = structure;
  if (!relations.length) return { kind: 'concepts' };
  if (nodes.length === 2 && relations.length === 1 && isSymmetric(relations[0])) return { kind: 'comparison' };
  const incoming = (name: string) => relations.filter(e => e.to === name);
  const outgoing = (name: string) => relations.flatMap((e, i) => e.from === name ? [i] : []);
  const roots = nodes.filter(n => !incoming(n.name).length);
  if (relations.length === nodes.length - 1 && roots.length === 1 && nodes.every(n => incoming(n.name).length <= 1)) {
    const names: string[] = [], edges: number[] = [];
    let name: string | undefined = roots[0].name;
    while (name && !names.includes(name)) {
      names.push(name);
      const next: number[] = outgoing(name);
      if (next.length !== 1) break;
      edges.push(next[0]); name = relations[next[0]].to;
    }
    if (names.length === nodes.length && nodes.length <= 5 && relations.every(e => !isSymmetric(e) && e.kind !== '反馈')) return { kind: 'chain', names, edges };
    if (relations.every(isStructural)) {
      const visited = new Set<string>();
      const visit = (current: string, depth: number): boolean => {
        if (visited.has(current) || depth > 2) return false;
        visited.add(current);
        return outgoing(current).every(i => visit(relations[i].to, depth + 1));
      };
      if (visit(roots[0].name, 0) && visited.size === nodes.length) return { kind: 'hierarchy', root: roots[0].name };
    }
  }
  return { kind: 'relations' };
}
