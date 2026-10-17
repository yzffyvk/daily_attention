import { z } from "zod";
import { loadPaymentConfig } from "@/server/payments/config";
import { paymentService } from "@/server/payments/service";
import { paymentContext, paymentFailure, paymentHeaders, requirePaymentAdmin } from "@/server/payments/http";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string; action: string }> }) {
  try {
    const { id, action } = await context.params;
    if (action === "pay") {
      const { service, owner } = await paymentContext(request);
      return Response.json(await service.resume(id, owner), { headers: paymentHeaders });
    }
    if (action === "close") {
      const { service, owner } = await paymentContext(request);
      return Response.json(await service.close(id, owner), { headers: paymentHeaders });
    }
    if (action === "refund-unused") {
      const { service, owner } = await paymentContext(request);
      const data = z.object({ requestNo: z.uuid() }).strict().parse(await request.json());
      return Response.json(await service.refundUnused(id, owner, data.requestNo), { headers: paymentHeaders });
    }
    if (action === "refund-status") {
      const { service, owner } = await paymentContext(request);
      return Response.json(await service.refundStatusOwned(id, owner), { headers: paymentHeaders });
    }
    requirePaymentAdmin(request);
    const config = await loadPaymentConfig();
    const service = paymentService(config);
    if (action === "refund") {
      const data = z.object({ requestNo: z.uuid(), amount: z.string().regex(/^\d+\.\d{2}$/u), reason: z.string().min(1).max(100) }).strict().parse(await request.json());
      return Response.json(await service.refund(id, data.requestNo, data.amount, data.reason), { headers: paymentHeaders });
    }
    if (action === "refund-query") {
      const data = z.object({ requestNo: z.uuid() }).strict().parse(await request.json());
      return Response.json(await service.refundQuery(id, data.requestNo), { headers: paymentHeaders });
    }
    return new Response(null, { status: 404 });
  } catch (error) { return paymentFailure(error); }
}
