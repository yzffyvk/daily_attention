import { parseKnowledgeStructure, type KnowledgeStructure } from "./knowledge-structure.ts";

/** Conservative presentation only: original is always the unchanged stored document. */
export interface KnowledgeNode {
  id: string;
  label: string;
  description: string;
  children: KnowledgeNode[];
  details: string[];
}
export interface KnowledgeSummary {
  structure: KnowledgeStructure | null;
  thesis: string;
  roots: KnowledgeNode[];
  explanation: string;
  distinctions: string;
  prompts: string[];
  unmapped: string;
  original: string;
}
const sections = ["一句话主旨", "主要骨架", "沿骨架展开", "关键辨析", "试着讲一遍"] as const;
type Section = typeof sections[number];
const normalize = (value: string) => value.trim().replace(/^\*\*(.*?)\*\*$/u, "$1").replace(/\s+/gu, " ");
function heading(line: string): { name: Section; rest: string } | null {
  const cleaned = line.trim().replace(/^#{1,6}\s+/u, "").replace(/^(?:\d+|[一二三四五六七八九十]+)[.、．)）]\s*/u, "").replace(/\*\*/gu, "");
  for (const name of sections) {
    if (cleaned === name) return { name, rest: "" };
    if (cleaned.startsWith(name + "：") || cleaned.startsWith(name + ":")) return { name, rest: cleaned.slice(name.length + 1).trim() };
  }
  return null;
}
function nodeText(value: string) {
  const split = value.indexOf("：") >= 0 ? value.indexOf("：") : value.indexOf(":");
  return { label: normalize(split < 0 ? value : value.slice(0, split)), description: split < 0 ? "" : value.slice(split + 1).trim() };
}
function plausibleLabel(value: string, explicit: boolean) {
  return value.length > 0 && value.length <= 100 && !/[<>→↔。；!?！？]/u.test(value) && (explicit || !value.includes("="));
}

type Fence = { character: string; length: number } | null;
/** Fence contents and delimiters are protected, including a valid closing line. */
function scanFence(line: string, current: Fence): { fence: Fence; protected: boolean } {
  const marker = line.trim().match(/^(`{3,}|~{3,})(.*)$/u);
  if (current) {
    const closes = marker && marker[1][0] === current.character && marker[1].length >= current.length && !marker[2].trim();
    return { fence: closes ? null : current, protected: true };
  }
  if (marker) return { fence: { character: marker[1][0], length: marker[1].length }, protected: true };
  return { fence: null, protected: false };
}

export function parseKnowledgeSummary(text: string): KnowledgeSummary {
  const result: KnowledgeSummary = { structure: parseKnowledgeStructure(text), thesis: "", roots: [], explanation: "", distinctions: "", prompts: [], unmapped: "", original: text };
  const bodies: Partial<Record<Section, string[]>> = {};
  const unknown: string[] = [];
  let section: Section | null = null;
  let fence: Fence = null;
  for (const line of text.split(/\r?\n/u)) {
    const scanned = scanFence(line, fence);
    fence = scanned.fence;
    const found = !scanned.protected ? heading(line) : null;
    if (found) { section = found.name; (bodies[section] ??= []).push(found.rest); }
    else if (section) (bodies[section] ??= []).push(line);
    else unknown.push(line);
  }
  result.thesis = (bodies["一句话主旨"] ?? []).join("\n").trim();
  result.explanation = (bodies["沿骨架展开"] ?? []).join("\n").trim();
  result.distinctions = (bodies["关键辨析"] ?? []).join("\n").trim();
  const skeleton = result.structure ? [] : bodies["主要骨架"] ?? [];
  const stack: { depth: number; node: KnowledgeNode }[] = [];
  const nodes: KnowledgeNode[] = [];
  fence = null;
  // Cache next nonempty lines in one backwards pass rather than rescanning tails.
  const nextNonempty: (string | undefined)[] = new Array(skeleton.length);
  let following: string | undefined;
  for (let index = skeleton.length - 1; index >= 0; index--) {
    nextNonempty[index] = following;
    if (skeleton[index].trim()) following = skeleton[index];
  }
  let blockedDepth: number | null = null;
  skeleton.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const scanned = scanFence(line, fence);
    fence = scanned.fence;
    if (scanned.protected) { unknown.push(line); return; }
    const tree = line.match(/^([ │\t]*)(?:├|└)[─━-]+\s*(.+)$/u);
    const bullet = line.match(/^(\s*)(?:[-*+] |\d+[.)、]\s+)(.+)$/u);
    let depth: number;
    let value: string;
    if (tree) { depth = Math.floor(tree[1].replace(/\t/gu, "   ").length / 3) + 1; value = tree[2]; }
    else if (bullet) { depth = Math.floor(bullet[1].replace(/\t/gu, "  ").length / 2); value = bullet[2]; }
    else {
      // A plain root is accepted only when the next nonempty line explicitly branches.
      const next = nextNonempty[index];
      if (!next || !/^[ │\t]*(?:├|└)[─━-]/u.test(next)) { unknown.push(line); return; }
      depth = 0; value = trimmed;
    }
    const parsed = nodeText(value);
    if (!plausibleLabel(parsed.label, Boolean(tree || bullet)) || nodes.length >= 120 || (tree && depth > 8) || (blockedDepth !== null && depth > blockedDepth)) {
      unknown.push(line); blockedDepth = blockedDepth === null ? depth : Math.min(depth, blockedDepth); return;
    }
    blockedDepth = null;
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    if (depth > 0 && (!stack.length || (tree && stack[stack.length - 1].depth !== depth - 1))) { unknown.push(line); blockedDepth = depth; return; }
    if (stack.length >= 9) { unknown.push(line); blockedDepth = depth; return; }
    const node: KnowledgeNode = { id: `knowledge-node-${index}`, ...parsed, children: [], details: [] };
    (stack.length ? stack[stack.length - 1].node.children : result.roots).push(node);
    nodes.push(node); stack.push({ depth, node });
  });
  // Only explicit Markdown subheadings with a unique exact label attach detail text.
  const labels = new Map<string, KnowledgeNode[]>();
  for (const node of nodes) {
    const label = normalize(node.label);
    const matching = labels.get(label);
    if (matching) matching.push(node);
    else labels.set(label, [node]);
  }
  let detailLabel = "";
  let detailLines: string[] = [];
  const flush = () => {
    const matching = labels.get(detailLabel);
    const detail = detailLines.join("\n").trim();
    if (matching?.length === 1 && detail) matching[0].details.push(detail);
  };
  fence = null;
  for (const line of bodies["沿骨架展开"] ?? []) {
    const scanned = scanFence(line, fence);
    fence = scanned.fence;
    const match = !scanned.protected ? line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/u) : null;
    if (match) { flush(); detailLabel = normalize(match[1]); detailLines = []; }
    else detailLines.push(line);
  }
  flush();
  const promptText = (bodies["试着讲一遍"] ?? []).join("\n").trim();
  if (promptText) result.prompts = promptText.split(/\n(?=\s*(?:\d+[.、)）]|[-*+]\s))/u).map(p => p.replace(/^\s*(?:\d+[.、)）]\s*|[-*+]\s+)/u, "").trim()).filter(Boolean);
  result.unmapped = unknown.join("\n").trim();
  return result;
}
