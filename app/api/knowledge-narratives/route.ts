import { createNarrativeSchema } from "@/lib/domain/knowledge-narrative";
import { requestIp } from "@/server/auth/request";
import { consumeRateLimit } from "@/server/rate-limit/service";
import { createNarrativeContext, narrativeFailure, narrativeSuccess, parseNarrativeInput } from "@/server/knowledge-narratives/http";
export const dynamic="force-dynamic";
export async function GET(){
  const requestId=crypto.randomUUID();
  try {const context=await createNarrativeContext();if(!context) throw new Error("SESSION_EXPIRED");
    return narrativeSuccess(await context.repository.list(context.userId),requestId);
  }catch(error){return narrativeFailure(error,requestId);}
}
export async function POST(request:Request){
  const requestId=crypto.randomUUID();
  try {const context=await createNarrativeContext();if(!context) throw new Error("SESSION_EXPIRED");
    if(process.env.AI_GENERATION_ENABLED!=="true") throw new Error("FEATURE_DISABLED");
    const parsed=await parseNarrativeInput(request,createNarrativeSchema,requestId);if("response" in parsed) return parsed.response;
    await consumeRateLimit("aiGenerate",`${context.userId}:${requestIp(request)}`,context.admin);
    return narrativeSuccess(await context.repository.create(context.userId,parsed.data),requestId,202);
  }catch(error){return narrativeFailure(error,requestId);}
}
