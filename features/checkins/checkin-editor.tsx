"use client";

import {
  ArrowRight,
  Check,
  FileText,
  Link2,
  PenLine,
  Pencil,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { ActiveAiJob } from "@/features/ai-generation/types";
import type { AiGenerationController } from "@/features/ai-generation/use-ai-generation";
import type { DraftStorageState } from "@/features/drafts/use-checkin-draft";
import { aiSourceFragmentNotice } from "@/lib/domain/ai-generation";
import { parseKnowledgeSummary } from "@/lib/domain/knowledge-summary";
import type { CheckInEntryMode } from "@/lib/domain/checkin";
import { sameAiGenerationContext, type AiGenerationContext } from "@/lib/domain/ai-prompt";
import { AiPromptInput } from "./ai-prompt-input";
import { formatDate } from "./dates";
import { ImageNoteUploader, type ImageSelection } from "./image-note-uploader";
import { SummaryEditor } from "./summary-editor";
import { KnowledgeSummaryView } from "./knowledge-summary-view";
import { LearningReflectionsEditor } from "./learning-reflections";
import type { CheckInRecord } from "./types";

export type CheckInDraft = {
  attention: string;
  sourceUrl: string;
  userPrompt?: string;
  aiGenerationContext?: AiGenerationContext | null;
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
    userPrompt: record?.entryMode === "ai" ? record.userPrompt ?? "" : "",
    aiGenerationContext: record?.entryMode === "ai" ? record.aiGenerationContext ?? null : null,
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
    (draft.userPrompt ?? "") !== (record?.userPrompt ?? "") ||
    !sameAiGenerationContext(draft.aiGenerationContext, record?.aiGenerationContext) ||
    draft.summary !== (record?.summary ?? "") ||
    draft.inspiration !== (record?.inspiration ?? "") ||
    draft.imageFile !== null ||
    draft.removeImage
  );
}

type CheckInEditorProps = {
  entryMode?: CheckInEntryMode;
  onEntryModeChange?: (mode: CheckInEntryMode) => void;
  aiActiveJob: ActiveAiJob | null;
  aiError: string;
  aiIsLongRunning: boolean;
  aiQuotaRemaining: number | null;
  aiStage: AiGenerationController["stage"];
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
  onAiCancel: () => void;
  onAiGenerate: () => void;
  onImageChange: (selection: ImageSelection, date: string) => void | Promise<void>;
  onImageError: (message: string) => void;
  onImagePreparationChange: (isPreparing: boolean, date: string) => void;
  onReset: () => void | Promise<void>;
  onRetryRecord: () => void;
  onRetryDraft?: () => void;
  onSubmit: () => void | Promise<unknown>;
};

export function CheckInEditor({
  entryMode: controlledEntryMode,
  onEntryModeChange,
  aiActiveJob,
  aiError,
  aiIsLongRunning,
  aiQuotaRemaining,
  aiStage,
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
  onAiCancel,
  onAiGenerate,
  onImageChange,
  onImageError,
  onImagePreparationChange,
  onReset,
  onRetryRecord,
  onRetryDraft,
  onSubmit,
}: CheckInEditorProps) {
  const [localEntryMode, setLocalEntryMode] = useState<CheckInEntryMode>("manual");
  const entryMode = controlledEntryMode ?? localEntryMode;
  const setEntryMode = onEntryModeChange ?? setLocalEntryMode;
  const imageIdentity = `${date}:${entryMode}`;
  const [summaryView, setSummaryView] = useState({ date, editing: false, hidden: false });
  const summaryEditing = summaryView.date === date && summaryView.editing;
  const summaryHidden = summaryView.date === date && summaryView.hidden;
  const reflectionPrompts = useMemo(() => parseKnowledgeSummary(draft.summary).prompts, [draft.summary]);

  const canSave = Boolean(draft.attention.trim());
  const state = isPreparingImage ? "正在整理图片" : isDirty ? "未保存" : record ? "已保存" : isLoading ? "正在读取" : "待填写";
  const isDisabled = isLoading || isSaving || isCleaningUpImage || isPreparingImage;
  const isUploaderDisabled =
    isSaving ||
    isCleaningUpImage ||
    (isLoading && !isPreparingImage);
  const localDraftUnavailable = isDirty && draftStorageState === "unavailable";
  const draftBlocked = draftStorageState === "blocked";
  const isAiActive = aiActiveJob !== null || aiStage === "creating";
  const fragmentNotice = aiSourceFragmentNotice(draft.sourceUrl);
  const aiProgressMessage = aiIsLongRunning
    ? "处理时间比预期更长，任务仍在继续"
    : aiStage === "creating"
      ? "正在创建生成任务…"
      : aiStage === "queued"
        ? "任务已排队，马上开始读取资料"
        : aiStage === "fetching"
          ? "正在安全读取并整理资料…"
          : aiStage === "generating"
            ? "DeepSeek 正在思考并生成小结…"
            : aiStage === "retrying"
              ? "服务暂时繁忙，正在自动重试…"
              : aiError;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSubmit();
  }

  return (
    <section aria-labelledby="editor-title" className={`editor-section${entryMode === "ai" ? " ai-reader-editor" : ""}`} id="entry-editor">
      <div className="editor-heading-bar">
        <div className="editor-heading-copy">
          <p className="eyebrow editor-date">{formatDate(date)}</p>
          <h2 id="editor-title">{record ? "回看这一天的收获" : "记录这一天的收获"}</h2>
          <p className="section-description">
            {entryMode === "ai"
              ? "让 AI 梳理知识骨架，再写下自己的理解与收获"
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
            <small>沿资料主线梳理知识</small>
          </span>
        </button>
      </div>

      <p className="entry-mode-note">手动记录与 AI 提炼分别保存，切换后可继续各自的内容。</p>

      {draftBlocked ? (
        <div className="editor-load-error entry-mode-recovery" role="alert">
          <p>当前草稿被旧标签页占用，暂时无法切换。请刷新或关闭其他标签页后重试。</p>
          {onRetryDraft ? <button onClick={onRetryDraft} type="button">重试草稿恢复</button> : null}
        </div>
      ) : isLoading && !loadError ? (
        <p className="entry-mode-note" role="status">正在恢复当前记录与草稿，完成后即可切换方式。</p>
      ) : null}

      <form aria-busy={isDisabled} className="checkin-form" onSubmit={submit}>
        {entryMode === "manual" ? (
          <div className="manual-entry">
            <div className="manual-core-fields">
              <label htmlFor="attention">
                <span className="label-row">
                  <b>今日知识主题</b>
                  <em>必填</em>
                </span>
                <span className="field-hint">用一句话总结当天学习的内容</span>
                <input
                  aria-label="今日知识主题"
                  disabled={isDisabled}
                  id="attention"
                  maxLength={120}
                  onChange={(event) => onDraftChange({ attention: event.target.value })}
                  placeholder="例如：理解了 Transformer 中的注意力机制"
                  value={draft.attention}
                />
                <span className="character-count">{draft.attention.length}/120</span>
              </label>

              <div className="summary-field">
                <label htmlFor="summary">
                  <span className="label-row"><b>知识小结</b></span>
                  <span className="field-hint">先写主要骨架，再沿着它解释概念和关系</span>
                </label>
                <SummaryEditor
                  disabled={isDisabled}
                  id="summary"
                  maxLength={5000}
                  onChange={(summary) => onDraftChange({ summary })}
                  placeholder="今天真正理解了什么？试着用自己的话讲一遍。"
                  value={draft.summary}
                />
                <span className="character-count">{draft.summary.length}/5000</span>
              </div>
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
                <span>可选 · 为这次学习留下出处、图像与延伸想法</span>
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
                  identity={imageIdentity}
                  onChange={(selection) => onImageChange(selection, imageIdentity)}
                  onError={onImageError}
                  onPreparationChange={(isPreparing) => onImagePreparationChange(isPreparing, imageIdentity)}
                  isPreparing={isPreparingImage}
                  removeImage={draft.removeImage}
                />

                <LearningReflectionsEditor
                  key={`manual-${date}`}
                  disabled={isDisabled}
                  value={draft.inspiration}
                  onChange={(inspiration) => onDraftChange({ inspiration })}
                />
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
                  <small>支持网页文章、文字教程与知识笔记；暂不解析视频或音频。</small>
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
                  disabled={isDisabled || isAiActive}
                  onChange={(event) => {
                    onDraftChange({ sourceUrl: event.target.value });
                  }}
                  placeholder="粘贴文章或文字知识点的网页链接"
                  aria-describedby={fragmentNotice ? "ai-source-fragment-notice" : undefined}
                  type="url"
                  value={draft.sourceUrl}
                />
              </label>
              {fragmentNotice ? (
                <p className="ai-notice" id="ai-source-fragment-notice" role="status">
                  {fragmentNotice}
                </p>
              ) : null}
              <AiPromptInput
                key={imageIdentity}
                value={draft.userPrompt ?? ""}
                onChange={userPrompt => onDraftChange({ userPrompt })}
                disabled={isDisabled || isAiActive}
                generationContext={draft.aiGenerationContext}
                hasSummary={Boolean(draft.summary.trim())}
              />
              <div className="ai-generate-row">
                <button
                  className="ai-generate-button"
                  disabled={isDisabled || isOffline || isAiActive || !draft.sourceUrl.trim()}
                  onClick={onAiGenerate}
                  type="button"
                >
                  <Sparkles aria-hidden="true" size={17} />
                  {aiStage === "creating" ? "正在创建…" : isAiActive ? "生成中…" : "生成知识小结"}
                </button>
                <span>
                  {aiQuotaRemaining === null
                    ? "本账号每天共 5 次，提炼与串联共享"
                    : `本次提炼提交后，共享额度剩余 ${aiQuotaRemaining} 次`}
                </span>
              </div>
              <p className="field-hint">按实际请求当天计数，北京时间 0 点重置；切换日历日期不会增加次数。</p>
              {aiProgressMessage ? (
                <p className="ai-notice" role={aiError ? "alert" : "status"}>
                  {aiProgressMessage}
                  {isAiActive && aiStage === "queued" ? (
                    <button onClick={onAiCancel} type="button">取消任务</button>
                  ) : null}
                </p>
              ) : null}
            </section>

            <section aria-labelledby="ai-result-title" className="ai-result-step" id="learning-summary-content" hidden={summaryHidden}>
              <div className="ai-step-heading">
                <span aria-hidden="true"><FileText size={18} /></span>
                <div>
                  <p>STEP 02</p>
                  <h3 id="ai-result-title">知识骨架</h3>
                  <small>先看主要结构，再沿着节点读解释</small>
                </div>
                <button
                  className="summary-edit-toggle"
                  type="button"
                  disabled={isDisabled}
                  onClick={() => setSummaryView({ date, hidden: false, editing: !summaryEditing })}
                >
                  {summaryEditing ? <Check aria-hidden="true" size={16} /> : <Pencil aria-hidden="true" size={16} />}
                  {summaryEditing ? "完成编辑" : "编辑总结"}
                </button>
              </div>
              <div className="ai-result-fields">
                {summaryEditing || !draft.summary.trim() ? (
                <label htmlFor="attention">
                  <span className="label-row">
                    <b>今日知识主题</b>
                    <em>必填</em>
                  </span>
                  <input
                    aria-label="今日知识主题"
                    disabled={isDisabled}
                    id="attention"
                    maxLength={120}
                    onChange={(event) => onDraftChange({ attention: event.target.value })}
                    placeholder="AI 将为这次学习生成一句话标题"
                    value={draft.attention}
                  />
                  <span className="character-count">{draft.attention.length}/120</span>
                </label>
                ) : <h4 className="knowledge-title">{draft.attention || "本次学习的知识小结"}</h4>}
                {summaryEditing ? (
                <div className="summary-field">
                  <label htmlFor="summary">
                    <span className="label-row"><b>知识小结</b></span>
                  </label>
                  <span className="field-hint learning-hint">一句话主旨 → 主要骨架 → 沿骨架展开 → 关键辨析</span>
                  <SummaryEditor
                    disabled={isDisabled}
                    id="summary"
                    maxLength={5000}
                    onChange={(summary) => onDraftChange({ summary })}
                    placeholder="AI 将先梳理资料的主要骨架，再沿着它解释知识点之间的关系。"
                    value={draft.summary}
                  />
                  <span className="character-count">{draft.summary.length}/5000</span>
                </div>
                ) : <KnowledgeSummaryView key={date} value={draft.summary} />}
              </div>
            </section>

            <div className="ai-supporting-fields">
              <LearningReflectionsEditor
                key={`ai-${date}`}
                disabled={isDisabled}
                value={draft.inspiration}
                prompts={reflectionPrompts}
                polishContext={{ topic: draft.attention, summary: draft.summary }}
                polishDisabled={isOffline || isAiActive}
                summaryVisible={!summaryHidden}
                onToggleSummary={() => setSummaryView({ date, editing: summaryEditing, hidden: !summaryHidden })}
                onChange={(inspiration) => onDraftChange({ inspiration })}
              />
              <ImageNoteUploader
                disabled={isUploaderDisabled}
                existingImage={record ? { imageName: record.imageName, imageUrl: record.imageUrl } : null}
                file={draft.imageFile}
                identity={imageIdentity}
                onChange={(selection) => onImageChange(selection, imageIdentity)}
                onError={onImageError}
                onPreparationChange={(isPreparing) => onImagePreparationChange(isPreparing, imageIdentity)}
                isPreparing={isPreparingImage}
                removeImage={draft.removeImage}
              />
            </div>
          </div>
        )}

        <div className="form-actions" data-testid="checkin-actions">
          <div className="action-buttons">
            <button aria-label={isSaving ? "正在保存" : record ? "保存修改" : "保存记录，完成打卡"} className="primary-button" disabled={isDisabled || isOffline || !canSave} type="submit">
              {isSaving ? "正在保存…" : record ? "保存修改" : "保存记录"}
              <ArrowRight aria-hidden="true" size={18} />
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
            <span aria-live="polite" className={`save-message ${localDraftUnavailable || draftBlocked ? "error" : messageTone}`} role="status">
              {draftBlocked
                ? "另一个标签页正在使用旧版草稿，请刷新或关闭后重试。"
                : localDraftUnavailable
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
