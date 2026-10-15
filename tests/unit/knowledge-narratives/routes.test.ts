import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({context:vi.fn(),consume:vi.fn(),list:vi.fn(),create:vi.fn(),get:vi.fn(),rename:vi.fn(),update:vi.fn(),copy:vi.fn(),remove:vi.fn()}));
vi.mock("@/server/knowledge-narratives/http",async()=>({...await vi.importActual<object>("@/server/knowledge-narratives/http"),createNarrativeContext:mocks.context}));
vi.mock("@/server/rate-limit/service",()=>({consumeRateLimit:mocks.consume}));
import { GET as list, POST } from "@/app/api/knowledge-narratives/route";
import { GET, PATCH, DELETE } from "@/app/api/knowledge-narratives/[id]/route";
import { POST as copy } from "@/app/api/knowledge-narratives/[id]/copy/route";
import { narrativeResultFixture } from "../../helpers/narrative-fixtures";
const id="f805ec72-15a8-4b42-970e-7989e4351a11";
const input={recordIds:["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-000000000002"],question:"",idempotencyKey:id};
const request=(body:unknown=input)=>new Request("http://example.test/api/knowledge-narratives",{method:"POST",body:JSON.stringify(body)});
const ctx=()=>({params:Promise.resolve({id})});
describe("owned narrative API",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();vi.stubEnv("AI_GENERATION_ENABLED","true");
    mocks.context.mockResolvedValue({userId:"owner",admin:{},repository:{list:mocks.list,create:mocks.create,get:mocks.get,rename:mocks.rename,update:mocks.update,copy:mocks.copy,remove:mocks.remove}});
    mocks.list.mockResolvedValue([]);mocks.create.mockResolvedValue({id,status:"queued"});mocks.get.mockResolvedValue({id,status:"succeeded"});mocks.rename.mockResolvedValue({id,title:"新名称"});
  });
  it.each([()=>list(),()=>POST(request()),()=>GET(request(),ctx()),()=>PATCH(request({title:"名称"}),ctx()),()=>DELETE(request(),ctx()),()=>copy(request({idempotencyKey:id}),ctx())])("requires a verified account",async(invoke)=>{
    mocks.context.mockResolvedValue(null); expect((await invoke()).status).toBe(401);
  });
  it("returns a durable job and uses the verified account",async()=>{
    const response=await POST(request());expect(response.status).toBe(202);
    expect(mocks.create).toHaveBeenCalledWith("owner",input);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
  it("rejects duplicate selected records before any generation",async()=>{
    expect((await POST(request({...input,recordIds:[input.recordIds[0],input.recordIds[0]]}))).status).toBe(422);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("asks date-only clients to refresh before reserving quota",async()=>{
    const response=await POST(request({dates:["2026-08-31","2026-09-02"],question:"",idempotencyKey:id}));
    expect(response.status).toBe(409);expect((await response.json()).error.code).toBe("CLIENT_UPGRADE_REQUIRED");
    expect(mocks.create).not.toHaveBeenCalled();expect(mocks.consume).not.toHaveBeenCalled();
  });
  it("returns a field error for malformed JSON",async()=>{
    expect((await POST(new Request("http://example.test",{method:"POST",body:"{"}))).status).toBe(422);
  });
  it("hides resources owned by other accounts",async()=>{
    mocks.get.mockRejectedValue(new Error("NARRATIVE_NOT_FOUND"));expect((await GET(request(),ctx())).status).toBe(404);
    expect(mocks.get).toHaveBeenCalledWith("owner",id);
  });
  it("reports exhausted shared quota without exposing internals",async()=>{
    mocks.create.mockRejectedValue({message:"DAILY_AI_LIMIT_REACHED"});const response=await POST(request());
    expect(response.status).toBe(429);expect((await response.json()).error.message).toContain("5 次");
  });
  it("does not accept result or owner changes in rename",async()=>{
    expect((await PATCH(request({title:"名字",userId:"someone"}),ctx())).status).toBe(422);
    expect(mocks.rename).not.toHaveBeenCalled();
  });
  it("keeps history readable when new generation is disabled",async()=>{
    vi.stubEnv("AI_GENERATION_ENABLED","false");expect((await list()).status).toBe(200);expect((await POST(request())).status).toBe(403);
  });
  it("saves a full edited result with a revision, even when generation is disabled",async()=>{
    vi.stubEnv("AI_GENERATION_ENABLED","false");
    const body={result:narrativeResultFixture(),expectedUpdatedAt:"2026-09-10T01:02:03.123456+00:00"};
    body.result.sections[0].body="完整保留用户编写的总结。".repeat(160);
    body.result.overview="总览".repeat(500);
    body.result.framework[0].body="框架".repeat(700);
    mocks.update.mockResolvedValue({id,result:body.result});
    const response=await PATCH(request(body),ctx());
    expect(response.status).toBe(200);expect(mocks.update).toHaveBeenCalledWith("owner",id,body);
    expect(mocks.consume).not.toHaveBeenCalled();
  });
  it("requires a revision and rejects oversized edits before persistence",async()=>{
    expect((await PATCH(request({result:narrativeResultFixture()}),ctx())).status).toBe(422);
    const result=narrativeResultFixture();result.overview="x".repeat(1501);
    expect((await PATCH(request({result,expectedUpdatedAt:new Date().toISOString()}),ctx())).status).toBe(422);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("returns a recoverable conflict instead of overwriting another edit",async()=>{
    mocks.update.mockRejectedValue(new Error("NARRATIVE_EDIT_CONFLICT"));
    const response=await PATCH(request({result:narrativeResultFixture(),expectedUpdatedAt:new Date().toISOString()}),ctx());
    expect(response.status).toBe(409);expect((await response.json()).error.code).toBe("NARRATIVE_EDIT_CONFLICT");
  });
  it("copies as an owned, idempotent operation without generating AI content",async()=>{
    vi.stubEnv("AI_GENERATION_ENABLED","false");mocks.copy.mockResolvedValue({id,title:"脉络 cp"});
    const response=await copy(request({idempotencyKey:id}),ctx());
    expect(response.status).toBe(201);expect(mocks.copy).toHaveBeenCalledWith("owner",id,id);
    expect(mocks.consume).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
    expect((await copy(request({idempotencyKey:id,title:"客户端不能选名"}),ctx())).status).toBe(422);
  });
  it("deletes through the verified account and hides foreign records",async()=>{
    mocks.remove.mockResolvedValue(undefined);
    const response=await DELETE(request(),ctx());expect(response.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith("owner",id);expect((await response.json()).data).toEqual({id});
    mocks.remove.mockRejectedValue(new Error("NARRATIVE_NOT_FOUND"));
    expect((await DELETE(request(),ctx())).status).toBe(404);
  });
});
