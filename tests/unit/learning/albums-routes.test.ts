import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock=vi.hoisted(()=>({context:vi.fn()}));
vi.mock('@/server/learning/http',async original=>({...await original<typeof import('@/server/learning/http')>(),createLearningRequestContext:mock.context}));
import { GET, POST } from '@/app/api/albums/route';
import { PATCH, DELETE } from '@/app/api/albums/[id]/route';
const id='00000000-0000-4000-8000-000000000001';
const route={params:Promise.resolve({id})};
const album={id,name:'学习主题',description:'',recordCount:2,completedCount:1};
const repo={listAlbums:vi.fn(),createAlbum:vi.fn(),updateAlbum:vi.fn(),deleteAlbum:vi.fn()};
const req=(body:unknown,method='POST')=>new Request('https://test/api/albums',{method,body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();mock.context.mockResolvedValue({userId:'owner',repository:repo});});
describe('album routes',()=>{
 it('lists persisted counts with private caching disabled',async()=>{repo.listAlbums.mockResolvedValue([album]);const response=await GET();expect(await response.json()).toMatchObject({data:[album]});expect(response.headers.get('Cache-Control')).toBe('private, no-store');});
 it('rejects empty album names',async()=>{const response=await POST(req({name:'  '}));expect(response.status).toBe(422);expect(repo.createAlbum).not.toHaveBeenCalled();});
 it('creates normalized album with authenticated ownership',async()=>{repo.createAlbum.mockResolvedValue(album);const response=await POST(req({name:' 学习主题 '}));expect(response.status).toBe(201);expect(repo.createAlbum).toHaveBeenCalledWith('owner',{name:'学习主题',description:''});});
 it('preserves description when a rename omits it',async()=>{repo.updateAlbum.mockResolvedValue({...album,name:'新名字',description:'原说明'});const response=await PATCH(req({name:'新名字'},'PATCH'),route);expect(response.status).toBe(200);expect(repo.updateAlbum).toHaveBeenCalledWith('owner',id,{name:'新名字'});});
 it('returns missing for an inaccessible album update',async()=>{repo.updateAlbum.mockResolvedValue(null);expect((await PATCH(req({name:'重命名'},'PATCH'),route)).status).toBe(404);});
 it('deletes only the album using its owner-scoped repository',async()=>{repo.deleteAlbum.mockResolvedValue(id);const response=await DELETE(new Request('https://test',{method:'DELETE'}),route);expect(await response.json()).toMatchObject({data:{id}});expect(repo.deleteAlbum).toHaveBeenCalledWith('owner',id);});
});
