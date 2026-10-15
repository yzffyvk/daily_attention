import type { CheckInEntryMode } from '@/lib/domain/checkin';
import type { LearningRecord } from '@/lib/domain/learning-record';
import { draftFromRecord, type CheckInDraft } from '@/features/checkins/checkin-editor';
export type LearningDraft = CheckInDraft & {
    id: string;
    date: string;
    entryMode: CheckInEntryMode;
    albumId: string | null;
    baseVersion: number | null;
    localOnly: boolean;
    updatedAt: string;
    createdAt: string;
    candidateJobId?: string;
    needsCloudReview?: boolean;
    recoveredCreate?: boolean;
    pendingSaveStatus?: 'pending' | 'completed';
};
export type LearningView = {
    kind: 'all';
} | {
    kind: 'date';
    date: string;
} | {
    kind: 'pending';
} | {
    kind: 'album';
    albumId: string;
} | {
    kind: 'albums';
} | {
    kind: 'unfiled';
};
export function makeLearningDraft(date: string, albumId: string | null, entryMode: CheckInEntryMode): LearningDraft {
    return { ...draftFromRecord(null), id: crypto.randomUUID(), date, albumId, entryMode, baseVersion: null, localOnly: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
export function draftForRecord(record: LearningRecord): LearningDraft {
    return { ...draftFromRecord(record), userPrompt: record.userPrompt ?? '', aiGenerationContext: record.aiGenerationContext ?? null, id: record.id, date: record.date, albumId: record.albumId, entryMode: record.entryMode ?? 'manual', baseVersion: record.version, localOnly: false, createdAt: record.createdAt, updatedAt: record.updatedAt };
}
export function draftForCandidate(record: LearningRecord, current: LearningDraft): LearningDraft {
    const candidate = record.aiCandidate;
    if (!candidate)
        return current;
    return { ...current, attention: candidate.result.attention, summary: candidate.result.summary, sourceUrl: candidate.sourceUrl, userPrompt: candidate.userPrompt, aiGenerationContext: candidate.generationContext, candidateJobId: candidate.jobId, entryMode: 'ai', baseVersion: current.baseVersion };
}
export function draftForEditing(record: LearningRecord, local?: LearningDraft | null): LearningDraft {
    const current = local ?? draftForRecord(record);
    // An already displayed result may contain edits. Do not reapply it on polling,
    // or silently rebase drafts that still need version conflict resolution.
    return current.candidateJobId || current.needsCloudReview ? current : draftForCandidate(record, current);
}
export function recordStateLabel(record: LearningRecord) {
    if (record.activeAiJobId)
        return record.aiStatus === 'queued' ? '排队中' : '提炼中';
    if (record.aiCandidate)
        return '待保存';
    if (record.aiStatus === 'failed')
        return '提炼失败';
    return record.status === 'completed' ? '已完成' : '待整理';
}
export function matchesRecordTitle(record: Pick<LearningRecord, 'attention'>, search: string) {
    return record.attention.toLowerCase().includes(search.trim().toLowerCase());
}
export function recordsForView<T extends Pick<LearningRecord, 'date' | 'albumId' | 'status' | 'aiCandidate' | 'activeAiJobId' | 'aiStatus'>>(records: T[], view: LearningView): T[] {
    if (view.kind === 'all') return records;
    if (view.kind === 'albums') return [];
    return records.filter(record => view.kind === 'date' ? record.date === view.date : view.kind === 'album' ? record.albumId === view.albumId : view.kind === 'unfiled' ? record.albumId === null : record.status === 'pending' || Boolean(record.aiCandidate) || Boolean(record.activeAiJobId) || record.aiStatus === 'failed');
}
export function sourceHost(source: string) { try {
    return new URL(source).hostname.replace(/^www\./, '');
}
catch {
    return '';
} }
