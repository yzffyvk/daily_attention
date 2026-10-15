import { describe, expect, it } from 'vitest';
import { createLearningRecordSchema, updateLearningRecordSchema, learningRecordQuerySchema, learningAlbumInputSchema, moveLearningRecordsSchema, normalizeLearningSourceUrl } from '@/lib/domain/learning-record';

const capture = { id: '00000000-0000-4000-8000-000000000001', date: '2026-07-01', entryMode: 'ai', attention: '', sourceUrl: 'https://example.com#heading', summary: '', inspiration: '', imagePath: null, imageName: '', albumId: null, status: 'pending' };
it.each(['pending', 'completed'])('saves generated content with status %s without a separate confirmation contract', status => {
  expect(updateLearningRecordSchema.safeParse({ version: 1, candidateJobId: capture.id, status }).success).toBe(true);
});
describe('learning records and albums contracts', () => {
  it('accepts a trimmed title search and bounds its length', () => {
    expect(learningRecordQuerySchema.parse({search:'  注意力  '})).toMatchObject({search:'注意力',limit:50});
    expect(learningRecordQuerySchema.safeParse({search:'a'.repeat(121)}).success).toBe(false);
  });
  it('collects a link without a title, normalizes its URL and derives a title', () => {
    expect(createLearningRecordSchema.parse(capture)).toMatchObject({ attention: 'example.com', sourceUrl: 'https://example.com/', status: 'pending' });
  });
  it('requires a title when completing a record and rejects an empty collection', () => {
    expect(createLearningRecordSchema.safeParse({ ...capture, status: 'completed' }).success).toBe(false);
    expect(createLearningRecordSchema.safeParse({ ...capture, sourceUrl: '' }).success).toBe(false);
    expect(createLearningRecordSchema.safeParse({ ...capture, attention: '学习笔记', sourceUrl: '', entryMode: 'manual', status: 'completed' }).success).toBe(true);
  });
  it('does not permit moving dates, sending generated state or omitting update versions', () => {
    expect(updateLearningRecordSchema.safeParse({ version: 1, date: capture.date }).success).toBe(false);
    expect(updateLearningRecordSchema.safeParse({ version: 1, aiCandidate: {} }).success).toBe(false);
    expect(updateLearningRecordSchema.safeParse({ attention: '修改' }).success).toBe(false);
    expect(updateLearningRecordSchema.safeParse({ version: 1, discardCandidate: true, candidateJobId: capture.id }).success).toBe(false);
  });
  it('allows only one optional album and validates atomic move input', () => {
    expect(createLearningRecordSchema.safeParse({ ...capture, albumId: [capture.id] }).success).toBe(false);
    expect(moveLearningRecordsSchema.safeParse({ recordIds: [capture.id, capture.id], albumId: null }).success).toBe(false);
    expect(learningAlbumInputSchema.parse({ name: '  产品设计  ' })).toEqual({ name: '产品设计', description: '' });
  });
  it('bounds pagination and rejects conflicting album filters', () => {
    expect(learningRecordQuerySchema.parse({})).toMatchObject({ limit: 50 });
    expect(learningRecordQuerySchema.safeParse({ albumId: capture.id, unfiled: 'true' }).success).toBe(false);
    expect(learningRecordQuerySchema.safeParse({ limit: '1001' }).success).toBe(false);
    expect(learningRecordQuerySchema.safeParse({ cursor: 'arbitrary SQL' }).success).toBe(false);
    expect(learningRecordQuerySchema.parse({ sourceUrl: 'https://example.com#anchor' }).sourceUrl).toBe('https://example.com/');
  });
});


it.each(['manual','ai'] as const)('saves non-URL sources in %s records without changing the text',entryMode=>{
 const input={...capture,entryMode,attention:'我的学习',sourceUrl:'  课堂笔记 #1  ',status:'completed'};
 expect(createLearningRecordSchema.parse(input)).toMatchObject({sourceUrl:'课堂笔记 #1',status:'completed'});
 expect(updateLearningRecordSchema.parse({version:1,sourceUrl:'1',status:'completed'})).toMatchObject({sourceUrl:'1',status:'completed'});
 expect(learningRecordQuerySchema.parse({sourceUrl:'课堂笔记 #1'}).sourceUrl).toBe('课堂笔记 #1');
 expect(normalizeLearningSourceUrl('课堂笔记 #1')).toBe('课堂笔记 #1');
});

it('can infer a pending title from a plain-text source and keeps the source length limit',()=>{
 expect(createLearningRecordSchema.parse({...capture,sourceUrl:'课堂笔记 #1'})).toMatchObject({attention:'课堂笔记 #1',sourceUrl:'课堂笔记 #1'});
 expect(createLearningRecordSchema.safeParse({...capture,sourceUrl:'1'.repeat(2049)}).success).toBe(false);
});
