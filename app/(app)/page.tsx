import { redirect } from "next/navigation";
import { CheckInWorkspace } from "@/features/checkins/checkin-workspace";
import { getTodayKey } from "@/features/checkins/dates";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const serverToday = getTodayKey();
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_key")
    .eq("id", data.claims.sub)
    .maybeSingle();

  return (
    <CheckInWorkspace
      initialDate={serverToday}
      initialToday={serverToday}
      userId={data.claims.sub}
      initialProfile={
        error || !profile
          ? null
          : {
              id: profile.id,
              displayName: profile.display_name,
              avatarKey: profile.avatar_key,
            }
      }
    />
  );
}
