import { draftForRecord, makeLearningDraft, type LearningDraft } from '@/features/learning/model';
import { ApiError } from '@/features/checkins/api';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningRecord } from '@/lib/domain/learning-record';
import { LearningWorkspace } from '@/features/learning/learning-workspace';
const mocks=vi.hoisted(()=>({getRecords:vi.fn(),getRecord:vi.fn(),getAlbums:vi.fn(),createRecord:vi.fn(),updateRecord:vi.fn(),deleteRecord:vi.fn(),removeLearningDraft:vi.fn(),moveRecords:vi.fn(),listLearningDrafts:vi.fn(),saveLearningDraft:vi.fn(),migrateLegacyDrafts:vi.fn()}));
vi.mock('@/features/learning/api',()=>({...mocks,createAlbum:vi.fn(),updateAlbum:vi.fn(),deleteAlbum:vi.fn()}));
vi.mock('@/features/learning/drafts',()=>mocks);
vi.mock('@/features/profile/app-header',()=>({AppHeader:()=>null}));
vi.mock('@/features/profile/learning-persona',()=>({CurrentLearningPersona:()=>null}));
vi.mock('@/features/daily-takeaways/daily-takeaway-entry',()=>({DailyTakeawayEntry:()=>null}));
vi.mock('@/features/checkins/daily-echo-companion',()=>({DailyEchoCompanion:()=>null}));
vi.mock('@/features/knowledge-narratives/knowledge-workspace',()=>({KnowledgeWorkspace:()=>null}));
vi.mock('@/features/checkins/queries',()=>({useMonthCheckIns:()=>({data:[],isError:false}),checkInKeys:{all:['checkins']}}));
vi.mock('@/features/learning/record-detail',()=>({LearningRecordDetail:({draft,onChange,onSave,onBack,onCancel,message,duplicates=[]}:{message?:string;draft:LearningDraft;duplicates?:LearningRecord[];onChange:(x:Partial<LearningDraft>)=>void;onSave:(x:string)=>void;onBack:()=>void;onCancel:()=>void})=><section aria-label="学习记录详情"><p>{message}</p><input aria-label="学习主题" value={draft.attention} onChange={e=>onChange({attention:e.target.value})}/><input aria-label="资料链接" value={draft.sourceUrl} onChange={e=>onChange({sourceUrl:e.target.value})}/>{duplicates.length>0?<p>这个链接已有学习记录</p>:null}<button onClick={()=>onSave('pending')}>保存记录</button><button onClick={()=>onSave('completed')}>保存并完成</button><button onClick={onCancel}>取消</button><button onClick={onBack}>返回记录列表</button></section>}));
const a={id:'a',date:'2026-10-15',entryMode:'manual',attention:'Alpha',sourceUrl:'https://a.example',summary:'',inspiration:'',version:1,status:'pending',albumId:null,activeAiJobId:null,aiCandidate:null,imagePath:null,imageName:'',imageUrl:null,createdAt:'2026-10-15T02:00:00Z',updatedAt:'2026-10-15T02:00:00Z'} as LearningRecord;
const b={...a,id:'b',attention:'Beta',sourceUrl:'https://b.example'};
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={client}><LearningWorkspace initialDate="2026-10-15" initialToday="2026-10-15" initialProfile={null} userId="user"/></QueryClientProvider>);}
afterEach(cleanup);
beforeEach(()=>{vi.clearAllMocks();mocks.getRecords.mockResolvedValue({records:[a,b],nextCursor:null});mocks.getRecord.mockImplementation(async(id:string)=>id==='a'?a:b);mocks.getAlbums.mockResolvedValue([{id:'album',name:'AI 学习',recordCount:0,completedCount:0}]);mocks.listLearningDrafts.mockResolvedValue([]);mocks.saveLearningDraft.mockResolvedValue(undefined);mocks.migrateLegacyDrafts.mockResolvedValue(undefined);mocks.updateRecord.mockImplementation(async(id:string,input:object)=>({...a,id,...input,version:2}));});
describe('multi record workspace',()=>{
 it('searches cloud records by topic across pages, filters local drafts and resets the cursor for a new term',async()=>{
  const history={...a,id:'history',attention:'Transformer lesson',date:'2026-08-01'};
  const local={...makeLearningDraft('2026-07-01',null,'manual'),attention:'TRANS local draft'};
  mocks.listLearningDrafts.mockResolvedValue([local]);
  mocks.getRecords.mockImplementation(async(filters:{search?:string;cursor?:string})=>filters.search==='trans'?{records:filters.cursor?[]:[history],nextCursor:filters.cursor?null:'search-page'}:filters.search?{records:[],nextCursor:null}:{records:[a,b],nextCursor:null});
  mount();await screen.findByRole('button',{name:'打开记录 Alpha'});
  fireEvent.click(within(screen.getByRole('navigation',{name:'学习内容导航'})).getByRole('button',{name:'全部记录'}));
  const search=screen.getByRole('searchbox',{name:'搜索学习主题'});
  fireEvent.change(search,{target:{value:'trans'}});
  await screen.findByRole('button',{name:'打开记录 Transformer lesson'});
  expect(mocks.getRecords).toHaveBeenCalledWith({search:'trans',limit:50});
  expect(screen.getByRole('button',{name:'打开记录 TRANS local draft'})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'打开记录 Alpha'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'加载更多记录'}));
  await waitFor(()=>expect(mocks.getRecords).toHaveBeenCalledWith({search:'trans',limit:50,cursor:'search-page'}));
  fireEvent.change(search,{target:{value:'missing'}});
  await screen.findByText('没有找到匹配的记录');
  expect(mocks.getRecords).toHaveBeenCalledWith({search:'missing',limit:50});
  expect(screen.queryByRole('button',{name:'打开记录 TRANS local draft'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'清空搜索'}));
  await screen.findByRole('button',{name:'打开记录 Alpha'});
 });
 it('opens all records from primary navigation, includes older browser drafts and loads further pages',async()=>{
  const history={...a,id:'history',date:'2026-09-01',albumId:'album',status:'completed' as const,attention:'Older completed note',createdAt:'2026-09-01T02:00:00Z'};
  const older={...a,id:'older',date:'2026-08-01',attention:'Next page note',createdAt:'2026-08-01T02:00:00Z'};
  const local={...makeLearningDraft('2026-07-01','album','manual'),attention:'Older browser draft'};
  mocks.listLearningDrafts.mockResolvedValue([local]);
  mocks.getRecords.mockImplementation(async(filters:{date?:string;pending?:boolean;cursor?:string})=>filters.date?{records:[a],nextCursor:null}:filters.cursor?{records:[older],nextCursor:null}:{records:[a,history],nextCursor:'next-page'});
  mount();await screen.findByRole('button',{name:'打开记录 Alpha'});
  const nav=screen.getByRole('navigation',{name:'学习内容导航'});
  expect(within(nav).queryByRole('button',{name:'待处理'})).not.toBeInTheDocument();
  expect(within(nav).queryByRole('button',{name:'未归类'})).not.toBeInTheDocument();
  fireEvent.click(within(nav).getByRole('button',{name:'全部记录'}));
  await screen.findByRole('button',{name:'打开记录 Older completed note'});
  expect(mocks.getRecords).toHaveBeenCalledWith({limit:50});
  expect(within(nav).getByRole('button',{name:'全部记录'})).toHaveAttribute('aria-pressed','true');
  expect(screen.getByRole('button',{name:'打开记录 Older browser draft'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'加载更多记录'}));
  await screen.findByRole('button',{name:'打开记录 Next page note'});
  expect(mocks.getRecords).toHaveBeenCalledWith({limit:50,cursor:'next-page'});
  expect(screen.getByRole('button',{name:'打开记录 Older completed note'})).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('筛选学习状态'),{target:{value:'completed'}});
  expect(screen.getByRole('button',{name:'打开记录 Older completed note'})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'打开记录 Alpha'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'打开记录 Older browser draft'})).not.toBeInTheDocument();
 });
 it('preserves unsaved text separately when switching between same-day records',async()=>{mount();fireEvent.click(await screen.findByRole('button',{name:/打开记录 Alpha/}));fireEvent.change(await screen.findByLabelText('学习主题'),{target:{value:'Alpha edited'}});fireEvent.click(screen.getByRole('button',{name:/打开记录 Beta/}));await waitFor(()=>expect(screen.getByLabelText('学习主题')).toHaveValue('Beta'));fireEvent.change(screen.getByLabelText('学习主题'),{target:{value:'Beta edited'}});fireEvent.click(screen.getByRole('button',{name:/打开记录 Alpha/}));await waitFor(()=>expect(screen.getByLabelText('学习主题')).toHaveValue('Alpha edited'));expect(mocks.saveLearningDraft).toHaveBeenCalledWith('user',expect.objectContaining({id:'a',attention:'Alpha edited'}));});
 it('completes only the selected record by ID and its loaded version',async()=>{mount();fireEvent.click(await screen.findByRole('button',{name:/打开记录 Beta/}));await screen.findByLabelText('学习主题');fireEvent.click(screen.getByRole('button',{name:'保存并完成'}));await waitFor(()=>expect(mocks.updateRecord).toHaveBeenCalledWith('b',expect.objectContaining({version:1,status:'completed',attention:'Beta'})));});
});

describe('record creation and album actions',()=>{
 it('opens a new local editor directly and creates a stable-ID record only on save',async()=>{
  mocks.getRecords.mockImplementation(async(filters:{sourceUrl?:string})=>({records:filters.sourceUrl?[]:[a,b],nextCursor:null}));
  mocks.createRecord.mockImplementation(async(input:object)=>({...a,...input}));
  mount();await screen.findByRole('button',{name:/打开记录 Alpha/});
  fireEvent.click(screen.getByRole('button',{name:'新增记录'}));
  expect(screen.getByRole('region',{name:'学习记录详情'})).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mocks.createRecord).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('资料链接'),{target:{value:'https://new.example/article'}});
  fireEvent.click(screen.getByRole('button',{name:'保存记录'}));
  await waitFor(()=>expect(mocks.createRecord).toHaveBeenCalledWith(expect.objectContaining({id:expect.stringMatching(/^[a-f0-9-]{36}$/),date:'2026-10-15',sourceUrl:'https://new.example/article',entryMode:'manual',status:'pending',albumId:null})));
  expect(mocks.updateRecord).not.toHaveBeenCalled();
 });
 it('shows a duplicate link hint without blocking a separate new record',async()=>{
  mocks.getRecords.mockResolvedValue({records:[a,b],nextCursor:null});
  mocks.createRecord.mockImplementation(async(input:object)=>({...a,...input}));
  mount();await screen.findByRole('button',{name:/打开记录 Alpha/});fireEvent.click(screen.getByRole('button',{name:'新增记录'}));
  fireEvent.change(screen.getByLabelText('资料链接'),{target:{value:a.sourceUrl+'#section'}});
  expect(await screen.findByText('这个链接已有学习记录')).toBeInTheDocument();
  expect(mocks.getRecords).toHaveBeenCalledWith({sourceUrl:'https://a.example/',limit:10});
  expect(mocks.createRecord).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'保存记录'}));
  await waitFor(()=>expect(mocks.createRecord).toHaveBeenCalledTimes(1));
  expect(mocks.updateRecord).not.toHaveBeenCalled();
 });
 it('bulk moves by IDs without sending content, dates, or versions',async()=>{
  mocks.moveRecords.mockResolvedValue({moved:2});mount();await screen.findByRole('button',{name:/打开记录 Alpha/});
  fireEvent.click(screen.getByLabelText('选择记录 Alpha'));fireEvent.click(screen.getByLabelText('选择记录 Beta'));
  fireEvent.change(screen.getByLabelText('批量移动到专辑'),{target:{value:'album'}});
  await waitFor(()=>expect(mocks.moveRecords).toHaveBeenCalledWith(['a','b'],'album'));expect(mocks.updateRecord).not.toHaveBeenCalled();
 });
});


describe('ambiguous create recovery',()=>{
 it('preserves edits after a lost create response and requires an explicit choice before updating the recovered cloud record',async()=>{
  let committed:LearningRecord|null=null;
  const network=new ApiError('网络连接失败',{status:0,code:'NETWORK_ERROR',requestId:''});
  mocks.createRecord.mockImplementation(async(input:object)=>{if(!committed){committed={...a,...input,version:1,status:'completed'} as LearningRecord;throw network;}throw new ApiError('记录内容不一致',{status:409,code:'IDEMPOTENCY_CONFLICT',requestId:'conflict'});});
  mocks.getRecord.mockRejectedValueOnce(network).mockImplementation(async(id:string)=>committed?.id===id?committed:a);
  mount();await screen.findByRole('button',{name:'打开记录 Alpha'});
  fireEvent.click(screen.getByRole('button',{name:'新增记录'}));
  fireEvent.change(screen.getByLabelText('学习主题'),{target:{value:'Original submission'}});fireEvent.click(screen.getByRole('button',{name:'保存并完成'}));
  await waitFor(()=>expect(mocks.createRecord).toHaveBeenCalledTimes(1));await screen.findByText('网络连接失败');
  fireEvent.change(screen.getByLabelText('学习主题'),{target:{value:'Edited after lost response'}});fireEvent.click(screen.getByRole('button',{name:'保存并完成'}));
  await screen.findByText('云端记录已更新，本地修改已保留');
  expect(screen.getByLabelText('学习主题')).toHaveValue('Edited after lost response');
  expect(mocks.saveLearningDraft).toHaveBeenCalledWith('user',expect.objectContaining({localOnly:false,baseVersion:1,needsCloudReview:true,attention:'Edited after lost response'}));
  fireEvent.click(screen.getByRole('button',{name:'保存并完成'}));
  expect(mocks.updateRecord).not.toHaveBeenCalled();
  await waitFor(()=>expect(screen.getByRole('button',{name:'使用本地修改更新云端'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'使用本地修改更新云端'}));
  await waitFor(()=>expect(mocks.updateRecord).toHaveBeenCalledWith(committed!.id,expect.objectContaining({version:1,attention:'Edited after lost response'})));
  expect(mocks.createRecord).toHaveBeenCalledTimes(2);
 });
});


it('recovers a pending cloud v2 record without losing a completion-only retry or its album',async()=>{
 const local={...makeLearningDraft('2026-10-15','album','manual'),attention:'Same content',sourceUrl:'https://example.com/'};
 const cloud={...a,id:local.id,date:local.date,attention:local.attention,sourceUrl:local.sourceUrl,albumId:'album',version:2,status:'pending' as const};
 mocks.listLearningDrafts.mockResolvedValue([local]);mocks.getRecords.mockResolvedValue({records:[cloud],nextCursor:null});mocks.getRecord.mockResolvedValue(cloud);
 mocks.createRecord.mockRejectedValue(new ApiError('记录内容不一致',{status:409,code:'IDEMPOTENCY_CONFLICT',requestId:'conflict'}));
 mocks.updateRecord.mockImplementation(async(id:string,input:object)=>({...cloud,...input,id,version:3}));
 mount();fireEvent.click(await screen.findByRole('button',{name:'打开记录 Same content'}));
 fireEvent.click(screen.getByRole('button',{name:'保存并完成'}));
 await screen.findByText('云端记录已更新，本地修改已保留');
 expect(mocks.saveLearningDraft).toHaveBeenCalledWith('user',expect.objectContaining({id:local.id,localOnly:false,baseVersion:2,needsCloudReview:true,albumId:'album',pendingSaveStatus:'completed'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'使用本地修改更新云端'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'使用本地修改更新云端'}));
 await waitFor(()=>expect(mocks.updateRecord).toHaveBeenCalledWith(local.id,expect.objectContaining({version:2,status:'completed',attention:'Same content',albumId:'album'})));
});

it('can keep a recovered cloud record and save local edits as a separate new record',async()=>{
 const local={...makeLearningDraft('2026-10-15',null,'manual'),attention:'Local edited content'};
 const cloud={...a,id:local.id,attention:'Cloud original',version:2};
 mocks.listLearningDrafts.mockResolvedValue([local]);mocks.getRecords.mockResolvedValue({records:[cloud],nextCursor:null});mocks.getRecord.mockResolvedValue(cloud);
 mocks.createRecord.mockRejectedValueOnce(new ApiError('记录内容不一致',{status:409,code:'IDEMPOTENCY_CONFLICT',requestId:'conflict'})).mockImplementation(async(input:object)=>({...a,...input}));
 mount();fireEvent.click(await screen.findByRole('button',{name:'打开记录 Local edited content'}));
 fireEvent.click(screen.getByRole('button',{name:'保存并完成'}));await screen.findByText('云端记录已更新，本地修改已保留');
 await waitFor(()=>expect(screen.getByRole('button',{name:'将本地修改另存为新记录'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'将本地修改另存为新记录'}));
 expect(screen.getByLabelText('学习主题')).toHaveValue('Local edited content');
 expect(screen.getByRole('button',{name:'打开记录 Cloud original'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'保存并完成'}));
 await waitFor(()=>expect(mocks.createRecord).toHaveBeenCalledTimes(2));
 expect(mocks.createRecord.mock.calls[1][0]).toMatchObject({attention:'Local edited content'});
 expect(mocks.createRecord.mock.calls[1][0].id).not.toBe(local.id);
 expect(mocks.updateRecord).not.toHaveBeenCalled();
});


it('retains the recovery guard after reload until the user loads the cloud version',async()=>{
 const cloud={...a,version:2,attention:'Cloud content'};
 mocks.listLearningDrafts.mockResolvedValue([{...draftForRecord(cloud),attention:'Retained local edit',needsCloudReview:true,recoveredCreate:true,pendingSaveStatus:'completed'}]);
 mocks.getRecords.mockResolvedValue({records:[cloud],nextCursor:null});mocks.getRecord.mockResolvedValue(cloud);
 mount();fireEvent.click(await screen.findByRole('button',{name:'打开记录 Cloud content'}));
 expect(screen.getByLabelText('学习主题')).toHaveValue('Retained local edit');
 fireEvent.click(screen.getByRole('button',{name:'保存并完成'}));
 await screen.findByText('云端记录已更新，本地修改已保留');expect(mocks.updateRecord).not.toHaveBeenCalled();
 await waitFor(()=>expect(screen.getByRole('button',{name:'放弃本地修改并载入云端'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'放弃本地修改并载入云端'}));
 await waitFor(()=>expect(screen.getByLabelText('学习主题')).toHaveValue('Cloud content'));
});


it('opens albums from the primary navigation even when the calendar sidebar is collapsed',async()=>{
 localStorage.setItem('aura-calendar-collapsed','true');
 mocks.createRecord.mockImplementation(async(input:object)=>({...a,...input}));
 mount();await screen.findByRole('button',{name:'打开记录 Alpha'});
 const navigation=screen.getByRole('navigation',{name:'学习内容导航'});
 const entry=within(navigation).getByRole('button',{name:'专辑'});
 fireEvent.click(entry);
 const library=screen.getByRole('region',{name:'专辑列表'});
 expect(entry).toHaveAttribute('aria-pressed','true');
 expect(within(library).getByRole('heading',{name:'我的专辑'})).toBeInTheDocument();
 fireEvent.click(within(library).getByRole('button',{name:'新建专辑'}));
 expect(screen.getByRole('dialog',{name:'新建专辑'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'关闭对话框'}));
 fireEvent.click(within(library).getByRole('button',{name:'打开专辑 AI 学习'}));
 await waitFor(()=>expect(mocks.getRecords).toHaveBeenCalledWith({albumId:'album',limit:50}));
 expect(entry).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByRole('button',{name:'新增记录'}));
 fireEvent.change(screen.getByLabelText('学习主题'),{target:{value:'New album note'}});
 fireEvent.click(screen.getByRole('button',{name:'保存记录'}));
 await waitFor(()=>expect(mocks.createRecord).toHaveBeenCalledWith(expect.objectContaining({albumId:'album',attention:'New album note'})));
 localStorage.removeItem('aura-calendar-collapsed');
});


it('opens AI output directly and saves an edited result as a draft with personal notes retained',async()=>{
 const cloud={...a,entryMode:'ai',aiCandidate:{jobId:'job',baseVersion:1,sourceUrl:a.sourceUrl,userPrompt:'',generationContext:null,result:{attention:'AI topic',summary:'Generated summary',inspiration:'Suggestion',sourceTitle:'',warnings:[]},createdAt:a.updatedAt}} as LearningRecord;
 mocks.getRecords.mockResolvedValue({records:[cloud],nextCursor:null});mocks.getRecord.mockResolvedValue(cloud);
 mocks.listLearningDrafts.mockResolvedValue([{...draftForRecord(a),inspiration:'Unsaved personal notes'}]);
 mount();fireEvent.click(await screen.findByRole('button',{name:'打开记录 Alpha'}));
 expect(screen.getByLabelText('学习主题')).toHaveValue('AI topic');
 fireEvent.change(screen.getByLabelText('学习主题'),{target:{value:'Edited AI topic'}});
 fireEvent.click(screen.getByRole('button',{name:'保存记录'}));
 await waitFor(()=>expect(mocks.updateRecord).toHaveBeenCalledWith(a.id,expect.objectContaining({version:1,candidateJobId:'job',status:'pending',attention:'Edited AI topic',summary:'Generated summary',inspiration:'Unsaved personal notes'})));
});

it('cancels local edits and returns to the list without changing the saved record',async()=>{
 mount();fireEvent.click(await screen.findByRole('button',{name:'打开记录 Alpha'}));
 fireEvent.change(screen.getByLabelText('学习主题'),{target:{value:'Discard this edit'}});
 fireEvent.click(screen.getByRole('button',{name:'取消'}));
 await waitFor(()=>expect(screen.queryByRole('region',{name:'学习记录详情'})).not.toBeInTheDocument());
 expect(mocks.removeLearningDraft).toHaveBeenCalledWith('user',a.id);
 expect(mocks.updateRecord).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'打开记录 Alpha'}));
 expect(screen.getByLabelText('学习主题')).toHaveValue('Alpha');
});

it('cancels an unsaved AI result while retaining the previously saved content',async()=>{
 const cloud={...a,summary:'Saved summary',aiCandidate:{jobId:'job',baseVersion:1,sourceUrl:a.sourceUrl,userPrompt:'',generationContext:null,result:{attention:'AI topic',summary:'New summary',inspiration:'',sourceTitle:'',warnings:[]},createdAt:a.updatedAt}} as LearningRecord;
 mocks.getRecords.mockResolvedValue({records:[cloud],nextCursor:null});mocks.getRecord.mockResolvedValue(cloud);
 mocks.updateRecord.mockResolvedValue({...cloud,aiCandidate:null});
 mount();fireEvent.click(await screen.findByRole('button',{name:'打开记录 Alpha'}));
 fireEvent.click(screen.getByRole('button',{name:'取消'}));
 await waitFor(()=>expect(mocks.updateRecord).toHaveBeenCalledWith(a.id,{version:1,discardCandidate:true}));
 await waitFor(()=>expect(screen.queryByRole('region',{name:'学习记录详情'})).not.toBeInTheDocument());
});

it('deletes a record from the list without closing another selected record',async()=>{
 mount();fireEvent.click(await screen.findByRole('button',{name:'打开记录 Beta'}));
 fireEvent.click(screen.getByRole('button',{name:'删除记录 Alpha'}));
 const dialog=screen.getByRole('dialog',{name:'删除这条记录？'});
 expect(mocks.deleteRecord).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByRole('button',{name:'确认'}));
 await waitFor(()=>expect(mocks.deleteRecord).toHaveBeenCalledWith(a.id,1));
 expect(screen.getByLabelText('学习主题')).toHaveValue('Beta');
 expect(mocks.removeLearningDraft).toHaveBeenCalledWith('user',a.id);
});
