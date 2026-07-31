import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CheckInInput } from "@/lib/domain/checkin";
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
    attention: row.attention,
    sourceUrl: row.source_url ?? "",
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
  findByDate(userId: string, date: string): Promise<CheckInRecord | null>;
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
    async findByDate(userId, date) {
      const { data, error } = await supabase
        .from("check_ins")
        .select()
        .eq("user_id", userId)
        .eq("checkin_date", date)
        .maybeSingle();
      if (error) throw error;
      return data ? mapRecord(data) : null;
    },

    async findByMonth(userId, month) {
      const { data, error } = await supabase
        .from("check_ins")
        .select("checkin_date, attention, image_path, version, updated_at")
        .eq("user_id", userId)
        .gte("checkin_date", `${month}-01`)
        .lt("checkin_date", `${nextMonth(month)}-01`)
        .order("checkin_date", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        date: row.checkin_date,
        attention: row.attention,
        hasImage: row.image_path !== null,
        version: row.version,
        updatedAt: row.updated_at,
      }));
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
          attention: input.attention,
          source_url: input.sourceUrl || null,
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
      const { data, error } = await supabase
        .from("check_ins")
        .update({
          attention: input.attention,
          source_url: input.sourceUrl || null,
          summary: input.summary,
          inspiration: input.inspiration,
          image_path: input.imagePath,
          image_name: input.imageName,
          version: expectedVersion + 1,
        })
        .eq("user_id", userId)
        .eq("checkin_date", date)
        .eq("version", expectedVersion)
        .select()
        .maybeSingle();
      if (error) throw error;
      return data ? mapRecord(data) : null;
    },
  };
}
