import { monthQuerySchema } from "@/lib/domain/checkin";
import {
  checkInFailure,
  checkInServiceFailure,
  checkInSuccess,
  createCheckInRequestContext,
} from "@/server/checkins/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const context = await createCheckInRequestContext();
    if (!context) {
      return checkInFailure(
        "SESSION_EXPIRED",
        "登录已失效，请重新登录",
        requestId,
        401,
      );
    }

    const month = new URL(request.url).searchParams.get("month") ?? "";
    const parsed = monthQuerySchema.safeParse(month);
    if (!parsed.success) {
      return checkInFailure(
        "VALIDATION_ERROR",
        parsed.error.issues[0].message,
        requestId,
        422,
        { field: "month" },
      );
    }

    return checkInSuccess(
      await context.repository.findByMonth(context.userId, parsed.data),
      requestId,
    );
  } catch (error) {
    return checkInServiceFailure(error, requestId);
  }
}
