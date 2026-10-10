import "server-only";
import { apiFailure, apiSuccess } from "@/lib/api/result";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { logServerError, operationalErrorFields } from "@/lib/server/logging";
import { createTakeawayRepository } from "./repository";

const headers = { "Cache-Control": "private, no-store" };
const errors: Record<string, { status: number; message: string }> = {
  SESSION_EXPIRED: { status: 401, message: "登录已失效，请重新登录" },
  TAKEAWAY_ACCOUNT_NOT_FOUND: { status: 401, message: "登录已失效，请重新登录" },
  TAKEAWAY_NOT_FOUND: { status: 404, message: "这条新知暂时不可用，请更新学习进度" },
  DAILY_TAKEAWAY_DONE: { status: 409, message: "今天的新知已收下，请更新学习进度查看" },
  TAKEAWAY_PROGRESS_CHANGED: { status: 409, message: "学习进度已在其他页面更新，请载入最新进度" },
  TAKEAWAY_CONTENT_UPDATED: { status: 409, message: "这条新知有内容更正，请阅读更新后再收下" },
  TAKEAWAY_INVALID_ACTION: { status: 422, message: "请求内容不正确，请重试" },
  VALIDATION_ERROR: { status: 422, message: "请求内容不正确，请重试" },
  TAKEAWAY_UNAVAILABLE: { status: 503, message: "每日新知暂时无法连接，请稍后重试" },
};

export function takeawaySuccess<T>(data: T, requestId: string) {
  return Response.json(apiSuccess(data, requestId), { headers });
}

export function takeawayFailure(error: unknown, requestId: string) {
  const candidate = error && typeof error === "object" ? (error as { message?: unknown }).message : null;
  const code = typeof candidate === "string" && Object.hasOwn(errors, candidate) ? candidate : "TAKEAWAY_UNAVAILABLE";
  const mapped = errors[code];
  if (mapped.status >= 500) logServerError("Daily takeaway request failed", { requestId, ...operationalErrorFields(error) });
  return Response.json(apiFailure(code, mapped.message, requestId), { status: mapped.status, headers });
}

export async function createTakeawayContext() {
  const session = await createServerSupabase();
  const { data, error } = await session.auth.getUser();
  if (error || !data.user) return null;
  const { data: profile, error: profileError } = await session.from("profiles").select("id").eq("id", data.user.id).maybeSingle();
  if (profileError || !profile) return null;
  return { userId: data.user.id, repository: createTakeawayRepository(createAdminSupabase()) };
}
