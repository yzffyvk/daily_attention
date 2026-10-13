import { z } from "zod";

export const AI_PREVIEW_LIMIT = 48_000;
export const aiGenerationProgressSchema = z.object({
  phase: z.enum(["thinking", "writing", "repairing", "validating"]),
  preview: z.string().max(AI_PREVIEW_LIMIT),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export type AiGenerationProgress = z.infer<typeof aiGenerationProgressSchema>;

// Read only public prose fields from unfinished JSON. Never render wire JSON,
// identifiers, source evidence or provider reasoning as a user-facing answer.
export function summaryStreamPreview(content: string): string {
  const tokens = /"((?:[^"\\]|\\[\s\S])*)(?:(")|\\?$)/gu;
  const fields = new Set(["attention", "thesis", "coreQuestion", "title", "answer", "name", "summary", "explanation", "distinctions"]);
  const paragraphs: string[] = [];
  let field: string | null = null;
  for (const token of content.matchAll(tokens)) {
    const tail = content.slice(token.index! + token[0].length);
    if (token[2] && /^\s*:/u.test(tail)) {
      try { field = JSON.parse(token[0]) as string; } catch { field = null; }
      continue;
    }
    if (field && fields.has(field)) {
      // Completed strings retain every escape. For unfinished strings, hold
      // only an incomplete escape suffix (at most the five chars in \u123).
      for (let trim = 0; trim <= (token[2] ? 0 : Math.min(5, token[1].length)); trim++) {
        try {
          const raw = token[1].slice(0, token[1].length - trim);
          const value = JSON.parse(`"${raw}"`) as string;
          if (value.trim()) paragraphs.push(value.trim());
          break;
        } catch { /* Wait for the next chunk's remaining escape characters. */ }
      }
    }
    field = null;
  }
  return paragraphs.join("\n\n").slice(0, AI_PREVIEW_LIMIT);
}
