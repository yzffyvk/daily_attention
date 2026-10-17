import { PaymentPanel } from "@/features/payments/payment-panel";
import { createServerSupabase } from "@/lib/supabase/server";
import "../payments.css";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function PaymentReturnPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // The parameter is only a locator. The API checks the authenticated account and queries Alipay.
  const orderNo = typeof params.out_trade_no === "string" && /^AI[a-f0-9]{32}$/u.test(params.out_trade_no) ? params.out_trade_no : undefined;
  const client = await createServerSupabase();
  const { data } = await client.auth.getUser();
  return <main className="payment-page"><PaymentPanel returning signedIn={Boolean(data.user)} orderNo={orderNo} /></main>;
}
