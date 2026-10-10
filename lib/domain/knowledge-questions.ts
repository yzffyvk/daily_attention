import { z } from 'zod';
import { knowledgeContentTypes, knowledgeStructureSchema, type KnowledgeStructure } from './knowledge-structure.ts';
import { SUMMARY_MAX_LENGTH } from './summary-limits.ts';

const line = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\r\n]+$/u);
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/u);
const ids = (max: number) => z.array(id).max(max);
export const diagramKinds = ['composition', 'flow', 'causal', 'comparison', 'decision', 'argument', 'timeline', 'concepts', 'problem-solution', 'case'] as const;
const node = knowledgeStructureSchema.shape.nodes.element.extend({ id, homeQuestionId: id });
const relation = knowledgeStructureSchema.shape.relations.element.extend({ id, from: id, to: id });
const view = z.object({
  id, title: line(80), diagramKind: z.enum(diagramKinds), nodeIds: ids(32).min(1), relationIds: ids(48),
  referenceNodeIds: ids(32), readingOrder: ids(32),
  contextNotes: z.array(z.object({ nodeId: id, text: line(180) }).strict()).max(32),
}).strict();
const question = z.object({
  id, title: line(120), answer: line(400), scope: line(180), mainlineRole: line(120),
  evidence: line(180).min(4), views: z.array(view).min(1).max(3),
}).strict();
export const questionStructureSchema = z.object({
  schemaVersion: z.literal(2), coreQuestion: line(180), contentTypes: z.array(z.enum(knowledgeContentTypes)).min(1).max(10),
  questionOrder: ids(6).min(1), questions: z.array(question).min(1).max(6), nodes: z.array(node).min(1).max(32),
  relations: z.array(relation).max(48),
  questionLinks: z.array(z.object({ fromQuestionId: id, toQuestionId: id, label: line(120), relationIds: ids(48).min(1) }).strict()).max(20),
}).strict().superRefine((s, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  const unique = (values: string[], label: string) => { if (new Set(values).size !== values.length) fail(`Duplicate ${label}`); };
  const nodes = new Map(s.nodes.map(n => [n.id, n]));
  const edges = new Map(s.relations.map(e => [e.id, e]));
  const questions = new Map(s.questions.map(q => [q.id, q]));
  unique(s.nodes.map(n => n.id), 'node id'); unique(s.nodes.map(n => n.name), 'node name');
  unique(s.relations.map(e => e.id), 'relation id'); unique(s.questions.map(q => q.id), 'question id');
  unique(s.questions.flatMap(q => q.views.map(v => v.id)), 'view id'); unique(s.contentTypes, 'content type');
  unique(s.relations.map(e => JSON.stringify([e.from, e.to, e.kind, e.label])), 'relation');
  unique(s.questionOrder, 'question order');
  if (s.questionOrder.length !== questions.size || s.questionOrder.some(q => !questions.has(q))) fail('Invalid question order');
  const coveredNodes = new Set<string>(), coveredEdges = new Set<string>();
  for (const q of s.questions) for (const v of q.views) {
    const visible = new Set(v.nodeIds);
    for (const key of ['nodeIds', 'relationIds', 'referenceNodeIds', 'readingOrder'] as const) unique(v[key], `${v.id}.${key}`);
    unique(v.contextNotes.map(n => n.nodeId), `${v.id}.contextNotes`);
    for (const nid of v.nodeIds) {
      const n = nodes.get(nid);
      if (!n) { fail(`${v.id}: Unknown node ${nid}`); continue; }
      coveredNodes.add(nid);
      if ((n.homeQuestionId !== q.id) !== v.referenceNodeIds.includes(nid)) fail(`${v.id}: Foreign node must be explicitly referenced: ${nid}`);
    }
    for (const nid of [...v.referenceNodeIds, ...v.readingOrder, ...v.contextNotes.map(n => n.nodeId)]) if (!visible.has(nid)) fail(`${v.id}: Reference outside view ${nid}`);
    for (const eid of v.relationIds) {
      const e = edges.get(eid);
      if (!e || !visible.has(e.from) || !visible.has(e.to)) fail(`${v.id}: Relation endpoints must be visible: ${eid}`);
      coveredEdges.add(eid);
    }
  }
  for (const n of s.nodes) {
    const owner = questions.get(n.homeQuestionId);
    if (!owner || !owner.views.some(v => v.nodeIds.includes(n.id)) || !coveredNodes.has(n.id)) fail(`Missing home view for ${n.id}`);
  }
  const adjacency = new Map<string, string[]>();
  for (const e of s.relations) {
    if (!nodes.has(e.from) || !nodes.has(e.to) || e.from === e.to) fail(`Invalid relation endpoints: ${e.id}`);
    if (e.kind === '包含' || e.kind === '分类') adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), e.to]);
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const cycle = (nid: string): boolean => {
    if (visiting.has(nid)) return true;
    if (visited.has(nid)) return false;
    visiting.add(nid);
    if ((adjacency.get(nid) ?? []).some(cycle)) return true;
    visiting.delete(nid); visited.add(nid); return false;
  };
  if (s.nodes.some(n => cycle(n.id))) fail('Containment/classification cycle');
  unique(s.questionLinks.map(l => JSON.stringify([l.fromQuestionId, l.toQuestionId, l.label])), 'question link');
  for (const l of s.questionLinks) {
    if (!questions.has(l.fromQuestionId) || !questions.has(l.toQuestionId) || l.fromQuestionId === l.toQuestionId) fail('Invalid question link');
    unique(l.relationIds, 'question link relations');
    for (const eid of l.relationIds) {
      const e = edges.get(eid);
      const homes = e ? [nodes.get(e.from)?.homeQuestionId, nodes.get(e.to)?.homeQuestionId] : [];
      if (!homes.includes(l.fromQuestionId) || !homes.includes(l.toQuestionId)) fail(`Question link lacks connecting evidence: ${eid}`);
      coveredEdges.add(eid);
    }
  }
  for (const e of s.relations) if (!coveredEdges.has(e.id)) fail(`Uncovered relation ${e.id}`);
});
export const questionSummarySchema = z.object({
  attention: line(120), thesis: line(300), structure: questionStructureSchema,
  distinctions: z.string().trim().max(1200), prompts: z.array(line(220)).min(1).max(2),
  inspiration: z.literal(''), sourceTitle: line(300), warnings: z.array(line(500)).max(10),
}).strict();
export type QuestionStructure = z.infer<typeof questionStructureSchema>;
export type QuestionSummary = z.infer<typeof questionSummarySchema>;
export type QuestionView = QuestionStructure['questions'][number]['views'][number];

const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('|', '&#124;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '&#10;').replaceAll('\r', '&#13;');
const unescape = (s: string) => s.trim().replaceAll('&#13;', '\r').replaceAll('&#10;', '\n').replaceAll('&#124;', '|').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
const headers = {
  questions: ['标识', '问题', '答案', '范围', '主线作用', '依据'],
  views: ['标识', '所属问题', '视图', '图形', '节点', '关系', '外部引用', '阅读顺序'],
  contexts: ['视图', '节点', '本题作用'],
  nodes: ['标识', '所属问题', '节点', '角色', '定位', '解释', '依据'],
  relations: ['标识', '起点', '关系类型', '关系', '终点', '条件', '依据'],
  links: ['起始问题', '目标问题', '联系', '关系依据'],
};
function table(title: string, cols: string[], rows: string[][]) {
  return [`## ${title}`, `|${cols.join('|')}|`, `|${cols.map(() => '---').join('|')}|`, ...rows.map(r => `|${r.map(escape).join('|')}|`)].join('\n');
}
export function serializeQuestionSummary(value: QuestionSummary): string {
  const s = value.structure;
  return [
    '知识结构版本：2', `主题：${escape(value.attention)}`, `一句话主旨：${escape(value.thesis)}`,
    `资料标题：${escape(value.sourceTitle)}`, `核心问题：${escape(s.coreQuestion)}`,
    `内容类型：${s.contentTypes.join('、')}`, `问题顺序：${s.questionOrder.join(',')}`,
    table('问题与答案', headers.questions, s.questions.map(q => [q.id, q.title, q.answer, q.scope, q.mainlineRole, q.evidence])),
    table('局部视图', headers.views, s.questions.flatMap(q => q.views.map(v => [v.id, q.id, v.title, v.diagramKind, v.nodeIds.join(','), v.relationIds.join(','), v.referenceNodeIds.join(','), v.readingOrder.join(',')]))),
    table('本题作用', headers.contexts, s.questions.flatMap(q => q.views.flatMap(v => v.contextNotes.map(c => [v.id, c.nodeId, c.text])))),
    table('概念解释', headers.nodes, s.nodes.map(n => [n.id, n.homeQuestionId, n.name, n.role, n.summary, n.explanation, n.evidence])),
    table('概念关系', headers.relations, s.relations.map(e => [e.id, e.from, e.kind, e.label, e.to, e.condition, e.evidence])),
    table('跨问题联系', headers.links, s.questionLinks.map(l => [l.fromQuestionId, l.toQuestionId, l.label, l.relationIds.join(',')])),
    `关键辨析：${escape(value.distinctions)}`,
    table('试着讲一遍', ['问题'], value.prompts.map(p => [p])),
    table('资料提醒', ['提醒'], value.warnings.map(w => [w])),
    '文档结束：2',
  ].join('\n\n');
}

/** Strictly account for every line: never hide qualifications a person added. */
export function parseQuestionSummary(text: string): QuestionSummary | null {
  if (text.length > SUMMARY_MAX_LENGTH || !text.trimStart().startsWith('知识结构版本：2')) return null;
  const lines = text.split(/\r?\n/u).map(l => l.trim()).filter(Boolean);
  let cursor = 0;
  const take = (prefix: string) => {
    const line = lines[cursor++];
    if (line === undefined || !line.startsWith(prefix)) throw new Error('Invalid field');
    return unescape(line.slice(prefix.length));
  };
  const readTable = (title: string, cols: string[]) => {
    if (lines[cursor++] !== `## ${title}`) throw new Error('Invalid section');
    const split = (s: string) => {
      if (!s.startsWith('|') || !s.endsWith('|')) throw new Error('Invalid row');
      return s.slice(1, -1).split('|').map(unescape);
    };
    if (JSON.stringify(split(lines[cursor++] ?? '')) !== JSON.stringify(cols)) throw new Error('Invalid header');
    const separator = split(lines[cursor++] ?? '');
    if (separator.length !== cols.length || separator.some(c => !/^:?-{3,}:?$/u.test(c))) throw new Error('Invalid separator');
    const rows: string[][] = [];
    while (lines[cursor]?.startsWith('|')) {
      const row = split(lines[cursor++]);
      if (row.length !== cols.length) throw new Error('Invalid columns');
      rows.push(row);
    }
    return rows;
  };
  const list = (s: string) => s ? s.split(',').map(x => x.trim()) : [];
  try {
    if (lines[cursor++] !== '知识结构版本：2') return null;
    const attention = take('主题：'), thesis = take('一句话主旨：'), sourceTitle = take('资料标题：');
    const coreQuestion = take('核心问题：'), contentTypes = take('内容类型：').split('、'), questionOrder = list(take('问题顺序：'));
    const qs = readTable('问题与答案', headers.questions), vs = readTable('局部视图', headers.views), cs = readTable('本题作用', headers.contexts);
    const ns = readTable('概念解释', headers.nodes), es = readTable('概念关系', headers.relations), ls = readTable('跨问题联系', headers.links);
    const distinctions = take('关键辨析：'), prompts = readTable('试着讲一遍', ['问题']).map(r => r[0]), warnings = readTable('资料提醒', ['提醒']).map(r => r[0]);
    if (lines[cursor++] !== '文档结束：2' || cursor !== lines.length) return null;
    if (vs.some(v => !qs.some(q => q[0] === v[1])) || cs.some(c => !vs.some(v => v[0] === c[0]))) return null;
    const result = questionSummarySchema.safeParse({ attention, thesis, sourceTitle, inspiration: '', distinctions, prompts, warnings,
      structure: { schemaVersion: 2, coreQuestion, contentTypes, questionOrder,
        questions: qs.map(([id, title, answer, scope, mainlineRole, evidence]) => ({ id, title, answer, scope, mainlineRole, evidence,
          views: vs.filter(v => v[1] === id).map(([id, , title, diagramKind, nodes, edges, refs, order]) => ({ id, title, diagramKind,
            nodeIds: list(nodes), relationIds: list(edges), referenceNodeIds: list(refs), readingOrder: list(order), contextNotes: cs.filter(c => c[0] === id).map(([, nodeId, text]) => ({ nodeId, text })) })) })),
        nodes: ns.map(([id, homeQuestionId, name, role, summary, explanation, evidence]) => ({ id, homeQuestionId, name, role, summary, explanation, evidence })),
        relations: es.map(([id, from, kind, label, to, condition, evidence]) => ({ id, from, kind, label, to, condition, evidence })),
        questionLinks: ls.map(([fromQuestionId, toQuestionId, label, relationIds]) => ({ fromQuestionId, toQuestionId, label, relationIds: list(relationIds) })),
      } });
    return result.success ? result.data : null;
  } catch { return null; }
}

export function projectQuestionView(s: QuestionStructure, questionId: string, viewId: string): KnowledgeStructure {
  const q = s.questions.find(q => q.id === questionId);
  const v = q?.views.find(v => v.id === viewId);
  if (!q || !v) throw new Error('Unknown question view');
  const nodes = v.nodeIds.map(id => s.nodes.find(n => n.id === id)!);
  const name = (id: string) => s.nodes.find(n => n.id === id)!.name;
  return { coreQuestion: q.title, contentTypes: s.contentTypes,
    nodes: nodes.map(n => ({ name: n.name, role: n.role, summary: n.summary, explanation: n.explanation, evidence: n.evidence })),
    relations: v.relationIds.map(id => s.relations.find(e => e.id === id)!).map(e => ({ from: name(e.from), to: name(e.to), kind: e.kind, label: e.label, condition: e.condition, evidence: e.evidence })),
    readingOrder: v.readingOrder.map(name),
  };
}
