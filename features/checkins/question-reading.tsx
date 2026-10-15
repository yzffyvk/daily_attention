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
      label: /[。！？：]/u.test(question.mainlineRole) || question.mainlineRole.length > 18 ? question.scope : question.mainlineRole,
      nodes: [...orderedIds].flatMap(nodeId => {
        const node = nodes.get(nodeId);
        return node?.homeQuestionId === id ? [node] : [];
      }),
    };
  });
}

type ReadingParts = ReturnType<typeof questionReadingParts>;

// Support limited emphasis as text. Source-derived HTML is never executed.
export function SummaryText({ value }: { value: string }) {
  return <>{value.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/gu).map((part, index) =>
    part.startsWith('`') && part.endsWith('`') ? <code key={index}>{part.slice(1, -1)}</code>
      : part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong>
        : part,
  )}</>;
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
      {node.explanation.split(/\n\s*\n/u).filter(Boolean).map((paragraph, index) => <p key={index}><SummaryText value={paragraph} /></p>)}
      <details className="summary-document-evidence"><summary>原文依据</summary><blockquote><SummaryText value={node.evidence} /></blockquote></details>
    </dd>
  </div>)}</dl>;
}
