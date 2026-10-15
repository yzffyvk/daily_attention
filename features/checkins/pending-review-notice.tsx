import { PENDING_REVIEW_PREFIX } from '@/lib/domain/ai-review';
import type { QuestionStructure } from '@/lib/domain/knowledge-questions';

export function PendingReviewNotice({ warnings, structure }: { warnings: string[]; structure: QuestionStructure }) {
  const names = new Map([
    ...structure.questions.map(q => [q.id, `「${q.mainlineRole}」`] as const),
    ...structure.nodes.map(n => [n.id, `「${n.name}」`] as const),
    ...structure.relations.map(r => [r.id, `「${r.label}」`] as const),
  ]);
  const labels: Record<string, string> = { question: '问题', answer: '答案', homeQuestionId: '所属部分', explanation: '解释', scope: '范围' };
  const notes = warnings.filter(warning => warning.startsWith(PENDING_REVIEW_PREFIX)).map(warning => warning.slice(PENDING_REVIEW_PREFIX.length)
    .replace(/[A-Za-z][A-Za-z0-9_-]*/gu, token => names.get(token) ?? labels[token] ?? token));
  if (!notes.length) return null;
  return <aside role="note" aria-label="提炼结果待核对" className="question-review-notice">
    <p>{notes[0]}</p>
    {notes.length > 1 ? <details><summary tabIndex={0}>查看核对提示</summary><ul>{notes.slice(1).map((note, index) => <li key={index}>{note}</li>)}</ul></details> : null}
  </aside>;
}
