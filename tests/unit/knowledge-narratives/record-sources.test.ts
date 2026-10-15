import { describe, expect, it } from 'vitest';
import { createNarrativeSchema, validateNarrativeResult } from '@/lib/domain/knowledge-narrative';

const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const day = '2026-10-14';
const result = () => ({schemaVersion: 3, mode: 'source_records', title: '同一天的两条记录', reason: 'mixed_topics', sourceRecordIds: ids});
describe('record-specific knowledge sources', () => {
  it('accepts 2 distinct record IDs without requiring distinct dates or a shared entry mode', () => {
    expect(createNarrativeSchema.parse({recordIds: [...ids].reverse(), question: '', idempotencyKey: ids[0]})).toMatchObject({recordIds: ids});
  });
  it('rejects duplicate IDs and fewer than two records', () => {
    for(const recordIds of [[ids[0]], [ids[0],ids[0]]]) expect(createNarrativeSchema.safeParse({recordIds, question:'',idempotencyKey:ids[0]}).success).toBe(false);
  });
  it('keeps both same-day sources in a version 3 result', () => {
    expect(validateNarrativeResult(result(), [day, day], ids)).toEqual(result());
  });
  it('rejects a missing record even if dates are identical', () => {
    expect(() => validateNarrativeResult({...result(),sourceRecordIds:[ids[0]]}, [day, day], ids)).toThrow();
  });
  it('rejects fabricated or duplicate record citations', () => {
    expect(() => validateNarrativeResult({...result(),sourceRecordIds:[ids[0], '33333333-3333-4333-8333-333333333333']}, [day], ids)).toThrow();
    expect(() => validateNarrativeResult({...result(),sourceRecordIds:[ids[0],ids[0]]}, [day], ids)).toThrow();
  });
  it('continues accepting date-referenced historical results', () => {
    const old = {schemaVersion:2,mode:'source_records',title:'旧脉络',reason:'mixed_topics',sourceDates:['2026-10-13',day]};
    expect(validateNarrativeResult(old, old.sourceDates)).toEqual(old);
  });
});
