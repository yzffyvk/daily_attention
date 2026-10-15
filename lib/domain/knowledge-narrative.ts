import { z } from "zod";
import { checkInEntryModeSchema, dateKeySchema, type CheckInEntryMode } from "./checkin.ts";
import { knowledgeMapResultSchema, validateKnowledgeMapResult } from "./knowledge-map.ts";

export const MIN_NARRATIVE_DATES = 2;
export const MAX_NARRATIVE_DATES = 14;
export const narrativeDatesSchema = z.array(dateKeySchema).min(MIN_NARRATIVE_DATES, "至少选择 2 个有记录的日期").max(MAX_NARRATIVE_DATES, "一次最多串联 14 个日期")
  .refine(dates => new Set(dates).size === dates.length, "日期不能重复")
  .transform(dates => [...dates].sort());
const legacyCreateNarrativeSchema = z.object({
  entryMode: checkInEntryModeSchema.default("manual"),
  dates: narrativeDatesSchema,
  question: z.string().trim().max(300, "问题不能超过 300 字").default(""),
  idempotencyKey: z.uuid("请求标识格式不正确"),
 }).strict();
export const narrativeRecordIdsSchema = z.array(z.uuid()).min(2, "至少选择 2 条已完成记录").max(14, "一次最多串联 14 条记录")
  .refine(ids => new Set(ids).size === ids.length, "记录不能重复").transform(ids => [...ids].sort());
export const createRecordNarrativeSchema = z.object({
  recordIds: narrativeRecordIdsSchema, question: z.string().trim().max(300).default(""), idempotencyKey: z.uuid(),
}).strict();
export const createNarrativeSchema = z.union([createRecordNarrativeSchema, legacyCreateNarrativeSchema]);
export const renameNarrativeSchema = z.object({ title: z.string().trim().min(1, "请填写脉络名称").max(120, "名称不能超过 120 字") }).strict();
export const narrativeSourceSchema = z.object({
  id: z.uuid().optional(), entryMode: checkInEntryModeSchema.optional(),
  date: dateKeySchema, attention: z.string().min(1).max(120), summary: z.string(),
  inspiration: z.string().max(2000), version: z.number().int().positive(),
  sourceUrl: z.string().max(2048), hasImage: z.boolean(),
}).strict();
const citedSectionSchema = z.object({
  title: z.string().trim().min(1).max(100), body: z.string().trim().min(1).max(2500),
  sourceDates: z.array(dateKeySchema).min(1).max(MAX_NARRATIVE_DATES),
}).strict();
export const legacyNarrativeResultSchema = z.object({
  title: z.string().trim().min(1).max(120), overview: z.string().trim().min(1).max(1500),
  nodes: z.array(z.object({date: dateKeySchema, label: z.string().trim().min(1).max(20), takeaway: z.string().trim().min(1).max(300)}).strict()).min(2).max(14),
  connections: z.array(z.object({fromDate: dateKeySchema, toDate: dateKeySchema, relation: z.enum(["递进", "补充", "对照", "应用", "弱关联"]), explanation: z.string().trim().min(1).max(500)}).strict()).min(1).max(13),
  sections: z.array(citedSectionSchema).min(1).max(8),
  framework: z.array(citedSectionSchema).min(1).max(6),
  gaps: z.array(z.string().trim().min(1).max(500)).max(8),
  nextSteps: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
}).strict();
export const narrativeResultSchema = z.union([knowledgeMapResultSchema, legacyNarrativeResultSchema]);
export type LegacyNarrativeResult = z.infer<typeof legacyNarrativeResultSchema>;
export type NarrativeSource = z.infer<typeof narrativeSourceSchema>;
export type NarrativeResult = z.infer<typeof narrativeResultSchema>;
export const editNarrativeSchema = z.object({
  result: narrativeResultSchema,
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
}).strict();
export const updateNarrativeSchema = z.union([renameNarrativeSchema, editNarrativeSchema]);
export const copyNarrativeSchema = z.object({ idempotencyKey: z.uuid("请求标识格式不正确") }).strict();
export type EditNarrativeInput = z.infer<typeof editNarrativeSchema>;
export type NarrativeStatus = "queued" | "generating" | "succeeded" | "failed";
export type NarrativeSummary = {
  id: string; title: string; dates: string[]; question: string; status: NarrativeStatus;
  createdAt: string; updatedAt: string; error: string | null;
};
export type KnowledgeNarrative = NarrativeSummary & {
  sources: NarrativeSource[]; result: NarrativeResult | null; changedDates: string[];
};
export type CreateNarrativeInput = z.infer<typeof createRecordNarrativeSchema> | (Omit<z.infer<typeof legacyCreateNarrativeSchema>, "entryMode"> & { entryMode?: CheckInEntryMode });

/** Reject structurally valid hallucinated citations, missing days and duplicate edges. */
export function validateNarrativeResult(value: unknown, sourceDates: string[], sourceRecordIds: string[] = []): NarrativeResult {
  const result = narrativeResultSchema.parse(value);
  if ("schemaVersion" in result && result.schemaVersion === 3) {
    return validateKnowledgeMapResult(result, narrativeRecordIdsSchema.parse(sourceRecordIds));
  }
  const dates = narrativeDatesSchema.parse(sourceDates);
  if ("schemaVersion" in result) return validateKnowledgeMapResult(result, dates);
  const sortedNodes = [...result.nodes].sort((a,b) => a.date.localeCompare(b.date));
  if (sortedNodes.length !== dates.length || sortedNodes.some((node,i) => node.date !== dates[i])) {
    throw new Error("NARRATIVE_SOURCE_COVERAGE_INVALID");
  }
  for (const section of [...result.sections, ...result.framework]) {
    if (new Set(section.sourceDates).size !== section.sourceDates.length || section.sourceDates.some(date => !dates.includes(date))) {
      throw new Error("NARRATIVE_SOURCE_REFERENCE_INVALID");
    }
  }
  const edges = [...result.connections].sort((a,b) => a.fromDate.localeCompare(b.fromDate));
  if (edges.length !== dates.length - 1 || edges.some((edge,i) => edge.fromDate !== dates[i] || edge.toDate !== dates[i+1])) {
    throw new Error("NARRATIVE_CONNECTION_INVALID");
  }
  return { ...result, nodes: sortedNodes, connections: edges };
}
