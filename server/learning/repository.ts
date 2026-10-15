import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables } from "@/lib/supabase/database.types";
import { aiGenerationContextSchema } from "@/lib/domain/ai-prompt";
import { checkInEntryModeSchema } from "@/lib/domain/checkin";
import { learningAiCandidateSchema, learningStatusSchema, type LearningRecord, type LearningAlbum, type CreateLearningRecordInput, type UpdateLearningRecordInput, type LearningRecordQuery, type LearningAlbumInput, type LearningAlbumUpdateInput } from "@/lib/domain/learning-record";

type LearningRow = Tables<"check_ins">;
type AlbumRow = Tables<"albums">;
type AlbumCounts = Omit<AlbumRow, "user_id"> & { record_count: number; completed_count: number };

export function mapLearningRecord(row: LearningRow): LearningRecord {
  return {
    id: row.id, date: row.checkin_date, entryMode: checkInEntryModeSchema.parse(row.entry_mode),
    attention: row.attention, sourceUrl: row.source_url ?? "", userPrompt: row.user_prompt ?? "",
    aiGenerationContext: aiGenerationContextSchema.nullable().parse(row.ai_generation_context ?? null),
    summary: row.summary, inspiration: row.inspiration, imagePath: row.image_path, imageName: row.image_name,
    imageUrl: null, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
    albumId: row.album_id, status: learningStatusSchema.parse(row.learning_status), completedAt: row.completed_at,
    aiCandidate: learningAiCandidateSchema.nullable().parse(row.ai_candidate),
    activeAiJobId: row.active_ai_job_id, aiStatus: row.ai_status, aiError: row.ai_error,
  };
}
function mapAlbum(row: AlbumRow | AlbumCounts): LearningAlbum {
  return { id: row.id, name: row.name, description: row.description, createdAt: row.created_at, updatedAt: row.updated_at,
    recordCount: "record_count" in row ? Number(row.record_count) : 0, completedCount: "completed_count" in row ? Number(row.completed_count) : 0 };
}

export interface LearningRepository {
  list(userId: string, query: LearningRecordQuery): Promise<{ records: LearningRecord[]; nextCursor: string | null }>;
  find(userId: string, id: string): Promise<LearningRecord | null>;
  create(input: CreateLearningRecordInput): Promise<LearningRecord>;
  update(id: string, input: UpdateLearningRecordInput): Promise<LearningRecord>;
  delete(id: string, version: number): Promise<LearningRecord>;
  move(recordIds: string[], albumId: string | null): Promise<number>;
  listAlbums(): Promise<LearningAlbum[]>;
  createAlbum(userId: string, input: LearningAlbumInput): Promise<LearningAlbum>;
  updateAlbum(userId: string, id: string, input: LearningAlbumUpdateInput): Promise<LearningAlbum | null>;
  deleteAlbum(userId: string, id: string): Promise<string | null>;
  imageIsReferenced(userId: string, path: string): Promise<boolean>;
}

export function createLearningRepository(client: SupabaseClient<Database>): LearningRepository {
  const db = client;
  const repo: LearningRepository = {
    async list(userId, filters) {
      let query = db.from("check_ins").select().eq("user_id", userId);
      if (filters.search) query = query.ilike("attention", `%${filters.search.replace(/[\\%_]/gu, "\\$&")}%`);
      if (filters.date) query = query.eq("checkin_date", filters.date);
      if (filters.month) {
        const [year, month] = filters.month.split("-").map(Number);
        const next = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
        query = query.gte("checkin_date", `${filters.month}-01`).lt("checkin_date", next);
      }
      if (filters.albumId) query = query.eq("album_id", filters.albumId);
      if (filters.unfiled) query = query.is("album_id", null);
      if (filters.status) query = query.eq("learning_status", filters.status);
      if (filters.pending) query = query.or("learning_status.eq.pending,ai_candidate.not.is.null,active_ai_job_id.not.is.null,ai_status.eq.failed");
      if (filters.sourceUrl) query = query.eq("source_url_key", filters.sourceUrl);
      if (filters.cursor) {
        const [time, id] = filters.cursor.split("|");
        // The domain schema validates both values before interpolation into PostgREST syntax.
        query = query.or(`created_at.lt.${time},and(created_at.eq.${time},id.lt.${id})`);
      }
      const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(filters.limit + 1);
      if (error) throw error;
      const records = (data ?? []).slice(0, filters.limit).map(mapLearningRecord);
      const last = records.at(-1);
      return { records, nextCursor: (data?.length ?? 0) > filters.limit && last ? `${last.createdAt}|${last.id}` : null };
    },
    async find(userId, id) {
      const { data, error } = await db.from("check_ins").select().eq("user_id", userId).eq("id", id).maybeSingle();
      if (error) throw error;
      return data ? mapLearningRecord(data) : null;
    },
    async create(input) {
      const { data, error } = await db.rpc("create_learning_record", { target_id: input.id, payload: input as unknown as Json }).single();
      if (error) throw error;
      return mapLearningRecord(data);
    },
    async update(id, input) {
      const { version, candidateJobId, discardCandidate, ...patch } = input;
      const { data, error } = await db.rpc("update_learning_record", { target_id: id, expected_version: version, patch: patch as Json, ...(candidateJobId ? { candidate_job_id: candidateJobId } : {}), discard_candidate: discardCandidate ?? false }).single();
      if (error) throw error;
      return mapLearningRecord(data);
    },
    async delete(id, version) {
      const { data, error } = await db.rpc("delete_learning_record", { target_id: id, expected_version: version }).single();
      if (error) throw error;
      return mapLearningRecord(data);
    },
    async move(recordIds, albumId) {
      const { data, error } = await db.rpc("move_learning_records", { record_ids: recordIds, target_album_id: albumId as unknown as string });
      if (error) throw error;
      return data;
    },
    async listAlbums() {
      const { data, error } = await db.rpc("get_learning_albums");
      if (error) throw error;
      return (data ?? []).map(mapAlbum);
    },
    async createAlbum(userId, input) {
      const { data, error } = await db.from("albums").insert({ user_id: userId, ...input }).select().single();
      if (error) throw error;
      return mapAlbum(data);
    },
    async updateAlbum(userId, id, input) {
      const { data, error } = await db.from("albums").update(input).eq("user_id", userId).eq("id", id).select().maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return (await repo.listAlbums()).find(album => album.id === id) ?? mapAlbum(data);
    },
    async deleteAlbum(userId, id) {
      const { data, error } = await db.from("albums").delete().eq("user_id", userId).eq("id", id).select("id").maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
    async imageIsReferenced(userId, path) {
      const { data, error } = await db.from("check_ins").select("id").eq("user_id", userId).eq("image_path", path).limit(1);
      if (error) throw error;
      return Boolean(data?.length);
    },
  };
  return repo;
}
