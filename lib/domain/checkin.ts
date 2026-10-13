import { z } from "zod";
import { aiGenerationContextSchema, aiUserPromptSchema } from "./ai-prompt.ts";

export const checkInEntryModeSchema = z.enum(["manual", "ai"]);
export type CheckInEntryMode = z.infer<typeof checkInEntryModeSchema>;

export const dateKeySchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, "日期格式不正确");

const sourceUrlSchema = z.union([
  z.literal(""),
  z.string().url().max(2048).refine((value) => /^https?:\/\//u.test(value), "仅支持 HTTP/HTTPS 链接"),
]);

export const checkInInputSchema = z.object({
  entryMode: checkInEntryModeSchema.default("manual"),
  attention: z.string().trim().min(1, "请填写 attention").max(120),
  sourceUrl: sourceUrlSchema,
  userPrompt: aiUserPromptSchema.optional(),
  aiGenerationContext: aiGenerationContextSchema.nullable().optional(),
  summary: z.string(),
  inspiration: z.string().max(2000),
  imagePath: z
    .string()
    .min(1)
    .max(1024)
    .refine((value) => /\S/u.test(value), "图片路径不能为空白")
    .nullable(),
  imageName: z.string().max(255),
  version: z.number().int().positive().nullable(),
});

export const monthQuerySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u, "月份格式不正确");
export type CheckInInput = z.infer<typeof checkInInputSchema>;
