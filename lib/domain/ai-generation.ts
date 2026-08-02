import { z } from "zod";
import { dateKeySchema } from "@/lib/domain/checkin";

const sourceUrlSchema = z
  .string()
  .trim()
  .min(1, "请输入公开资料链接")
  .max(2048, "链接不能超过 2048 个字符")
  .transform((value, context) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      context.addIssue({ code: "custom", message: "链接格式不正确" });
      return z.NEVER;
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      context.addIssue({ code: "custom", message: "仅支持 HTTP/HTTPS 链接" });
      return z.NEVER;
    }
    if (parsed.username || parsed.password) {
      context.addIssue({ code: "custom", message: "链接不能包含登录凭据" });
      return z.NEVER;
    }
    if (parsed.hash) {
      context.addIssue({ code: "custom", message: "链接不能包含片段" });
      return z.NEVER;
    }
    if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
      context.addIssue({ code: "custom", message: "链接端口不受支持" });
      return z.NEVER;
    }

    parsed.hash = "";
    const normalized = parsed.toString();
    if (normalized.length > 2048) {
      context.addIssue({ code: "custom", message: "链接不能超过 2048 个字符" });
      return z.NEVER;
    }
    return normalized;
  });

export const createAiGenerationSchema = z.object({
  sourceUrl: sourceUrlSchema,
  targetDate: dateKeySchema,
  idempotencyKey: z.uuid("请求标识格式不正确"),
}).strict();

export const aiGenerationResultSchema = z.object({
  attention: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(5000),
  inspiration: z.string().trim().min(1).max(2000),
  sourceTitle: z.string().trim().min(1).max(300),
  warnings: z.array(z.string().trim().min(1).max(500)).max(10),
}).strict();

export type CreateAiGenerationInput = z.infer<typeof createAiGenerationSchema>;
export type AiGenerationResult = z.infer<typeof aiGenerationResultSchema>;
