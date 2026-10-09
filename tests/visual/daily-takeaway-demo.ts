import { getLearningDate, nextLearningMidnight, type TakeawayAction, type TakeawayState } from "@/lib/domain/daily-takeaway";
import { tennisLessons } from "@/lib/domain/tennis-lessons";

// This adapter is imported only by the opt-in local visual preview.
export function installTakeawayDemoApi(userId: string, scenario: string | null) {
  const originalFetch = window.fetch.bind(window);
  const key = `aura-takeaway-demo:v1:${userId}:${scenario ?? "new"}`;
  const today = getLearningDate();
  const dateBefore = (days: number) => new Date(Date.parse(`${today}T12:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
  const count = scenario === "history" ? 14 : scenario === "milestone" ? 6 : scenario === "corrected" ? 1 : 0;
  let history: TakeawayState["history"] = Array.from({ length: count }, (_, i) => ({
    lesson: tennisLessons[i], learningDate: dateBefore(count - i), collectedAt: `${dateBefore(count - i)}T03:00:00Z`, collectedVersion: 1,
  })).reverse();
  let skipped: string[] = scenario === "complete" ? tennisLessons.map(lesson => lesson.id) : [];
  let quizResults: TakeawayState["quizResults"] = [];
  let failNext = scenario === "save-error";
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (saved) { history = saved.history; skipped = saved.skipped; quizResults = saved.quizResults; }
  } catch { /* Preview storage is optional. */ }
  if (scenario === "corrected" && history[0]) history[0].lesson = { ...tennisLessons[0], version: 2, correctionNote: "补充说明：不同赛制要求的获胜盘数可能不同，以赛事规则为准。" };
  const snapshot = (): TakeawayState => ({
    today: getLearningDate(), timeZone: "Asia/Shanghai", nextAvailableAt: nextLearningMidnight(),
    totalLessons: tennisLessons.length, skippedCount: skipped.length,
    currentLesson: history.some(item => item.learningDate === getLearningDate()) ? null : tennisLessons.find(lesson => !skipped.includes(lesson.id) && !history.some(item => item.lesson.id === lesson.id)) ?? null,
    history, quizResults,
  });
  window.fetch = async (input, init) => {
    if (new URL(String(input), location.origin).pathname !== "/api/daily-takeaways") return originalFetch(input, init);
    const ok = () => Response.json({ ok: true, data: snapshot(), requestId: "takeaway-preview" });
    const failure = (code: string, message: string, status = 409) => Response.json({ ok: false, error: { code, message }, requestId: "takeaway-preview" }, { status });
    if (init?.method !== "POST") return ok();
    await new Promise(resolve => window.setTimeout(resolve, 220));
    if (failNext) { failNext = false; return failure("TAKEAWAY_UNAVAILABLE", "这次保存没有完成，请重试。", 503); }
    const action: TakeawayAction = JSON.parse(String(init.body));
    const lesson = history.find(item => item.lesson.id === action.lessonId)?.lesson ?? tennisLessons.find(item => item.id === action.lessonId);
    if (!lesson) return failure("TAKEAWAY_NOT_FOUND", "这条新知暂时不可用", 404);
    if (action.action === "collect" && history.some(item => item.lesson.id === lesson.id)) return ok();
    if (action.action === "skip" && skipped.includes(lesson.id)) return ok();
    if (action.version !== lesson.version) return failure("TAKEAWAY_CONTENT_UPDATED", "这条新知有内容更正，请载入最新进度");
    const isHistoryQuiz = action.action === "quiz" && history.some(item => item.lesson.id === lesson.id);
    if (!isHistoryQuiz && snapshot().currentLesson?.id !== lesson.id) return failure("TAKEAWAY_PROGRESS_CHANGED", "学习进度已更新，请载入最新进度");
    if (action.action === "collect") history = [{ lesson, collectedAt: new Date().toISOString(), learningDate: getLearningDate(), collectedVersion: lesson.version }, ...history];
    if (action.action === "skip") skipped = [...skipped, lesson.id];
    if (action.action === "quiz") quizResults = [{ lessonId: lesson.id, version: lesson.version, answerIndex: action.answerIndex, correct: lesson.quiz.correctIndex === action.answerIndex, answeredAt: new Date().toISOString() }, ...quizResults.filter(item => item.lessonId !== lesson.id)];
    try { sessionStorage.setItem(key, JSON.stringify({ history, skipped, quizResults })); } catch { /* Memory fallback. */ }
    return ok();
  };
}
