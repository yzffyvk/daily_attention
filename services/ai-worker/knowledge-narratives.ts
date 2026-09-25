import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "../../lib/supabase/database.types.ts";
import { narrativeSourceSchema, validateNarrativeResult, type NarrativeSource, type NarrativeResult } from "../../lib/domain/knowledge-narrative.ts";
import { DeepSeekProviderError } from "../../supabase/functions/_shared/ai/deepseek.ts";
import { createNarrativeProvider } from "../../supabase/functions/_shared/knowledge-narratives/provider.ts";
import { assertAiProviderModeAllowed, readSupabaseWorkerKey } from "../../supabase/functions/_shared/ai/environment.ts";

type ClaimedNarrative = { id:string; userId:string; claimToken:string; sources:NarrativeSource[]; question:string };
export type NarrativeWorkerPorts = {
  claim():Promise<ClaimedNarrative|null>;
  anonymousUserId(userId:string):Promise<string>;
  generate(input:{sources:NarrativeSource[];question:string;anonymousUserId:string}):Promise<NarrativeResult>;
  finish(input:{id:string;claimToken:string;result:NarrativeResult|null;errorCode:string|null;retryable:boolean}):Promise<boolean>;
};

export async function runNarrativeJob(ports:NarrativeWorkerPorts) {
  const job=await ports.claim(); if(!job) return;
  let result:NarrativeResult|null=null;
  let errorCode:string|null=null;
  let retryable=false;
  try {
    const anonymousUserId=await ports.anonymousUserId(job.userId);
    const generated=await ports.generate({sources:job.sources,question:job.question,anonymousUserId});
    result=validateNarrativeResult(generated,job.sources.map(source=>source.date));
  } catch(error) {
    errorCode=error instanceof DeepSeekProviderError ? error.code : "MODEL_SERVICE_ERROR";
    retryable=error instanceof DeepSeekProviderError ? error.retryable : true;
  }
  // Persistence errors leave the lease to recover; never replace a committed success with failure.
  await ports.finish({id:job.id,claimToken:job.claimToken,result,errorCode,retryable});
}

export function createNarrativeWorker(readEnvironment:(name:string)=>string|undefined):NarrativeWorkerPorts {
  const url=readEnvironment("SUPABASE_URL") ?? readEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  const key=readSupabaseWorkerKey(readEnvironment);
  const pepper=readEnvironment("AI_USER_ID_PEPPER");
  const apiKey=readEnvironment("DEEPSEEK_API_KEY");
  const mode=readEnvironment("AI_PROVIDER_MODE") ?? "deepseek";
  assertAiProviderModeAllowed({mode,nodeEnv:readEnvironment("NODE_ENV"),integrationTestBindings:readEnvironment("INTEGRATION_TEST_BINDINGS")});
  if(!url||!key||!pepper||pepper.length<32||(mode==="deepseek"&&!apiKey)) throw new Error("NARRATIVE_WORKER_CONFIGURATION_ERROR");
  const client=createClient<Database>(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(10_000)})}});
  const provider:ReturnType<typeof createNarrativeProvider>=mode==="fake" ? {
    async generate(input:{sources:NarrativeSource[]}):Promise<NarrativeResult>{
      const sources=[...input.sources].sort((a,b)=>a.date.localeCompare(b.date));
      return {
        schemaVersion:2,mode:"source_records",title:"测试环境的学习记录",
        reason:"insufficient_material",sourceDates:sources.map(source=>source.date),
      };
    },
  } : createNarrativeProvider({apiKey:apiKey!});
  return {
    async claim(){
      const {data,error}=await client.rpc("claim_knowledge_narrative"); if(error) throw error;
      const row=data?.[0]; if(!row) return null;
      return {id:row.id,userId:row.user_id,claimToken:z.uuid().parse(row.claim_token),sources:z.array(narrativeSourceSchema).min(2).max(14).parse(row.source_snapshot),question:row.question};
    },
    async anonymousUserId(userId){
      const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(pepper),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
      const digest=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(userId));
      return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
    },
    generate(input){return provider.generate({...input,signal:AbortSignal.timeout(120_000)});},
    async finish(input){
      const {data,error}=await client.rpc("finish_knowledge_narrative",{target_id:input.id,target_claim_token:input.claimToken,target_result:input.result as unknown as Json,target_error_code:input.errorCode ?? "",target_retryable:input.retryable});
      if(error) throw error; return data === true;
    },
  };
}
