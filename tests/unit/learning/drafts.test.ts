import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { saveDraft, deleteAttentionDraftDatabase } from '@/lib/indexed-db/drafts';
import { deleteLearningDraftDatabase, listLearningDrafts, migrateLegacyDrafts, removeLearningDraft, saveLearningDraft } from '@/features/learning/drafts';
import { makeLearningDraft } from '@/features/learning/model';

afterEach(async () => { await deleteLearningDraftDatabase(); await deleteAttentionDraftDatabase(); });
describe('record drafts', () => {
  it('keeps two same-day same-mode drafts independent and isolated by account', async () => {
    const a = makeLearningDraft('2026-10-15', null, 'manual');
    const b = makeLearningDraft('2026-10-15', null, 'manual');
    await saveLearningDraft('user', {...a, attention:'A'});
    await saveLearningDraft('user', {...b, attention:'B'});
    await saveLearningDraft('other', {...a, attention:'private'});
    expect((await listLearningDrafts('user')).map(draft => draft.attention).sort()).toEqual(['A','B']);
    await removeLearningDraft('user', a.id);
    expect((await listLearningDrafts('user')).map(draft => draft.attention)).toEqual(['B']);
    expect((await listLearningDrafts('other'))[0].attention).toBe('private');
  });
  it('migrates legacy drafts idempotently without deleting their source or overwriting existing records', async () => {
    await saveDraft({userId:'user',date:'2026-10-14',entryMode:'manual',attention:'old',sourceUrl:'',summary:'keep',inspiration:'my idea',imageBlob:new Blob(['image']),imageName:'note.png',removeImage:false,baseVersion:3,updatedAt:'2026-10-15T00:00:00Z'});
    await migrateLegacyDrafts('user');
    const [first] = await listLearningDrafts('user');
    expect(first).toMatchObject({date:'2026-10-14', attention:'old', summary:'keep', inspiration:'my idea', localOnly:true, baseVersion:null});
    expect(first.imageFile?.name).toBe('note.png');
    await saveLearningDraft('user', {...first, attention:'edited'});
    await migrateLegacyDrafts('user');
    expect(await listLearningDrafts('user')).toHaveLength(1);
    expect((await listLearningDrafts('user'))[0].attention).toBe('edited');
    await removeLearningDraft('user', first.id);
    await migrateLegacyDrafts('user');
    expect(await listLearningDrafts('user')).toHaveLength(0);
  });
});
