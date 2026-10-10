"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, Clock3, ExternalLink, Library, LoaderCircle, RefreshCw, SkipForward, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "@/features/checkins/api";
import { useDialogFocus } from "@/features/checkins/dirty-switch-dialog";
import { TAKEAWAY_TOPICS, takeawayMilestone, takeawayStage, type TakeawayAction, type TakeawayLesson, type TakeawayReceipt, type TakeawayState } from "@/lib/domain/daily-takeaway";
import { applyTakeawayAction, getTakeawayState } from "./api";
import "./daily-takeaways.css";

type View = { type: "history" } | { type: "reader"; lesson: TakeawayLesson; fromHistory: boolean } | { type: "received"; receipt: TakeawayReceipt };

function messageFor(error: unknown) {
  return error instanceof ApiError ? error.message : "每日新知暂时无法连接，请稍后重试";
}

function TakeawayDialog({ children, title, onClose, busy }: { children: ReactNode; title: string; onClose: () => void; busy: boolean }) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    const background = Array.from(document.body.children).filter((element): element is HTMLElement => element instanceof HTMLElement && !element.contains(dialogRef.current));
    const previous = background.map(element => element.inert);
    document.body.style.overflow = "hidden";
    background.forEach(element => { element.inert = true; });
    return () => {
      document.body.style.overflow = overflow;
      background.forEach((element, index) => { element.inert = previous[index]; });
    };
  }, []);
  useDialogFocus({ dialogRef, initialFocusRef: closeRef, onClose: () => { if (!busy) onClose(); } });
  return createPortal(<div className="takeaway-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="takeaway-dialog" role="dialog" aria-modal="true" aria-label={title} ref={dialogRef}>
      <header className="takeaway-dialog-heading">
        <span><BookOpen aria-hidden="true" size={18} />{title}</span>
        <button className="takeaway-icon-button" ref={closeRef} type="button" aria-label="关闭每日新知" title="关闭每日新知" disabled={busy} onClick={onClose}><X size={20} aria-hidden="true" /></button>
      </header>
      {children}
    </section>
  </div>, document.body);
}

function Milestone({ history }: { history: TakeawayReceipt[] }) {
  const milestone = takeawayMilestone(history.length);
  if (!milestone) return null;
  const topics = [...new Set(history.map(item => TAKEAWAY_TOPICS[item.lesson.topic]))];
  return <details className="takeaway-milestone">
    <summary>{milestone} 条新知，回看这一路的收获</summary>
    <p>{topics.join(" · ")}</p>
    <ul>{history.map(item => <li key={item.lesson.id}>{item.lesson.takeaway}</li>)}</ul>
  </details>;
}

function LessonReader({ lesson, receipt, quizResult, busy, onAct, onBack, outdated, onRefresh }: {
  lesson: TakeawayLesson; receipt?: TakeawayReceipt;
  quizResult?: TakeawayState["quizResults"][number]; busy: boolean;
  onAct: (input: TakeawayAction) => void; onBack?: () => void; outdated: boolean; onRefresh: () => void;
}) {
  const savedAnswer = quizResult?.version === lesson.version ? quizResult.answerIndex : null;
  const [answer, setAnswer] = useState<0 | 1 | null>(savedAnswer);
  const correct = answer === lesson.quiz.correctIndex;
  return <article className="takeaway-reader">
    {onBack ? <button className="takeaway-link-button" type="button" onClick={onBack} disabled={busy}><ArrowLeft size={16} aria-hidden="true" />我的新知</button> : null}
    <div className="takeaway-meta"><span>网球入门 · {TAKEAWAY_TOPICS[lesson.topic]}</span><span><Clock3 size={14} aria-hidden="true" />约 {Math.ceil(lesson.readingSeconds / 60)} 分钟</span></div>
    <h2>{lesson.question}</h2>
    {lesson.correctionNote ? <p className="takeaway-correction"><RefreshCw size={15} aria-hidden="true" />内容更正：{lesson.correctionNote}</p> : null}
    <p className="takeaway-conclusion">{lesson.conclusion}</p>
    <p className="takeaway-explanation">{lesson.explanation}</p>
    <section className="takeaway-scene"><h3>放进一个场景</h3><p>{lesson.scenario}</p></section>
    <blockquote className="takeaway-one-line"><span>今天记住这一句</span><p>{lesson.takeaway}</p></blockquote>
    <details className="takeaway-quiz">
      <summary>做一道小判断<span>可跳过</span></summary>
      <fieldset disabled={busy || outdated}>
        <legend>{lesson.quiz.question}</legend>
        {lesson.quiz.options.map((option, index) => <label key={option} className={`takeaway-option${answer === index ? " selected" : ""}`}>
          <input type="radio" name={`takeaway-quiz-${lesson.id}`} checked={answer === index} onChange={() => {
            setAnswer(index as 0 | 1);
            onAct({ action: "quiz", lessonId: lesson.id, version: lesson.version, answerIndex: index as 0 | 1 });
          }} />
          <span>{option}</span>
        </label>)}
      </fieldset>
      {answer !== null ? <div className={`takeaway-answer${correct ? " correct" : ""}`} aria-live="polite"><strong>{correct ? "理解对了" : "再看一眼这个细节"}</strong><p>{lesson.quiz.explanation}</p></div> : null}
    </details>
    <details className="takeaway-sources"><summary>内容依据</summary>
      <ul>{lesson.sources.map(source => <li key={`${source.url}:${source.section}`}><a href={source.url} target="_blank" rel="noreferrer">{source.title}<ExternalLink size={12} aria-hidden="true" /></a><span>{source.section}</span></li>)}</ul>
      <p>资料核对：{lesson.sourceVerifiedAt} · 内容版本 {lesson.version}</p>
    </details>
    <footer className="takeaway-reader-actions">
      {outdated ? <div className="takeaway-update"><p>内容或学习进度已更新，当前阅读仍为打开时的版本。</p><button className="takeaway-button" type="button" disabled={busy} onClick={onRefresh}><RefreshCw size={16} aria-hidden="true" />载入最新进度</button></div>
        : receipt ? <p className="takeaway-collected"><Check size={17} aria-hidden="true" />已于 {receipt.learningDate} 收下</p>
        : <><button className="takeaway-button takeaway-primary" type="button" disabled={busy} onClick={() => onAct({ action: "collect", lessonId: lesson.id, version: lesson.version })}>{busy ? <LoaderCircle className="takeaway-spinner" size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}收下今日新知</button>
          <button className="takeaway-link-button" type="button" disabled={busy} onClick={() => onAct({ action: "skip", lessonId: lesson.id, version: lesson.version })}><SkipForward size={16} aria-hidden="true" />这条我已了解</button></>}
    </footer>
  </article>;
}

function TakeawayHistory({ state, busy, onRead }: { state: TakeawayState; busy: boolean; onRead: (lesson: TakeawayLesson) => void }) {
  const [topic, setTopic] = useState("all");
  const entries = state.history.filter(item => topic === "all" || item.lesson.topic === topic);
  return <div className="takeaway-history">
    <div className="takeaway-history-heading"><div><h2>我的新知</h2><p>收下的每一点，都在这里。</p></div><label>主题<select aria-label="按主题筛选" value={topic} onChange={event => setTopic(event.target.value)}><option value="all">全部主题</option>{Object.entries(TAKEAWAY_TOPICS).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label></div>
    <Milestone history={state.history} />
    {entries.length ? <ol className="takeaway-history-list">{entries.map(item => <li key={item.lesson.id}><button disabled={busy} type="button" onClick={() => onRead(item.lesson)}>
      <span className="takeaway-history-date">{item.learningDate}<span>{TAKEAWAY_TOPICS[item.lesson.topic]}</span></span>
      <span className="takeaway-history-copy"><strong>{item.lesson.question}</strong><span>{item.lesson.takeaway}</span>{item.lesson.version > item.collectedVersion ? <em>内容已更正</em> : null}</span><ChevronRight size={18} aria-hidden="true" />
    </button></li>)}</ol> : <p className="takeaway-empty">{state.history.length ? "这个主题还没有收下的新知。" : "还没有收下的新知。今天读懂的一点，可以从这里开始积累。"}</p>}
  </div>;
}

function TakeawayEntryForAccount({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["daily-takeaways", userId] as const;
  const [view, setView] = useState<View | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [lastAction, setLastAction] = useState<TakeawayAction | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const actionInFlight = useRef(false);
  const query = useQuery({ queryKey, queryFn: ({ signal }) => getTakeawayState(signal), staleTime: 15_000, refetchOnWindowFocus: "always", refetchInterval: 60_000, retry: 1 });
  const mutation = useMutation({ mutationFn: applyTakeawayAction });
  const state = query.data;
  const todayReceipt = state?.history.find(item => item.learningDate === state.today);
  const stage = state ? takeawayStage({ totalLessons: state.totalLessons, hasCurrentLesson: !!state.currentLesson, collectedToday: !!todayReceipt }) : null;
  const busy = mutation.isPending || refreshing;

  useEffect(() => {
    if (!state) return;
    const delay = Date.parse(state.nextAvailableAt) - Date.now();
    if (delay <= 0) return;
    const timer = window.setTimeout(() => { void queryClient.invalidateQueries({ queryKey: ["daily-takeaways", userId] }); }, Math.min(delay + 100, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [state?.nextAvailableAt, userId, queryClient, state]);

  async function act(input: TakeawayAction) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setActionError(null);
    setLastAction(input);
    try {
      await queryClient.cancelQueries({ queryKey });
      const next = await mutation.mutateAsync(input);
      // Focus or polling may have started a stale read while the save was in flight.
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, next);
      if (input.action === "collect") {
        const receipt = next.history.find(item => item.lesson.id === input.lessonId);
        if (receipt) setView({ type: "received", receipt });
      } else if (input.action === "skip") {
        setView(next.currentLesson ? { type: "reader", lesson: next.currentLesson, fromHistory: false } : { type: "history" });
      }
    } catch (error) {
      setActionError(error);
    } finally {
      actionInFlight.current = false;
    }
  }

  async function refreshReader() {
    if (actionInFlight.current || refreshing) return;
    setRefreshing(true);
    try {
      const result = await query.refetch();
      if (result.error) throw result.error;
      const next = result.data;
      if (!next) throw new Error("No data");
      setActionError(null);
      if (view?.type === "reader") {
        const saved = next.history.find(item => item.lesson.id === view.lesson.id);
        const lesson = saved?.lesson ?? next.currentLesson;
        setView(lesson ? { type: "reader", lesson, fromHistory: view.fromHistory } : { type: "history" });
      }
    } catch (error) { setActionError(error); }
    finally { setRefreshing(false); }
  }

  function open(next: View) { setActionError(null); setLastAction(null); setView(next); }
  const conflict = actionError instanceof ApiError && (actionError.status === 409 || actionError.status === 404);
  const readerReceipt = view?.type === "reader" ? state?.history.find(item => item.lesson.id === view.lesson.id) : undefined;
  const latestLesson = readerReceipt?.lesson ?? state?.currentLesson;
  const readerOutdated = view?.type === "reader" && (!latestLesson || latestLesson.id !== view.lesson.id || latestLesson.version !== view.lesson.version || conflict);

  return <section className="daily-takeaway-entry" aria-label="每日新知">
    <div className="takeaway-entry-symbol"><BookOpen size={22} aria-hidden="true" /></div>
    <div className="takeaway-entry-copy">
      <div className="takeaway-entry-label"><strong>每日新知</strong><span>网球入门</span></div>
      {query.isPending ? <p role="status">正在取来今天的新知…</p>
        : !state ? <p role="alert">{messageFor(query.error)}</p>
        : <><h2>{stage === "done" ? "今天，又多懂了一点" : stage === "complete" ? "本阶段已完成" : stage === "unavailable" ? "网球新知正在准备中" : state.currentLesson!.question}</h2>
          <p>{stage === "done" ? todayReceipt!.lesson.takeaway : stage === "complete" ? "带着积累继续前进，收下的内容可以随时回看。" : stage === "unavailable" ? "内容核验完成后，就能从第一条开始。" : <><Clock3 size={13} aria-hidden="true" />约 {Math.ceil(state.currentLesson!.readingSeconds / 60)} 分钟<span>·</span>{TAKEAWAY_TOPICS[state.currentLesson!.topic]}</>}</p></>}
    </div>
    <div className="takeaway-entry-actions">
      {stage === "available" && state?.currentLesson ? <button className="takeaway-button" type="button" onClick={() => open({ type: "reader", lesson: state.currentLesson!, fromHistory: false })}>读今日新知<ArrowRight size={16} aria-hidden="true" /></button> : null}
      {stage === "done" && todayReceipt ? <button className="takeaway-button" type="button" onClick={() => open({ type: "reader", lesson: todayReceipt.lesson, fromHistory: false })}><Check size={16} aria-hidden="true" />回看今日收获</button> : null}
      {state ? <button className="takeaway-link-button" type="button" onClick={() => open({ type: "history" })}><Library size={16} aria-hidden="true" />我的新知<span>{state.history.length}</span></button>
        : query.isError ? <button className="takeaway-button" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={16} aria-hidden="true" />重试</button> : null}
      {state ? <small>累计收下 {state.history.length} 条</small> : null}
    </div>
    {view && state ? <TakeawayDialog title={view.type === "history" ? "我的新知" : "每日新知"} busy={busy} onClose={() => setView(null)}>
      {actionError ? <div className="takeaway-error" role="alert"><p>{messageFor(actionError)}</p>{conflict ? <button type="button" className="takeaway-link-button" disabled={busy} onClick={() => void refreshReader()}><RefreshCw size={15} aria-hidden="true" />载入最新进度</button> : lastAction?.action === "quiz" ? <button type="button" className="takeaway-link-button" disabled={busy} onClick={() => void act(lastAction)}><RefreshCw size={15} aria-hidden="true" />重试保存自测</button> : null}</div> : null}
      {view.type === "reader" ? <LessonReader key={`${view.lesson.id}:${view.lesson.version}`} lesson={view.lesson} receipt={readerReceipt} quizResult={state.quizResults.find(item => item.lessonId === view.lesson.id)} busy={busy} onAct={input => void act(input)} onBack={view.fromHistory ? () => open({ type: "history" }) : undefined} outdated={!!readerOutdated} onRefresh={() => void refreshReader()} />
        : view.type === "history" ? <TakeawayHistory state={state} busy={busy} onRead={lesson => open({ type: "reader", lesson, fromHistory: true })} />
        : <div className="takeaway-received" role="status"><div className="takeaway-received-mark"><Check size={26} aria-hidden="true" /></div><p className="takeaway-meta">今天带走了</p><h2>{view.receipt.lesson.takeaway}</h2><p>累计收下 {state.history.length} 条网球新知</p>
          <Milestone history={state.history} />
          <p className="takeaway-next">{state.history.length + state.skippedCount >= state.totalLessons ? "本阶段已完成，随时回来看看你的积累。" : "下一条新知将在北京时间明天 00:00 开启。"}</p>
          <div className="takeaway-received-actions"><button className="takeaway-button" type="button" onClick={() => open({ type: "history" })}><Library size={16} aria-hidden="true" />查看我的新知</button><button className="takeaway-link-button" type="button" onClick={() => setView(null)}>回到首页<ArrowRight size={16} aria-hidden="true" /></button></div>
        </div>}
    </TakeawayDialog> : null}
  </section>;
}

export function DailyTakeawayEntry({ userId }: { userId: string }) {
  return <TakeawayEntryForAccount key={userId} userId={userId} />;
}
