import { z } from "zod";
export { getLearningDate, nextLearningMidnight } from "./learning-date.ts";

export const TAKEAWAY_TIMEZONE = "Asia/Shanghai" as const;
export const TAKEAWAY_TOPICS = {
  rules: "计分与规则",
  terms: "术语与场地",
  watching: "看球线索",
  technique: "基础击球",
  etiquette: "比赛礼仪",
} as const;

const lessonId = z.string().regex(/^tennis-\d{2}$/u);
const version = z.number().int().positive();
const answerIndex = z.union([z.literal(0), z.literal(1)]);
const text = z.string().trim().min(1);

export const takeawayLessonSchema = z.object({
  id: lessonId,
  sequence: z.number().int().positive(),
  domain: z.literal("tennis"),
  topic: z.enum(["rules", "terms", "watching", "technique", "etiquette"]),
  question: text,
  conclusion: text,
  explanation: text,
  scenario: text,
  takeaway: text,
  readingSeconds: z.number().int().positive(),
  version,
  correctionNote: text.nullable(),
  sourceVerifiedAt: z.iso.date(),
  quiz: z.object({ question: text, options: z.tuple([text, text]), correctIndex: answerIndex, explanation: text }),
  sources: z.array(z.object({ title: text, url: z.url().refine(value => value.startsWith("https://")), section: text })).min(1),
});
export type TakeawayLesson = z.infer<typeof takeawayLessonSchema>;

export const takeawayActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("collect"), lessonId, version }).strict(),
  z.object({ action: z.literal("skip"), lessonId, version }).strict(),
  z.object({ action: z.literal("quiz"), lessonId, version, answerIndex }).strict(),
]);
export type TakeawayAction = z.infer<typeof takeawayActionSchema>;

export const takeawayReceiptSchema = z.object({
  lesson: takeawayLessonSchema,
  collectedAt: z.string().datetime({ offset: true }),
  learningDate: z.iso.date(),
  collectedVersion: version,
});
export type TakeawayReceipt = z.infer<typeof takeawayReceiptSchema>;

export const takeawayQuizResultSchema = z.object({
  lessonId,
  version,
  answerIndex,
  correct: z.boolean(),
  answeredAt: z.string().datetime({ offset: true }),
});

export const takeawayStateSchema = z.object({
  today: z.iso.date(),
  timeZone: z.literal(TAKEAWAY_TIMEZONE),
  nextAvailableAt: z.string().datetime({ offset: true }),
  totalLessons: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  currentLesson: takeawayLessonSchema.nullable(),
  history: z.array(takeawayReceiptSchema),
  quizResults: z.array(takeawayQuizResultSchema),
});
export type TakeawayState = z.infer<typeof takeawayStateSchema>;

export function takeawayStage(input: { totalLessons: number; collectedToday: boolean; hasCurrentLesson: boolean }) {
  if (input.collectedToday) return "done";
  if (input.hasCurrentLesson) return "available";
  return input.totalLessons === 0 ? "unavailable" : "complete";
}

export function takeawayMilestone(collectedCount: number) {
  return collectedCount === 7 || collectedCount === 14 || collectedCount === 30 ? collectedCount : null;
}
