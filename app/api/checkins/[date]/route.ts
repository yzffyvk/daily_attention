import { checkInEntryModeSchema, dateKeySchema, writableDateKeySchema } from "@/lib/domain/checkin";
import {
  checkInFailure,
  checkInServiceFailure,
  checkInSuccess,
  createCheckInRequestContext,
} from "@/server/checkins/http";
import {
  createCheckInImageUrl,
} from "@/server/storage/service";

type RouteContext = {
  params: Promise<{ date: string }>;
};

export const dynamic = "force-dynamic";

async function parseDate(context: RouteContext, requestId: string, forWrite = false): Promise<{ date: string } | { response: Response }> {
  const { date } = await context.params;
  const parsed = (forWrite ? writableDateKeySchema : dateKeySchema).safeParse(date);
  if (!parsed.success) {
    return {
      response: checkInFailure(
        "VALIDATION_ERROR",
        parsed.error.issues[0].message,
        requestId,
        422,
        { field: "date" },
      ),
    };
  }
  return { date: parsed.data };
}

export async function GET(request: Request, routeContext: RouteContext) {
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

    const parsedDate = await parseDate(routeContext, requestId);
    if ("response" in parsedDate) return parsedDate.response;
    const parsedMode = checkInEntryModeSchema.safeParse(new URL(request.url).searchParams.get("mode") ?? "manual");
    if (!parsedMode.success) {
      return checkInFailure("VALIDATION_ERROR", "记录模式不正确", requestId, 422, { field: "mode" });
    }
    const record = await context.repository.findByDate(
      context.userId,
      parsedDate.date,
      parsedMode.data,
    );
    if (!record) {
      return checkInFailure(
        "NOT_FOUND",
        "这一天还没有打卡记录",
        requestId,
        404,
      );
    }
    const imageUrl = record.imagePath
      ? await createCheckInImageUrl(
          context.userId,
          record.imagePath,
          context.supabase,
        )
      : null;
    return checkInSuccess({ ...record, imageUrl }, requestId);
  } catch (error) {
    if (error instanceof Error && error.message === "CLIENT_UPGRADE_REQUIRED") return checkInFailure("CLIENT_UPGRADE_REQUIRED", "同日已有多条记录，请刷新页面使用新版", requestId, 409);
    return checkInServiceFailure(error, requestId);
  }
}
export const PUT: (request: Request, routeContext: RouteContext) => Promise<Response> = async () => {
  const requestId = crypto.randomUUID();
  try {
    const context = await createCheckInRequestContext();
    if (!context) return checkInFailure("SESSION_EXPIRED", "登录已失效，请重新登录", requestId, 401);
    return checkInFailure("CLIENT_UPGRADE_REQUIRED", "记录已升级为每天多条，请刷新页面后继续保存", requestId, 409);
  } catch (error) {
    return checkInServiceFailure(error, requestId);
  }
}
