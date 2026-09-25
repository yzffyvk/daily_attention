import { z } from "zod";

export const reflectionPolishInputSchema = z.object({
  topic: z.string().max(120),
  summary: z.string().min(1).max(5_000).refine((value) => value.trim().length > 0, "知识总结不能为空"),
  answer: z.string().min(1).max(2_000).refine((value) => value.trim().length > 0, "解释不能为空"),
  maxLength: z.number().int().min(1).max(2_000),
}).strict().superRefine((value, context) => {
  if (value.answer.length > value.maxLength) {
    context.addIssue({
      code: "custom",
      path: ["answer"],
      message: "当前解释超过允许长度",
    });
  }
});

const noteSchema = z.string().min(1).max(300).refine((value) => value.trim().length > 0, "说明不能为空");
const knowledgePointSchema = z.string().min(1).max(40).refine((value) => value.trim().length > 0, "知识点不能为空");

export const reflectionPolishResultSchema = z.object({
  polishedAnswer: z.string().min(1).max(2_000).refine((value) => value.trim().length > 0, "润色结果不能为空"),
  knowledgePoints: z.array(knowledgePointSchema).max(6),
  improvements: z.array(noteSchema).max(4),
  cautions: z.array(noteSchema).max(3),
}).strict();

export type ReflectionPolishInput = z.infer<typeof reflectionPolishInputSchema>;
export type ReflectionPolishResult = z.infer<typeof reflectionPolishResultSchema>;
