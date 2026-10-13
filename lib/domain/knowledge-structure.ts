import { z } from 'zod';

export const knowledgeContentTypes = ['概念与边界', '组成与分类', '运行机制与流程', '原理与因果', '问题与解决方案', '对比与选型', '方法与决策规则', '观点与论证', '演化与历史', '案例与经验'] as const;
export const knowledgeRelationKinds = ['包含', '分类', '作用', '依赖', '因果', '流程', '对照', '权衡', '支持', '例证', '演化', '条件', '反馈', '区别'] as const;
const line = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\r\n]+$/u);
const name = line(60).refine(value => !value.includes('→'), 'Node names cannot contain reading-order separators');
const evidence = line(180).min(4);
export const knowledgeStructureSchema = z.object({
  coreQuestion: line(180),
  contentTypes: z.array(z.enum(knowledgeContentTypes)).min(1).max(10),
  nodes: z.array(z.object({
    name, role: z.enum(['概念', '对象', '组成', '机制', '问题', '约束', '结果', '证据', '步骤', '方案', '观点', '阶段', '条件']),
    summary: line(120), explanation: z.string().trim().min(1).max(700), evidence,
  }).strict()).min(1).max(16),
  relations: z.array(z.object({
    from: name, to: name, kind: z.enum(knowledgeRelationKinds), label: line(48),
    condition: z.string().trim().max(180).regex(/^[^\r\n]*$/u), evidence,
  }).strict()).max(24),
  readingOrder: z.array(name).max(16),
}).strict().superRefine((value, context) => {
  const names = new Set(value.nodes.map(node => node.name));
  const invalid = (message: string) => context.addIssue({ code: 'custom', message });
  if (names.size !== value.nodes.length) invalid('Duplicate node name');
  if (new Set(value.contentTypes).size !== value.contentTypes.length) invalid('Duplicate content type');
  if (new Set(value.readingOrder).size !== value.readingOrder.length || value.readingOrder.some(item => !names.has(item))) invalid('Invalid reading order');
  const keys = new Set<string>();
  for (const relation of value.relations) {
    if (!names.has(relation.from) || !names.has(relation.to) || relation.from === relation.to) invalid('Invalid relation endpoint');
    const key = JSON.stringify([relation.from, relation.kind, relation.to, relation.label]);
    if (keys.has(key)) invalid('Duplicate relation');
    keys.add(key);
  }
  const children = new Map<string, string[]>();
  for (const edge of value.relations.filter(edge => edge.kind === '包含' || edge.kind === '分类')) {
    children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function hasCycle(current: string): boolean {
    if (visiting.has(current)) return true;
    if (visited.has(current)) return false;
    visiting.add(current);
    if ((children.get(current) ?? []).some(hasCycle)) return true;
    visiting.delete(current); visited.add(current);
    return false;
  }
  if ([...names].some(hasCycle)) invalid('Containment/classification cycle');
});
export type KnowledgeStructure = z.infer<typeof knowledgeStructureSchema>;
export type KnowledgeRelation = KnowledgeStructure['relations'][number];
export type KnowledgeConcept = KnowledgeStructure['nodes'][number];
export const structuredSummarySchema = z.object({
  attention: line(120), thesis: line(300), structure: knowledgeStructureSchema,
  distinctions: z.string().trim().max(1200), prompts: z.array(line(220)).min(1).max(2),
  inspiration: z.literal(''), sourceTitle: line(300), warnings: z.array(line(500)).max(10),
}).strict();
export type StructuredSummary = z.infer<typeof structuredSummarySchema>;

// A single readable, editable document travels through existing saves and drafts.
// Escaping is reversible; never render these strings as HTML.
function cell(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('|', '&#124;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '&#10;');
}
function uncell(value: string) {
  return value.trim().replaceAll('&#10;', '\n').replaceAll('&#124;', '|').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}
function table(headers: string[], rows: string[][], compact: boolean) {
  const heading = [headers, headers.map(() => '---')].map(row => `| ${row.map(cell).join(' | ')} |`);
  return [...heading, ...rows.map(row => compact ? `|${row.map(cell).join('|')}|` : `| ${row.map(cell).join(' | ')} |`)].join('\n');
}
export function serializeStructuredSummary(input: StructuredSummary): string {
  const { structure } = input;
  const compile = (compact: boolean) => [
    `一句话主旨：${input.thesis}`, '主要骨架：',
    `核心问题：${cell(structure.coreQuestion)}`, `内容类型：${structure.contentTypes.join('、')}`,
    `阅读顺序：${structure.readingOrder.map(cell).join(' → ')}`,
    table(['节点', '角色', '定位', '依据'], structure.nodes.map(node => [node.name, node.role, node.summary, node.evidence]), compact),
    table(['起点', '关系类型', '关系', '终点', '条件', '依据'], structure.relations.map(edge => [edge.from, edge.kind, edge.label, edge.to, edge.condition, edge.evidence]), compact),
    '沿骨架展开：', ...structure.nodes.map(node => `### ${cell(node.name)}\n${node.explanation}`),
    ...(input.distinctions ? ['关键辨析：', input.distinctions] : []),
    '试着讲一遍：', ...input.prompts.map((prompt, index) => `${index + 1}. ${prompt}`),
  ].join('\n\n');
  const readable = compile(false);
  // Compact table spacing in long documents without rejecting or trimming content.
  return readable.length <= 4800 ? readable : compile(true);
}
function tableRows(lines: string[], headers: string[]): string[][] | null {
  const header = `| ${headers.join(' | ')} |`;
  const starts = lines.flatMap((value, index) => value.trim() === header ? [index] : []);
  if (starts.length !== 1) return null;
  const start = starts[0];
  if (!/^\|(?:\s*:?-+:?\s*\|)+$/u.test(lines[start + 1]?.trim() ?? '')) return null;
  const rows: string[][] = [];
  for (let index = start + 2; index < lines.length && lines[index].trim(); index++) {
    const row = lines[index].trim();
    if (!row.startsWith('|') || !row.endsWith('|')) return null;
    const columns = row.slice(1, -1).split('|').map(uncell);
    if (columns.length !== headers.length) return null;
    rows.push(columns);
  }
  return rows;
}
export function parseKnowledgeStructure(text: string): KnowledgeStructure | null {
  const skeleton = text.match(/^主要骨架：[ \t]*\r?\n([\s\S]*?)^沿骨架展开：[ \t]*\r?\n/mu)?.[1];
  if (!skeleton) return null;
  const lines = skeleton.split(/\r?\n/u);
  // User-added prose may qualify the relationships. Keep it visible via the full-text reader.
  if (lines.some(line => line.trim() && !/^(?:核心问题：|内容类型：|阅读顺序：|\s*\|)/u.test(line))) return null;
  const field = (prefix: string) => {
    const matching = lines.filter(line => line.startsWith(prefix));
    return matching.length === 1 ? uncell(matching[0].slice(prefix.length)) : undefined;
  };
  const nodes = tableRows(lines, ['节点', '角色', '定位', '依据']);
  const relations = tableRows(lines, ['起点', '关系类型', '关系', '终点', '条件', '依据']);
  if (!nodes || !relations) return null;
  // A blank line inside a table must not silently turn the remaining edges into omitted text.
  const tableLineCount = lines.filter(line => line.trim().startsWith('|')).length;
  if (tableLineCount !== nodes.length + relations.length + 4) return null;
  const explanations = new Map<string, string>();
  const explanation = text.match(/^沿骨架展开：[ \t]*\r?\n([\s\S]*?)(?=^(?:关键辨析|试着讲一遍)：)/mu)?.[1];
  if (!explanation) return null;
  for (const match of explanation.matchAll(/^### ([^\r\n]+)\r?\n([\s\S]*?)(?=^### |$(?![\s\S]))/gmu)) {
    const label = uncell(match[1]);
    if (explanations.has(label)) return null;
    explanations.set(label, match[2].trim());
  }
  if (explanations.size !== nodes.length) return null;
  const parsed = knowledgeStructureSchema.safeParse({
    coreQuestion: field('核心问题：'), contentTypes: field('内容类型：')?.split('、'),
    readingOrder: field('阅读顺序：')?.split(' → ').filter(Boolean),
    nodes: nodes.map(([name, role, summary, evidence]) => ({ name, role, summary, evidence, explanation: explanations.get(name) })),
    relations: relations.map(([from, kind, label, to, condition, evidence]) => ({ from, kind, label, to, condition, evidence })),
  });
  return parsed.success ? parsed.data : null;
}
export function hasSourceEvidence(structure: KnowledgeStructure, source: string): boolean {
  const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/gu, '');
  const normalizedSource = normalize(source);
  return [...structure.nodes, ...structure.relations].every(item => normalizedSource.includes(normalize(item.evidence)));
}
