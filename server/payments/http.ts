import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { ZodError } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { loadPaymentConfig } from "./config";
import { paymentService } from "./service";

export const paymentHeaders = { "Cache-Control": "private, no-store" };
export function hashOwner(value: string) { return createHash("sha256").update(value).digest("hex"); }

export async function paymentUser() {
  const client = await createServerSupabase();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("PAYMENT_LOGIN_REQUIRED");
  return { userId: data.user.id, owner: hashOwner(`account:${data.user.id}`) };
}

export async function paymentContext(request: Request) {
  const user = await paymentUser();
  const config = await loadPaymentConfig();
  if (request.method !== "GET" && request.headers.get("origin") !== config.origin) throw new Error("PAYMENT_ORIGIN_INVALID");
  return { config, ...user, service: paymentService(config) };
}

export function requirePaymentAdmin(request: Request) {
  const expected = process.env.PAYMENT_ADMIN_TOKEN;
  const actual = request.headers.get("authorization")?.replace(/^Bearer /u, "");
  if (!expected || expected.length < 32 || !actual) throw new Error("PAYMENT_ADMIN_REQUIRED");
  const left = Buffer.from(expected), right = Buffer.from(actual);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error("PAYMENT_ADMIN_REQUIRED");
}

export function paymentFailure(error: unknown) {
  const code = error instanceof Error ? error.message : "PAYMENT_UNAVAILABLE";
  if (code === "PAYMENT_LOGIN_REQUIRED") return Response.json({ error: "请先登录，再购买或查看次数包" }, { status: 401, headers: paymentHeaders });
  if (error instanceof ZodError || error instanceof SyntaxError || code === "PAYMENT_PRODUCT_INVALID") return Response.json({ error: "套餐或请求格式不正确，请重新选择" }, { status: 422, headers: paymentHeaders });
  if (code === "PAYMENT_CREDIT_REFUND_REQUIRES_UNUSED_PACK") return Response.json({ error: "仅支持全部未使用且无生成中任务的次数包整包退款；其他情况请保留订单号联系运营者核验" }, { status: 409, headers: paymentHeaders });
  if (code === "PAYMENT_IDEMPOTENCY_CONFLICT") return Response.json({ error: "订单套餐已变化，请重新选择后发起购买" }, { status: 409, headers: paymentHeaders });
  if (code === "PAYMENT_SALES_CLOSED") return Response.json({ error: "次数包购买暂未开放，请稍后再试" }, { status: 503, headers: paymentHeaders });
  const status = code === "PAYMENT_NOT_FOUND" ? 404 : code === "PAYMENT_ADMIN_REQUIRED" || code === "PAYMENT_ORIGIN_INVALID" ? 403
    : code === "PAYMENT_ALREADY_PAID" || code === "PAYMENT_REFUND_PENDING" ? 409 : 503;
  // SDK errors may contain signed forms or raw gateway responses. Never forward/log them.
  return Response.json({ error: status === 404 ? "订单不存在或当前浏览器无权访问" : status === 403 ? "无权执行此操作" : status === 409 ? "交易状态已变化，请查询后重试" : "支付服务暂不可用，请稍后查询订单" }, { status, headers: paymentHeaders });
}
