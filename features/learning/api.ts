import { requestApi } from '@/features/checkins/api';
import type { CheckInEntryMode } from '@/lib/domain/checkin';
import type { AiGenerationContext } from '@/lib/domain/ai-prompt';
import type { LearningAlbum, LearningRecord } from '@/lib/domain/learning-record';
export type RecordFilters = {
    search?: string;
    date?: string;
    month?: string;
    albumId?: string;
    unfiled?: boolean;
    pending?: boolean;
    sourceUrl?: string;
    status?: 'pending' | 'completed';
    cursor?: string;
    limit?: number;
};
export type RecordsPage = {
    records: LearningRecord[];
    nextCursor: string | null;
};
export type RecordContent = {
    entryMode: CheckInEntryMode;
    attention: string;
    sourceUrl: string;
    summary: string;
    inspiration: string;
    imagePath: string | null;
    imageName: string;
    userPrompt?: string;
    aiGenerationContext?: AiGenerationContext | null;
    albumId?: string | null;
    status: 'pending' | 'completed';
};
export function getRecords(filters: RecordFilters = {}) { const params = new URLSearchParams(); for (const [key, value] of Object.entries(filters))
    if (value !== undefined)
        params.set(key, String(value)); return requestApi<RecordsPage>(`/api/records?${params}`); }
export function getRecord(id: string) { return requestApi<LearningRecord>(`/api/records/${encodeURIComponent(id)}`); }
export function createRecord(input: RecordContent & {
    id: string;
    date: string;
}) { return requestApi<LearningRecord>('/api/records', { method: 'POST', body: JSON.stringify(input) }); }
export function updateRecord(id: string, input: Partial<RecordContent> & {
    version: number;
    candidateJobId?: string;
    discardCandidate?: boolean;
}) { return requestApi<LearningRecord>(`/api/records/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }); }
export function deleteRecord(id: string, version: number) { return requestApi<{
    id: string;
}>(`/api/records/${encodeURIComponent(id)}?version=${version}`, { method: 'DELETE' }); }
export function moveRecords(recordIds: string[], albumId: string | null) { return requestApi<{
    moved: number;
}>('/api/records/move', { method: 'POST', body: JSON.stringify({ recordIds, albumId }) }); }
export function getAlbums() { return requestApi<LearningAlbum[]>('/api/albums'); }
export function createAlbum(input: {
    name: string;
    description?: string;
}) { return requestApi<LearningAlbum>('/api/albums', { method: 'POST', body: JSON.stringify(input) }); }
export function updateAlbum(id: string, input: {
    name: string;
    description?: string;
}) { return requestApi<LearningAlbum>(`/api/albums/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }); }
export function deleteAlbum(id: string) { return requestApi<{
    id: string;
}>(`/api/albums/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
