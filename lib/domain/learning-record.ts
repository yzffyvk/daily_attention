import { z } from "zod";
import type { CheckInRecord } from "@/features/checkins/types";
import { checkInEntryModeSchema, dateKeySchema, monthQuerySchema, writableDateKeySchema } from "./checkin";
import { aiGenerationContextSchema, aiUserPromptSchema } from "./ai-prompt";
import { aiGenerationResultSchema } from "./ai-generation";

export const learningStatusSchema = z.enum(["pending", "completed"]);
export const learningAiCandidateSchema = z.object({
  jobId: z.uuid(), sourceUrl: z.string(), userPrompt: aiUserPromptSchema,
  baseVersion: z.number().int().positive(), generationContext: aiGenerationContextSchema.nullable(),
  result: aiGenerationResultSchema, createdAt: z.string(),
});
export type LearningAiCandidate = z.infer<typeof learningAiCandidateSchema>;
export type LearningRecord = CheckInRecord & {
  albumId: string | null; status: z.infer<typeof learningStatusSchema>; completedAt: string | null;
  aiCandidate: LearningAiCandidate | null; activeAiJobId: string | null; aiStatus: string | null; aiError: string | null;
};
export type LearningAlbum = {
  id: string; name: string; description: string; createdAt: string; updatedAt: string;
  recordCount: number; completedCount: number;
};

export function normalizeLearningSourceUrl(value: string) {
  const source = value.trim();
  if (!/^https?:\/\//iu.test(source)) return source;
  let url: URL;
  try { url = new URL(source); } catch { return source; }
  // Keep hash-router URLs intact so AI validation can explain why they are unsupported.
  if (!/^#(?:[!/?]|%(?:2f|21|3f))/iu.test(url.hash)) url.hash = "";
  return url.toString();
}
// A saved source can be a URL, a book reference, or any short piece of text.
// Fetchable URL validation belongs to AI generation, not record persistence.
const sourceSchema = z.string().trim().max(2048).transform(normalizeLearningSourceUrl).pipe(z.string().max(2048));
function sourceTitle(source: string) {
  try { return new URL(source).hostname || source.slice(0, 120); }
  catch { return source.slice(0, 120); }
}
const contentFields = {
  entryMode: checkInEntryModeSchema,
  attention: z.string().trim().max(120), sourceUrl: sourceSchema, userPrompt: aiUserPromptSchema,
  aiGenerationContext: aiGenerationContextSchema.nullable(),
  summary: z.string(), inspiration: z.string().max(2000),
  imagePath: z.string().min(1).max(1024).refine(value => /\S/u.test(value)).nullable(),
  imageName: z.string().max(255), albumId: z.uuid().nullable(), status: learningStatusSchema,
};
export const createLearningRecordSchema = z.object({
  ...contentFields, id: z.uuid(), date: writableDateKeySchema,
  entryMode: contentFields.entryMode.default("manual"), userPrompt: contentFields.userPrompt.default(""),
  aiGenerationContext: contentFields.aiGenerationContext.optional(), albumId: contentFields.albumId.default(null),
  status: contentFields.status.default("pending"),
}).strict().superRefine((value, ctx) => {
  if (!value.attention && (value.status === "completed" || !value.sourceUrl)) {
    ctx.addIssue({ code: "custom", path: ["attention"], message: "请填写学习主题" });
  }
}).transform(value => ({ ...value, attention: value.attention || sourceTitle(value.sourceUrl).slice(0, 120) }));
export const updateLearningRecordSchema = z.object(contentFields).partial().extend({
  version: z.number().int().positive(), candidateJobId: z.uuid().optional(), discardCandidate: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.candidateJobId && value.discardCandidate) ctx.addIssue({ code: "custom", message: "不能同时确认和丢弃提炼结果" });
  if (value.attention !== undefined && !value.attention) ctx.addIssue({ code: "custom", path: ["attention"], message: "请填写学习主题" });
});
export const learningAlbumInputSchema = z.object({
  name: z.string().trim().min(1, "请填写专辑名称").max(80),
  description: z.string().trim().max(500).default(""),
}).strict();
export const learningAlbumUpdateSchema = learningAlbumInputSchema.omit({ description: true }).extend({
  description: z.string().trim().max(500).optional(),
});
export const moveLearningRecordsSchema = z.object({
  recordIds: z.array(z.uuid()).min(1).max(100).refine(ids => new Set(ids).size === ids.length, "记录不能重复"),
  albumId: z.uuid().nullable(),
}).strict();
const cursorSchema = z.string().refine(value => {
  const [time, id, ...rest] = value.split("|");
  return !rest.length && z.iso.datetime({ offset: true }).safeParse(time).success && z.uuid().safeParse(id).success;
}, "分页游标不正确");
const booleanQuery = z.enum(["true", "false"]).transform(value => value === "true").optional();
export const learningRecordQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  date: dateKeySchema.optional(), month: monthQuerySchema.optional(), albumId: z.uuid().optional(),
  sourceUrl: sourceSchema.optional(), status: learningStatusSchema.optional(), unfiled: booleanQuery, pending: booleanQuery,
  cursor: cursorSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict().refine(value => !(value.albumId && value.unfiled), "专辑筛选不正确");
export type CreateLearningRecordInput = z.infer<typeof createLearningRecordSchema>;
export type UpdateLearningRecordInput = z.infer<typeof updateLearningRecordSchema>;
export type LearningRecordQuery = z.infer<typeof learningRecordQuerySchema>;
export type LearningAlbumInput = z.infer<typeof learningAlbumInputSchema>;

export type LearningAlbumUpdateInput = z.infer<typeof learningAlbumUpdateSchema>;
