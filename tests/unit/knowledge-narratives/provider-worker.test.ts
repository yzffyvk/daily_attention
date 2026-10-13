import { describe, expect, it, vi } from "vitest";
import { createNarrativeProvider } from "@/supabase/functions/_shared/knowledge-narratives/provider";
import { createNarrativeWorker, runNarrativeJob, type NarrativeWorkerPorts } from "@/services/ai-worker/knowledge-narratives";
import { narrativeResultFixture, narrativeSourcesFixture } from "@/tests/helpers/narrative-fixtures";
import { knowledgeMapFixture, knowledgeMapSourcesFixture, sourceRecordsFixture } from "@/tests/helpers/knowledge-map-fixtures";

function envelope(content: unknown) {
  return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] });
}
describe("narrative generation", () => {
  it("sends untrusted saved sources and accepts a concept map with source provenance", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope(knowledgeMapFixture()));
    const result = await createNarrativeProvider({apiKey:"test-key",fetchImpl}).generate({sources:knowledgeMapSourcesFixture(),question:"如何理解？",anonymousUserId:"a".repeat(64)});
    expect(result).toMatchObject({mode:"concept_map",title:"从理解用户，到验证需求"});
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(sent.model).toBe("deepseek-flash");
    expect(sent.messages[0].content).toContain("时间顺序不代表因果");
    expect(sent.messages[1].content).toContain("untrusted_learning_records");
    expect(sent.user_id).toBe("a".repeat(64));
  });
  it("returns a sources-only result for mixed topics without manufacturing a map", async () => {
    const provider = createNarrativeProvider({ apiKey: "test-key", fetchImpl: vi.fn().mockResolvedValue(envelope(sourceRecordsFixture())) });
    expect(await provider.generate({ sources: knowledgeMapSourcesFixture(), question: "", anonymousUserId: "a".repeat(64) })).toEqual(sourceRecordsFixture());
  });
  it("requires new generations to use the new contract while old results remain readable elsewhere", async () => {
    const provider = createNarrativeProvider({ apiKey: "test-key", fetchImpl: vi.fn().mockResolvedValue(envelope(narrativeResultFixture())) });
    await expect(provider.generate({ sources: narrativeSourcesFixture(), question: "", anonymousUserId: "a".repeat(64) })).rejects.toMatchObject({ code: "MODEL_OUTPUT_INVALID" });
  });
  it("rejects fabricated citations and malformed provider output", async () => {
    const result = knowledgeMapFixture(); result.concepts[0].sourceDates = ["2026-09-10"];
    const provider = createNarrativeProvider({apiKey:"test-key",fetchImpl:vi.fn().mockResolvedValue(envelope(result))});
    await expect(provider.generate({sources:knowledgeMapSourcesFixture(),question:"",anonymousUserId:"a".repeat(64)})).rejects.toThrow("MODEL_OUTPUT_INVALID");
  });
  it("marks provider overload as retryable", async () => {
    const provider = createNarrativeProvider({apiKey:"test-key",fetchImpl:vi.fn().mockResolvedValue(new Response("",{status:429}))});
    await expect(provider.generate({sources:narrativeSourcesFixture(),question:"",anonymousUserId:"a".repeat(64)})).rejects.toMatchObject({retryable:true,code:"MODEL_RATE_LIMITED"});
  });
});
describe("durable narrative worker", () => {
  const environment:Record<string,string>={NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:54321",SUPABASE_SECRET_KEY:"test-secret",AI_USER_ID_PEPPER:"a".repeat(32),AI_PROVIDER_MODE:"fake",NODE_ENV:"test"};
  it("supports fake mode without a model key and performs no provider request",async()=>{
    const fetchSpy=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("NETWORK_MUST_NOT_BE_USED"));
    const worker=createNarrativeWorker(name=>environment[name]);
    const result=await worker.generate({sources:narrativeSourcesFixture(),question:"",anonymousUserId:"a".repeat(64)});
    expect(result).toMatchObject({schemaVersion:2,mode:"source_records",sourceDates:["2026-08-31","2026-09-02"]});
    expect(fetchSpy).not.toHaveBeenCalled();fetchSpy.mockRestore();
  });
  it("rejects fake mode outside the existing authorized test modes",()=>{
    expect(()=>createNarrativeWorker(name=>({...environment,NODE_ENV:"production",DEEPSEEK_API_KEY:"test-key"})[name])).toThrow("FUNCTION_CONFIGURATION_ERROR");
  });
  it.each(["SUPABASE_SERVICE_ROLE_KEY","SUPABASE_SECRET_KEYS"])("accepts existing %s configuration",keyName=>{
    const env:Record<string,string>={...environment,DEEPSEEK_API_KEY:"test-key",[keyName]:keyName==="SUPABASE_SECRET_KEYS"?JSON.stringify({default:"test-secret"}):"test-secret"};
    delete env.SUPABASE_SECRET_KEY;
    expect(()=>createNarrativeWorker(name=>env[name])).not.toThrow();
  });
  function ports() {
    return {
      claim: vi.fn().mockResolvedValue({ id:"job", userId:"owner", claimToken:"lease", sources:narrativeSourcesFixture(), question:"" }),
      anonymousUserId: vi.fn().mockResolvedValue("a".repeat(64)),
      generate: vi.fn().mockResolvedValue(narrativeResultFixture()),
      finish: vi.fn().mockResolvedValue(true),
    } satisfies NarrativeWorkerPorts;
  }
  it("finishes with the original claim token and validated sources", async () => {
    const deps = ports();
    await runNarrativeJob(deps);
    expect(deps.finish).toHaveBeenCalledWith({id:"job",claimToken:"lease",result:narrativeResultFixture(),errorCode:null,retryable:false});
  });
  it("does not call the model for an empty queue", async () => {
    const deps=ports(); deps.claim.mockResolvedValue(null); await runNarrativeJob(deps);
    expect(deps.generate).not.toHaveBeenCalled();
  });
  it("persists model failures without leaking raw error messages", async () => {
    const deps=ports(); deps.generate.mockRejectedValue(new Error("secret network detail")); await runNarrativeJob(deps);
    expect(deps.finish).toHaveBeenCalledWith({id:"job",claimToken:"lease",result:null,errorCode:"MODEL_SERVICE_ERROR",retryable:true});
  });
  it("does not overwrite success with failure when persistence is unavailable", async () => {
    const deps=ports(); deps.finish.mockRejectedValue(new Error("db unavailable"));
    await expect(runNarrativeJob(deps)).rejects.toThrow("db unavailable");
    expect(deps.finish).toHaveBeenCalledTimes(1);
  });
});
