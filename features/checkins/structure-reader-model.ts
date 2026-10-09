import type { QuestionView } from '@/lib/domain/knowledge-questions';
import type { KnowledgeConcept, KnowledgeRelation, KnowledgeStructure } from '@/lib/domain/knowledge-structure';

export const isStructural = (edge: KnowledgeRelation) => edge.kind === '包含' || edge.kind === '分类';
export const isSymmetric = (edge: KnowledgeRelation) => ['对照', '权衡', '区别'].includes(edge.kind);

export type ReadingChapter = { id: string; title: string; names: string[] };
const chapterTitles = {
  composition: '对象与组成', mechanism: '原理与机制', method: '方法与过程',
  argument: '观点与依据', boundary: '问题与边界',
};

// Chapters are navigation aids, never additional facts or graph nodes. Keep the
// author's suggested order inside each chapter and append omitted nodes safely.
export function buildReadingChapters(structure: KnowledgeStructure): ReadingChapter[] {
  const order = [...new Set([...structure.readingOrder, ...structure.nodes.map(node => node.name)])];
  const prerequisites = new Set(structure.relations.filter(edge => edge.kind === '依赖').map(edge => edge.to));
  function chapterFor(node: KnowledgeConcept): keyof typeof chapterTitles {
    if (['概念', '对象', '组成'].includes(node.role)) return 'composition';
    if (['观点', '证据'].includes(node.role)) return 'argument';
    if (['问题', '约束', '结果', '条件'].includes(node.role)) return 'boundary';
    if (node.role === '机制') {
      const applies = structure.relations.some(edge =>
        (edge.from === node.name && ['作用', '流程', '演化', '反馈'].includes(edge.kind)) ||
        (edge.to === node.name && edge.kind === '演化'));
      return prerequisites.has(node.name) || !applies ? 'mechanism' : 'method';
    }
    return 'method';
  }
  const chapters = new Map<string, ReadingChapter>();
  for (const name of order) {
    const node = structure.nodes.find(item => item.name === name);
    if (!node) continue;
    const id = chapterFor(node);
    if (!chapters.has(id)) chapters.set(id, { id, title: chapterTitles[id], names: [] });
    chapters.get(id)!.names.push(name);
  }
  return [...chapters.values()];
}

export type PositionedConcept = { name: string; x: number; y: number; width: number; height: number };
export type StructureLayout = {
  width: number; height: number;
  columns: { title: string; x: number; width: number }[];
  nodes: PositionedConcept[];
  edges: { index: number; path: string; labelX: number; labelY: number; wideLabel?: boolean; labelOnNode?: boolean }[];
};

// Only containment/classification establish hierarchy. Feedback, dependency,
// and causal edges never participate in ranking, so cycles cannot hang layout.
export function layoutKnowledgeStructure(structure: KnowledgeStructure, diagramKind?: QuestionView['diagramKind']): StructureLayout {
  const structural = structure.relations.filter(isStructural);
  const participating = new Set(structural.flatMap(edge => [edge.from, edge.to]));
  const chapters = buildReadingChapters(structure);
  const ordered = chapters.flatMap(chapter => chapter.names);
  const columns: { title: string; names: string[] }[] = [];
  if (diagramKind && diagramKind !== 'composition') {
    // Rank only evidence-backed forward relationships, never the editorial route.
    // Kahn traversal leaves feedback/cyclic groups together instead of inventing order.
    const forward = structure.relations.filter(e => !isSymmetric(e) && e.kind !== '反馈');
    const incoming = new Map(structure.nodes.map(n => [n.name, 0]));
    for (const e of forward) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
    const rank = new Map(structure.nodes.map(n => [n.name, 0]));
    const queue = structure.nodes.filter(n => incoming.get(n.name) === 0).map(n => n.name);
    for (let i = 0; i < queue.length; i++) for (const e of forward.filter(e => e.from === queue[i])) {
      rank.set(e.to, Math.max(rank.get(e.to) ?? 0, (rank.get(e.from) ?? 0) + 1));
      incoming.set(e.to, incoming.get(e.to)! - 1);
      if (incoming.get(e.to) === 0) queue.push(e.to);
    }
    const order = [...new Set([...structure.readingOrder, ...structure.nodes.map(n => n.name)])];
    const titles = diagramKind === 'argument' ? ['依据与前提', '论证与主张'] : diagramKind === 'problem-solution' ? ['问题与方案', '作用对象与结果'] : ['关系起点', '关系展开'];
    for (const depth of [...new Set(rank.values())].sort((a, b) => a - b)) {
      columns.push({ title: titles[Math.min(depth, 1)], names: order.filter(n => rank.get(n) === depth) });
    }
  } else if (structural.length) {
    const independent = ordered.filter(name => !participating.has(name));
    if (independent.length) columns.push({ title: '相关主题与机制', names: independent });
    const depths = new Map(ordered.map(name => [name, 0]));
    // Bounded longest-path relaxation also tolerates malformed external input.
    for (let pass = 0; pass < structure.nodes.length; pass++) {
      let changed = false;
      for (const edge of structural) {
        const depth = Math.min(structure.nodes.length - 1, (depths.get(edge.from) ?? 0) + 1);
        if (depth > (depths.get(edge.to) ?? 0)) { depths.set(edge.to, depth); changed = true; }
      }
      if (!changed) break;
    }
    for (let depth = 0; depth <= Math.max(...depths.values()); depth++) {
      const names = ordered.filter(name => participating.has(name) && depths.get(name) === depth);
      if (names.length) columns.push({ title: depth === 0 ? '整体与上位概念' : '组成与分类', names });
    }
  } else {
    for (const chapter of chapters) columns.push({ title: chapter.title, names: chapter.names });
  }
  const nodeWidth = 184, nodeHeight = 70, pitch = 82, columnPitch = 252;
  const height = Math.max(310, Math.max(...columns.map(column => column.names.length)) * pitch + 72);
  const nodes = columns.flatMap((column, columnIndex) => column.names.map((name, row) => ({
    name, x: 46 + columnIndex * columnPitch,
    // Roots stay near the top; mechanisms connect through the remaining space.
    y: 54 + row * pitch, width: nodeWidth, height: nodeHeight,
  })));
  const positions = new Map(nodes.map(node => [node.name, node]));
  const edges = structure.relations.flatMap((edge, index) => {
    const from = positions.get(edge.from), to = positions.get(edge.to);
    if (!from || !to) return [];
    let startY = from.y + nodeHeight / 2;
    const endY = to.y + nodeHeight / 2;
    if (from.x === to.x) {
      const lane = from.x - 16 - (index % 4) * 6;
      return [{ index, path: `M ${from.x} ${startY} H ${lane} V ${endY} H ${to.x}`, labelX: lane, labelY: (startY + endY) / 2 }];
    }
    const forward = from.x < to.x;
    const startX = from.x + (forward ? nodeWidth : 0), endX = to.x + (forward ? 0 : nodeWidth);
    const laneOffset = isStructural(edge) ? 36 : 30 + (index % 3) * 7;
    const lane = forward ? endX - laneOffset : endX + laneOffset;
    const wideLabel = Math.abs(lane - startX) > 180;
    const siblings = wideLabel ? structure.relations.map((item, siblingIndex) => ({ item, siblingIndex }))
      .filter(({ item }) => item.from === edge.from && Math.abs((positions.get(item.to)?.x ?? from.x) - from.x) > columnPitch) : [];
    if (wideLabel && siblings.length > 1 && siblings.length <= 3) {
      const port = siblings.findIndex(item => item.siblingIndex === index);
      startY = from.y + 10 + port * (nodeHeight - 20) / (siblings.length - 1);
    }
    return [{ index, path: `M ${startX} ${startY} H ${lane} V ${endY} H ${endX}`,
      labelX: wideLabel ? (startX + lane) / 2 : lane, labelY: wideLabel ? startY - 13 : endY - 12,
      wideLabel, labelOnNode: siblings.length <= 3 }];
  });
  return {
    width: Math.max(300, columns.length * columnPitch + 20), height, nodes, edges,
    columns: columns.map((column, index) => ({ title: column.title, x: 46 + index * columnPitch, width: nodeWidth })),
  };
}
