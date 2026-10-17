// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { cents, isPaymentEvent, parseAlipayForm, paymentState } from "@/server/payments/domain";
import { paymentService } from "@/server/payments/service";
import type { PaymentConfig } from "@/server/payments/config";
import type { PaymentOrder } from "@/server/payments/repository";

const config: PaymentConfig = { mode: "sandbox", appId: "test-app", privateKey: "test-only", alipayPublicKey: "test-only", sellerId: "seller", gateway: "https://openapi-sandbox.dl.alipaydev.com/gateway.do", origin: "http://127.0.0.1:3000", returnUrl: "http://127.0.0.1:3000/payments/return" };
function setup(mode: PaymentConfig["mode"] = "sandbox") {
  const order: PaymentOrder = { user_id: "00000000-0000-4000-8000-000000009701", product_id: "ai_1", product_title: "单次提炼", credit_count: 1, valid_days: 90, environment: "sandbox", out_trade_no: "order", owner_hash: "owner", app_id: "test-app", total_amount: "0.90", state: "PENDING_PAYMENT", trade_no: null, created_at: new Date().toISOString(), idempotency_key: "key" };
  const refund = { out_request_no: "refund", out_trade_no: "order", amount: "0.90", reason: "reason", state: "PENDING", created_at: new Date(Date.now() - 20_000).toISOString() };
  const repo = { create: vi.fn().mockResolvedValue(order), get: vi.fn().mockResolvedValue(order), event: vi.fn(), reserveRefund: vi.fn().mockResolvedValue(refund), refund: vi.fn().mockResolvedValue(refund), confirmRefund: vi.fn(), balance: vi.fn().mockResolvedValue({ freeLimit: 2, freeRemaining: 2, paidRemaining: 0, remaining: 2, unlimited: false, resetsAt: new Date().toISOString(), lots: [] }), list: vi.fn().mockResolvedValue([]), latestRefund: vi.fn().mockResolvedValue(null) };
  const sdk = { exec: vi.fn().mockResolvedValue({ code: "10000", out_trade_no: "order", trade_no: "trade", total_amount: "0.90", trade_status: "WAIT_BUYER_PAY" }), pageExec: vi.fn().mockImplementation((_method, verb) => verb === "GET" ? "https://openapi-sandbox.dl.alipaydev.com/gateway.do?method=alipay.trade.page.pay" : "<form></form>"), checkNotifySignV2: vi.fn().mockReturnValue(true) };
  const checkoutFetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://unitradeprod-sandbox.dl.alipaydev.com/appAssign.htm?ticket=local-only" } }));
  return { order, repo, sdk, checkoutFetch, service: paymentService({ ...config, mode }, repo, sdk, checkoutFetch) };
}
const notification = { app_id: "test-app", sign_type: "RSA2", sign: "test", seller_id: "seller", out_trade_no: "order", total_amount: "0.90", notify_id: "event", trade_no: "trade", trade_status: "TRADE_SUCCESS" };

describe("payment security and lifecycle", () => {
  it("compares money exactly and rejects precision loss", () => {
    expect(cents("99999999.99")).toBe(BigInt(9999999999));
    expect(cents("1.1")).toBe(cents("1.10"));
    expect(() => cents("0.001")).toThrow();
  });
  it("does not treat a successful API response or unknown status as a paid order", () => {
    expect(paymentState("WAIT_BUYER_PAY")).toBe("PENDING_PAYMENT");
    expect(paymentState("unexpected")).toBe("UNKNOWN");
    expect(paymentState("TRADE_CLOSED")).toBe("CLOSED");
  });
  it("parses a form once without losing encoded fields and rejects duplicates", () => {
    expect(parseAlipayForm("subject=a%2Bb&sign=c%2Bd")).toEqual({ subject: "a+b", sign: "c+d" });
    expect(() => parseAlipayForm("sign=a&sign=b")).toThrow();
  });
  it("uses a POST page form, server price and an implemented return route", async () => {
    const { service, sdk } = setup("production"); await service.create("owner", "00000000-0000-4000-8000-000000009701", "ai_1", "key");
    expect(sdk.pageExec).toHaveBeenCalledWith("alipay.trade.page.pay", "POST", expect.objectContaining({ returnUrl: config.returnUrl, bizContent: expect.objectContaining({ total_amount: "0.90", product_code: "FAST_INSTANT_TRADE_PAY" }) }));
    expect(sdk.pageExec.mock.calls[0][2]).not.toHaveProperty("notifyUrl");
  });
  it("uses an SDK-signed GET link in the sandbox where POST page-pay returns 404", async () => {
    const { service, sdk } = setup();
    sdk.pageExec.mockReturnValue("https://openapi-sandbox.dl.alipaydev.com/gateway.do?method=alipay.trade.page.pay");
    expect(await service.create("owner", "00000000-0000-4000-8000-000000009701", "ai_1", "key")).toMatchObject({
      paymentUrl: "https://unitradeprod-sandbox.dl.alipaydev.com/appAssign.htm?ticket=local-only",
    });
    expect(sdk.pageExec).toHaveBeenCalledWith("alipay.trade.page.pay", "GET", expect.anything());
  });
  it("refuses an untrusted sandbox cashier redirect without issuing a checkout URL", async () => {
    const { service, checkoutFetch } = setup();
    checkoutFetch.mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://untrusted.invalid/cashier" } }));
    await expect(service.create("owner", "00000000-0000-4000-8000-000000009701", "ai_1", "key")).rejects.toThrow("PAYMENT_GATEWAY_UNAVAILABLE");
  });
  it("rejects unknown products before creating an order or contacting Alipay", async () => {
    const { service, sdk, repo } = setup();
    await expect(service.create("owner", "00000000-0000-4000-8000-000000009701", "forged", "key")).rejects.toThrow("PAYMENT_PRODUCT_INVALID");
    expect(repo.create).not.toHaveBeenCalled(); expect(sdk.pageExec).not.toHaveBeenCalled();
  });
  it("persists the authenticated account and selected product instead of a caller amount", async () => {
    const { service, repo } = setup();
    await service.create("owner", "00000000-0000-4000-8000-000000009701", "ai_1", "key");
    expect(repo.create).toHaveBeenCalledWith("owner", "00000000-0000-4000-8000-000000009701", "test-app", "ai_1", "sandbox", "key");
  });
  it("rejects other browser sessions before gateway calls", async () => {
    const { service, sdk } = setup(); await expect(service.query("order", "stranger")).rejects.toThrow("PAYMENT_NOT_FOUND"); expect(sdk.exec).not.toHaveBeenCalled();
  });
  it("keeps waiting orders queryable and validates signed gateway responses", async () => {
    const { service, sdk } = setup(); await expect(service.query("order", "owner")).resolves.toMatchObject({ state: "PENDING_PAYMENT" });
    expect(sdk.exec).toHaveBeenCalledWith("alipay.trade.query", expect.anything(), { validateSign: true });
  });
  it("resumes the same owned unpaid order after a cashier failure without creating another", async () => {
    const { service, repo, sdk } = setup("production");
    expect(await service.resume("order", "owner")).toMatchObject({ orderNo: "order", paymentHtml: "<form></form>" });
    expect(repo.create).not.toHaveBeenCalled();
    expect(sdk.pageExec).toHaveBeenCalledWith("alipay.trade.page.pay", "POST", expect.objectContaining({
      bizContent: expect.objectContaining({ out_trade_no: "order", total_amount: "0.90" }),
    }));
  });
  it("checks the gateway before resume so a paid order cannot open another cashier", async () => {
    const { service, sdk, repo, order } = setup();
    sdk.exec.mockResolvedValue({ code: "10000", out_trade_no: "order", trade_no: "trade", total_amount: "0.90", trade_status: "TRADE_SUCCESS" });
    repo.event.mockImplementation(async () => { order.state = "PAID"; });
    expect(await service.resume("order", "owner")).toMatchObject({ state: "PAID" });
    expect(sdk.pageExec).not.toHaveBeenCalled();
  });
  it("rejects signature, merchant, application and amount mismatches", async () => {
    const { service, sdk, repo } = setup();
    sdk.checkNotifySignV2.mockReturnValue(false); expect(await service.notify(notification)).toBe(false);
    sdk.checkNotifySignV2.mockReturnValue(true);
    for (const change of [{ seller_id: "other" }, { app_id: "other" }, { total_amount: "0.91" }]) expect(await service.notify({ ...notification, ...change })).toBe(false);
    expect(repo.event).not.toHaveBeenCalled();
  });
  it("never marks refund or split notifications as a new payment", async () => {
    const { service, repo } = setup();
    expect(isPaymentEvent({ ...notification, refund_fee: "0.90" })).toBe(false);
    expect(await service.notify({ ...notification, out_biz_no: "refund-event" })).toBe(true);
    expect(repo.event).toHaveBeenCalledWith("order", "trade", "UNKNOWN", "event", "non_payment");
  });
  it("passes the persisted notification identity to the atomic event transaction", async () => {
    const { service, repo } = setup(); expect(await service.notify(notification)).toBe(true);
    expect(repo.event).toHaveBeenCalledWith("order", "trade", "PAID", "event", "payment");
  });
  it("checks payment before closing and refuses a paid order", async () => {
    const { service, sdk, order } = setup(); order.state = "PAID";
    sdk.exec.mockResolvedValueOnce({ code: "10000", out_trade_no: "order", trade_no: "trade", total_amount: "0.90", trade_status: "TRADE_SUCCESS" });
    await expect(service.close("order", "owner")).rejects.toThrow("PAYMENT_ALREADY_PAID"); expect(sdk.exec).toHaveBeenCalledTimes(1);
  });
  it("reserves refunds before calling the gateway and keeps uncertain results pending", async () => {
    const { service, sdk, repo } = setup();
    sdk.exec.mockResolvedValueOnce({ code: "10000", out_trade_no: "order", trade_no: "trade", total_amount: "0.90", trade_status: "TRADE_SUCCESS" }).mockResolvedValueOnce({ code: "10000", out_trade_no: "order", fund_change: "N" });
    expect(await service.refund("order", "refund", "0.90", "reason")).toMatchObject({ state: "PENDING", requestNo: "refund" });
    expect(repo.reserveRefund).toHaveBeenCalledWith("order", "refund", "0.90", "reason"); expect(repo.confirmRefund).not.toHaveBeenCalled();
  });
  it("requires refund status and matching amount before confirming a refund", async () => {
    const { service, sdk, repo } = setup(); sdk.exec.mockResolvedValue({ code: "10000", out_trade_no: "order", out_request_no: "refund", refund_status: "REFUND_SUCCESS", refund_amount: "0.90" });
    expect(await service.refundQuery("order", "refund")).toMatchObject({ state: "REFUNDED" }); expect(repo.confirmRefund).toHaveBeenCalledWith("refund");
  });
  it("keeps the persisted refund outcome visible when querying a previously paid order", async () => {
    const { service, repo } = setup();
    repo.latestRefund.mockResolvedValue({ out_request_no: "refund", out_trade_no: "order", amount: "0.90", reason: "unused", state: "REFUNDED", created_at: new Date().toISOString() });
    expect(await service.query("order", "owner")).toMatchObject({ refundState: "REFUNDED" });
  });
  it("retries an uncertain refund with the persisted request instead of a new refund", async () => {
    const { service, repo, sdk } = setup();
    repo.latestRefund.mockResolvedValue({ out_request_no: "persisted-refund", out_trade_no: "order", amount: "0.90", reason: "unused", state: "PENDING", created_at: new Date().toISOString() });
    sdk.exec.mockResolvedValueOnce({ code: "10000", out_trade_no: "order", trade_no: "trade", total_amount: "0.90", trade_status: "TRADE_SUCCESS" })
      .mockResolvedValueOnce({ code: "10000", out_trade_no: "order", fund_change: "N" });
    await service.refundUnused("order", "owner", "different-browser-request");
    expect(repo.reserveRefund).toHaveBeenCalledWith("order", "persisted-refund", "0.90", "unused");
    expect(sdk.exec).toHaveBeenLastCalledWith("alipay.trade.refund", { bizContent: expect.objectContaining({ out_request_no: "persisted-refund" }) }, { validateSign: true });
  });
});
