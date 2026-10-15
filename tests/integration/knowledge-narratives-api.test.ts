import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { createNarrativeWorker, runNarrativeJob } from "@/services/ai-worker/knowledge-narratives";
import { createNarrativeProvider } from "@/supabase/functions/_shared/knowledge-narratives/provider";
import { knowledgeMapFixture, mapDates as narrativeDates } from "../helpers/knowledge-map-fixtures";
import { ApiSession } from "../helpers/api-session";
import { cleanupIntegrationFixtures, trackIntegrationRateBucket, trackIntegrationUser, uniqueEmail } from "../helpers/integration-fixtures";

let seed=75000;
async function account(){
  const ip=`narrative-${crypto.randomUUID()}`;
  const session=new ApiSession(undefined,{"CF-Connecting-IP":ip});
  const email=uniqueEmail(seed++);trackIntegrationRateBucket("register",ip);
  const registration=await session.post("/api/auth/register",{email,password:"password123"});
  expect(registration.status).toBe(201);
  const profile=registration.body.data.profile;trackIntegrationUser(profile.id,profile.email);
  trackIntegrationRateBucket("login",`${ip}:${email}`);
  expect((await session.post("/api/auth/login",{email,password:"password123"})).status).toBe(200);
  expect((await session.post("/api/onboarding",{displayName:"脉络测试",avatarKey:1})).status).toBe(200);
  trackIntegrationRateBucket("ai_generate",`${profile.id}:${ip}`);
  return {session,userId:profile.id};
}
afterAll(cleanupIntegrationFixtures);
describe("knowledge narrative API lifecycle",()=>{
  it("preserves owned source snapshots through generation, rename, refresh and source changes",async()=>{
    const anonymous=new ApiSession();expect((await anonymous.get("/api/knowledge-narratives")).status).toBe(401);
    const owner=await account(); const other=await account();
    const recordIds=narrativeDates.map(()=>crypto.randomUUID());
    const note={entryMode:"manual",status:"completed",attention:"记录与复盘",summary:"原始版本的知识",inspiration:"寻找联系",sourceUrl:"",imagePath:null,imageName:""};
    for(const [index,id] of recordIds.entries()) expect((await owner.session.post("/api/records",{...note,id,date:narrativeDates[0],entryMode:index===1?"ai":"manual"})).status).toBe(201);
    const input={recordIds:[...recordIds].reverse(),question:"如何形成理解？",idempotencyKey:crypto.randomUUID()};
    const created=await owner.session.post("/api/knowledge-narratives",input);expect(created.status).toBe(202);
    const job=created.body.data;expect(job.status).toBe("queued");expect(job.sources[0].summary).toBe(note.summary);
    const retry=await owner.session.post("/api/knowledge-narratives",input);expect(retry.body.data.id).toBe(job.id);
    expect((await other.session.get(`/api/knowledge-narratives/${job.id}`)).status).toBe(404);
    expect((await other.session.get("/api/knowledge-narratives")).body.data).toEqual([]);
    expect((await other.session.post("/api/knowledge-narratives",{...input,idempotencyKey:crypto.randomUUID()})).status).toBe(422);
    expect((await owner.session.request(`/api/records/${recordIds[0]}`,{method:"PATCH",body:JSON.stringify({...note,version:1,summary:"更新后的知识"})})).status).toBe(200);
    const updated=await owner.session.get(`/api/knowledge-narratives/${job.id}`);
    expect(updated.body.data.changedDates).toEqual([narrativeDates[0]]);expect(updated.body.data.sources[0].summary).toBe(note.summary);

    const url=process.env.TEST_SUPABASE_URL!;expect(new URL(url).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
    const client=createClient<Database>(url,process.env.TEST_SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
    const claimToken=crypto.randomUUID();
    // Scope the test lease to this fixture account, avoiding consumption of unrelated local jobs.
    // The production global claim/quotas/fencing lifecycle is covered separately by pgTAP.
    const leased=await client.from("knowledge_narratives").update({status:"generating",claim_token:claimToken,lease_expires_at:new Date(Date.now()+180000).toISOString(),started_at:new Date().toISOString(),attempt_count:1}).eq("user_id",owner.userId).eq("id",job.id).eq("status","queued").select("id").single();
    expect(leased.error).toBeNull();
    const env:Record<string,string>={NEXT_PUBLIC_SUPABASE_URL:url,SUPABASE_SECRET_KEY:process.env.TEST_SUPABASE_SECRET_KEY!,AI_USER_ID_PEPPER:"integration-narrative-pepper-of-32-characters",DEEPSEEK_API_KEY:"unused-fixture-key"};
    const worker=createNarrativeWorker(name=>env[name]);
    const legacyMap=knowledgeMapFixture();
    const referenceIds=(dates:string[])=>dates.map(date=>recordIds[narrativeDates.indexOf(date)]);
    const recordMap={...legacyMap,schemaVersion:3,concepts:legacyMap.concepts.map(({sourceDates,...concept})=>({...concept,sourceRecordIds:referenceIds(sourceDates)})),connections:legacyMap.connections.map(({sourceDates,...connection})=>({...connection,sourceRecordIds:referenceIds(sourceDates)}))};
    const provider=createNarrativeProvider({apiKey:"unused-fixture-key",fetchImpl:async()=>Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(recordMap)}}]})});
    await runNarrativeJob({...worker,claim:async()=>({id:job.id,userId:owner.userId,claimToken,sources:job.sources,question:job.question}),generate:input=>provider.generate(input)});
    const completed=await owner.session.get(`/api/knowledge-narratives/${job.id}`);
    expect(completed.status).toBe(200);expect(completed.body.data.status).toBe("succeeded");expect(completed.body.data.result.mode).toBe("concept_map");expect(completed.body.data.result.concepts.flatMap((concept:{sourceRecordIds:string[]})=>concept.sourceRecordIds).sort()).toEqual([...recordIds].sort());
    const renamed=await owner.session.request(`/api/knowledge-narratives/${job.id}`,{method:"PATCH",body:JSON.stringify({title:"我的第一条知识脉络"})});
    expect(renamed.status).toBe(200);expect(renamed.body.data.title).toBe("我的第一条知识脉络");
    expect((await owner.session.get("/api/knowledge-narratives")).body.data[0]).toMatchObject({id:job.id,title:"我的第一条知识脉络",status:"succeeded"});
    expect((await other.session.request(`/api/knowledge-narratives/${job.id}`,{method:"PATCH",body:JSON.stringify({title:"不可覆盖"})})).status).toBe(404);
    const editedResult={...renamed.body.data.result,title:"我的知识地图",overview:"用自己的话改写 AI 总结。"};
    const editBody={result:editedResult,expectedUpdatedAt:renamed.body.data.updatedAt};
    const invalidResult={...editedResult,concepts:editedResult.concepts.map((concept:object,index:number)=>index===0?{...concept,sourceRecordIds:[crypto.randomUUID()]}:concept)};
    expect((await owner.session.request(`/api/knowledge-narratives/${job.id}`,{method:"PATCH",body:JSON.stringify({...editBody,result:invalidResult})})).status).toBe(422);
    const edited=await owner.session.request(`/api/knowledge-narratives/${job.id}`,{method:"PATCH",body:JSON.stringify(editBody)});
    expect(edited.status).toBe(200);expect(edited.body.data.result).toEqual(editedResult);
    expect((await owner.session.request(`/api/knowledge-narratives/${job.id}`,{method:"PATCH",body:JSON.stringify(editBody)})).status).toBe(409);
    expect((await owner.session.get(`/api/knowledge-narratives/${job.id}`)).body.data.result).toEqual(editedResult);
    const copyInput={idempotencyKey:crypto.randomUUID()};
    expect((await other.session.post(`/api/knowledge-narratives/${job.id}/copy`,copyInput)).status).toBe(404);
    const copied=await owner.session.post(`/api/knowledge-narratives/${job.id}/copy`,copyInput);
    expect(copied.status).toBe(201);const copy=copied.body.data;
    expect(copy.id).not.toBe(job.id);expect(copy.title).toBe("我的知识地图 cp");expect(copy.sources).toEqual(job.sources);
    expect(copy.result.overview).toBe(editedResult.overview);
    expect((await owner.session.post(`/api/knowledge-narratives/${job.id}/copy`,copyInput)).body.data.id).toBe(copy.id);
    const concurrentCopies=await Promise.all(Array.from({length:3},()=>owner.session.post(`/api/knowledge-narratives/${job.id}/copy`,{idempotencyKey:crypto.randomUUID()})));
    expect(concurrentCopies.every(response=>response.status===201)).toBe(true);
    expect(concurrentCopies.map(response=>response.body.data.title).sort()).toEqual(["我的知识地图 2 cp","我的知识地图 3 cp","我的知识地图 4 cp"]);
    const editedCopy=await owner.session.request(`/api/knowledge-narratives/${copy.id}`,{method:"PATCH",body:JSON.stringify({result:{...copy.result,overview:"这是副本里的不同理解"},expectedUpdatedAt:copy.updatedAt})});
    expect(editedCopy.status).toBe(200);
    expect((await owner.session.get(`/api/knowledge-narratives/${job.id}`)).body.data.result.overview).toBe(editedResult.overview);
    const unicodeRename=await owner.session.request(`/api/knowledge-narratives/${job.id}`,{method:"PATCH",body:JSON.stringify({title:"😀".repeat(60)})});
    expect(unicodeRename.status).toBe(200);
    const unicodeCopyInput={idempotencyKey:crypto.randomUUID()};
    const unicodeCopy=await owner.session.post(`/api/knowledge-narratives/${job.id}/copy`,unicodeCopyInput);
    expect(unicodeCopy.status).toBe(201);expect(unicodeCopy.body.data.title.length).toBeLessThanOrEqual(120);
    expect(unicodeCopy.body.data.title.endsWith(" cp")).toBe(true);
    expect((await owner.session.post(`/api/knowledge-narratives/${job.id}/copy`,unicodeCopyInput)).body.data.id).toBe(unicodeCopy.body.data.id);
    expect((await owner.session.get(`/api/knowledge-narratives/${unicodeCopy.body.data.id}`)).body.data.result.title).toBe(unicodeCopy.body.data.title);
    expect((await other.session.request(`/api/knowledge-narratives/${job.id}`,{method:"DELETE"})).status).toBe(404);
    expect((await owner.session.request(`/api/knowledge-narratives/${job.id}`,{method:"DELETE"})).status).toBe(200);
    expect((await owner.session.get(`/api/knowledge-narratives/${job.id}`)).status).toBe(404);
    expect((await owner.session.get("/api/knowledge-narratives")).body.data.some((item:{id:string})=>item.id===job.id)).toBe(false);
    expect((await owner.session.get(`/api/knowledge-narratives/${copy.id}`)).body.data.result.overview).toBe("这是副本里的不同理解");
    expect((await owner.session.post(`/api/knowledge-narratives/${job.id}/copy`,copyInput)).body.data.id).toBe(copy.id);
    // Confirm the independent edited copy survives a read directly from durable storage.
    const stored=await client.from("knowledge_narratives").select("result").eq("id",copy.id).eq("user_id",owner.userId).single();
    expect(stored.data?.result).toEqual(editedCopy.body.data.result);

  },30000);
});
