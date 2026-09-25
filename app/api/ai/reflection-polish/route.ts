import { reflectionPolishInputSchema } from "@/lib/domain/reflection-polish";
import {
  aiFailure,
  aiSuccess,
  aiValidationFailure,
  createAiRequestContext,
  isAiGenerationEnabled,
} from "@/server/ai/http";
import { polishReflection } from "@/server/ai/reflection-polish";
import { consumeRateLimit } from "@/server/rate-limit/service";

export const dynamic = "force-dynamic";
const bodyByteLimit = 64 * 1024;

async function readBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > bodyByteLimit) throw new Error("BODY_TOO_LARGE");
  if (!request.body) throw new Error("INVALID_BODY");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > bodyByteLimit) {
        await reader.cancel();
        throw new Error("BODY_TOO_LARGE");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    reader.releaseLock();
  }
}

function requestIsValid(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return false;
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    const context = await createAiRequestContext();
    if (!context) return aiFailure(new Error("SESSION_EXPIRED"), requestId);
    if (!isAiGenerationEnabled()) return aiFailure(new Error("FEATURE_DISABLED"), requestId);
    if (!requestIsValid(request)) return aiValidationFailure({ message: "请求来源或格式不正确", path: [] }, requestId);

    let body: unknown;
    try {
      body = await readBody(request);
    } catch {
      return aiValidationFailure({ message: "请求内容不正确", path: [] }, requestId);
    }
    const parsed = reflectionPolishInputSchema.safeParse(body);
    if (!parsed.success) return aiValidationFailure(parsed.error.issues[0], requestId);

    await consumeRateLimit("aiGenerate", `reflection-polish:${context.userId}`, context.admin);
    return aiSuccess(
      await polishReflection(parsed.data, context.userId, request.signal),
      requestId,
    );
  } catch (error) {
    return aiFailure(error, requestId);
  }
}
