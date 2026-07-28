import { redirect } from "next/navigation";
import { AuthCard } from "@/features/auth/auth-card";
import { OnboardingForm } from "@/features/auth/onboarding-form";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, onboarding_completed")
    .eq("id", data.claims.sub)
    .maybeSingle();

  if (error || !profile) redirect("/login");
  if (profile.onboarding_completed) redirect("/");

  return (
    <AuthCard
      description="设置一个名称和头像，开始记录你的 attention。"
      step="02"
      title="完善你的学习身份"
    >
      <OnboardingForm />
    </AuthCard>
  );
}
