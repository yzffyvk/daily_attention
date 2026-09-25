import { z } from "zod";

export const AI_USER_PROMPT_LIMIT = 1000;
export const aiUserPromptSchema = z.string().trim().max(AI_USER_PROMPT_LIMIT, "提炼要求不能超过 1000 个字符");
export const aiGenerationContextSchema = z.object({
  userPrompt: aiUserPromptSchema,
  promptVersion: z.string().trim().min(1).max(40),
}).strict();
export type AiGenerationContext = z.infer<typeof aiGenerationContextSchema>;

export function sameAiGenerationContext(left?: AiGenerationContext | null, right?: AiGenerationContext | null) {
  return (left ?? null) === (right ?? null)
    || (left != null && right != null && left.userPrompt === right.userPrompt && left.promptVersion === right.promptVersion);
}
