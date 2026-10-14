import { checkInEntryModeSchema, checkInInputSchema, dateKeySchema, writableDateKeySchema } from "@/lib/domain/checkin";
import {
  logServerError,
  operationalErrorFields,
} from "@/lib/server/logging";
import {
  checkInFailure,
  checkInServiceFailure,
  checkInSuccess,
  createCheckInRequestContext,
} from "@/server/checkins/http";
import { saveCheckIn } from "@/server/checkins/service";
import {
  assertOwnedImagePath,
  createCheckInImageUrl,
  removeCheckInImage,
} from "@/server/storage/service";

type RouteContext = {
  params: Promise<{ date: string }>;
};

export const dynamic = "force-dynamic";

async function parseDate(context: RouteContext, requestId: string, forWrite = false) {
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

    const parsedDate = await parseDate(routeContext, requestId, true);
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
    if (parsedInput.data.imagePath !== null) {
      try {
        assertOwnedImagePath(context.userId, parsedInput.data.imagePath);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "FORBIDDEN_IMAGE_PATH"
        ) {
          return checkInFailure(
            "FORBIDDEN_IMAGE_PATH",
            "无权使用此图片",
            requestId,
            403,
          );
        }
        throw error;
      }
    }

    const previous = await context.repository.findByDate(
      context.userId,
      parsedDate.date,
      parsedInput.data.entryMode,
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
      try {
        await removeCheckInImage(
          context.userId,
          previous.imagePath,
          context.supabase,
        );
      } catch (error) {
        logServerError("check-in image cleanup failed", {
          requestId,
          ...operationalErrorFields(error),
        });
      }
    }
    return checkInSuccess(result.record, requestId);
  } catch (error) {
    return checkInServiceFailure(error, requestId);
  }
}
