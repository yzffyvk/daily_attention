import { z } from "zod";
import { narrativeSourceSchema, validateNarrativeResult, type NarrativeResult, type NarrativeSource } from "../../../../lib/domain/knowledge-narrative.ts";
import { DeepSeekProviderError } from "../ai/deepseek.ts";
import { knowledgeMapResultSchema } from "../../../../lib/domain/knowledge-map.ts";
import { knowledgeMapPrompt, recordKnowledgeMapPrompt } from "./prompt.ts";

const inputSchema = z.object({
  sources: z.array(narrativeSourceSchema).min(2).max(14),
  question: z.string().max(300), anonymousUserId: z.string().regex(/^[0-9a-f]{64}$/),
});

export function createNarrativeProvider(config: { apiKey: string; fetchImpl?: typeof fetch }) {
  if (!config.apiKey || config.apiKey.length > 512) throw new Error("DEEPSEEK_CONFIG_INVALID");
  const fetchImpl = config.fetchImpl ?? fetch;
  return {
    async generate(input: {sources: NarrativeSource[]; question: string; anonymousUserId: string; signal?: AbortSignal}): Promise<NarrativeResult> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) throw new DeepSeekProviderError("MODEL_OUTPUT_INVALID", false);
      let response: Response;
      try {
        response = await fetchImpl("https://api.deepseek.com/chat/completions", {
          method:"POST", headers:{Authorization:`Bearer ${config.apiKey}`,"Content-Type":"application/json",Accept:"application/json"},
          signal: input.signal ?? AbortSignal.timeout(120_000),
          body:JSON.stringify({model:"deepseek-flash",thinking:{type:"enabled"},reasoning_effort:"high",response_format:{type:"json_object"},max_tokens:16384,stream:false,user_id:input.anonymousUserId,
            messages:[{role:"system",content:parsed.data.sources.every(source=>Boolean(source.id))?recordKnowledgeMapPrompt:knowledgeMapPrompt},{role:"user",content:JSON.stringify({dataType:"untrusted_learning_records",question:parsed.data.question,sources:parsed.data.sources})}]}),
        });
      } catch { throw new DeepSeekProviderError("MODEL_SERVICE_ERROR", true); }
      if (response.status === 429) throw new DeepSeekProviderError("MODEL_RATE_LIMITED", true);
      if (!response.ok) throw new DeepSeekProviderError("MODEL_SERVICE_ERROR", response.status >= 500);
      let payload: unknown;
      try {
        // Bound streamed bytes, including reasoning text, before allocating a complete response.
        const reader=response.body?.getReader();
        if (!reader) throw new Error("EMPTY_BODY");
        const chunks:Uint8Array[]=[]; let size=0;
        try {
          while (true) {
            const {done,value}=await reader.read(); if(done) break;
            size+=value.byteLength;
            if(size>2*1024*1024) { await reader.cancel(); throw new Error("RESPONSE_TOO_LARGE"); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        const bytes=new Uint8Array(size); let offset=0;
        for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
        payload=JSON.parse(new TextDecoder().decode(bytes));
      } catch { throw new DeepSeekProviderError("MODEL_OUTPUT_INVALID", true); }
      const envelope=z.object({choices:z.array(z.object({finish_reason:z.string(),message:z.object({content:z.string().nullable()})})).min(1)}).safeParse(payload);
      if(!envelope.success) throw new DeepSeekProviderError("MODEL_OUTPUT_INVALID", true);
      const choice=envelope.data.choices[0];
      if(choice.finish_reason==="content_filter") throw new DeepSeekProviderError("CONTENT_BLOCKED",false);
      if(choice.finish_reason!=="stop"||!choice.message.content) throw new DeepSeekProviderError("MODEL_OUTPUT_INVALID",true);
      try {
        const result=knowledgeMapResultSchema.parse(JSON.parse(choice.message.content));
        if(parsed.data.sources.every(source=>Boolean(source.id)) && result.schemaVersion !== 3) throw new Error("RECORD_CITATIONS_REQUIRED");
        return validateNarrativeResult(result,parsed.data.sources.map(s=>s.date),parsed.data.sources.flatMap(s=>s.id?[s.id]:[]));
      }
      catch { throw new DeepSeekProviderError("MODEL_OUTPUT_INVALID",true); }
    },
  };
}
