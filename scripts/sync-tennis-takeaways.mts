import { createClient } from "@supabase/supabase-js";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { takeawayLessonSchema, type TakeawayLesson } from "../lib/domain/daily-takeaway.ts";
import { tennisLessons } from "../lib/domain/tennis-lessons.ts";
import type { Database, Json } from "../lib/supabase/database.types.ts";
import { localSupabaseBindings } from "./local-supabase-env.mjs";

type ExistingLesson = { id: string; sequence: number; version: number; content: unknown; published: boolean; reviewed_at?: string | null };
type ReviewOptions = { publish?: boolean; reviewer?: string; confirmHumanReview?: boolean };

export function planCatalogSync(lessons: TakeawayLesson[], existing: ExistingLesson[], options: ReviewOptions) {
  const reviewer = options.reviewer?.trim();
  if (options.publish && (!reviewer || !options.confirmHumanReview)) throw new Error("发布需要具名人工审核，并显式确认已逐条审核内容与来源。");
  const checked = lessons.map(lesson => takeawayLessonSchema.parse(lesson));
  if (new Set(checked.map(item => item.id)).size !== checked.length || new Set(checked.map(item => item.sequence)).size !== checked.length) throw new Error("目录存在重复编号。");
  return checked.flatMap(lesson => {
    const previous = existing.find(item => item.id === lesson.id);
    const wasReviewed = previous && (previous.published || previous.reviewed_at != null);
    const unchanged = previous && isDeepStrictEqual(previous.content, lesson);
    if (wasReviewed && unchanged && (previous.published || !options.publish)) return [];
    if (wasReviewed && !unchanged) {
      if (!options.publish) throw new Error(`${lesson.id} 曾经发布；修改需要重新人工审核。`);
      if (lesson.sequence !== previous.sequence) throw new Error(`${lesson.id} 的学习顺序不能在发布后更改。`);
      if (lesson.version <= previous.version) throw new Error(`${lesson.id} 的内容版本必须递增。`);
      if (!lesson.correctionNote) throw new Error(`${lesson.id} 需要填写更正说明。`);
    }
    return [{
      id: lesson.id, sequence: lesson.sequence, version: lesson.version, content: lesson as Json,
      published: !!options.publish, reviewed_by: options.publish ? reviewer! : null,
      reviewed_at: options.publish ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
    }];
  });
}

async function main() {
  const { values } = parseArgs({ options: {
    apply: { type: "boolean", default: false }, publish: { type: "boolean", default: false },
    reviewer: { type: "string" }, "confirm-human-review": { type: "boolean", default: false },
    "configured-database": { type: "boolean", default: false },
  } });
  const options = { publish: values.publish, reviewer: values.reviewer, confirmHumanReview: values["confirm-human-review"] };
  planCatalogSync(tennisLessons, [], options);
  if (!values.apply) {
    console.log(`目录校验通过：${tennisLessons.length} 条网球新知。未写入数据库。使用 --apply 导入待审核草稿。`);
    return;
  }
  const bindings = values["configured-database"] ? process.env : localSupabaseBindings();
  const url = bindings.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = bindings.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) throw new Error("缺少数据库连接配置。");
  if (!values["configured-database"] && !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("默认仅允许本地数据库。");
  const client = createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const existing = await client.from("daily_takeaway_lessons").select("id, sequence, version, content, published, reviewed_at");
  if (existing.error) throw new Error("无法读取新知目录，请先应用数据库迁移。");
  const rows = planCatalogSync(tennisLessons, existing.data, options);
  if (rows.length) {
    const result = await client.from("daily_takeaway_lessons").upsert(rows, { onConflict: "id" });
    if (result.error) throw new Error(`新知目录保存失败：${result.error.code}`);
  }
  console.log(`已${options.publish ? "发布经确认人工审核的内容" : "导入待审核草稿"}：${rows.length} 条。数据库：${new URL(url).host}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "目录同步失败"); process.exitCode = 1; });
}
