import { z } from "zod";
import { dateKeySchema } from "@/lib/domain/checkin";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  checkInFailure,
  checkInServiceFailure,
  checkInSuccess,
  createCheckInRequestContext,
} from "@/server/checkins/http";
import {
  assertOwnedImagePath,
  createCheckInUpload,
  isStorageUploadLimitError,
  releaseCheckInUploadReservation,
  removeCheckInImage,
} from "@/server/storage/service";

const maxImageBytes = 10 * 1024 * 1024;
const imageMimeTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);
const uploadRequestSchema = z.object({
  date: dateKeySchema,
  mimeType: imageMimeTypeSchema,
  size: z.number().int().positive(),
});
const deleteRequestSchema = z.object({ path: z.string().min(1).max(1024) });

export const dynamic = "force-dynamic";

async function parseRequest(request: Request, requestId: string) {
  try {
    return { body: await request.json() };
  } catch {
    return {
      response: checkInFailure(
        "VALIDATION_ERROR",
        "请求内容不正确",
        requestId,
        422,
      ),
    };
  }
}

export async function POST(request: Request) {
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

    const parsedRequest = await parseRequest(request, requestId);
    if ("response" in parsedRequest) return parsedRequest.response;
    const parsedInput = uploadRequestSchema.safeParse(parsedRequest.body);
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
    if (parsedInput.data.size > maxImageBytes) {
      return checkInFailure(
        "PAYLOAD_TOO_LARGE",
        "图片不能超过 10 MB",
        requestId,
        413,
        { field: "size" },
      );
    }

    try {
      return checkInSuccess(
        await createCheckInUpload(
          context.userId,
          parsedInput.data.date,
          parsedInput.data.mimeType,
          parsedInput.data.size,
          createAdminSupabase(),
        ),
        requestId,
      );
    } catch (error) {
      if (isStorageUploadLimitError(error)) {
        return checkInFailure(
          "RATE_LIMITED",
          "图片上传过于频繁或存储空间已达上限",
          requestId,
          429,
        );
      }
      throw error;
    }
  } catch (error) {
    return checkInServiceFailure(error, requestId);
  }
}

export async function DELETE(request: Request) {
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

    const parsedRequest = await parseRequest(request, requestId);
    if ("response" in parsedRequest) return parsedRequest.response;
    const parsedInput = deleteRequestSchema.safeParse(parsedRequest.body);
    if (!parsedInput.success) {
      return checkInFailure(
        "VALIDATION_ERROR",
        parsedInput.error.issues[0].message,
        requestId,
        422,
        { field: parsedInput.error.issues[0].path[0]?.toString() },
      );
    }
    try {
      assertOwnedImagePath(context.userId, parsedInput.data.path);
    } catch {
      return checkInFailure(
        "FORBIDDEN_IMAGE_PATH",
        "无权操作该图片",
        requestId,
        403,
        { field: "path" },
      );
    }
    await removeCheckInImage(context.userId, parsedInput.data.path, context.supabase);
    await releaseCheckInUploadReservation(
      context.userId,
      parsedInput.data.path,
      createAdminSupabase(),
    );
    return checkInSuccess({}, requestId);
  } catch (error) {
    return checkInServiceFailure(error, requestId);
  }
}
