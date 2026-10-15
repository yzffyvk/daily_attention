import { openDB, deleteDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { StoredDraft } from '@/lib/indexed-db/drafts';
import { loadDraft } from '@/lib/indexed-db/drafts';
import { makeLearningDraft, type LearningDraft } from './model';
type StoredLearningDraft = Omit<LearningDraft, 'imageFile'> & {
    userId: string;
    imageBlob: Blob | null;
    imageName: string;
};
interface LearningDraftDatabase extends DBSchema {
    records: {
        key: [
            string,
            string
        ];
        value: StoredLearningDraft;
        indexes: {
            'by-user': string;
        };
    };
    imports: {
        key: string;
        value: {
            key: string;
            recordId: string;
        };
    };
}
const databaseName = 'aura-learning-record-drafts';
let connection: Promise<IDBPDatabase<LearningDraftDatabase>> | null = null;
function database() {
    if (!connection)
        connection = openDB<LearningDraftDatabase>(databaseName, 1, { upgrade(db) { db.createObjectStore('records', { keyPath: ['userId', 'id'] }).createIndex('by-user', 'userId'); db.createObjectStore('imports', { keyPath: 'key' }); }, blocking() { void connection?.then(db => db.close()); connection = null; } }).catch(error => { connection = null; throw error; });
    return connection;
}
function stored(userId: string, draft: LearningDraft): StoredLearningDraft { const { imageFile, ...rest } = draft; return { ...rest, userId, imageBlob: imageFile, imageName: imageFile?.name ?? '' }; }
function restored(draft: StoredLearningDraft): LearningDraft { const { userId: _userId, imageBlob, imageName, ...rest } = draft; void _userId; return { ...rest, imageFile: imageBlob ? new File([imageBlob], imageName, { type: imageBlob.type }) : null }; }
export async function saveLearningDraft(userId: string, draft: LearningDraft) { await (await database()).put('records', stored(userId, draft)); }
export async function removeLearningDraft(userId: string, id: string) { await (await database()).delete('records', [userId, id]); }
export async function listLearningDrafts(userId: string) { return (await (await database()).getAllFromIndex('records', 'by-user', userId)).map(restored); }
export async function migrateLegacyDrafts(userId: string) {
    // Open through the existing migration first so older v1 drafts are normalized safely.
    await loadDraft(userId, '0000-00-00');
    const legacy = await openDB('attention-cloud-drafts');
    let drafts: StoredDraft[];
    try {
        drafts = await legacy.getAllFromIndex('drafts', 'by-user', userId);
    }
    finally {
        legacy.close();
    }
    const db = await database();
    const tx = db.transaction(['records', 'imports'], 'readwrite');
    for (const old of drafts) {
        if (!old.attention && !old.summary && !old.sourceUrl && !old.inspiration && !old.imageBlob && !old.activeAiJob)
            continue;
        const key = `${userId}:${old.date}:${old.entryMode ?? 'manual'}`;
        if (await tx.objectStore('imports').get(key))
            continue;
        const draft: LearningDraft = { ...makeLearningDraft(old.date, null, old.entryMode ?? 'manual'), attention: old.attention, summary: old.summary, sourceUrl: old.sourceUrl, inspiration: old.inspiration, userPrompt: old.userPrompt, aiGenerationContext: old.aiGenerationContext, imageFile: old.imageBlob ? new File([old.imageBlob], old.imageName, { type: old.imageBlob.type }) : null, removeImage: old.removeImage, uploadedImagePath: old.uploadedImagePath ?? null, createdAt: old.updatedAt, updatedAt: old.updatedAt };
        await tx.objectStore('records').put(stored(userId, draft));
        await tx.objectStore('imports').put({ key, recordId: draft.id });
    }
    await tx.done;
}
export async function deleteLearningDraftDatabase() { const opened = connection; connection = null; if (opened)
    (await opened).close(); await deleteDB(databaseName); }
