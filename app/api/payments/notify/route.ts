import { loadPaymentConfig } from "@/server/payments/config";
import { parseAlipayForm } from "@/server/payments/domain";
import { paymentService } from "@/server/payments/service";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let accepted = false;
  try {
    if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) throw new Error("INVALID_FORM");
    const params = parseAlipayForm(await request.text());
    accepted = await paymentService(await loadPaymentConfig()).notify(params);
  } catch {
    console.warn("Alipay notification rejected; no notification contents logged");
  }
  return new Response(accepted ? "success" : "fail", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
