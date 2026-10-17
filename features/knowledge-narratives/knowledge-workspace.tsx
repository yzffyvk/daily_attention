"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { MonthCalendar } from "@/features/calendar/month-calendar";
import { ApiError } from "@/features/checkins/api";
import { monthKeyForDate } from "@/features/checkins/dates";
import { useDialogFocus } from "@/features/checkins/dirty-switch-dialog";
import { useMonthCheckIns } from "@/features/checkins/queries";
import type { CheckInEntryMode } from "@/lib/domain/checkin";
import type { KnowledgeNarrative, NarrativeStatus, NarrativeSummary } from "@/lib/domain/knowledge-narrative";
import { copyNarrative, createNarrative, deleteNarrative, getNarrative, getNarratives, type CreateNarrativeInput } from "./api";
import { NarrativeReader } from "./narrative-reader";
import { NarrativeEditor } from "./narrative-editor";
import { RecordSourcePicker } from "./record-source-picker";
import { KnowledgeConstellation } from "./knowledge-constellation";

const labels: Record<NarrativeStatus, string> = { queued: "等待生成", generating: "正在生成", succeeded: "已保存", failed: "生成失败" };
const activeStatus = (status?: NarrativeStatus) => status === "queued" || status === "generating";
const errorText = (error: unknown) => error instanceof ApiError ? error.message : "操作失败，请稍后重试";
type LeaveGuard = (leave: () => void) => void;

function ConfirmDialog({ title, children, confirmLabel, cancelLabel = "取消", busy = false, error, onConfirm, onCancel }: {
  title: string; children: ReactNode; confirmLabel: string; cancelLabel?: string; busy?: boolean; error?: string;
  onConfirm: () => void; onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  useDialogFocus({ dialogRef, initialFocusRef: cancelRef, onClose: () => { if (!busy) onCancel(); } });
  useEffect(() => { if (busy) dialogRef.current?.focus(); else cancelRef.current?.focus(); }, [busy]);
  return <div className="dialog-backdrop" role="presentation"><section role="dialog" aria-modal="true" aria-label={title} aria-describedby={descriptionId} className="switch-dialog narrative-confirm-dialog" ref={dialogRef} tabIndex={-1} onKeyDown={event => { if (busy && event.key === "Tab") event.preventDefault(); }}>
    <p className="eyebrow">知识脉络</p><h2>{title}</h2><div id={descriptionId}>{children}</div>
    {error ? <p role="alert" className="knowledge-error">{error}</p> : null}
    <div className="dialog-actions"><button ref={cancelRef} className="secondary-button" type="button" disabled={busy} onClick={onCancel}>{cancelLabel}</button><button className="narrative-danger-button" type="button" disabled={busy} onClick={onConfirm}>{busy ? "正在删除…" : confirmLabel}</button></div>
  </section></div>;
}

function NarrativeDetail({ narrative, onRegenerate, onEdit }: { narrative: KnowledgeNarrative; onRegenerate: () => void; onEdit: () => void }) {
  return <>
    <div className="narrative-detail-heading">
      <div><p className="eyebrow">{labels[narrative.status]} · {narrative.dates.length} 天的学习</p><h2>{narrative.title}</h2></div>
      <div className="knowledge-actions">
        {narrative.status === "succeeded" ? <button className="text-button" onClick={onEdit} type="button">编辑</button> : null}
        {!activeStatus(narrative.status) ? <button className="secondary-button" type="button" onClick={onRegenerate}>重新生成</button> : null}
      </div>
    </div>
    {narrative.question ? <p className="narrative-question"><span>探索的问题</span>{narrative.question}</p> : null}
    {narrative.changedDates.length ? <p className="knowledge-source-warning" role="status">来源记录已有更新（{narrative.changedDates.join("、")}）。当前内容保留生成时的快照，重新生成可使用最新记录。</p> : null}
    {narrative.status === "queued" || narrative.status === "generating" ? <KnowledgeConstellation dates={narrative.dates} status={narrative.status} autoFocus /> : null}
    {narrative.status === "failed" ? <div className="knowledge-job-state" role="alert"><h3>这次生成未完成</h3><p>{narrative.error || "生成暂时不可用，请稍后重新生成。"}</p><p>原始学习记录已保留，重新生成将创建一条新脉络。</p></div> : null}
    {narrative.status === "succeeded" ? <NarrativeReader narrative={narrative} /> : null}
  </>;
}

export function KnowledgeWorkspace({ today, userId, entryMode = "manual", onClose, leaveGuardRef, listNavigationRef, emptyIllustration, initialRecordIds, initialAlbumId }: { initialRecordIds?: string[]; initialAlbumId?: string | null; today: string; userId: string; entryMode?: CheckInEntryMode; onClose: () => void; leaveGuardRef?: RefObject<LeaveGuard | null>; listNavigationRef?: RefObject<(() => void) | null>; emptyIllustration?: ReactNode }) {
  const recordSelection = initialRecordIds !== undefined || initialAlbumId !== undefined;
  const [recordIds, setRecordIds] = useState<string[]>(initialRecordIds ?? []);
  const client = useQueryClient();
  const [view, setView] = useState<"list" | "create" | "detail" | "edit">((initialRecordIds?.length || initialAlbumId !== undefined) ? "create" : "list");
  const [month, setMonth] = useState(() => monthKeyForDate(today));
  const [sourceEntryMode, setSourceEntryMode] = useState<CheckInEntryMode>(entryMode);
  const [dates, setDates] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<{ action: () => void } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NarrativeSummary | null>(null);
  const [notice, setNotice] = useState("");
  const requestRef = useRef<CreateNarrativeInput | null>(null);
  const requestInFlight = useRef(false);
  const hasEnteredCreation = useRef(false);
  const copyKeys = useRef(new Map<string, string>());
  const copying = useRef(false);
  const deleting = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const monthQuery = useMonthCheckIns(month);
  const listKey = ["knowledge-narratives", userId] as const;
  const detailKey = ["knowledge-narrative", userId, activeId] as const;
  const history = useQuery({ queryKey: listKey, queryFn: getNarratives, refetchInterval: query => query.state.data?.some(item => activeStatus(item.status)) ? 3000 : false });
  const detail = useQuery({ queryKey: detailKey, queryFn: () => getNarrative(activeId!), enabled: Boolean(activeId), refetchInterval: query => activeStatus(query.state.data?.status) ? 3000 : false });
  const create = useMutation({ mutationFn: createNarrative });
  const copy = useMutation({ mutationFn: copyNarrative });
  const remove = useMutation({ mutationFn: deleteNarrative });
  const busy = editorSaving || create.isPending;
  const requestLeave = useCallback((action: () => void) => {
    if (busy) return;
    if (dirty) setPendingLeave({ action });
    else action();
  }, [dirty, busy]);

  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => {
    if (!leaveGuardRef) return;
    leaveGuardRef.current = requestLeave;
    return () => { leaveGuardRef.current = null; };
  }, [leaveGuardRef, requestLeave]);
  useEffect(() => {
    if (!dirty && !editorSaving) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, editorSaving]);

  function focusHeading() { requestAnimationFrame(() => headingRef.current?.focus()); }
  async function cacheNarrative(value: KnowledgeNarrative) {
    // A read started before the write must not replace the newly saved result when it arrives late.
    await Promise.all([
      client.cancelQueries({ queryKey: ["knowledge-narrative", userId, value.id] }),
      client.cancelQueries({ queryKey: listKey }),
    ]);
    client.setQueryData(["knowledge-narrative", userId, value.id], value);
    client.setQueryData<NarrativeSummary[]>(listKey, items => items?.some(item => item.id === value.id) ? items.map(item => item.id === value.id ? value : item) : [value, ...(items ?? [])]);
    void client.invalidateQueries({ queryKey: listKey });
  }
  async function showNarrative(value: KnowledgeNarrative) {
    await cacheNarrative(value); setDirty(false); setEditorSaving(false);
    setActiveId(value.id); setView("detail");
    if (!activeStatus(value.status)) focusHeading();
  }
  const showList = useCallback(() => { setActiveId(null); setView("list"); setDirty(false); requestAnimationFrame(() => headingRef.current?.focus()); }, []);
  useEffect(() => {
    if (!listNavigationRef) return;
    listNavigationRef.current = () => requestLeave(showList);
    return () => { listNavigationRef.current = null; };
  }, [listNavigationRef, requestLeave, showList]);
  function openNarrative(id: string, edit = false) { setNotice(""); setActiveId(id); setView(edit ? "edit" : "detail"); focusHeading(); }

  async function generate() {
    if (requestInFlight.current || (recordSelection ? recordIds : dates).length < 2 || (recordSelection ? recordIds : dates).length > 14 || question.length > 300) return;
    requestInFlight.current = true;
    const normalized = recordSelection ? { recordIds: [...recordIds].sort(), question: question.trim() } : { dates: [...dates].sort(), question: question.trim(), ...(sourceEntryMode === "ai" ? { entryMode: sourceEntryMode } : {}) };
    const fingerprint = JSON.stringify(normalized);
    const storageKey = `knowledge-request:${userId}`;
    // Keep uncertain requests idempotent, including when a response was lost before refresh.
    if (!requestRef.current) {
      try {
        const saved: CreateNarrativeInput = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
        if (saved && (Array.isArray(saved.dates) || Array.isArray(saved.recordIds)) && typeof saved.question === "string" && typeof saved.idempotencyKey === "string") requestRef.current = saved;
      } catch { /* Storage may be unavailable; the in-memory key still covers retries. */ }
    }
    if (!requestRef.current || JSON.stringify(requestRef.current.recordIds ? { recordIds: requestRef.current.recordIds, question:requestRef.current.question } : { dates: requestRef.current.dates, question: requestRef.current.question, ...(requestRef.current.entryMode === "ai" ? { entryMode: "ai" } : {}) }) !== fingerprint) {
      requestRef.current = { ...normalized, idempotencyKey: crypto.randomUUID() };
    }
    try { sessionStorage.setItem(storageKey, JSON.stringify(requestRef.current)); } catch { /* Optional recovery storage. */ }
    try {
      const value = await create.mutateAsync(requestRef.current);
      requestRef.current = null;
      try { sessionStorage.removeItem(storageKey); } catch { /* Optional recovery storage. */ }
      await showNarrative(value);
    } catch {
      // A rejected retry cannot disprove an earlier commit whose response was lost.
      // Keep the request identity until success, changed input, or explicit new intent.
    } finally { requestInFlight.current = false; }
  }

  function startSelection(source?: KnowledgeNarrative) {
    const selectedMode = source ? source.sources[0]?.entryMode ?? "manual" : entryMode;
    setSourceEntryMode(selectedMode);
    // Only the first selection after mounting recovers an unresolved request. A later new selection
    // and every regeneration are explicit new operations, even when the input is unchanged.
    if (source || hasEnteredCreation.current) {
      requestRef.current = recordSelection ? {recordIds: source?.sources.flatMap(item=>item.id?[item.id]:[]).sort() ?? [],question:source?.question.trim() ?? "",idempotencyKey:crypto.randomUUID()} : { dates: [...(source?.dates ?? [])].sort(), question: source?.question.trim() ?? "", ...(selectedMode === "ai" ? { entryMode: selectedMode } : {}), idempotencyKey: crypto.randomUUID() };
      try { sessionStorage.removeItem(`knowledge-request:${userId}`); } catch { /* In-memory identity takes precedence. */ }
    }
    hasEnteredCreation.current = true;
    setActiveId(null); setView("create"); setDirty(false); setNotice(""); create.reset();
    setRecordIds(source?.sources.flatMap(item=>item.id?[item.id]:[]).sort() ?? []);
    setDates(source ? source.dates : []); setQuestion(source?.question ?? "");
    if (source?.dates.length) setMonth(monthKeyForDate(source.dates[source.dates.length - 1]));
    focusHeading();
  }

  async function makeCopy(item: NarrativeSummary) {
    if (copying.current) return;
    copying.current = true; setNotice("");
    let idempotencyKey = copyKeys.current.get(item.id);
    if (!idempotencyKey) { idempotencyKey = crypto.randomUUID(); copyKeys.current.set(item.id, idempotencyKey); }
    try {
      const value = await copy.mutateAsync({ id: item.id, idempotencyKey });
      copyKeys.current.delete(item.id);
      await cacheNarrative(value); setNotice(`已复制为「${value.title}」`);
    } catch { /* Preserve the operation identity for a response-loss retry. */ }
    finally { copying.current = false; }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting.current) return;
    deleting.current = true;
    const target = deleteTarget;
    try {
      try { await remove.mutateAsync(target.id); }
      catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
      await client.cancelQueries({ queryKey: listKey });
      await client.cancelQueries({ queryKey: ["knowledge-narrative", userId, target.id] });
      client.removeQueries({ queryKey: ["knowledge-narrative", userId, target.id] });
      client.setQueryData<NarrativeSummary[]>(listKey, items => items?.filter(item => item.id !== target.id) ?? []);
      copyKeys.current.delete(target.id);
      setDeleteTarget(null); setNotice(`已删除「${target.title}」`);
      void client.invalidateQueries({ queryKey: listKey });
      focusHeading();
    } catch { /* Leave the confirmation open with its error so the user can retry. */ }
    finally { deleting.current = false; }
  }

  return <section className="knowledge-workspace" aria-labelledby="knowledge-title">
    <div inert={Boolean(deleteTarget || pendingLeave)}>
    <div className="knowledge-topline"><button className="text-button" type="button" disabled={busy} onClick={() => requestLeave(onClose)}><ArrowLeft aria-hidden="true" size={16} />返回学习记录</button><p>记录成点 · 关联成线 · 理解成面</p></div>
    <div className="knowledge-heading"><div><p className="eyebrow">知序 / KNOWLEDGE</p><h2 id="knowledge-title" tabIndex={-1} ref={headingRef}>{view === "create" ? "新增串联知识" : "知识脉络"}</h2></div>{view !== "create" ? <button className="secondary-button" type="button" disabled={busy} onClick={() => requestLeave(() => startSelection())}><Plus aria-hidden="true" size={16} />新增串联知识</button> : null}</div>
    {view !== "list" ? <button className="text-button knowledge-back-list" type="button" disabled={busy} onClick={() => requestLeave(showList)}><ArrowLeft size={15} aria-hidden="true" />返回脉络列表</button> : null}
    {notice ? <p role="status" className="knowledge-notice">{notice}</p> : null}
    {view === "detail" || view === "edit" ? <div className="knowledge-detail">
      {detail.isPending ? <p role="status">正在读取知识脉络…</p> : null}
      {detail.isError ? <div role="alert"><p>{errorText(detail.error)}</p><button type="button" className="secondary-button" disabled={detail.isFetching} onClick={() => void detail.refetch()}>重试读取脉络</button></div> : null}
      {detail.data ? view === "edit" && detail.data.status === "succeeded" && detail.data.result
        ? <NarrativeEditor key={detail.data.id} narrative={detail.data} onSaved={async value => { await showNarrative(value); setNotice("修改已保存"); }} onCancel={() => requestLeave(() => { setDirty(false); setView("detail"); focusHeading(); })} onDirtyChange={setDirty} onSavingChange={setEditorSaving} />
        : <NarrativeDetail key={detail.data.id} narrative={detail.data} onRegenerate={() => startSelection(detail.data)} onEdit={() => { setNotice(""); setView("edit"); }} /> : null}
    </div> : view === "create" ? <div className="knowledge-selection">
      {recordSelection ? <RecordSourcePicker userId={userId} selectedIds={recordIds} initialAlbumId={initialAlbumId} disabled={create.isPending} onChange={ids=>{setRecordIds(ids);create.reset();}} /> : <MonthCalendar month={month} selectedDate="" selectedDates={dates} summaries={monthQuery.data?.filter(record => (record.entryMode ?? "manual") === sourceEntryMode)} today={today} disabled={create.isPending}
        isLoading={monthQuery.isPending} errorMessage={monthQuery.isError ? errorText(monthQuery.error) : ""} isRetrying={monthQuery.isFetching} onRetry={() => void monthQuery.refetch()}
        onMonthChange={setMonth} onSelectDate={date => { if (create.isPending) return; create.reset(); setDates(current => current.includes(date) ? current.filter(item => item !== date) : current.length < 14 ? [...current, date].sort() : current); }} />}
      <section className="knowledge-compose" aria-labelledby="knowledge-compose-title"><p className="eyebrow">{recordSelection ? "从哪些记录开始" : "从哪几天开始"}</p><h3 id="knowledge-compose-title">把零散的收获，连起来</h3>
        <p className="knowledge-muted">{recordSelection ? "选择 2–14 条已完成记录，支持同一天、跨日期和不同整理方式。待整理内容、待确认结果及图片正文不会参与生成。" : `来源：${sourceEntryMode === "ai" ? "AI 提炼" : "手动记录"}。以该方式已保存的知识主题、小结和灵感为基础；未保存草稿和图片正文不会参与生成。`}</p>
        <p className="knowledge-muted">同一主题会整理为概念图谱与表达提纲，必要时补充少量知识并标注「AI 补充」。多领域混合时按原始记录展示。</p>
        {recordSelection ? <div className="knowledge-selection-count">已选 <strong>{recordIds.length}</strong> / 14 条{recordIds.length<2?<span>至少选择 2 条</span>:null}</div> : <><div className="knowledge-selection-count">已选 <strong>{dates.length}</strong> / 14 天{dates.length < 2 ? <span>至少选择 2 天</span> : null}</div>
        <ul className="knowledge-selected-dates" aria-label="已选日期">{dates.map(date => <li key={date}><time>{date}</time><button aria-label={`移除 ${date}`} type="button" disabled={create.isPending} onClick={() => { setDates(current => current.filter(item => item !== date)); create.reset(); }}><X size={14} aria-hidden="true" /></button></li>)}</ul>
        {!dates.length ? <p className="knowledge-selection-empty">在日历中点选有记录的日期，探索它们之间的联系。</p> : null}</> }
        <label className="knowledge-question-label" htmlFor="knowledge-question">想探索的问题（可选）</label><textarea id="knowledge-question" rows={3} maxLength={300} placeholder="例如：这些学习如何帮助我搭建一个完整的检索流程？" disabled={create.isPending} value={question} onChange={event => { setQuestion(event.target.value); create.reset(); }} />
        <p className="knowledge-character-count">{question.length}/300</p>
        {create.isError ? <p role="alert" className="knowledge-error">{errorText(create.error)}</p> : null}
        <button className="primary-button knowledge-generate" type="button" disabled={(recordSelection ? recordIds : dates).length < 2 || (recordSelection ? recordIds : dates).length > 14 || create.isPending} onClick={() => void generate()}>{create.isPending ? "正在提交…" : create.isError ? "重试生成请求" : "生成知识脉络"}</button>
        <p className="knowledge-muted knowledge-generation-note">生成后自动保存；重新生成会保留旧版本并使用 1 次额度。知识提炼与知识串联每日合计免费 2 次，北京时间 0 点重置；免费次数用完后使用次数包，切换所选日期不会增加免费次数。</p>
      </section>
    </div> : <section className="knowledge-history" aria-labelledby="knowledge-history-title">
      <div className="knowledge-history-heading"><div><h3 id="knowledge-history-title">已保存的脉络</h3><p>让每一次理解，都有迹可循。</p></div><span>最近 50 条</span></div>
      {history.isPending ? <p role="status">正在读取历史脉络…</p> : null}
      {history.isError ? <div role="alert"><p>{errorText(history.error)}</p><button className="text-button" type="button" disabled={history.isFetching} onClick={() => void history.refetch()}>重试历史脉络</button></div> : null}
      {copy.isError ? <p role="alert" className="knowledge-error">{errorText(copy.error)}，请再次点击该条脉络的复制按钮重试。</p> : null}
      {history.data?.length === 0 ? <div className="knowledge-library-empty">{emptyIllustration ?? <div className="knowledge-empty-thread" aria-hidden="true"><i /><i /><i /></div>}<h4>还没有知识脉络</h4><p>选择已完成的学习记录，把零散的收获连成自己的理解。</p><button className="primary-button" type="button" onClick={() => startSelection()}>创建第一条脉络</button></div> : null}
      {history.data?.length ? <><div className="knowledge-library-columns" aria-hidden="true"><span>脉络名称</span><span>学习日期</span><span>创建时间</span><span>状态</span><span>操作</span></div>
      <ul className="knowledge-library-list">{history.data.map(item => <li className="knowledge-library-row" key={item.id}>
        <button type="button" className="knowledge-library-name" aria-label={`打开知识脉络 ${item.title}，${labels[item.status]}`} onClick={() => openNarrative(item.id)}>{item.title}</button>
        <span className="knowledge-library-days">{item.dates.length} 天</span><time className="knowledge-library-created" dateTime={item.createdAt}>{item.createdAt.slice(0, 10)}</time><span className={`knowledge-status ${item.status}`}>{labels[item.status]}</span>
        <div className="knowledge-library-actions">{item.status === "succeeded" ? <><button type="button" className="text-button" aria-label={`编辑 ${item.title}`} onClick={() => openNarrative(item.id, true)}>编辑</button><button type="button" className="text-button" aria-label={`复制 ${item.title}`} disabled={copy.isPending} onClick={() => void makeCopy(item)}>{copy.isPending && copy.variables?.id === item.id ? "复制中…" : "复制"}</button></> : null}<button type="button" className="text-button knowledge-delete" aria-label={`删除 ${item.title}`} disabled={copy.isPending} onClick={() => { remove.reset(); setNotice(""); setDeleteTarget(item); }}>删除</button></div>
      </li>)}</ul></> : null}
    </section>}
    </div>
    {deleteTarget ? <ConfirmDialog title="删除知识脉络？" confirmLabel="确认删除" busy={remove.isPending} error={remove.isError ? errorText(remove.error) : ""} onCancel={() => { setDeleteTarget(null); remove.reset(); }} onConfirm={() => void confirmDelete()}><p>即将删除「{deleteTarget.title}」。删除后不可恢复。</p>{activeStatus(deleteTarget.status) ? <p>这条脉络仍在生成中，删除后会终止展示，生成结果也不会保留。尚未开始的任务会返还次数；已经开始的任务仍会消耗原次数。</p> : null}</ConfirmDialog> : null}
    {pendingLeave ? <ConfirmDialog title="放弃未保存的修改？" confirmLabel="放弃修改" cancelLabel="继续编辑" onCancel={() => setPendingLeave(null)} onConfirm={() => { const action = pendingLeave.action; setPendingLeave(null); action(); }}><p>当前修改尚未保存。放弃后将保留上次保存的内容。</p></ConfirmDialog> : null}
  </section>;
}
