import { z } from "zod";
import { updateNarrativeSchema } from "@/lib/domain/knowledge-narrative";
import { createNarrativeContext, narrativeFailure, narrativeSuccess, narrativeValidationFailure, parseNarrativeInput } from "@/server/knowledge-narratives/http";
export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};
export async function GET(_request:Request,{params}:Context){
  const requestId=crypto.randomUUID();
  try {const context=await createNarrativeContext();if(!context) throw new Error("SESSION_EXPIRED");
    const {id}=await params;if(!z.uuid().safeParse(id).success) return narrativeValidationFailure("脉络标识格式不正确",requestId);
    return narrativeSuccess(await context.repository.get(context.userId,id),requestId);
  }catch(error){return narrativeFailure(error,requestId);}
}
export async function PATCH(request:Request,{params}:Context){
  const requestId=crypto.randomUUID();
  try {const context=await createNarrativeContext();if(!context) throw new Error("SESSION_EXPIRED");
    const {id}=await params;if(!z.uuid().safeParse(id).success) return narrativeValidationFailure("脉络标识格式不正确",requestId);
    const parsed=await parseNarrativeInput(request,updateNarrativeSchema,requestId,128_000);if("response" in parsed) return parsed.response;
    const data="result" in parsed.data
      ? await context.repository.update(context.userId,id,parsed.data)
      : await context.repository.rename(context.userId,id,parsed.data.title);
    return narrativeSuccess(data,requestId);
  }catch(error){return narrativeFailure(error,requestId);}
}
export async function DELETE(_request:Request,{params}:Context){
  const requestId=crypto.randomUUID();
  try {const context=await createNarrativeContext();if(!context) throw new Error("SESSION_EXPIRED");
    const {id}=await params;if(!z.uuid().safeParse(id).success) return narrativeValidationFailure("脉络标识格式不正确",requestId);
    await context.repository.remove(context.userId,id);
    return narrativeSuccess({id},requestId);
  }catch(error){return narrativeFailure(error,requestId);}
}
