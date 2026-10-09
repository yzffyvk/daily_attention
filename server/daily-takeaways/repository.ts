import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { takeawayStateSchema, type TakeawayAction } from "@/lib/domain/daily-takeaway";

export function createTakeawayRepository(supabase: SupabaseClient<Database>) {
  return {
    async get(userId: string) {
      const { data, error } = await supabase.rpc("get_daily_takeaway_state", { target_user_id: userId });
      if (error) throw error;
      return takeawayStateSchema.parse(data);
    },
    async act(userId: string, input: TakeawayAction) {
      const { data, error } = await supabase.rpc("apply_daily_takeaway_action", {
        target_user_id: userId,
        target_lesson_id: input.lessonId,
        target_version: input.version,
        target_action: input.action,
        ...(input.action === "quiz" ? { target_answer: input.answerIndex } : {}),
      });
      if (error) throw error;
      return takeawayStateSchema.parse(data);
    },
  };
}
