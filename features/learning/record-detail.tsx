'use client';
import { ArrowLeft, Check, ExternalLink, Plus, PenLine, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { normalizeLearningSourceUrl, type LearningAlbum, type LearningRecord } from '@/lib/domain/learning-record';
import type { ActiveAiJob } from '@/features/ai-generation/types';
import { useAiGeneration } from '@/features/ai-generation/use-ai-generation';
import { GenerationProgress } from '@/features/ai-generation/generation-progress';
import { CancellationDialog } from '@/features/ai-generation/cancellation-dialog';
import { AiPromptInput } from '@/features/checkins/ai-prompt-input';
import { SummaryEditor } from '@/features/checkins/summary-editor';
import { KnowledgeSummaryView } from '@/features/checkins/knowledge-summary-view';
import { LearningReflectionsEditor } from '@/features/checkins/learning-reflections';
import { ImageNoteUploader } from '@/features/checkins/image-note-uploader';
import { formatDate } from '@/features/checkins/dates';
import { parseKnowledgeSummary } from '@/lib/domain/knowledge-summary';
import { aiSourceFragmentNotice, aiGenerationErrorMessage, createAiGenerationSchema } from '@/lib/domain/ai-generation';
import { recordStateLabel, type LearningDraft } from './model';
export type LearningSaveFeedback = {
    kind: 'progress' | 'success' | 'error';
    status: 'pending' | 'completed';
    message: string;
};
type Props = {
    record: LearningRecord | null;
    draft: LearningDraft;
    albums: LearningAlbum[];
    duplicates?: LearningRecord[];
    onOpenRecord?: (record: LearningRecord) => void;
    saving: boolean;
    storageError: boolean;
    message: string;
    saveFeedback?: LearningSaveFeedback | null;
    onChange: (change: Partial<LearningDraft>) => void;
    onSave: (status: 'pending' | 'completed', options?: {entryMode:'ai'}) => Promise<LearningRecord | null> | void;
    onRefresh: () => void;
    onMove: (albumId: string | null) => void;
    onBack: () => void;
    onNewLink: () => void;
    onCreateAlbum: () => void;
    onCancel: () => void;
};
export function LearningRecordDetail({ record, draft, albums, duplicates = [], onOpenRecord, saving, storageError, message, saveFeedback, onChange, onSave, onRefresh, onMove, onBack, onNewLink, onCreateAlbum, onCancel }: Props) {
    const [editing, setEditing] = useState(!draft.summary);
    const [summaryVisible, setSummaryVisible] = useState(true);
    const [displayedJobId, setDisplayedJobId] = useState(draft.candidateJobId);
    if (displayedJobId !== draft.candidateJobId) {
        setDisplayedJobId(draft.candidateJobId);
        if (draft.candidateJobId) {
            setEditing(false);
            setSummaryVisible(true);
        }
    }
    const [preparingImage, setPreparingImage] = useState(false);
    const [localMessage, setLocalMessage] = useState('');
    const [starting, setStarting] = useState(false);
    const restoredJob = useMemo<ActiveAiJob | null>(() => record?.activeAiJobId ? { jobId: record.activeAiJobId, recordId: record.id, targetDate: record.date, sourceUrl: record.sourceUrl, userPrompt: record.userPrompt ?? '', createdAt: record.updatedAt } : null, [record]);
    const generation = useAiGeneration({ activeJob: restoredJob, onSucceeded: () => onRefresh(), onTerminal: () => onRefresh(), onActiveJobChange: () => onRefresh() });
    const active = Boolean(generation.activeJob) || generation.isCreating || starting;
    const hasGeneratedResult = Boolean(draft.candidateJobId);
    const aiTools = draft.entryMode === 'ai' || active || hasGeneratedResult;
    const stale = Boolean(record?.aiCandidate && (record.aiCandidate.baseVersion !== record.version || record.aiCandidate.sourceUrl !== normalizeLearningSourceUrl(record.sourceUrl)));
    const disabled = saving || preparingImage;
    const fragmentNotice = aiSourceFragmentNotice(draft.sourceUrl);
    const prompts = useMemo(() => parseKnowledgeSummary(draft.summary).prompts, [draft.summary]);
    const feedback = localMessage ? { kind: 'error' as const, message: localMessage } : saveFeedback;
    function saveRecord(status: 'pending' | 'completed') {
        setLocalMessage('');
        if (!draft.attention.trim() && (status === 'completed' || !draft.sourceUrl.trim())) {
            setLocalMessage('请填写学习主题后再保存。');
            return;
        }
        void onSave(status);
    }
    async function generate() {
        if (starting || active)
            return;
        if (!createAiGenerationSchema.shape.sourceUrl.safeParse(draft.sourceUrl).success) {
            setLocalMessage('AI 提炼需要可读取的 HTTP/HTTPS 网址。当前来源可以直接保存为学习记录。');
            return;
        }
        setStarting(true);
        setLocalMessage('');
        try {
            const saved = await onSave(record?.status ?? 'pending', {entryMode:'ai'});
            if (saved)
                await generation.generate({ recordId: saved.id, sourceUrl: saved.sourceUrl, targetDate: saved.date, userPrompt: draft.userPrompt ?? '' });
        }
        finally {
            setStarting(false);
            onRefresh();
        }
    }
    return <section className="learning-detail editor-section" aria-label="学习记录详情">
    <button className="learning-back" onClick={onBack} type="button"><ArrowLeft size={16}/>返回记录列表</button>
    <header className="learning-detail-heading"><div><p className="eyebrow">{formatDate(draft.date)}</p><h2>{record?.attention || '新的学习记录'}</h2></div><span className={`learning-state ${record?.status === 'completed' ? 'complete' : ''}`}>{record ? recordStateLabel(record) : '浏览器草稿'}</span></header>
    <p className="field-hint">{record ? '每条记录独立保存，整理完成后计入这一天的学习。' : '选择手动记录，或粘贴资料链接让 AI 提炼。'}</p>
    {stale ? <p className="learning-error" role="alert">记录已更新，这份提炼结果已过期。请取消本次编辑后重新提炼。</p> : null}
    {storageError ? <p className="learning-error" role="alert">浏览器草稿暂时无法保存。请保存到云端后再关闭页面。</p> : null}
    {message && !feedback ? <p className="learning-message" role="status">{message}</p> : null}
    <form className="checkin-form" onSubmit={event => { event.preventDefault(); saveRecord('completed'); }}>
      <div className="learning-entry-modes" role="group" aria-label="记录方式">
        <button type="button" aria-pressed={draft.entryMode === 'manual'} disabled={disabled || active || hasGeneratedResult} onClick={() => onChange({ entryMode: 'manual' })}><PenLine size={17}/>手动记录</button>
        <button type="button" aria-pressed={draft.entryMode === 'ai'} disabled={disabled || active || hasGeneratedResult} onClick={() => onChange({ entryMode: 'ai' })}><Sparkles size={17}/>AI 提炼</button>
      </div>
      <div className="learning-record-meta">
        <label><span className="label-row"><b>所属专辑</b><em>选填</em></span><select aria-label="所属专辑" value={record ? record.albumId ?? '' : draft.albumId ?? ''} disabled={disabled} onChange={event => onMove(event.target.value || null)}><option value="">未归类</option>{albums.map(album => <option key={album.id} value={album.id}>{album.name}</option>)}</select></label>
        <button className="secondary-button" disabled={disabled} type="button" onClick={onCreateAlbum}><Plus size={15}/>新建专辑</button>
      </div>
      <label><span className="label-row"><b>学习主题</b></span><input aria-label="学习主题" maxLength={120} disabled={disabled} value={draft.attention} onChange={event => onChange({ attention: event.target.value })} placeholder="例如：理解注意力机制的工作方式"/></label>
      <label><span className="label-row"><b>资料链接</b><em>选填</em></span><input aria-label="资料链接" type="text" maxLength={2048} disabled={disabled || active || hasGeneratedResult || Boolean(record?.summary)} value={draft.sourceUrl} placeholder={draft.entryMode === 'ai' ? '粘贴资料链接，或填写来源说明' : '链接、书名、课程名或其他来源（选填）'} onChange={event => { onChange({ sourceUrl: event.target.value }); setLocalMessage(''); generation.clearError(); }}/><span className="field-hint">可填写网址或文字来源。AI 提炼时需要可读取的网页链接。</span></label>
      <div className="learning-source-actions">{draft.sourceUrl && /^https?:\/\//i.test(draft.sourceUrl) ? <a href={draft.sourceUrl} target="_blank" rel="noreferrer">打开原文<ExternalLink size={13}/></a> : null}{record?.summary ? <button type="button" onClick={onNewLink}>记录其他链接<Plus size={13}/></button> : null}</div>
      {duplicates.length ? <div className="learning-duplicate" role="status"><strong>这个链接已有学习记录</strong><p>可以打开已有记录，或继续创建一条新的记录。</p>{duplicates.map(item => <button type="button" key={item.id} onClick={() => onOpenRecord?.(item)}>{item.date} · {item.attention} · 打开已有记录</button>)}</div> : null}
      {aiTools ? <section className="learning-ai-tools" aria-label="AI 提炼工具">
        {fragmentNotice ? <p className="field-hint">{fragmentNotice}</p> : null}
        <AiPromptInput value={draft.userPrompt ?? ''} onChange={userPrompt => onChange({ userPrompt })} disabled={disabled || active || hasGeneratedResult} generationContext={draft.aiGenerationContext} hasSummary={Boolean(draft.summary)}/>
        <div className="ai-generate-row"><button className="ai-generate-button" type="button" disabled={disabled || active || hasGeneratedResult || !draft.sourceUrl.trim()} onClick={() => void generate()}><Sparkles size={17}/>{active ? '正在提炼…' : record?.summary ? '重新提炼' : '生成知识小结'}</button><span>{generation.quotaRemaining === null ? '每天共 5 次，与知识串联共享' : `今日共享额度剩余 ${generation.quotaRemaining} 次`}</span></div>
        <p className="field-hint">生成时可以继续整理其他记录。提炼结果会直接显示在下方，点击“保存草稿”或“确认”即可保存。</p>
        {active ? <><GenerationProgress stage={generation.stage} progress={generation.progress} attemptCount={generation.attemptCount} retryMessage={generation.retryMessage} createdAt={generation.activeJob?.createdAt} isLongRunning={generation.isLongRunning} error={generation.error}/>{generation.activeJob ? <div className="ai-cancel-row"><button type="button" className="secondary-button" disabled={generation.isCancelling} onClick={() => void generation.cancel()}>{generation.isCancelling ? '正在取消…' : '取消任务'}</button><p>{generation.cancellation?.requiresConfirmation ? '免费取消已用完，取消前会确认额度。' : '生成开始前取消不计次数；开始后每天可免费取消 2 次。'}</p></div> : null}</> : null}
        {generation.error || record?.aiError ? <p className="learning-error" role="alert">{generation.error || aiGenerationErrorMessage(record?.aiError)}</p> : null}
        {generation.canRetryCreate ? <button type="button" className="secondary-button" disabled={disabled || active} onClick={() => void generation.retryCreate()}>重试创建任务</button> : null}
        {generation.cancellationMessage ? <p role="status">{generation.cancellationMessage}</p> : null}
      </section> : null}
      <section id="learning-summary-content" hidden={!summaryVisible} aria-label="知识小结"><div className="learning-summary-heading"><h3>知识小结</h3><button type="button" className="secondary-button" disabled={disabled} onClick={() => setEditing(value => !value)}>{editing ? '阅读小结' : '编辑小结'}</button></div>{editing ? <SummaryEditor id="summary" disabled={disabled} value={draft.summary} onChange={summary => onChange({ summary })} placeholder="先写知识骨架，再用自己的话解释。"/> : <KnowledgeSummaryView value={draft.summary} title={draft.attention}/>}</section>
      <LearningReflectionsEditor value={draft.inspiration} onChange={inspiration => onChange({ inspiration })} disabled={disabled} prompts={prompts} polishContext={draft.summary ? { topic: draft.attention, summary: draft.summary } : undefined} summaryVisible={summaryVisible} onToggleSummary={() => setSummaryVisible(value => !value)}/>
      <ImageNoteUploader identity={draft.id} existingImage={record ? { imageName: record.imageName, imageUrl: record.imageUrl } : null} file={draft.imageFile} removeImage={draft.removeImage} disabled={saving} isPreparing={preparingImage} onPreparationChange={setPreparingImage} onChange={selection => onChange({ imageFile: selection.file, removeImage: selection.removeImage, uploadedImagePath: null })} onError={setLocalMessage}/>
      <footer className="learning-detail-actions">
        {feedback ? <p data-testid="record-save-feedback" className={`learning-save-feedback ${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p> : null}
        <button className="secondary-button" type="button" disabled={disabled || stale || (!draft.attention.trim() && !draft.sourceUrl.trim())} onClick={() => saveRecord('pending')}>{saving && saveFeedback?.status === 'pending' ? '正在保存…' : '保存草稿'}</button>
        <button className="secondary-button" type="button" disabled={disabled} onClick={onCancel}>取消</button>
        <button className="primary-button" type="submit" disabled={disabled || stale}><Check size={16}/>{saving && saveFeedback?.status === 'completed' ? '正在确认…' : '确认'}</button>
      </footer>
      <p className="field-hint">{draft.localOnly ? '尚未保存到云端。' : '修改会保存在当前浏览器，点击保存同步到云端。'}</p>
    </form>
    {generation.cancellationConfirmationRequired ? <CancellationDialog isBusy={generation.isCancelling} onContinue={generation.dismissCancellationConfirmation} onConfirm={() => void generation.cancel(true)}/> : null}
  </section>;
}
