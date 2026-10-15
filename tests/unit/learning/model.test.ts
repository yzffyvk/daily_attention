import { describe, expect, it } from 'vitest';
import { draftForCandidate, draftForEditing, draftForRecord, matchesRecordTitle, recordStateLabel, recordsForView } from '@/features/learning/model';
import type { LearningRecord } from '@/lib/domain/learning-record';
const record = {id:'one',date:'2026-10-14',entryMode:'ai',attention:'accepted',sourceUrl:'https://example.com',summary:'old summary',inspiration:'my thoughts',version:4,status:'completed',albumId:null,activeAiJobId:null,aiCandidate:null} as LearningRecord;
describe('learning record model', () => {
  it('matches partial titles case insensitively without searching other fields or interpreting wildcards', () => {
    const item={...record,attention:'Transformer 注意力 50%_复盘',summary:'Only in summary',inspiration:'Only in reflections'};
    expect(matchesRecordTitle(item,'  TRANS  ')).toBe(true);
    expect(matchesRecordTitle(item,'注意')).toBe(true);
    expect(matchesRecordTitle(item,'50%_')).toBe(true);
    expect(matchesRecordTitle(item,'Only in summary')).toBe(false);
    expect(matchesRecordTitle(item,'https://')).toBe(false);
    expect(matchesRecordTitle(item,'')).toBe(true);
  });
  it('includes records across dates, albums and completion states in the all-records view', () => {
    const records=[record,{...record,id:'past',date:'2026-09-01',albumId:'album'},{...record,id:'draft',status:'pending' as const}];
    expect(recordsForView(records,{kind:'all'})).toEqual(records);
  });
  it('previews a candidate without overwriting accepted content or personal reflections', () => {
    const candidate = {...record, aiCandidate:{jobId:'job',sourceUrl:record.sourceUrl,userPrompt:'explain',baseVersion:4,result:{attention:'new',summary:'new summary'},generationContext:null,createdAt:'2026-10-15'}} as LearningRecord;
    const draft = draftForCandidate(candidate, {...draftForRecord(record), inspiration:'unsaved reflection'});
    expect(draft).toMatchObject({attention:'new', summary:'new summary', inspiration:'unsaved reflection', candidateJobId:'job', baseVersion:4});
    expect(candidate.summary).toBe('old summary');
  });
  it('includes completed records awaiting AI review in the pending inbox', () => {
    const waiting = {...record, aiCandidate:{jobId:'job'}} as LearningRecord;
    expect(recordsForView([record,waiting],{kind:'pending'})).toHaveLength(1);
    expect(recordStateLabel(waiting)).toBe('待保存');
  });
  it('filters album and unfiled without changing source date or completion', () => {
    const inAlbum={...record, id:'two',albumId:'album'};
    expect(recordsForView([record,inAlbum],{kind:'album',albumId:'album'})).toEqual([inAlbum]);
    expect(recordsForView([record,inAlbum],{kind:'unfiled'})).toEqual([record]);
  });
});

it('opens generated content directly and preserves edits to the displayed result',()=>{
 const cloud={...record,aiCandidate:{jobId:'job',baseVersion:4,sourceUrl:record.sourceUrl,userPrompt:'',result:{attention:'AI title',summary:'AI summary'},generationContext:null,createdAt:'2026-10-15'}} as LearningRecord;
 expect(draftForEditing(cloud)).toMatchObject({attention:'AI title',summary:'AI summary',candidateJobId:'job',baseVersion:4,inspiration:'my thoughts'});
 const local={...draftForRecord(record),inspiration:'My unsaved understanding'};
 const generated=draftForEditing(cloud,local);
 expect(generated.inspiration).toBe(local.inspiration);
 expect(draftForEditing(cloud,{...generated,summary:'Edited AI summary'}).summary).toBe('Edited AI summary');
 expect(draftForEditing(cloud,{...local,needsCloudReview:true})).toEqual({...local,needsCloudReview:true});
});


it('does not promote an older local draft version when loading a newer AI candidate',()=>{
 const cloud={...record,version:5,aiCandidate:{jobId:'job',baseVersion:5,sourceUrl:record.sourceUrl,userPrompt:'',result:{attention:'new',summary:'new summary'},generationContext:null,createdAt:'2026-10-15'}} as LearningRecord;
 const local={...draftForRecord(record),baseVersion:4,inspiration:'older unsaved reflection'};
 expect(draftForCandidate(cloud,local)).toMatchObject({baseVersion:4,inspiration:'older unsaved reflection',candidateJobId:'job'});
});
