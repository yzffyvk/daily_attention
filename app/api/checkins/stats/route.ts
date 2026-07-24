import { dateKeySchema } from "@/lib/domain/checkin";
import {
  checkInFailure,
  checkInServiceFailure,
  checkInSuccess,
  createCheckInRequestContext,
} from "@/server/checkins/http";
import { getCheckInStats } from "@/server/checkins/stats-service";

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

    const parsedToday = dateKeySchema.safeParse(
      new URL(request.url).searchParams.get("today"),
    );
    if (!parsedToday.success) {
      return checkInFailure(
        "VALIDATION_ERROR",
        parsedToday.error.issues[0].message,
        requestId,
        422,
        { field: "today" },
      );
    }

    return checkInSuccess(
      await getCheckInStats(
        context.userId,
        parsedToday.data,
        context.repository,
      ),
      requestId,
    );
  } catch (error) {
    return checkInServiceFailure(error, requestId);
  }
}
