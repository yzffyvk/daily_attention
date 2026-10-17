import type { QuestionSummary } from '@/lib/domain/knowledge-questions';
import { isSymmetric } from './structure-reader-model';
import { QuestionMemoryOutline, QuestionPartExplanation, questionReadingParts, SummaryText, SummaryProse } from './question-reading';
import { PendingReviewNotice } from './pending-review-notice';
import { PENDING_REVIEW_PREFIX } from '@/lib/domain/ai-review';

function Evidence({ value }: { value: string }) {
  return <details className="summary-document-evidence"><summary>原文依据</summary><blockquote><SummaryText value={value} /></blockquote></details>;
}

/** A reading view of the saved document; storage syntax stays in the editor. */
export function QuestionSummaryDocument({ document }: { document: QuestionSummary }) {
  const s = document.structure;
  const parts = questionReadingParts(s);
  const sourceWarnings = document.warnings.filter(warning => !warning.startsWith(PENDING_REVIEW_PREFIX));
  const nodeNames = new Map(s.nodes.map(node => [node.id, node.name]));
  return <article className="summary-document" data-testid="complete-summary" aria-label="完整小结正文">
    <header>
      <p className="summary-document-source">资料：<SummaryText value={document.sourceTitle} /></p>
      <h4><SummaryText value={document.attention} /></h4>
      <p className="summary-document-thesis"><SummaryText value={document.thesis} /></p>
    </header>
    <PendingReviewNotice warnings={document.warnings} structure={s} />
    <section>
      <h5>核心问题</h5>
      <p><SummaryText value={s.coreQuestion} /></p>
    </section>
    <QuestionMemoryOutline parts={parts} />
    <section>
      <h5>沿骨架展开</h5>
      <ol className="summary-document-parts">{parts.map(({ question: q, label, nodes }) => {
        const id = q.id;
        const notes = [...new Set([
          ...q.views.flatMap(view => view.contextNotes.map(note => note.text)),
          ...s.questionLinks.filter(link => link.fromQuestionId === id).map(link => link.label),
        ])];
        return <li key={id}>
          <p className="summary-document-part-label"><SummaryText value={label} /></p>
          <h6><SummaryText value={q.title} /></h6>
          <SummaryProse value={q.answer} emphasizeFormulas={false} />
          <QuestionPartExplanation nodes={nodes} />
          <details className="summary-document-evidence"><summary>范围与依据</summary>
            <p><SummaryText value={q.scope} /></p>
            {q.mainlineRole !== label ? <p><SummaryText value={q.mainlineRole} /></p> : null}
            {notes.map(note => <p key={note}><SummaryText value={note} /></p>)}
            <blockquote><SummaryText value={q.evidence} /></blockquote>
          </details>
        </li>;
      })}</ol>
    </section>
    {s.relations.length ? <details className="summary-document-relations">
      <summary>关系与适用条件</summary>
      <ul>{s.relations.map(relation => <li key={relation.id}>
        <h6>{nodeNames.get(relation.from)} {isSymmetric(relation) ? '↔' : '→'} {nodeNames.get(relation.to)}</h6>
        <p><SummaryText value={relation.label} /></p>
        {relation.condition ? <p className="summary-document-condition"><span>适用条件</span><SummaryText value={relation.condition} /></p> : null}
        <Evidence value={relation.evidence} />
      </li>)}</ul>
    </details> : null}
    {document.distinctions ? <section><h5>关键辨析</h5><SummaryProse value={document.distinctions} /></section> : null}
    <section><h5>试着讲一遍</h5><ol className="summary-document-prompts">{document.prompts.map((prompt, index) => <li key={index}><SummaryText value={prompt} /></li>)}</ol></section>
    {sourceWarnings.length ? <section className="summary-document-warnings"><h5>资料提醒</h5><ul>{sourceWarnings.map((warning, index) => <li key={index}><SummaryText value={warning} /></li>)}</ul></section> : null}
  </article>;
}
