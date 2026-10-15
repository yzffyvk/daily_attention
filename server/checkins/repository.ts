import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { checkInEntryModeSchema, type CheckInEntryMode, type CheckInInput } from "@/lib/domain/checkin";
import { aiGenerationContextSchema, aiUserPromptSchema } from "@/lib/domain/ai-prompt";
import type { Database, Tables } from "@/lib/supabase/database.types";
import type {
  CheckInRecord,
  CheckInStats,
  CheckInSummary,
} from "@/features/checkins/types";

type CheckInRow = Tables<"check_ins">;

function mapRecord(row: CheckInRow): CheckInRecord {
  return {
    id: row.id,
    date: row.checkin_date,
    entryMode: checkInEntryModeSchema.parse(row.entry_mode ?? "manual"),
    attention: row.attention,
    sourceUrl: row.source_url ?? "",
    userPrompt: row.entry_mode === "ai" ? row.user_prompt ?? "" : "",
    aiGenerationContext: row.entry_mode === "ai"
      ? aiGenerationContextSchema.nullable().parse(row.ai_generation_context ?? null)
      : null,
    summary: row.summary,
    inspiration: row.inspiration,
    imagePath: row.image_path,
    imageName: row.image_name,
    imageUrl: null,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nextMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1));
  return next.toISOString().slice(0, 7);
}

export interface CheckInRepository {
  findByDate(userId: string, date: string, entryMode?: CheckInEntryMode): Promise<CheckInRecord | null>;
  findByMonth(userId: string, month: string): Promise<CheckInSummary[]>;
  getStats(today: string): Promise<CheckInStats>;
  insert(
    userId: string,
    date: string,
    input: CheckInInput,
  ): Promise<CheckInRecord>;
  updateAtVersion(
    userId: string,
    date: string,
    expectedVersion: number,
    input: CheckInInput,
  ): Promise<CheckInRecord | null>;
}

export function createCheckInRepository(
  supabase: SupabaseClient<Database>,
): CheckInRepository {
  return {
    async findByDate(userId, date, entryMode = "manual") {
      const { data, error } = await supabase
        .from("check_ins")
        .select()
        .eq("user_id", userId)
        .eq("checkin_date", date)
        .eq("entry_mode", entryMode)
        .limit(2);
      if (error) throw error;
      if (data && data.length > 1) throw new Error("CLIENT_UPGRADE_REQUIRED");
      return data?.[0] ? mapRecord(data[0]) : null;
    },

    async findByMonth(userId, month) {
      const pageSize = 500;
      const summaries: CheckInSummary[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase
          .from("check_ins")
          .select("id, checkin_date, entry_mode, attention, image_path, version, updated_at, learning_status, album_id, created_at")
          .eq("user_id", userId)
          .gte("checkin_date", `${month}-01`)
          .lt("checkin_date", `${nextMonth(month)}-01`)
          .order("checkin_date", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        summaries.push(...(data ?? []).map<CheckInSummary>((row) => ({
          id: row.id,
          status: row.learning_status === "pending" ? "pending" : "completed",
          albumId: row.album_id ?? null,
          createdAt: row.created_at,
          date: row.checkin_date,
          entryMode: checkInEntryModeSchema.parse(row.entry_mode ?? "manual"),
          attention: row.attention,
          hasImage: row.image_path !== null,
          version: row.version,
          updatedAt: row.updated_at,
        })));
        if (!data || data.length < pageSize) return summaries;
      }
    },

    async getStats(today) {
      const { data, error } = await supabase
        .rpc("get_check_in_stats", { target_today: today })
        .single();
      if (error) throw error;
      return {
        totalCount: Number(data.total_count),
        currentStreak: data.current_streak,
        hasTodayRecord: data.has_today_record,
      };
    },

    async insert(userId, date, input) {
      const { data, error } = await supabase
        .from("check_ins")
        .insert({
          user_id: userId,
          checkin_date: date,
          entry_mode: input.entryMode ?? "manual",
          attention: input.attention,
          source_url: input.sourceUrl || null,
          user_prompt: input.entryMode === "ai" ? aiUserPromptSchema.parse(input.userPrompt ?? "") : "",
          ai_generation_context: input.entryMode === "ai" ? input.aiGenerationContext ?? null : null,
          summary: input.summary,
          inspiration: input.inspiration,
          image_path: input.imagePath,
          image_name: input.imageName,
          version: 1,
        })
        .select()
        .single();
      if (error) throw error;
      return mapRecord(data);
    },

    async updateAtVersion(userId, date, expectedVersion, input) {
      // Older clients omit these fields when editing content or reflections.
      const promptUpdates = input.entryMode === "ai"
        ? {
          ...(input.userPrompt !== undefined ? { user_prompt: aiUserPromptSchema.parse(input.userPrompt) } : {}),
          ...(input.aiGenerationContext !== undefined ? { ai_generation_context: input.aiGenerationContext } : {}),
        }
        : { user_prompt: "", ai_generation_context: null };
      const { data, error } = await supabase
        .from("check_ins")
        .update({
          attention: input.attention,
          source_url: input.sourceUrl || null,
          ...promptUpdates,
          summary: input.summary,
          inspiration: input.inspiration,
          image_path: input.imagePath,
          image_name: input.imageName,
          version: expectedVersion + 1,
        })
        .eq("user_id", userId)
        .eq("checkin_date", date)
        .eq("entry_mode", input.entryMode ?? "manual")
        .eq("version", expectedVersion)
        .select()
        .maybeSingle();
      if (error) throw error;
      return data ? mapRecord(data) : null;
    },
  };
}
