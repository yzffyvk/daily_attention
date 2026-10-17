import { paymentContext, paymentFailure, paymentHeaders } from "@/server/payments/http";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { service, owner } = await paymentContext(request);
    const { id } = await context.params;
    return Response.json(await service.query(id, owner), { headers: paymentHeaders });
  } catch (error) { return paymentFailure(error); }
}
