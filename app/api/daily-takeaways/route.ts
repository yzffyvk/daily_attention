import { takeawayActionSchema } from "@/lib/domain/daily-takeaway";
import { createTakeawayContext, takeawayFailure, takeawaySuccess } from "@/server/daily-takeaways/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const context = await createTakeawayContext();
    if (!context) return takeawayFailure(new Error("SESSION_EXPIRED"), requestId);
    return takeawaySuccess(await context.repository.get(context.userId), requestId);
  } catch (error) {
    return takeawayFailure(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const context = await createTakeawayContext();
    if (!context) return takeawayFailure(new Error("SESSION_EXPIRED"), requestId);
    let input: unknown;
    try {
      const raw = await request.text();
      if (raw.length > 1024) throw new Error("TOO_LARGE");
      input = JSON.parse(raw);
    } catch {
      return takeawayFailure(new Error("VALIDATION_ERROR"), requestId);
    }
    const parsed = takeawayActionSchema.safeParse(input);
    if (!parsed.success) return takeawayFailure(new Error("VALIDATION_ERROR"), requestId);
    return takeawaySuccess(await context.repository.act(context.userId, parsed.data), requestId);
  } catch (error) {
    return takeawayFailure(error, requestId);
  }
}
