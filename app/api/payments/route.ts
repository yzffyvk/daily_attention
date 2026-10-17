import { z } from "zod";
import { paymentContext, paymentFailure, paymentHeaders, paymentUser } from "@/server/payments/http";
import { paymentRepository } from "@/server/payments/repository";
import { AI_CREDIT_PACKS } from "@/lib/domain/billing";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const input = z.object({ productId: z.enum(["ai_1", "ai_10", "ai_20"]), idempotencyKey: z.uuid() }).strict().parse(await request.json());
    const { service, owner, userId, config } = await paymentContext(request);
    if (config.mode === "production" && process.env.PAYMENTS_ENABLED !== "true") throw new Error("PAYMENT_SALES_CLOSED");
    return Response.json(await service.create(owner, userId, input.productId, input.idempotencyKey), { headers: paymentHeaders });
  } catch (error) { return paymentFailure(error); }
}

export async function GET(request: Request) {
  try {
    const { userId } = await paymentUser();
    const params = new URL(request.url).searchParams;
    const cursor = params.has("beforeCreatedAt") || params.has("beforeOrderNo") ? z.object({
      createdAt: z.iso.datetime({ offset: true }), orderNo: z.string().regex(/^AI[a-f0-9]{32}$/u),
    }).parse({ createdAt: params.get("beforeCreatedAt"), orderNo: params.get("beforeOrderNo") }) : undefined;
    const repository = paymentRepository();
    const [balance, rows] = await Promise.all([repository.balance(userId), repository.list(userId, cursor)]);
    const shown = rows.slice(0, 20);
    const orders = shown.map(o => {
      return { orderNo: o.out_trade_no, productTitle: o.product_title, amount: o.total_amount,
        credits: o.credit_count, state: o.state, createdAt: o.created_at, refundState: o.refund_state ?? null,
        expiresAt: o.expires_at ?? null, creditsRemaining: o.credits_remaining ?? 0, refundable: o.refundable ?? false };
    });
    const last = shown.at(-1);
    return Response.json({ balance, orders, packs: AI_CREDIT_PACKS,
      nextCursor: rows.length > 20 && last ? { createdAt: last.created_at, orderNo: last.out_trade_no } : null }, { headers: paymentHeaders });
  } catch (error) { return paymentFailure(error); }
}
