import type { QuestionStructure } from '@/lib/domain/knowledge-questions';

/** One ownership and reading order for the outline, prose and complete document. */
export function questionReadingParts(structure: QuestionStructure) {
  const nodes = new Map(structure.nodes.map(node => [node.id, node]));
  return structure.questionOrder.map(id => {
    const question = structure.questions.find(item => item.id === id)!;
    const orderedIds = new Set([
      ...structure.nodes.filter(node => node.homeQuestionId === id).map(node => node.id),
      ...question.views.flatMap(view => view.readingOrder),
      ...question.views.flatMap(view => view.nodeIds),
    ]);
    return {
      question,
      label: question.mainlineRole,
      nodes: [...orderedIds].flatMap(nodeId => {
        const node = nodes.get(nodeId);
        return node?.homeQuestionId === id ? [node] : [];
      }),
    };
  });
}

type ReadingParts = ReturnType<typeof questionReadingParts>;
const inlineEmphasis = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/gu;

// Support limited emphasis as text. Source-derived HTML is never executed.
export function SummaryText({ value }: { value: string }) {
  return <>{value.split(inlineEmphasis).map((part, index) =>
    part.startsWith('`') && part.endsWith('`') ? <code key={index}>{part.slice(1, -1)}</code>
      : part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong>
        : part,
  )}</>;
}

// Promote only an already-emphasized expression, never infer emphasis from prose.
function isFormula(value: string) {
  if (value.length > 160 || /https?:\/\/|[<>。！？\n，,；;：:]/u.test(value)) return false;
  const terms = value.split(/\s*[=＝≈→⇒+＋]\s*/u);
  return terms.length > 1 && terms.every(term => /[\p{L}\p{N}]/u.test(term));
}

function SummaryParagraph({ value, emphasizeFormulas }: { value: string; emphasizeFormulas: boolean }) {
  const parts = value.split(inlineEmphasis);
  const index = emphasizeFormulas && !/^\s*(?:`{3,}|~{3,})/mu.test(value)
    ? parts.findIndex(part => part.startsWith('**') && part.endsWith('**') && isFormula(part.slice(2, -2))) : -1;
  if (index < 0) return <p><SummaryText value={value} /></p>;
  const prefix = parts.slice(0, index).join('').trimEnd();
  // Sentence punctuation after the inline formula becomes display-block spacing.
  const suffix = parts.slice(index + 1).join('').replace(/^(?:[\s，,：:；;。]|\.(?!\d))+/u, '');
  return <>
    {prefix ? <p><SummaryText value={prefix} /></p> : null}
    <div className="summary-formula-callout">
      <p className="summary-formula-expression"><strong>{parts[index].slice(2, -2)}</strong></p>
      {suffix ? <p className="summary-formula-explanation"><SummaryText value={suffix} /></p> : null}
    </div>
  </>;
}

/** Only explicit text/list markers are interpreted; source HTML stays inert. */
export function SummaryProse({ value, className = '', emphasizeFormulas = true }: { value: string; className?: string; emphasizeFormulas?: boolean }) {
  type Block = { kind: 'paragraph'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[]; start?: number };
  const blocks: Block[] = [];
  const state: { current: Block | null } = { current: null };
  let fence: { marker: string; length: number } | null = null;
  const flush = () => { if (state.current) blocks.push(state.current); state.current = null; };
  for (const line of value.split(/\r?\n/u)) {
    const marker = line.trim().match(/^(`{3,}|~{3,})(.*)$/u);
    const protectedLine = Boolean(fence || marker);
    if (fence) {
      if (marker && marker[1][0] === fence.marker && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
    } else if (marker) fence = { marker: marker[1][0], length: marker[1].length };
    if (!protectedLine && !line.trim()) { flush(); continue; }
    const bullet = !protectedLine ? line.match(/^\s*(?:[-*+•]\s+|(\d+)[.)、]\s+)(.+)$/u) : null;
    if (bullet) {
      const kind = bullet[1] ? 'ol' : 'ul';
      if (state.current?.kind !== kind) { flush(); state.current = { kind, items: [], ...(kind === 'ol' ? { start: Number(bullet[1]) } : {}) }; }
      state.current.items.push(bullet[2]);
    } else if (!protectedLine && /^\s+\S/u.test(line) && state.current && state.current.kind !== 'paragraph') {
      state.current.items[state.current.items.length - 1] += `\n${line.trim()}`;
    } else {
      if (state.current?.kind !== 'paragraph') { flush(); state.current = { kind: 'paragraph', lines: [] }; }
      state.current.lines.push(protectedLine ? line : line.replace(/^#{1,6}\s+/u, ''));
    }
  }
  flush();
  return <div className={`summary-prose ${className}`.trim()}>{blocks.map((block, index) => {
    if (block.kind === 'paragraph') return <SummaryParagraph key={index} value={block.lines.join('\n')} emphasizeFormulas={emphasizeFormulas} />;
    const items = block.items.map((item, itemIndex) => <li key={itemIndex}><SummaryText value={item} /></li>);
    return block.kind === 'ol' ? <ol key={index} start={block.start}>{items}</ol> : <ul key={index}>{items}</ul>;
  })}</div>;
}

export function QuestionMemoryOutline({ parts }: { parts: ReadingParts }) {
  return <section className="question-memory-outline" aria-label="记忆骨架">
    <p className="question-memory-heading">记忆骨架</p>
    <ol>{parts.map(({ question, label, nodes }) => <li key={question.id}>
      <strong><SummaryText value={label} /></strong>
      {nodes.length ? <ul aria-label={`${label}的记忆线索`}>{nodes.map(node => <li key={node.id}>
        <span className="question-memory-concept"><SummaryText value={node.name} /></span>
        {node.summary !== node.name ? <><span aria-hidden="true">： </span><span><SummaryText value={node.summary} /></span></> : null}
      </li>)}</ul> : null}
    </li>)}</ol>
  </section>;
}

export function QuestionPartExplanation({ nodes }: { nodes: ReadingParts[number]['nodes'] }) {
  return <dl className="question-part-explanations">{nodes.map(node => <div key={node.id}>
    <dt><SummaryText value={node.name} /></dt>
    <dd>
      <SummaryProse value={node.explanation} />
      <details className="summary-document-evidence"><summary>原文依据</summary><blockquote><SummaryText value={node.evidence} /></blockquote></details>
    </dd>
  </div>)}</dl>;
}
