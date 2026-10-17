import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { AiCreditBalance } from "@/lib/domain/billing";

// A dedicated generated shape keeps unrelated existing database types untouched.
export type PaymentOrder = {
  out_trade_no: string; owner_hash: string; app_id: string; total_amount: string;
  state: string; trade_no: string | null; created_at: string; idempotency_key: string;
  user_id: string | null; product_id: string | null; product_title: string | null;
  credit_count: number | null; valid_days: number | null; environment: "sandbox" | "production" | null;
  refund_state?: string | null; expires_at?: string | null; credits_remaining?: number; refundable?: boolean;
};
export type Refund = { out_request_no: string; out_trade_no: string; amount: string; reason: string; state: string; created_at: string };

export function paymentRepository() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("PAYMENT_DATABASE_UNAVAILABLE");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  async function checked<T>(query: PromiseLike<{ data: T; error: unknown }>) {
    const { data, error } = await query;
    if (error) {
      const message = (error as { message?: string }).message;
      const safe = ["PAYMENT_IDEMPOTENCY_CONFLICT", "PAYMENT_PRODUCT_INVALID", "PAYMENT_CREDIT_REFUND_REQUIRES_UNUSED_PACK", "PAYMENT_REFUND_CONFLICT", "PAYMENT_REFUND_EXCEEDS_PAID"];
      throw new Error(message && safe.includes(message) ? message : "PAYMENT_DATABASE_UNAVAILABLE");
    }
    return data;
  }
  return {
    async create(ownerHash: string, userId: string, appId: string, productId: string, mode: "sandbox" | "production", key: string): Promise<PaymentOrder> {
      // A sandbox transaction must never grant spendable rights in a live database.
      if (mode === "sandbox" && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) throw new Error("PAYMENT_SANDBOX_DATABASE_REQUIRED");
      const orderNo = `AI${crypto.randomUUID().replaceAll("-", "")}`;
      return await checked(client.rpc("payment_create_credit_order", {
        p_order: orderNo, p_owner: ownerHash, p_user: userId, p_app: appId, p_product: productId, p_mode: mode, p_key: key,
      })) as PaymentOrder;
    },
    async get(orderNo: string): Promise<PaymentOrder | null> {
      return await checked(client.from("payment_orders").select("*").eq("out_trade_no", orderNo).maybeSingle()) as PaymentOrder | null;
    },
    async balance(userId: string): Promise<AiCreditBalance> {
      return await checked(client.rpc("read_ai_credit_balance", { target_user_id: userId })) as AiCreditBalance;
    },
    async list(userId: string, cursor?: { createdAt: string; orderNo: string }): Promise<PaymentOrder[]> {
      return await checked(client.rpc("payment_list_credit_orders", { target_user_id: userId,
        target_before_time: cursor?.createdAt ?? null, target_before_order: cursor?.orderNo ?? null })) as PaymentOrder[];
    },
    async latestRefund(orderNo: string): Promise<Refund | null> {
      return await checked(client.from("payment_refunds").select("*").eq("out_trade_no", orderNo).order("created_at", { ascending: false }).limit(1).maybeSingle()) as Refund | null;
    },
    async event(orderNo: string, tradeNo: string, state: string, eventId: string, eventType: string) {
      await checked(client.rpc("payment_apply_event", {
        p_order: orderNo, p_trade: tradeNo, p_state: state, p_event: eventId, p_type: eventType,
      }));
    },
    async reserveRefund(orderNo: string, requestNo: string, amount: string, reason: string): Promise<Refund> {
      return await checked(client.rpc("payment_reserve_refund", {
        p_order: orderNo, p_request: requestNo, p_amount: amount, p_reason: reason,
      })) as Refund;
    },
    async refund(orderNo: string, requestNo: string): Promise<Refund | null> {
      return await checked(client.from("payment_refunds").select("*").eq("out_trade_no", orderNo).eq("out_request_no", requestNo).maybeSingle()) as Refund | null;
    },
    async confirmRefund(requestNo: string) {
      await checked(client.rpc("payment_confirm_refund", { p_request: requestNo }));
    },
  };
}
