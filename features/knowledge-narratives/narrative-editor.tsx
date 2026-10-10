"use client";

import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError } from "@/features/checkins/api";
import { narrativeResultSchema, type KnowledgeNarrative, type LegacyNarrativeResult } from "@/lib/domain/knowledge-narrative";
import { updateNarrative } from "./api";
import { KnowledgeMapEditor } from "./knowledge-map-editor";

export type EditorProps = {
  narrative: KnowledgeNarrative;
  onSaved: (value: KnowledgeNarrative) => void | Promise<void>;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void;
};

export function NarrativeEditor(props: EditorProps) {
  const result = props.narrative.result;
  if (!result) return null;
  return "schemaVersion" in result
    ? <KnowledgeMapEditor {...props} result={result} />
    : <LegacyNarrativeEditor {...props} result={result} />;
}

function LegacyNarrativeEditor({ narrative, result, onSaved, onCancel, onDirtyChange, onSavingChange }: EditorProps & { result: LegacyNarrativeResult }) {
  // Keep the revision that this draft was based on, even if a background read finds a newer one.
  const [base] = useState(() => ({ result: structuredClone(result), updatedAt: narrative.updatedAt }));
  const [draft, setDraft] = useState<LegacyNarrativeResult>(() => structuredClone(base.result));
  const [validationError, setValidationError] = useState("");
  const save = useMutation({ mutationFn: updateNarrative, onSuccess: onSaved });
  const dirty = JSON.stringify(draft) !== JSON.stringify(base.result);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => onSavingChange(save.isPending), [save.isPending, onSavingChange]);

  function change(next: LegacyNarrativeResult) { setDraft(next); setValidationError(""); save.reset(); }
  function field(id: string, label: string, value: string, maxLength: number, update: (value: string) => void, rows?: number) {
    return <div className="narrative-editor-field"><label htmlFor={id}>{label}</label>{rows
      ? <textarea id={id} value={value} maxLength={maxLength} rows={rows} required onChange={event => update(event.target.value)} />
      : <input id={id} value={value} maxLength={maxLength} required onChange={event => update(event.target.value)} />}
    </div>;
  }
  const error = validationError || (save.isError ? save.error instanceof ApiError ? save.error.message : "保存失败，请稍后重试。当前修改已保留。" : "");

  return <form className="narrative-editor" aria-label="编辑知识脉络" onSubmit={event => {
    event.preventDefault();
    if (save.isPending) return;
    const checked = narrativeResultSchema.safeParse(draft);
    if (!checked.success) { setValidationError("请检查文本内容是否填写完整，并遵守字数限制。"); return; }
    save.mutate({ id: narrative.id, result: checked.data, expectedUpdatedAt: base.updatedAt });
  }}>
    <div className="narrative-editor-heading"><div><p className="eyebrow">整理你的理解</p><h2>编辑知识脉络</h2><p className="knowledge-muted">编辑后直接保存，不消耗生成额度。引用日期与来源快照保留。</p></div><span className="narrative-editor-state">{dirty ? "有未保存修改" : "已与保存内容一致"}</span></div>
    <div className="narrative-editor-layout">
      <nav className="narrative-editor-nav" aria-label="编辑内容导航"><a href="#edit-overview">名称与总览</a><a href="#edit-nodes">日期节点</a><a href="#edit-connections">节点联系</a><a href="#edit-sections">叙事章节</a><a href="#edit-framework">知识框架</a><a href="#edit-exploration">继续探索</a></nav>
      <fieldset disabled={save.isPending} className="narrative-editor-fields">
        <section id="edit-overview"><h3>名称与总览</h3>
          {field("edit-title", "脉络名称", draft.title, 120, title => change({ ...draft, title }))}
          {field("edit-overview-text", "总览", draft.overview, 1500, overview => change({ ...draft, overview }), 5)}
        </section>
        <section id="edit-nodes"><h3>日期节点</h3>{draft.nodes.map((node, index) => <div className="narrative-editor-item" key={node.date}><p className="narrative-editor-citations"><time>{node.date}</time></p>
          {field(`edit-node-${index}-label`, `${node.date} 节点标签`, node.label, 20, label => change({ ...draft, nodes: draft.nodes.map((item, i) => i === index ? { ...item, label } : item) }))}
          {field(`edit-node-${index}-takeaway`, `${node.date} 节点要点`, node.takeaway, 300, takeaway => change({ ...draft, nodes: draft.nodes.map((item, i) => i === index ? { ...item, takeaway } : item) }), 3)}
        </div>)}</section>
        <section id="edit-connections"><h3>节点联系</h3>{draft.connections.map((connection, index) => <div className="narrative-editor-item" key={`${connection.fromDate}-${connection.toDate}`}><p className="narrative-editor-citations">{connection.fromDate} → {connection.toDate}</p>
          <div className="narrative-editor-field"><label htmlFor={`edit-relation-${index}`}>联系 {index + 1} 关系</label><select id={`edit-relation-${index}`} value={connection.relation} onChange={event => change({ ...draft, connections: draft.connections.map((item, i) => i === index ? { ...item, relation: event.target.value as typeof connection.relation } : item) })}>{["递进", "补充", "对照", "应用", "弱关联"].map(relation => <option key={relation}>{relation}</option>)}</select></div>
          {field(`edit-connection-${index}`, `联系 ${index + 1} 说明`, connection.explanation, 500, explanation => change({ ...draft, connections: draft.connections.map((item, i) => i === index ? { ...item, explanation } : item) }), 3)}
        </div>)}</section>
        {([['sections', '叙事章节'], ['framework', '知识框架']] as const).map(([key, title]) => <section id={`edit-${key}`} key={key}><h3>{title}</h3>{draft[key].map((section, index) => <div className="narrative-editor-item" key={index}><p className="narrative-editor-citations">引用日期：{section.sourceDates.join("、")}</p>
          {field(`edit-${key}-${index}-title`, `${title} ${index + 1} 标题`, section.title, 100, title => change({ ...draft, [key]: draft[key].map((item, i) => i === index ? { ...item, title } : item) }))}
          {field(`edit-${key}-${index}-body`, `${title} ${index + 1} 正文`, section.body, 2500, body => change({ ...draft, [key]: draft[key].map((item, i) => i === index ? { ...item, body } : item) }), 7)}
        </div>)}</section>)}
        <section id="edit-exploration"><h3>继续探索</h3>
          {!draft.gaps.length ? <p className="knowledge-muted">这条脉络暂未列出待探索问题。</p> : null}
          {draft.gaps.map((gap, index) => <div key={`gap-${index}`}>{field(`edit-gap-${index}`, `待探索问题 ${index + 1}`, gap, 500, value => change({ ...draft, gaps: draft.gaps.map((item, i) => i === index ? value : item) }), 3)}</div>)}
          {draft.nextSteps.map((step, index) => <div key={`step-${index}`}>{field(`edit-step-${index}`, `下一步 ${index + 1}`, step, 500, value => change({ ...draft, nextSteps: draft.nextSteps.map((item, i) => i === index ? value : item) }), 3)}</div>)}
        </section>
      </fieldset>
    </div>
    <div className="narrative-editor-footer">{error ? <p className="knowledge-error" role="alert">{error}</p> : null}<div className="knowledge-actions"><button className="primary-button" type="submit" disabled={!dirty || save.isPending}>{save.isPending ? "正在保存…" : "保存修改"}</button><button className="secondary-button" type="button" disabled={save.isPending} onClick={onCancel}>取消编辑</button></div></div>
  </form>;
}
