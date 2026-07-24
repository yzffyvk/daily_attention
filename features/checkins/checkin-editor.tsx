"use client";

import { Check, RotateCcw } from "lucide-react";
import type { FormEvent } from "react";
import { formatDate } from "./dates";
import { ImageNoteUploader, type ImageSelection } from "./image-note-uploader";
import type { CheckInRecord } from "./types";

export type CheckInDraft = {
  attention: string;
  sourceUrl: string;
  summary: string;
  inspiration: string;
  imageFile: File | null;
  removeImage: boolean;
  uploadedImagePath: string | null;
};

export type MessageTone = "neutral" | "success" | "error";

export function draftFromRecord(record: CheckInRecord | null | undefined): CheckInDraft {
  return {
    attention: record?.attention ?? "",
    sourceUrl: record?.sourceUrl ?? "",
    summary: record?.summary ?? "",
    inspiration: record?.inspiration ?? "",
    imageFile: null,
    removeImage: false,
    uploadedImagePath: null,
  };
}

export function isDraftDirty(draft: CheckInDraft, record: CheckInRecord | null | undefined) {
  return (
    draft.attention !== (record?.attention ?? "") ||
    draft.sourceUrl !== (record?.sourceUrl ?? "") ||
    draft.summary !== (record?.summary ?? "") ||
    draft.inspiration !== (record?.inspiration ?? "") ||
    draft.imageFile !== null ||
    draft.removeImage
  );
}

type CheckInEditorProps = {
  date: string;
  record: CheckInRecord | null | undefined;
  draft: CheckInDraft;
  isDirty: boolean;
  isLoading: boolean;
  isSaving: boolean;
  message: string;
  messageTone: MessageTone;
  onDraftChange: (change: Partial<CheckInDraft>) => void;
  onImageChange: (selection: ImageSelection, date: string) => void | Promise<void>;
  onImageError: (message: string) => void;
  onReset: () => void | Promise<void>;
  onSubmit: () => void | Promise<unknown>;
};

export function CheckInEditor({
  date,
  record,
  draft,
  isDirty,
  isLoading,
  isSaving,
  message,
  messageTone,
  onDraftChange,
  onImageChange,
  onImageError,
  onReset,
  onSubmit,
}: CheckInEditorProps) {
  const canSave = Boolean(draft.attention.trim());
  const state = isDirty ? "未保存" : record ? "已保存" : isLoading ? "正在读取" : "待填写";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSubmit();
  }

  return (
    <section aria-labelledby="editor-title" className="editor-section" id="entry-editor">
      <div className="editor-heading-bar">
        <div className="editor-heading-copy">
          <p className="eyebrow">DAILY ATTENTION</p>
          <h2 id="editor-title">{formatDate(date)}</h2>
          <p className="section-description">
            {record ? "回看并补充这一天的理解" : "从一句话开始，完成一次轻量复盘"}
          </p>
        </div>
        <div className="editor-statuses">
          <span className={`editor-state${isDirty ? " dirty" : ""}`}>{state}</span>
          <span className={`checkin-state${record ? " complete" : ""}`}>
            {record ? <Check aria-hidden="true" size={14} strokeWidth={3} /> : null}
            {record ? "已打卡" : "待打卡"}
          </span>
        </div>
      </div>

      <form aria-busy={isSaving} className="checkin-form" onSubmit={submit}>
        <div className="form-grid">
          <label htmlFor="attention">
            <span className="label-row">
              <b>今日 attention</b>
              <em>必填</em>
            </span>
            <span className="field-hint">用一句话总结当天学习的内容</span>
            <input
              aria-label="attention"
              disabled={isSaving}
              id="attention"
              maxLength={120}
              onChange={(event) => onDraftChange({ attention: event.target.value })}
              placeholder="例如：理解了 Transformer 中的注意力机制"
              value={draft.attention}
            />
            <span className="character-count">{draft.attention.length}/120</span>
          </label>

          <label htmlFor="source-url">
            <span className="label-row"><b>学习资料来源</b></span>
            <span className="field-hint">文章、视频、课程或工具链接</span>
            <input
              id="source-url"
              inputMode="url"
              maxLength={2048}
              disabled={isSaving}
              onChange={(event) => onDraftChange({ sourceUrl: event.target.value })}
              placeholder="https://"
              type="url"
              value={draft.sourceUrl}
            />
          </label>
        </div>

        <div className="reflection-layout">
          <label className="summary-field" htmlFor="summary">
            <span className="label-row"><b>学习知识点小结</b></span>
            <span className="field-hint">写下关键概念、你的理解，以及还没想明白的问题</span>
            <textarea
              id="summary"
              maxLength={5000}
              disabled={isSaving}
              onChange={(event) => onDraftChange({ summary: event.target.value })}
              placeholder="今天真正理解了什么？试着用自己的话讲一遍。"
              value={draft.summary}
            />
            <span className="character-count">{draft.summary.length}/5000</span>
          </label>

          <div className="secondary-fields">
            <ImageNoteUploader
              disabled={isSaving}
              existingImage={record ? { imageName: record.imageName, imageUrl: record.imageUrl } : null}
              file={draft.imageFile}
              identity={date}
              onChange={(selection) => onImageChange(selection, date)}
              onError={onImageError}
              removeImage={draft.removeImage}
            />

            <label className="inspiration-field" htmlFor="inspiration">
              <span className="label-row"><b>灵感记录</b></span>
              <span className="field-hint">它让你联想到了什么？接下来想试试什么？</span>
              <textarea
                disabled={isSaving}
                id="inspiration"
                maxLength={2000}
                onChange={(event) => onDraftChange({ inspiration: event.target.value })}
                placeholder="记下一闪而过的想法…"
                value={draft.inspiration}
              />
              <span className="character-count">{draft.inspiration.length}/2000</span>
            </label>
          </div>
        </div>

        <div className="form-actions">
          <div className="action-buttons">
            <button className="primary-button" disabled={isSaving || !canSave} type="submit">
              {isSaving ? "正在保存…" : record ? "保存修改" : <><span aria-hidden="true">叮</span>一下，完成打卡</>}
            </button>
            <button
              aria-label="还原未保存的修改"
              className="icon-button reset-button"
              disabled={!isDirty || isSaving}
              onClick={() => void onReset()}
              title="还原未保存的修改"
              type="button"
            >
              <RotateCcw aria-hidden="true" size={18} />
            </button>
          </div>
          <div className="save-status">
            <span aria-live="polite" className={`save-message ${messageTone}`} role="status">
              {message || (isDirty ? "有修改尚未保存" : "已同步到云端")}
            </span>
            <small>云端记录</small>
          </div>
        </div>
      </form>
    </section>
  );
}
