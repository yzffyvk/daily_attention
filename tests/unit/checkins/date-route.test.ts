import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({context:vi.fn(),createUrl:vi.fn()}));
vi.mock('@/server/checkins/http',()=>({
 checkInFailure:(code:string,message:string,requestId:string,status:number,details={})=>Response.json({ok:false,error:{code,message,details},requestId},{status,headers:{'Cache-Control':'private, no-store'}}),
 checkInSuccess:(data:unknown,requestId:string)=>Response.json({ok:true,data,requestId}),
 checkInServiceFailure:()=>Response.json({ok:false},{status:503}),
 createCheckInRequestContext:mocks.context,
}));
vi.mock('@/server/storage/service',()=>({createCheckInImageUrl:mocks.createUrl}));
import { GET, PUT } from '@/app/api/checkins/[date]/route';
const route={params:Promise.resolve({date:'2026-07-23'})};
beforeEach(()=>vi.resetAllMocks());
describe('legacy date route after multi-record upgrade',()=>{
 it('rejects authenticated date writes without reading or changing a record',async()=>{
   const findByDate=vi.fn();mocks.context.mockResolvedValue({userId:'owner',repository:{findByDate}});
   const response=await PUT(new Request('https://test/api/checkins/2026-07-23',{method:'PUT',body:JSON.stringify({attention:'old-client'})}),route);
   expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:{code:'CLIENT_UPGRADE_REQUIRED'}});expect(findByDate).not.toHaveBeenCalled();
 });
 it('still requires authentication for retired writes',async()=>{mocks.context.mockResolvedValue(null);expect((await PUT(new Request('https://test',{method:'PUT'}),route)).status).toBe(401);});
 it.each([['','manual'],['?mode=ai','ai']])('reads a unique legacy record %s',async(query,mode)=>{
   const record={id:'unique',entryMode:mode,imagePath:null,version:1};const findByDate=vi.fn().mockResolvedValue(record);
   mocks.context.mockResolvedValue({userId:'owner',repository:{findByDate},supabase:{}});
   const response=await GET(new Request(`https://test/api/checkins/2026-07-23${query}`),route);
   expect(response.status).toBe(200);expect(await response.json()).toMatchObject({data:record});expect(findByDate).toHaveBeenCalledWith('owner','2026-07-23',mode);
 });
 it('requires upgrade on ambiguous date reads instead of choosing a record',async()=>{
   mocks.context.mockResolvedValue({userId:'owner',repository:{findByDate:vi.fn().mockRejectedValue(new Error('CLIENT_UPGRADE_REQUIRED'))}});
   const response=await GET(new Request('https://test/api/checkins/2026-07-23'),route);
   expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:{code:'CLIENT_UPGRADE_REQUIRED'}});
 });
 it('rejects malformed mode before reading',async()=>{
   const findByDate=vi.fn();mocks.context.mockResolvedValue({userId:'owner',repository:{findByDate}});
   expect((await GET(new Request('https://test/api/checkins/2026-07-23?mode=wrong'),route)).status).toBe(422);expect(findByDate).not.toHaveBeenCalled();
 });
});
