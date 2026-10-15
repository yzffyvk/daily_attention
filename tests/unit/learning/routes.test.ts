import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({ context:vi.fn(), signed:vi.fn(), remove:vi.fn() }));
vi.mock('@/server/learning/http',async original=>({...await original<typeof import('@/server/learning/http')>(),createLearningRequestContext:mocks.context}));
vi.mock('@/server/storage/service',async original=>({...await original<typeof import('@/server/storage/service')>(),createCheckInImageUrl:mocks.signed,removeCheckInImage:mocks.remove}));
import { GET, POST } from '@/app/api/records/route';
import { PATCH, DELETE } from '@/app/api/records/[id]/route';
import { POST as MOVE } from '@/app/api/records/move/route';
const id='00000000-0000-4000-8000-000000000001';
const owner='00000000-0000-4000-8000-000000000002';
const record={id,date:'2026-07-01',entryMode:'ai',attention:'example.com',sourceUrl:'https://example.com/',summary:'existing',inspiration:'mine',imagePath:null,imageName:'',version:1,albumId:null,status:'pending',aiCandidate:null};
const request=(body:unknown,method='POST')=>new Request('http://test/api/records',{method,body:JSON.stringify(body)});
const route={params:Promise.resolve({id})};
const repo={list:vi.fn(),find:vi.fn(),create:vi.fn(),update:vi.fn(),delete:vi.fn(),move:vi.fn(),imageIsReferenced:vi.fn()};
beforeEach(()=>{vi.resetAllMocks();mocks.context.mockResolvedValue({userId:owner,repository:repo,supabase:{}});repo.find.mockResolvedValue(record);mocks.signed.mockResolvedValue('https://signed.test/image');});
describe('record routes',()=>{
 it('passes partial title search to the repository before pagination',async()=>{
  repo.list.mockResolvedValue({records:[],nextCursor:null});
  const response=await GET(new Request('http://test/api/records?search=%20TRANS%20&limit=50'));
  expect(response.status).toBe(200);
  expect(repo.list).toHaveBeenCalledWith(owner,{search:'TRANS',limit:50});
 });
 it('requires a session and never caches private records',async()=>{mocks.context.mockResolvedValue(null);const response=await GET(new Request('http://test/api/records'));expect(response.status).toBe(401);expect(response.headers.get('Cache-Control')).toBe('private, no-store');});
 it('creates independent captures with a stable supplied ID and normalized URL',async()=>{repo.create.mockResolvedValue(record);const response=await POST(request({...record,summary:'',attention:'',version:undefined,aiCandidate:undefined}));expect(response.status).toBe(201);expect(await response.json()).toMatchObject({data:{id,status:'pending'}});expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({id,attention:'example.com'}));});
 it('signs images in lists without exposing foreign images',async()=>{repo.list.mockResolvedValue({records:[{...record,imagePath:`${owner}/2026-07-01/${id}.png`}],nextCursor:null});const response=await GET(new Request('http://test/api/records?pending=true'));expect(await response.json()).toMatchObject({data:{records:[{imageUrl:'https://signed.test/image'}]}});});
 it('rejects foreign image updates before persistence',async()=>{const response=await PATCH(request({version:1,imagePath:`${id}/2026-07-01/${id}.png`},'PATCH'),route);expect(response.status).toBe(403);expect(repo.update).not.toHaveBeenCalled();});
 it('returns current cloud record for an optimistic conflict and preserves images',async()=>{repo.update.mockRejectedValue({message:'VERSION_CONFLICT'});const response=await PATCH(request({version:1,summary:'edited'},'PATCH'),route);expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:{code:'VERSION_CONFLICT',details:{current:{id}}}});expect(mocks.remove).not.toHaveBeenCalled();});
 it('retains a shared image after deleting one record',async()=>{repo.delete.mockResolvedValue({...record,imagePath:`${owner}/2026-07-01/${id}.png`});repo.imageIsReferenced.mockResolvedValue(true);const response=await DELETE(new Request('http://test/api/records/'+id+'?version=1',{method:'DELETE'}),route);expect(response.status).toBe(200);expect(mocks.remove).not.toHaveBeenCalled();});
 it('maps stale candidate failures to actionable conflicts',async()=>{repo.update.mockRejectedValue({message:'STALE_AI_CANDIDATE'});const response=await PATCH(request({version:1,candidateJobId:id,status:'completed'},'PATCH'),route);expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:{code:'STALE_AI_CANDIDATE'}});});
 it('rejects incomplete bulk ownership validation without reporting a partial move',async()=>{repo.move.mockRejectedValue({message:'RECORD_NOT_FOUND'});const response=await MOVE(request({recordIds:[id,owner],albumId:null}));expect(response.status).toBe(404);expect(await response.json()).toMatchObject({error:{code:'NOT_FOUND'}});});
});


it('accepts descriptive sources on both create and update without URL validation',async()=>{
 const input={id,date:'2026-07-01',entryMode:'manual',attention:'Manual learning',sourceUrl:'课堂笔记 #1',summary:'My notes',inspiration:'',imagePath:null,imageName:'',albumId:null,status:'completed'};
 repo.create.mockResolvedValue({...record,...input});
 const created=await POST(request(input));
 expect(created.status).toBe(201);
 expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({sourceUrl:'课堂笔记 #1',status:'completed'}));
 repo.update.mockResolvedValue({...record,...input,version:2});
 const saved=await PATCH(request({version:1,sourceUrl:'1',status:'completed'},'PATCH'),route);
 expect(saved.status).toBe(200);
 expect(repo.update).toHaveBeenCalledWith(id,expect.objectContaining({sourceUrl:'1',status:'completed'}));
});
