export function cents(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/u.test(value)) throw new Error("PAYMENT_AMOUNT_INVALID");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}

export function paymentState(status: unknown) {
  if (status === "TRADE_SUCCESS" || status === "TRADE_FINISHED") return "PAID";
  if (status === "WAIT_BUYER_PAY") return "PENDING_PAYMENT";
  if (status === "TRADE_CLOSED") return "CLOSED";
  return "UNKNOWN";
}

export function isPaymentEvent(params: Record<string, string>) {
  return paymentState(params.trade_status) === "PAID"
    && !params.out_biz_no && !params.gmt_refund && !params.refund_fee;
}

export function parseAlipayForm(body: string): Record<string, string> {
  if (body.length > 65_536) throw new Error("PAYMENT_FORM_INVALID");
  const result: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(body)) {
    if (Object.hasOwn(result, key)) throw new Error("PAYMENT_FORM_INVALID");
    result[key] = value;
  }
  return result;
}
