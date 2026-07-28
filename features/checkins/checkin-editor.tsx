"use client";

import {
  Check,
  FileText,
  Link2,
  PenLine,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import type { DraftStorageState } from "@/features/drafts/use-checkin-draft";
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
  isCleaningUpImage: boolean;
  isPreparingImage: boolean;
  isRetryingRecord: boolean;
  isOffline: boolean;
  draftStorageState: DraftStorageState;
  loadError: string;
  message: string;
  messageTone: MessageTone;
  onDraftChange: (change: Partial<CheckInDraft>) => void;
  onImageChange: (selection: ImageSelection, date: string) => void | Promise<void>;
  onImageError: (message: string) => void;
  onImagePreparationChange: (isPreparing: boolean, date: string) => void;
  onReset: () => void | Promise<void>;
  onRetryRecord: () => void;
  onSubmit: () => void | Promise<unknown>;
};

export function CheckInEditor({
  date,
  record,
  draft,
  isDirty,
  isLoading,
  isSaving,
  isCleaningUpImage,
  isPreparingImage,
  isRetryingRecord,
  isOffline,
  draftStorageState,
  loadError,
  message,
  messageTone,
  onDraftChange,
  onImageChange,
  onImageError,
  onImagePreparationChange,
  onReset,
  onRetryRecord,
  onSubmit,
}: CheckInEditorProps) {
  const [entryMode, setEntryMode] = useState<"manual" | "ai">("manual");
  const [aiNotice, setAiNotice] = useState<{ date: string; message: string } | null>(null);

  const canSave = Boolean(draft.attention.trim());
  const state = isPreparingImage ? "正在整理图片" : isDirty ? "未保存" : record ? "已保存" : isLoading ? "正在读取" : "待填写";
  const isDisabled = isLoading || isSaving || isCleaningUpImage || isPreparingImage;
  const isUploaderDisabled =
    isSaving ||
    isCleaningUpImage ||
    (isLoading && !isPreparingImage);
  const localDraftUnavailable = isDirty && draftStorageState === "unavailable";

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
            {entryMode === "ai"
              ? "提供资料来源，让 AI 帮你提炼可复习的知识点"
              : record
                ? "回看并补充这一天的理解"
                : "从一句话开始，完成一次轻量复盘"}
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

      {loadError ? (
        <div className="editor-load-error" role="alert">
          <p>{loadError}</p>
          <button disabled={isRetryingRecord} onClick={onRetryRecord} type="button">
            {isRetryingRecord ? "正在重试…" : "重试"}
          </button>
        </div>
      ) : null}

      <div aria-label="选择打卡方式" className="entry-mode-switch" role="group">
        <button
          aria-pressed={entryMode === "manual"}
          className={entryMode === "manual" ? "active" : ""}
          disabled={isDisabled}
          onClick={() => setEntryMode("manual")}
          type="button"
        >
          <span aria-hidden="true"><PenLine size={18} /></span>
          <span>
            <strong>手动记录</strong>
            <small>自己整理知识小结</small>
          </span>
        </button>
        <button
          aria-pressed={entryMode === "ai"}
          className={entryMode === "ai" ? "active" : ""}
          disabled={isDisabled}
          onClick={() => setEntryMode("ai")}
          type="button"
        >
          <span aria-hidden="true"><Sparkles size={18} /></span>
          <span>
            <strong>AI 提炼</strong>
            <small>从学习资料生成小结</small>
          </span>
          <em>即将接入</em>
        </button>
      </div>

      <form aria-busy={isDisabled} className="checkin-form" onSubmit={submit}>
        {entryMode === "manual" ? (
          <div className="manual-entry">
            <div className="manual-core-fields">
              <label htmlFor="attention">
                <span className="label-row">
                  <b>今日 attention</b>
                  <em>必填</em>
                </span>
                <span className="field-hint">用一句话总结当天学习的内容</span>
                <input
                  aria-label="attention"
                  disabled={isDisabled}
                  id="attention"
                  maxLength={120}
                  onChange={(event) => onDraftChange({ attention: event.target.value })}
                  placeholder="例如：理解了 Transformer 中的注意力机制"
                  value={draft.attention}
                />
                <span className="character-count">{draft.attention.length}/120</span>
              </label>

              <label className="summary-field" htmlFor="summary">
                <span className="label-row"><b>学习知识点小结</b></span>
                <span className="field-hint">写下关键概念、你的理解，以及还没想明白的问题</span>
                <textarea
                  id="summary"
                  maxLength={5000}
                  disabled={isDisabled}
                  onChange={(event) => onDraftChange({ summary: event.target.value })}
                  placeholder="今天真正理解了什么？试着用自己的话讲一遍。"
                  value={draft.summary}
                />
                <span className="character-count">{draft.summary.length}/5000</span>
              </label>
            </div>

            <section
              aria-labelledby="manual-reference-title"
              className="manual-reference-section"
            >
              <div className="manual-reference-heading">
                <div>
                  <p>REFERENCE</p>
                  <h3 id="manual-reference-title">参考资料</h3>
                </div>
                <span>可选 · 为这次 attention 留下出处、图像与延伸想法</span>
              </div>

              <div className="manual-reference-grid">
                <label htmlFor="source-url">
                  <span className="label-row"><b>学习资料来源</b></span>
                  <span className="field-hint">文章、视频、课程或工具链接</span>
                  <input
                    id="source-url"
                    inputMode="url"
                    maxLength={2048}
                    disabled={isDisabled}
                    onChange={(event) => onDraftChange({ sourceUrl: event.target.value })}
                    placeholder="https://"
                    type="url"
                    value={draft.sourceUrl}
                  />
                </label>

                <ImageNoteUploader
                  disabled={isUploaderDisabled}
                  existingImage={record ? { imageName: record.imageName, imageUrl: record.imageUrl } : null}
                  file={draft.imageFile}
                  identity={date}
                  onChange={(selection) => onImageChange(selection, date)}
                  onError={onImageError}
                  onPreparationChange={(isPreparing) => onImagePreparationChange(isPreparing, date)}
                  isPreparing={isPreparingImage}
                  removeImage={draft.removeImage}
                />

                <label className="inspiration-field" htmlFor="inspiration">
                  <span className="label-row"><b>灵感记录</b></span>
                  <span className="field-hint">它让你联想到了什么？接下来想试试什么？</span>
                  <textarea
                    disabled={isDisabled}
                    id="inspiration"
                    maxLength={2000}
                    onChange={(event) => onDraftChange({ inspiration: event.target.value })}
                    placeholder="记下一闪而过的想法…"
                    value={draft.inspiration}
                  />
                  <span className="character-count">{draft.inspiration.length}/2000</span>
                </label>
              </div>
            </section>
          </div>
        ) : (
          <div className="ai-workflow">
            <section aria-labelledby="ai-source-title" className="ai-source-step">
              <div className="ai-step-heading">
                <span aria-hidden="true"><Link2 size={18} /></span>
                <div>
                  <p>STEP 01</p>
                  <h3 id="ai-source-title">提供学习资料</h3>
                  <small>支持文章、视频、课程或公开网页链接</small>
                </div>
              </div>
              <label htmlFor="source-url">
                <span className="label-row">
                  <b>学习资料来源</b>
                  <em>必填</em>
                </span>
                <input
                  id="source-url"
                  inputMode="url"
                  maxLength={2048}
                  disabled={isDisabled}
                  onChange={(event) => {
                    setAiNotice(null);
                    onDraftChange({ sourceUrl: event.target.value });
                  }}
                  placeholder="粘贴希望 AI 阅读的资料链接"
                  type="url"
                  value={draft.sourceUrl}
                />
              </label>
              <div className="ai-generate-row">
                <button
                  className="ai-generate-button"
                  disabled={isDisabled || !draft.sourceUrl.trim()}
                  onClick={() => {
                    setAiNotice({
                      date,
                      message: "AI 总结服务尚未接入，资料链接已保存在当前草稿中。",
                    });
                  }}
                  type="button"
                >
                  <Sparkles aria-hidden="true" size={17} />
                  生成知识小结
                </button>
                <span>本阶段仅完成前端流程</span>
              </div>
              {aiNotice?.date === date ? (
                <p className="ai-notice" role="status">{aiNotice.message}</p>
              ) : null}
            </section>

            <section aria-labelledby="ai-result-title" className="ai-result-step">
              <div className="ai-step-heading">
                <span aria-hidden="true"><FileText size={18} /></span>
                <div>
                  <p>STEP 02</p>
                  <h3 id="ai-result-title">审阅生成结果</h3>
                  <small>AI 接入后，标题与知识点会出现在这里，并支持继续修改</small>
                </div>
              </div>
              <div className="ai-result-fields">
                <label htmlFor="attention">
                  <span className="label-row">
                    <b>今日 attention</b>
                    <em>必填</em>
                  </span>
                  <input
                    aria-label="attention"
                    disabled={isDisabled}
                    id="attention"
                    maxLength={120}
                    onChange={(event) => onDraftChange({ attention: event.target.value })}
                    placeholder="AI 将为这次学习生成一句话标题"
                    value={draft.attention}
                  />
                  <span className="character-count">{draft.attention.length}/120</span>
                </label>
                <label className="summary-field" htmlFor="summary">
                  <span className="label-row"><b>学习知识点小结</b></span>
                  <textarea
                    id="summary"
                    maxLength={5000}
                    disabled={isDisabled}
                    onChange={(event) => onDraftChange({ summary: event.target.value })}
                    placeholder="AI 生成的核心知识点、概念解释和复习线索会显示在这里"
                    value={draft.summary}
                  />
                  <span className="character-count">{draft.summary.length}/5000</span>
                </label>
              </div>
            </section>

            <div className="ai-supporting-fields">
              <ImageNoteUploader
                disabled={isUploaderDisabled}
                existingImage={record ? { imageName: record.imageName, imageUrl: record.imageUrl } : null}
                file={draft.imageFile}
                identity={date}
                onChange={(selection) => onImageChange(selection, date)}
                onError={onImageError}
                onPreparationChange={(isPreparing) => onImagePreparationChange(isPreparing, date)}
                isPreparing={isPreparingImage}
                removeImage={draft.removeImage}
              />
              <label className="inspiration-field" htmlFor="inspiration">
                <span className="label-row"><b>补充你的灵感</b></span>
                <span className="field-hint">AI 负责提炼，你负责留下真正属于自己的联想</span>
                <textarea
                  disabled={isDisabled}
                  id="inspiration"
                  maxLength={2000}
                  onChange={(event) => onDraftChange({ inspiration: event.target.value })}
                  placeholder="读完这份总结，你还想到了什么？"
                  value={draft.inspiration}
                />
                <span className="character-count">{draft.inspiration.length}/2000</span>
              </label>
            </div>
          </div>
        )}

        <div className="form-actions" data-testid="checkin-actions">
          <div className="action-buttons">
            <button className="primary-button" disabled={isDisabled || isOffline || !canSave} type="submit">
              {isSaving ? "正在保存…" : record ? "保存修改" : <><span aria-hidden="true">叮</span>一下，完成打卡</>}
            </button>
            <button
              aria-label="还原未保存的修改"
              className="icon-button reset-button"
              disabled={!isDirty || isDisabled}
              onClick={() => void onReset()}
              title="还原未保存的修改"
              type="button"
            >
              <RotateCcw aria-hidden="true" size={18} />
            </button>
          </div>
          <div className="save-status">
            <span aria-live="polite" className={`save-message ${localDraftUnavailable ? "error" : messageTone}`} role="status">
              {localDraftUnavailable
                ? "浏览器草稿保存失败，请保持页面开启并尽快重试"
                : isOffline
                  ? "离线，内容已保存在此浏览器"
                  : isPreparingImage
                    ? "正在整理图片，请稍候"
                    : message || (isDirty ? "有修改尚未保存" : "已同步到云端")}
            </span>
            <small>云端记录</small>
          </div>
        </div>
      </form>
    </section>
  );
}
