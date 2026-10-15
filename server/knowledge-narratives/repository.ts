import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { narrativeSourceSchema, validateNarrativeResult, type CreateNarrativeInput, type EditNarrativeInput, type KnowledgeNarrative, type NarrativeSummary } from "@/lib/domain/knowledge-narrative";

type Row=Tables<"knowledge_narratives">;
const statusSchema=z.enum(["queued","generating","succeeded","failed"]);
const summaryColumns="id,title,dates,question,status,created_at,updated_at,error_code";
type SummaryRow=Pick<Row,"id"|"title"|"dates"|"question"|"status"|"created_at"|"updated_at"|"error_code">;
function mapSummary(row:SummaryRow):NarrativeSummary {
  const status=statusSchema.parse(row.status);
  return {id:row.id,title:row.title,dates:row.dates,question:row.question,status,createdAt:row.created_at,updatedAt:row.updated_at,
    error:status==="failed" ? (row.error_code==="CONTENT_BLOCKED" ? "部分内容暂时无法处理，请调整日期后重试。" : "这次串联未完成，可以重新生成。") : null};
}
export function createNarrativeRepository(client:SupabaseClient<Database>) {
  async function detail(userId:string,row:Row):Promise<KnowledgeNarrative> {
    const sources=z.array(narrativeSourceSchema).min(2).max(14).parse(row.source_snapshot);
    const ids=sources.flatMap(source=>source.id?[source.id]:[]);
    const query=client.from("check_ins").select("id,checkin_date,entry_mode,version").eq("user_id",userId);
    const {data:current,error}=await query.in(ids.length===sources.length?"id":"checkin_date",ids.length===sources.length?ids:row.dates);
    if(error) throw error;
    const versionsById=new Map((current??[]).map(source=>[source.id,source.version]));
    const versionsByMode=new Map((current??[]).map(source=>[`${source.checkin_date}:${source.entry_mode??"manual"}`,source.version]));
    return {...mapSummary(row),sources,result:row.result===null?null:validateNarrativeResult(row.result,row.dates,sources.flatMap(source=>source.id?[source.id]:[])),changedDates:sources.filter(source=>(source.id ? versionsById.get(source.id) : versionsByMode.get(`${source.date}:${source.entryMode??"manual"}`))!==source.version).map(source=>source.date)};
  }
  return {
    async list(userId:string):Promise<NarrativeSummary[]> {
      const {data,error}=await client.from("knowledge_narratives").select(summaryColumns).eq("user_id",userId).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(50);
      if(error) throw error; return (data??[]).map(mapSummary);
    },
    async create(userId:string,input:CreateNarrativeInput):Promise<KnowledgeNarrative> {
      if (!("recordIds" in input)) throw new Error("CLIENT_UPGRADE_REQUIRED");
      const {data,error}=await client.rpc("create_record_knowledge_narrative",{target_user_id:userId,target_record_ids:input.recordIds,target_question:input.question,target_idempotency_key:input.idempotencyKey});
      if(error) throw error; const row=data?.[0]; if(!row) throw new Error("NARRATIVE_SERVICE_UNAVAILABLE");
      return detail(userId,row);
    },
    async get(userId:string,id:string):Promise<KnowledgeNarrative> {
      const {data,error}=await client.from("knowledge_narratives").select().eq("user_id",userId).eq("id",id).maybeSingle();
      if(error) throw error; if(!data) throw new Error("NARRATIVE_NOT_FOUND"); return detail(userId,data);
    },
    async rename(userId:string,id:string,title:string):Promise<KnowledgeNarrative> {
      const {data,error}=await client.rpc("update_knowledge_narrative",{target_user_id:userId,target_id:id,target_title:title});
      if(error) throw error; if(!data?.[0]) throw new Error("NARRATIVE_NOT_FOUND"); return detail(userId,data[0]);
    },
    async update(userId:string,id:string,input:EditNarrativeInput):Promise<KnowledgeNarrative> {
      const {data:source,error:sourceError}=await client.from("knowledge_narratives").select("dates,source_snapshot").eq("user_id",userId).eq("id",id).maybeSingle();
      if(sourceError) throw sourceError; if(!source) throw new Error("NARRATIVE_NOT_FOUND");
      let result;
      try {result=validateNarrativeResult(input.result,source.dates,Array.isArray(source.source_snapshot)?z.array(narrativeSourceSchema).parse(source.source_snapshot).flatMap(item=>item.id?[item.id]:[]):[]);} catch {throw new Error("NARRATIVE_EDIT_INVALID");}
      const {data,error}=await client.rpc("update_knowledge_narrative",{target_user_id:userId,target_id:id,target_result:result,target_expected_updated_at:input.expectedUpdatedAt});
      if(error) throw error; if(!data?.[0]) throw new Error("NARRATIVE_NOT_FOUND"); return detail(userId,data[0]);
    },
    async copy(userId:string,id:string,idempotencyKey:string):Promise<KnowledgeNarrative> {
      const {data,error}=await client.rpc("copy_knowledge_narrative",{target_user_id:userId,target_id:id,target_idempotency_key:idempotencyKey});
      if(error) throw error; if(!data?.[0]) throw new Error("NARRATIVE_NOT_FOUND"); return detail(userId,data[0]);
    },
    async remove(userId:string,id:string):Promise<void> {
      const {error}=await client.rpc("delete_knowledge_narrative",{target_user_id:userId,target_id:id});
      if(error) throw error;
    },
  };
}
