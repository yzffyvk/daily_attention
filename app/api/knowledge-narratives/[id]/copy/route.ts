import { z } from "zod";
import { copyNarrativeSchema } from "@/lib/domain/knowledge-narrative";
import { createNarrativeContext, narrativeFailure, narrativeSuccess, narrativeValidationFailure, parseNarrativeInput } from "@/server/knowledge-narratives/http";

export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const context = await createNarrativeContext();
    if (!context) throw new Error("SESSION_EXPIRED");
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return narrativeValidationFailure("脉络标识格式不正确", requestId);
    const parsed = await parseNarrativeInput(request, copyNarrativeSchema, requestId);
    if ("response" in parsed) return parsed.response;
    return narrativeSuccess(await context.repository.copy(context.userId, id, parsed.data.idempotencyKey), requestId, 201);
  } catch (error) { return narrativeFailure(error, requestId); }
}
