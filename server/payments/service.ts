import "server-only";
import { createPaymentSdk, type PaymentConfig } from "./config";
import { cents, isPaymentEvent, paymentState } from "./domain";
import { paymentRepository, type PaymentOrder } from "./repository";
import { getAiCreditPack } from "@/lib/domain/billing";

type Repository = ReturnType<typeof paymentRepository>;
type Sdk = Pick<ReturnType<typeof createPaymentSdk>, "exec" | "pageExec" | "checkNotifySignV2">;

export function paymentService(config: PaymentConfig, repository: Repository = paymentRepository(), sdk: Sdk = createPaymentSdk(config), checkoutFetch: typeof fetch = fetch) {
  async function owned(orderNo: string, ownerHash: string) {
    const order = await repository.get(orderNo);
    if (!order || order.owner_hash !== ownerHash || order.app_id !== config.appId) throw new Error("PAYMENT_NOT_FOUND");
    return order;
  }
  async function query(order: PaymentOrder) {
    const result = await sdk.exec("alipay.trade.query", { bizContent: { out_trade_no: order.out_trade_no } }, { validateSign: true });
    if (result.code !== "10000") {
      if (result.sub_code === "ACQ.TRADE_NOT_EXIST") return { state: order.state, orderNo: order.out_trade_no };
      throw new Error("PAYMENT_GATEWAY_UNAVAILABLE");
    }
    if (result.out_trade_no !== order.out_trade_no || cents(result.total_amount) !== cents(order.total_amount)
      || (result.seller_id && result.seller_id !== config.sellerId)) throw new Error("PAYMENT_RESULT_MISMATCH");
    const state = paymentState(result.trade_status);
    await repository.event(order.out_trade_no, result.trade_no, state, `query:${crypto.randomUUID()}`, "query");
    const updated = await repository.get(order.out_trade_no);
    const refund = await repository.latestRefund(order.out_trade_no);
    return { state: updated?.state ?? state, orderNo: order.out_trade_no, creditCount: updated?.credit_count ?? order.credit_count,
      refundState: refund?.state ?? null,
      ...(order.user_id ? { balance: await repository.balance(order.user_id) } : {}) };
  }
  async function checkout(order: PaymentOrder) {
    if (["PAID", "CLOSED"].includes(order.state)) return { orderNo: order.out_trade_no, state: order.state };
    // The sandbox page-pay POST endpoint currently returns 404; SDK GET redirects normally.
    const method = config.mode === "sandbox" ? "GET" : "POST";
    const payment = sdk.pageExec("alipay.trade.page.pay", method, {
      returnUrl: config.returnUrl,
      ...(config.notifyUrl ? { notifyUrl: config.notifyUrl } : {}),
      bizContent: { out_trade_no: order.out_trade_no, total_amount: order.total_amount,
        subject: `知序 Aura · ${order.product_title}`, product_code: "FAST_INSTANT_TRADE_PAY", timeout_express: "15m" },
    });
    if (method === "GET") {
      // Resolve the gateway hop on the server: browser navigation to this sandbox gateway can 404.
      const response = await checkoutFetch(payment, { redirect: "manual", signal: AbortSignal.timeout(10000) });
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) throw new Error("PAYMENT_GATEWAY_UNAVAILABLE");
      const cashier = new URL(location, config.gateway);
      if (cashier.protocol !== "https:" || cashier.hostname !== "unitradeprod-sandbox.dl.alipaydev.com"
        || cashier.pathname !== "/appAssign.htm" || cashier.username || cashier.password) throw new Error("PAYMENT_GATEWAY_UNAVAILABLE");
      return { orderNo: order.out_trade_no, state: order.state, paymentUrl: cashier.href };
    }
    return { orderNo: order.out_trade_no, state: order.state, paymentHtml: payment };
  }
  return {
    async create(ownerHash: string, userId: string, productId: string, key: string) {
      getAiCreditPack(productId);
      const order = await repository.create(ownerHash, userId, config.appId, productId, config.mode, key);
      return checkout(order);
    },
    async resume(orderNo: string, ownerHash: string) {
      const order = await owned(orderNo, ownerHash);
      const current = await query(order);
      if (["PAID", "CLOSED"].includes(current.state)) return current;
      return checkout(order);
    },
    async query(orderNo: string, ownerHash: string) { return query(await owned(orderNo, ownerHash)); },
    async refundUnused(orderNo: string, ownerHash: string, requestNo: string) {
      const order = await owned(orderNo, ownerHash);
      const prior = await repository.latestRefund(orderNo);
      // Reuse the persisted request across browsers and network retries.
      return this.refund(orderNo, prior?.out_request_no ?? requestNo, order.total_amount, prior?.reason ?? "未使用次数包整包退款");
    },
    async refundStatusOwned(orderNo: string, ownerHash: string) {
      await owned(orderNo, ownerHash);
      const prior = await repository.latestRefund(orderNo);
      if (!prior) return { state: "NONE" };
      return this.refundQuery(orderNo, prior.out_request_no);
    },
    async close(orderNo: string, ownerHash: string) {
      const order = await owned(orderNo, ownerHash);
      const current = await query(order);
      if (current.state === "PAID") throw new Error("PAYMENT_ALREADY_PAID");
      if (current.state === "CLOSED") return current;
      const result = await sdk.exec("alipay.trade.close", { bizContent: { out_trade_no: orderNo } }, { validateSign: true });
      if (result.code !== "10000") throw new Error("PAYMENT_GATEWAY_UNAVAILABLE");
      if (result.out_trade_no !== orderNo) throw new Error("PAYMENT_RESULT_MISMATCH");
      await repository.event(orderNo, result.trade_no ?? "", "CLOSED", `close:${crypto.randomUUID()}`, "close");
      return { orderNo, state: "CLOSED" };
    },
    async notify(params: Record<string, string>) {
      if (params.app_id !== config.appId || params.sign_type !== "RSA2" || !sdk.checkNotifySignV2(params)) return false;
      const order = await repository.get(params.out_trade_no);
      if (!order || order.app_id !== config.appId || params.seller_id !== config.sellerId
        || !params.notify_id || !params.trade_no || cents(params.total_amount) !== cents(order.total_amount)) return false;
      const paid = isPaymentEvent(params);
      // Refund / split / closing notifications are recorded, never treated as a new payment.
      const state = paid ? "PAID" : params.trade_status === "TRADE_CLOSED" ? "CLOSED" : "UNKNOWN";
      await repository.event(order.out_trade_no, params.trade_no, state, params.notify_id, paid ? "payment" : "non_payment");
      return true;
    },
    async refund(orderNo: string, requestNo: string, amount: string, reason: string) {
      if (cents(amount) <= BigInt(0)) throw new Error("PAYMENT_AMOUNT_INVALID");
      const order = await repository.get(orderNo);
      if (!order || order.app_id !== config.appId) throw new Error("PAYMENT_NOT_FOUND");
      await query(order);
      // Transaction locks the order and reserves all pending refunds, including unknown outcomes.
      const refund = await repository.reserveRefund(orderNo, requestNo, amount, reason);
      if (refund.state === "REFUNDED") return { state: "REFUNDED", requestNo };
      const result = await sdk.exec("alipay.trade.refund", { bizContent: {
        out_trade_no: orderNo, out_request_no: requestNo, refund_amount: refund.amount, refund_reason: refund.reason,
      } }, { validateSign: true });
      if (result.code !== "10000") throw new Error("PAYMENT_REFUND_PENDING");
      if (result.out_trade_no !== orderNo) throw new Error("PAYMENT_RESULT_MISMATCH");
      if (result.fund_change === "Y" && cents(result.refund_fee) === cents(refund.amount)) {
        await repository.confirmRefund(requestNo);
        return { state: "REFUNDED", requestNo };
      }
      return { state: "PENDING", requestNo, retryAfterSeconds: 10 };
    },
    async refundQuery(orderNo: string, requestNo: string) {
      const order = await repository.get(orderNo);
      const refund = await repository.refund(orderNo, requestNo);
      if (!order || order.app_id !== config.appId || !refund) throw new Error("PAYMENT_NOT_FOUND");
      if (Date.now() - Date.parse(refund.created_at) < 10_000) return { state: refund.state, requestNo, retryAfterSeconds: 10 };
      const result = await sdk.exec("alipay.trade.fastpay.refund.query", { bizContent: { out_trade_no: orderNo, out_request_no: requestNo } }, { validateSign: true });
      if (result.code !== "10000") return { state: "PENDING", requestNo, retryAfterSeconds: 10 };
      if (result.out_trade_no !== orderNo || result.out_request_no !== requestNo) throw new Error("PAYMENT_RESULT_MISMATCH");
      if (result.refund_status === "REFUND_SUCCESS" && cents(result.refund_amount) === cents(refund.amount)) {
        await repository.confirmRefund(requestNo);
        return { state: "REFUNDED", requestNo };
      }
      return { state: "PENDING", requestNo, retryAfterSeconds: 10 };
    },
  };
}
