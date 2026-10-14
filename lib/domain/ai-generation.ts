import { z } from "zod";
import { writableDateKeySchema } from "@/lib/domain/checkin";
import { aiUserPromptSchema } from "@/lib/domain/ai-prompt";

const hashRoutePattern = /^#(?:[!/?]|%(?:2f|21|3f))/iu;
const hashRouteMessage = "该链接通过 # 切换页面，暂不支持，请使用对应内容的直接链接";

export function aiSourceFragmentNotice(value: string): string {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || !url.hash) return "";
    return hashRoutePattern.test(url.hash)
      ? hashRouteMessage
      : "将忽略链接中的章节定位，提炼整篇文章，而非仅该章节。";
  } catch {
    return "";
  }
}

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
    if (hashRoutePattern.test(parsed.hash)) {
      context.addIssue({ code: "custom", message: hashRouteMessage });
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
  userPrompt: aiUserPromptSchema.default(""),
  targetDate: writableDateKeySchema,
  idempotencyKey: z.uuid("请求标识格式不正确"),
}).strict();

export const aiGenerationResultSchema = z.object({
  attention: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1),
  inspiration: z.string().trim().max(2000),
  sourceTitle: z.string().trim().min(1).max(300),
  warnings: z.array(z.string().trim().min(1).max(500)).max(10),
}).strict();

export type CreateAiGenerationInput = z.input<typeof createAiGenerationSchema>;
export type AiGenerationResult = z.infer<typeof aiGenerationResultSchema>;
