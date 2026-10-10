import { questionSummarySchema, type QuestionSummary } from "../../../../lib/domain/knowledge-questions.ts";
export function indexQuestionSource(source: string) {
  const fragments: { id: string; text: string }[] = [];
  let offset = 0;
  while (offset < source.length) {
    const window = source.slice(offset, offset + 80);
    const boundary = [...window.matchAll(/[。！？；.!?;\n]/gu)].at(-1);
    let length = boundary && boundary.index >= 25 ? boundary.index + 1 : window.length;
    if (/[\uD800-\uDBFF]/u.test(window[length - 1] ?? '')) length--;
    if (length === 0) length = window.length;
    fragments.push({ id: `S${String(fragments.length + 1).padStart(4, '0')}`, text: source.slice(offset, offset + length) });
    offset += length;
  }
  const excerpts = new Map(fragments.map(part => [part.id, part.text.replace(/\s+/gu, ' ').trim()]));
  return {
    text: fragments.map(part => `[${part.id}] ${part.text}`).join('\n'),
    fragments,
    resolve: (id: string): string | null => excerpts.get(id) ?? null,
  };
}

export function normalizeQuestionViews<T>(value: T): T {
  let candidate = value;
  const raw = value as { structure?: { relations?: unknown } } | null;
  if (raw && Array.isArray(raw.structure?.relations)) {
    candidate = structuredClone(value);
    const relations = (candidate as { structure: { relations: unknown[] } }).structure.relations;
    for (const edge of relations) {
      // Constraints are a condition on the target; preserve the exact directional
      // claim, label, qualification and evidence. Other unknown kinds still fail.
      if (edge && typeof edge === 'object' && 'kind' in edge && edge.kind === '约束') edge.kind = '条件';
    }
    const questions = (candidate as { structure: { questions?: unknown } }).structure.questions;
    if (Array.isArray(questions)) for (const question of questions) {
      if (!question || !Array.isArray(question.views)) continue;
      for (const view of question.views) {
        // A tradeoff is displayed as a comparison; the actual edge kind and
        // its qualifications remain unchanged. Do not guess other view types.
        if (view && typeof view === 'object' && view.diagramKind === 'tradeoff') view.diagramKind = 'comparison';
      }
    }
  }
  const parsed = questionSummarySchema.safeParse(candidate);
  const isViewReferenceIssue = (message: string) => message.startsWith('Uncovered relation ')
    || message.startsWith('Question link lacks connecting evidence: ')
    || /^[a-z][a-z0-9_-]*: Foreign node must be explicitly referenced: /u.test(message)
    || /^[a-z][a-z0-9_-]*: Relation endpoints must be visible: /u.test(message);
  if (parsed.success || parsed.error.issues.some(issue => issue.code !== 'custom' || !isViewReferenceIssue(issue.message))) return candidate;
  // All fields, nodes and shared edge endpoints passed validation. Only fix a
  // reference to an existing edge inside a view that already contains both ends.
  const result = structuredClone(candidate) as QuestionSummary;
  const views = result.structure.questions.flatMap(q => q.views);
  const edges = new Map(result.structure.relations.map(edge => [edge.id, edge]));
  const nodes = new Map(result.structure.nodes.map(node => [node.id, node]));
  for (const question of result.structure.questions) for (const view of question.views) {
    // Ownership is already explicit; reference badges are derived metadata.
    view.referenceNodeIds = view.nodeIds.filter(id => nodes.get(id)?.homeQuestionId !== question.id);
  }
  result.structure.questionLinks = result.structure.questionLinks.flatMap(link => {
    const relationIds = link.relationIds.filter(id => {
      const edge = edges.get(id);
      const from = edge && nodes.get(edge.from)?.homeQuestionId;
      const to = edge && nodes.get(edge.to)?.homeQuestionId;
      return (from === link.fromQuestionId && to === link.toQuestionId)
        || (to === link.fromQuestionId && from === link.toQuestionId);
    });
    return relationIds.length ? [{ ...link, relationIds }] : [];
  });
  for (const view of views) view.relationIds = view.relationIds.filter(id => {
    const edge = edges.get(id);
    return edge && view.nodeIds.includes(edge.from) && view.nodeIds.includes(edge.to);
  });
  const covered = new Set([...views.flatMap(v => v.relationIds), ...result.structure.questionLinks.flatMap(l => l.relationIds)]);
  for (const edge of result.structure.relations) {
    if (covered.has(edge.id)) continue;
    const view = views.find(v => v.nodeIds.includes(edge.from) && v.nodeIds.includes(edge.to));
    if (view) view.relationIds.push(edge.id);
    else {
      const from = nodes.get(edge.from)?.homeQuestionId;
      const to = nodes.get(edge.to)?.homeQuestionId;
      // The edge already states the relationship; expose it between its known
      // owning questions instead of adding foreign nodes to a local diagram.
      if (from && to && from !== to) {
        const link = result.structure.questionLinks.find(link => link.fromQuestionId === from && link.toQuestionId === to && link.label === edge.label);
        if (link) link.relationIds.push(edge.id);
        else result.structure.questionLinks.push({ fromQuestionId: from, toQuestionId: to, label: edge.label, relationIds: [edge.id] });
      }
    }
  }
  return result as T;
}
