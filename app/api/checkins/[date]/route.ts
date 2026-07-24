import { checkInInputSchema, dateKeySchema } from "@/lib/domain/checkin";
import {
  checkInFailure,
  checkInServiceFailure,
  checkInSuccess,
  createCheckInRequestContext,
} from "@/server/checkins/http";
import { saveCheckIn } from "@/server/checkins/service";
import {
  createCheckInImageUrl,
  removeCheckInImage,
} from "@/server/storage/service";

type RouteContext = {
  params: Promise<{ date: string }>;
};

export const dynamic = "force-dynamic";

async function parseDate(context: RouteContext, requestId: string) {
  const { date } = await context.params;
  const parsed = dateKeySchema.safeParse(date);
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

export async function GET(_request: Request, routeContext: RouteContext) {
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
    const record = await context.repository.findByDate(
      context.userId,
      parsedDate.date,
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
      ? await createCheckInImageUrl(record.imagePath, context.supabase)
      : null;
    return checkInSuccess({ ...record, imageUrl }, requestId);
  } catch (error) {
    return checkInServiceFailure(error, requestId);
  }
}
export async function PUT(request: Request, routeContext: RouteContext) {
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return checkInFailure(
        "VALIDATION_ERROR",
        "请求内容不正确",
        requestId,
        422,
      );
    }
    const parsedInput = checkInInputSchema.safeParse(body);
    if (!parsedInput.success) {
      const issue = parsedInput.error.issues[0];
      return checkInFailure(
        "VALIDATION_ERROR",
        issue.message,
        requestId,
        422,
        { field: issue.path[0]?.toString() },
      );
    }

    const previous = await context.repository.findByDate(
      context.userId,
      parsedDate.date,
    );
    const result = await saveCheckIn(
      context.userId,
      parsedDate.date,
      parsedInput.data,
      context.repository,
    );
    if (!result.ok) {
      return checkInFailure(
        "VERSION_CONFLICT",
        "云端记录已更新，请确认后重试",
        requestId,
        409,
        { current: result.current },
      );
    }
    if (
      previous?.imagePath &&
      previous.imagePath !== result.record.imagePath
    ) {
      await removeCheckInImage(
        context.userId,
        previous.imagePath,
        context.supabase,
      );
    }
    return checkInSuccess(result.record, requestId);
  } catch (error) {
    return checkInServiceFailure(error, requestId);
  }
}
