import { PaymentPanel } from "@/features/payments/payment-panel";
import { loadPaymentConfig } from "@/server/payments/config";
import { createServerSupabase } from "@/lib/supabase/server";
import "./payments.css";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function PaymentsPage() {
  const config = await loadPaymentConfig().catch(() => null);
  const client = await createServerSupabase();
  const { data } = await client.auth.getUser();
  return <main className="payment-page"><PaymentPanel signedIn={Boolean(data.user)} sandbox={config?.mode === "sandbox"}
    enabled={Boolean(config && (config.mode === "sandbox" || process.env.PAYMENTS_ENABLED === "true"))} /></main>;
}
