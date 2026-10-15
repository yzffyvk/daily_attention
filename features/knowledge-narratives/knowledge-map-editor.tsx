"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ApiError } from "@/features/checkins/api";
import { validateNarrativeResult } from "@/lib/domain/knowledge-narrative";
import { sourceReferences, type AnyConceptMapResult, type KnowledgeMapResult } from "@/lib/domain/knowledge-map";
import { updateNarrative } from "./api";
import type { EditorProps } from "./narrative-editor";

function TextField({ id, label, value, maxLength, rows, onChange }: {
  id: string; label: string; value: string; maxLength: number; rows?: number; onChange: (value: string) => void;
}) {
  return <div className="narrative-editor-field"><label htmlFor={id}>{label}</label>{rows
    ? <textarea id={id} value={value} maxLength={maxLength} rows={rows} required onChange={event => onChange(event.target.value)} />
    : <input id={id} value={value} maxLength={maxLength} required onChange={event => onChange(event.target.value)} />}</div>;
}

function ConceptFields({ draft, change, sourceLabels }: { draft: AnyConceptMapResult; change: (result: AnyConceptMapResult) => void; sourceLabels: Map<string,string> }) {
  function changeConcept(id: string, patch: {label?:string;explanation?:string;supplementReason?:string}) {
    if(draft.schemaVersion===3) change({...draft,concepts:draft.concepts.map(item=>item.id===id?{...item,...patch}:item)});
    else change({...draft,concepts:draft.concepts.map(item=>item.id===id?{...item,...patch}:item)});
  }
  function changeConnection(index:number, patch:{relation?:string;explanation?:string}) {
    if(draft.schemaVersion===3) change({...draft,connections:draft.connections.map((item,i)=>i===index?{...item,...patch}:item)});
    else change({...draft,connections:draft.connections.map((item,i)=>i===index?{...item,...patch}:item)});
  }
  const labels = new Map(draft.concepts.map(concept => [concept.id, concept.label]));
  return <>
    <section id="map-edit-overview"><h3>问题与主线</h3>
      <TextField id="map-edit-question" label="核心问题" value={draft.focusQuestion} maxLength={300} rows={2} onChange={focusQuestion => change({ ...draft, focusQuestion })} />
      <TextField id="map-edit-summary" label="总览" value={draft.overview} maxLength={1500} rows={4} onChange={overview => change({ ...draft, overview })} />
    </section>
    <section id="map-edit-branches"><h3>知识主干</h3>{draft.branches.map((branch, index) => <div className="narrative-editor-item" key={branch.id}>
      <TextField id={`map-branch-${index}-title`} label={`主干 ${index + 1} 名称`} value={branch.title} maxLength={40} onChange={title => change({ ...draft, branches: draft.branches.map(item => item.id === branch.id ? { ...item, title } : item) })} />
      <TextField id={`map-branch-${index}-summary`} label={`主干 ${index + 1} 结论`} value={branch.summary} maxLength={300} rows={3} onChange={summary => change({ ...draft, branches: draft.branches.map(item => item.id === branch.id ? { ...item, summary } : item) })} />
    </div>)}</section>
    <section id="map-edit-concepts"><h3>概念与解释</h3>{draft.concepts.map((concept, index) => <div className="narrative-editor-item" key={concept.id}>
      <p className="narrative-editor-citations">{concept.origin === "ai_supplement" ? "AI 补充 · 不属于原始记录" : `记录来源：${sourceReferences(concept).map(id=>sourceLabels.get(id)??id).join("、")}`}</p>
      <TextField id={`map-concept-${index}-label`} label={`概念 ${index + 1} 名称`} value={concept.label} maxLength={40} onChange={label => changeConcept(concept.id, { label })} />
      <TextField id={`map-concept-${index}-explanation`} label={`概念 ${index + 1} 解释`} value={concept.explanation} maxLength={1000} rows={4} onChange={explanation => changeConcept(concept.id, { explanation })} />
      {concept.origin === "ai_supplement" ? <TextField id={`map-concept-${index}-reason`} label={`概念 ${index + 1} 补充原因`} value={concept.supplementReason} maxLength={300} rows={2} onChange={supplementReason => changeConcept(concept.id, { supplementReason })} /> : null}
    </div>)}</section>
    <section id="map-edit-connections"><h3>关键关系</h3>{draft.connections.map((edge, index) => <div className="narrative-editor-item" key={`${edge.fromId}:${edge.toId}`}>
      <p>{labels.get(edge.fromId)} → {labels.get(edge.toId)}</p>
      <p className="narrative-editor-citations">{edge.origin === "ai_supplement" ? "AI 补充" : `${edge.origin === "inference" ? "AI 归纳" : "记录依据"}：${sourceReferences(edge).map(id=>sourceLabels.get(id)??id).join("、")}`}</p>
      <TextField id={`map-edge-${index}-relation`} label={`关系 ${index + 1} 连接词`} value={edge.relation} maxLength={40} onChange={relation => changeConnection(index, { relation })} />
      <TextField id={`map-edge-${index}-explanation`} label={`关系 ${index + 1} 解释`} value={edge.explanation} maxLength={500} rows={3} onChange={explanation => changeConnection(index, { explanation })} />
    </div>)}</section>
    <section id="map-edit-outline"><h3>表达提纲</h3>{draft.outline.map((step, index) => <div className="narrative-editor-item" key={index}>
      <p className="narrative-editor-citations">围绕：{step.conceptIds.map(id => labels.get(id)).join("、")}</p>
      <TextField id={`map-outline-${index}-title`} label={`表达步骤 ${index + 1} 标题`} value={step.title} maxLength={100} onChange={title => change({ ...draft, outline: draft.outline.map((item, i) => i === index ? { ...item, title } : item) })} />
      <TextField id={`map-outline-${index}-body`} label={`表达步骤 ${index + 1} 内容`} value={step.body} maxLength={1500} rows={4} onChange={body => change({ ...draft, outline: draft.outline.map((item, i) => i === index ? { ...item, body } : item) })} />
    </div>)}</section>
    {draft.gaps.length ? <section id="map-edit-gaps"><h3>待探索的部分</h3>{draft.gaps.map((gap, index) => <TextField key={index} id={`map-gap-${index}`} label={`待探索问题 ${index + 1}`} value={gap} maxLength={500} rows={3} onChange={value => change({ ...draft, gaps: draft.gaps.map((item, i) => i === index ? value : item) })} />)}</section> : null}
  </>;
}

export function KnowledgeMapEditor({ narrative, result, onSaved, onCancel, onDirtyChange, onSavingChange }: EditorProps & { result: KnowledgeMapResult }) {
  const [base] = useState(() => ({ result: structuredClone(result), updatedAt: narrative.updatedAt }));
  const [draft, setDraft] = useState<KnowledgeMapResult>(() => structuredClone(base.result));
  const [validationError, setValidationError] = useState("");
  const save = useMutation({ mutationFn: updateNarrative, onSuccess: onSaved });
  const dirty = JSON.stringify(draft) !== JSON.stringify(base.result);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => onSavingChange(save.isPending), [save.isPending, onSavingChange]);
  function change(next: KnowledgeMapResult) { setDraft(next); setValidationError(""); save.reset(); }
  const error = validationError || (save.isError ? save.error instanceof ApiError ? save.error.message : "保存失败，请稍后重试。当前修改已保留。" : "");

  return <form className="narrative-editor" aria-label="编辑知识脉络" onSubmit={event => {
    event.preventDefault(); if (save.isPending) return;
    try {
      const checked = validateNarrativeResult(draft, narrative.dates, narrative.sources.flatMap(source=>source.id?[source.id]:[]));
      save.mutate({ id: narrative.id, result: checked, expectedUpdatedAt: base.updatedAt });
    } catch { setValidationError("请检查内容是否填写完整。概念关系、补充标记和来源引用需要保持有效。"); }
  }}>
    <div className="narrative-editor-heading"><div><p className="eyebrow">整理你的理解</p><h2>编辑知识脉络</h2><p className="knowledge-muted">{draft.mode === "concept_map" ? "修改概念解释与表达提纲，保留概念关系、来源和 AI 补充标记。" : "可以修改脉络名称。原始内容保留生成时的快照，请回到学习记录中修改笔记。"}</p></div><span className="narrative-editor-state">{dirty ? "有未保存修改" : "已与保存内容一致"}</span></div>
    <div className="narrative-editor-layout">
      <nav className="narrative-editor-nav" aria-label="编辑内容导航"><a href="#map-edit-title">脉络名称</a>{draft.mode === "concept_map" ? <><a href="#map-edit-overview">问题与主线</a><a href="#map-edit-branches">知识主干</a><a href="#map-edit-concepts">概念与解释</a><a href="#map-edit-connections">关键关系</a><a href="#map-edit-outline">表达提纲</a>{draft.gaps.length ? <a href="#map-edit-gaps">待探索的部分</a> : null}</> : null}</nav>
      <fieldset disabled={save.isPending} className="narrative-editor-fields">
        <section id="map-edit-title"><h3>脉络名称</h3><TextField id="map-title" label="脉络名称" value={draft.title} maxLength={120} onChange={title => change({ ...draft, title })} /></section>
        {draft.mode === "concept_map" ? <ConceptFields draft={draft} change={change} sourceLabels={new Map(narrative.sources.flatMap(source=>source.id?[[source.id,`${source.date} · ${source.attention}`]]:[]))} /> : null}
      </fieldset>
    </div>
    <div className="narrative-editor-footer">{error ? <p className="knowledge-error" role="alert">{error}</p> : null}<div className="knowledge-actions"><button className="primary-button" type="submit" disabled={!dirty || save.isPending}>{save.isPending ? "正在保存…" : "保存修改"}</button><button className="secondary-button" type="button" disabled={save.isPending} onClick={onCancel}>取消编辑</button></div></div>
  </form>;
}
