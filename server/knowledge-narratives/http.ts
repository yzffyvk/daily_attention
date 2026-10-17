import "server-only";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { apiFailure, apiSuccess } from "@/lib/api/result";
import { logServerError, operationalErrorFields } from "@/lib/server/logging";
import { createNarrativeRepository } from "./repository";

const headers={"Cache-Control":"private, no-store"};
const errors:Record<string,{status:number;message:string}>={
  CLIENT_UPGRADE_REQUIRED:{status:409,message:"记录已升级为多条独立保存，请刷新页面后选择具体记录进行串联。"},
  SESSION_EXPIRED:{status:401,message:"登录已失效，请重新登录"},
  FEATURE_DISABLED:{status:403,message:"AI 生成功能暂未开放"},
  NARRATIVE_NOT_FOUND:{status:404,message:"这条知识脉络不存在或无权访问"},
  NARRATIVE_NOT_READY:{status:409,message:"脉络尚未生成完成或不可访问，请刷新后重试"},
  NARRATIVE_EDIT_CONFLICT:{status:409,message:"这条脉络已在其他页面更新，当前修改仍保留在编辑框内。请先把改动复制到别处，再返回列表重新打开最新内容。"},
  NARRATIVE_EDIT_INVALID:{status:422,message:"总结格式或引用来源不正确，请检查内容后重试"},
  NARRATIVE_IDEMPOTENCY_CONFLICT:{status:409,message:"本次请求的来源或问题已变化，请重新生成"},
  NARRATIVE_SOURCES_MISSING:{status:422,message:"部分来源已删除或尚未完成，请重新选择"},
  NARRATIVE_INVALID_INPUT:{status:422,message:"请选择 2–14 条不同的已完成记录"},
  DAILY_AI_LIMIT_REACHED:{status:429,message:"今日免费 2 次已用完，付费次数也不足；可购买次数包，或等待北京时间 0 点免费额度重置"},
  RATE_LIMITED:{status:429,message:"请求过于频繁，请稍后再试"},
  NARRATIVE_SERVICE_UNAVAILABLE:{status:503,message:"知识脉络服务暂时不可用，请稍后重试"},
};
export function narrativeSuccess<T>(data:T,requestId:string,status=200){return Response.json(apiSuccess(data,requestId),{status,headers});}
export function narrativeFailure(error:unknown,requestId:string){
  const candidate=error&&typeof error==="object"?(error as {message?:unknown}).message:null;
  const code=typeof candidate==="string"&&candidate in errors?candidate:"NARRATIVE_SERVICE_UNAVAILABLE";
  const mapped=errors[code];
  if(mapped.status>=500) logServerError("Knowledge narrative request failed",{requestId,...operationalErrorFields(error)});
  return Response.json(apiFailure(code,mapped.message,requestId),{status:mapped.status,headers});
}
export function narrativeValidationFailure(message:string,requestId:string){
  return Response.json(apiFailure("VALIDATION_ERROR",message,requestId),{status:422,headers});
}
export async function parseNarrativeInput<T extends z.ZodType>(request:Request,schema:T,requestId:string,maxLength=4096):Promise<{data:z.output<T>}|{response:Response}>{
  let body:unknown;
  try {const raw=await request.text();if(raw.length>maxLength) throw new Error("TOO_LARGE");body=JSON.parse(raw);}
  catch {return {response:narrativeValidationFailure("请求内容不正确",requestId)};}
  const parsed=schema.safeParse(body);
  return parsed.success?{data:parsed.data}:{response:narrativeValidationFailure(parsed.error.issues[0].message,requestId)};
}
export async function createNarrativeContext(){
  const session=await createServerSupabase();
  const {data,error}=await session.auth.getUser();if(error||!data.user) return null;
  const {data:profile,error:profileError}=await session.from("profiles").select("id").eq("id",data.user.id).maybeSingle();
  if(profileError||!profile) return null;
  const admin=createAdminSupabase();return {userId:data.user.id,admin,repository:createNarrativeRepository(admin)};
}
