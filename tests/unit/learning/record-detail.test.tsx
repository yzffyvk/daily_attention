import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LearningRecord } from '@/lib/domain/learning-record';
import { draftForCandidate, draftForRecord, makeLearningDraft } from '@/features/learning/model';
import { LearningRecordDetail } from '@/features/learning/record-detail';
const generation=vi.hoisted(()=>({activeJob:null as null|{jobId:string;createdAt:string},generate:vi.fn(),quotaUnlimited:false}));
vi.mock('@/features/ai-generation/use-ai-generation',()=>({useAiGeneration:()=>({...generation,stage:'idle',error:'',quotaRemaining:5,cancellationConfirmationRequired:false,clearError:vi.fn()})}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();generation.activeJob=null;generation.quotaUnlimited=false;vi.clearAllMocks();});
const record={id:'one',date:'2026-10-14',entryMode:'manual',attention:'First',sourceUrl:'https://example.com',summary:'Accepted summary',inspiration:'',version:4,status:'completed',albumId:null,activeAiJobId:null,aiCandidate:null,updatedAt:'2026-10-14T08:00:00Z',imagePath:null,imageUrl:null,imageName:''} as LearningRecord;
function props(){return {record,draft:draftForRecord(record),albums:[],saving:false,storageError:false,message:'',onChange:vi.fn(),onSave:vi.fn(),onRefresh:vi.fn(),onMove:vi.fn(),onBack:vi.fn(),onNewLink:vi.fn(),onCreateAlbum:vi.fn(),onCancel:vi.fn()};}
describe('learning record detail',()=>{
 it('shows unlimited access without displaying a finite remaining allowance',()=>{
   generation.quotaUnlimited=true;
   const p=props();p.draft={...p.draft,entryMode:'ai'};
   render(<LearningRecordDetail {...p}/>);
   expect(screen.getByText('测试白名单：AI 提炼与知识串联不限次数')).toBeInTheDocument();
   expect(screen.queryByText(/今日共享额度剩余/)).not.toBeInTheDocument();
 });
 it('saves a completed record without presenting it as a new day or another independent entry mode',()=>{
   const p=props();render(<LearningRecordDetail {...p}/>);
   expect(screen.getByRole('heading',{name:'First'})).toBeInTheDocument();
   fireEvent.click(screen.getByRole('button',{name:'确认'}));
   expect(p.onSave).toHaveBeenCalledWith('completed');
   expect(screen.queryByText('手动记录与 AI 提炼分别保存')).not.toBeInTheDocument();
 });
 it('uses the same three save actions for generated content and manual notes',()=>{
   const p=props();p.record={...record,aiCandidate:{jobId:'candidate',baseVersion:4,sourceUrl:'https://example.com/',userPrompt:'',generationContext:null,result:{attention:'Candidate',summary:'New summary',inspiration:'',sourceTitle:'',warnings:[]},createdAt:'2026-10-15T00:00:00Z'}};
   p.draft=draftForCandidate(p.record,p.draft);
   render(<LearningRecordDetail {...p}/>);
   const footer=document.querySelector('footer')!;
   expect(within(footer).getAllByRole('button').map(button=>button.textContent)).toEqual(['保存草稿','取消','确认']);
   expect(screen.queryByText(/审阅/)).not.toBeInTheDocument();
   expect(screen.getByText('New summary')).toBeInTheDocument();
   fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));
   expect(p.onSave).toHaveBeenLastCalledWith('pending');
   fireEvent.click(screen.getByRole('button',{name:'确认'}));
   expect(p.onSave).toHaveBeenLastCalledWith('completed');
   fireEvent.click(screen.getByRole('button',{name:'取消'}));
   expect(p.onCancel).toHaveBeenCalledOnce();
 });
});

it('switches the saved preparation snapshot to AI before generating from a manual note',()=>{
 const p=props();p.draft={...p.draft,userPrompt:'explain the examples'};
 const {rerender}=render(<LearningRecordDetail {...p}/>);
 fireEvent.click(screen.getByRole('button',{name:'AI 提炼'}));
 expect(p.onChange).toHaveBeenCalledWith({entryMode:'ai'});
 rerender(<LearningRecordDetail {...p} draft={{...p.draft,entryMode:'ai'}}/>);
 fireEvent.click(screen.getByRole('button',{name:'重新提炼'}));
 expect(p.onSave).toHaveBeenCalledWith('completed',{entryMode:'ai'});
});

it('disables saving when the candidate snapshot is older than the saved record',()=>{
 const p=props();p.record={...record,version:5,aiCandidate:{jobId:'candidate',baseVersion:4,sourceUrl:'https://example.com/',userPrompt:'',generationContext:null,result:{attention:'Candidate',summary:'New summary',inspiration:'',sourceTitle:'',warnings:[]},createdAt:'2026-10-15T00:00:00Z'}};
 p.draft={...p.draft,candidateJobId:'candidate',attention:'Candidate',summary:'New summary'};
 render(<LearningRecordDetail {...p}/>);
 expect(screen.getByRole('button',{name:'确认'})).toBeDisabled();
 expect(screen.getByText(/这份提炼结果已过期/)).toBeInTheDocument();
});


it('maps selected and removed images into the record draft imageFile field',async()=>{
 const OriginalURL=URL;
 vi.stubGlobal('URL',class extends OriginalURL {static createObjectURL(){return 'blob:record-note';}static revokeObjectURL(){}});
 vi.stubGlobal('Image',undefined);
 const p=props();const file=new File(['image'],'note.png',{type:'image/png'});
 function Harness(){const [draft,setDraft]=useState(p.draft);return <LearningRecordDetail {...p} draft={draft} onChange={change=>{p.onChange(change);setDraft(current=>({...current,...change}));}}/>;}
 render(<Harness/>);
 fireEvent.change(screen.getByLabelText('添加图片笔记'),{target:{files:[file]}});
 await waitFor(()=>expect(p.onChange).toHaveBeenCalledWith({imageFile:file,removeImage:false,uploadedImagePath:null}));
 fireEvent.click(await screen.findByRole('button',{name:'移除图片'}));
 expect(p.onChange).toHaveBeenLastCalledWith({imageFile:null,removeImage:true,uploadedImagePath:null});
});


it('switches one new draft between manual and AI without saving or losing its contents',()=>{
 const p=props();
 const initial={...makeLearningDraft('2026-10-15','album','manual'),attention:'My topic',sourceUrl:'https://example.com/article',summary:'My notes',inspiration:'My understanding',userPrompt:'Explain examples'};
 let current=initial;
 function Harness(){const [draft,setDraft]=useState(initial);current=draft;return <LearningRecordDetail {...p} record={null} draft={draft} onChange={change=>setDraft(value=>({...value,...change}))}/>;}
 render(<Harness/>);
 expect(screen.getByRole('button',{name:'手动记录'})).toHaveAttribute('aria-pressed','true');
 expect(screen.queryByRole('region',{name:'AI 提炼工具'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'AI 提炼'}));
 expect(screen.getByRole('button',{name:'AI 提炼'})).toHaveAttribute('aria-pressed','true');
 expect(screen.getByRole('region',{name:'AI 提炼工具'})).toBeInTheDocument();
 expect(screen.getByLabelText('提炼要求')).toHaveValue('Explain examples');
 fireEvent.click(screen.getByRole('button',{name:'手动记录'}));
 expect(current).toEqual(initial);
 expect(p.onSave).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'AI 提炼'}));
 expect(screen.getByLabelText('提炼要求')).toHaveValue('Explain examples');
});

it.each(['saving','active','unsaved AI result'] as const)('prevents mode changes while %s',state=>{
 const p=props();p.draft.entryMode='ai';
 if(state==='saving')p.saving=true;
 if(state==='active')generation.activeJob={jobId:'job',createdAt:new Date().toISOString()};
 if(state==='unsaved AI result')p.draft.candidateJobId='candidate';
 render(<LearningRecordDetail {...p}/>);
 expect(screen.getByRole('button',{name:'手动记录'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'AI 提炼'})).toBeDisabled();
});


it('completes a manual record whose optional source is not a URL',()=>{
 const p=props();const draft={...makeLearningDraft('2026-10-15',null,'manual'),attention:'My learning',sourceUrl:'1',summary:'My notes'};
 render(<LearningRecordDetail {...p} record={null} draft={draft}/>);
 fireEvent.click(screen.getByRole('button',{name:'确认'}));
 expect(p.onSave).toHaveBeenCalledWith('completed');
});

it('checks the source only for AI generation and still lets the record be completed',()=>{
 const p=props();const draft={...makeLearningDraft('2026-10-15',null,'ai'),attention:'My learning',sourceUrl:'课堂笔记'};
 render(<LearningRecordDetail {...p} record={null} draft={draft}/>);
 fireEvent.click(screen.getByRole('button',{name:'生成知识小结'}));
 expect(p.onSave).not.toHaveBeenCalled();
 expect(generation.generate).not.toHaveBeenCalled();
 expect(screen.getByRole('alert')).toHaveTextContent(/AI 提炼需要.*HTTP.*可以直接保存/);
 fireEvent.click(screen.getByRole('button',{name:'确认'}));
 expect(p.onSave).toHaveBeenCalledWith('completed');
});

it('shows completion progress and the final result beside the save controls',()=>{
 const p=props();const draft={...makeLearningDraft('2026-10-15',null,'manual'),attention:'My learning',sourceUrl:'1'};
 const {rerender}=render(<LearningRecordDetail {...p} record={null} draft={draft} saving saveFeedback={{kind:'progress',status:'completed',message:'正在保存并完成…'}}/>);
 expect(screen.getByRole('button',{name:'正在确认…'})).toBeDisabled();
 expect(screen.getByTestId('record-save-feedback')).toHaveTextContent('正在保存并完成…');
 const message='保存失败：网络连接失败。内容已保留，请重试。';
 rerender(<LearningRecordDetail {...p} record={null} draft={draft} saveFeedback={{kind:'error',status:'completed',message}}/>);
 expect(screen.getByRole('alert')).toHaveTextContent(message);
 expect(screen.getByRole('button',{name:'确认'})).toBeEnabled();
 rerender(<LearningRecordDetail {...p} record={{...record,status:'completed'}} draft={draft} saveFeedback={{kind:'success',status:'completed',message:'这条记录已完成并保存到云端。'}}/>);
 expect(screen.getByTestId('record-save-feedback')).toHaveTextContent('这条记录已完成并保存到云端。');
});
