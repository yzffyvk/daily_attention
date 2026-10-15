import { z } from "zod";
import { AI_RESULT_WARNING_LIMIT } from './ai-review';
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
  recordId: z.uuid("记录标识格式不正确").optional(),
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
  warnings: z.array(z.string().trim().min(1).max(500)).max(AI_RESULT_WARNING_LIMIT),
}).strict();

export type CreateAiGenerationInput = z.input<typeof createAiGenerationSchema>;
export type AiGenerationResult = z.infer<typeof aiGenerationResultSchema>;

export const aiGenerationTaskErrorMessages = {
  FETCH_TIMEOUT: "读取网页超时，请稍后重试",
  FETCH_SERVICE_UNAVAILABLE: "网页读取服务暂时不可用，请稍后重试",
  TOO_MANY_REDIRECTS: "网页跳转次数过多",
  RESPONSE_TOO_LARGE: "网页内容过大，暂时无法处理",
  UNSUPPORTED_CONTENT_TYPE: "该链接不是可处理的文本网页",
  CONTENT_NOT_EXTRACTABLE: "未能从该页面读取足够的公开正文",
  CONTENT_BLOCKED: "该页面暂时无法访问",
  MODEL_RATE_LIMITED: "AI 服务繁忙，请稍后重试",
  MODEL_OUTPUT_INVALID: "AI 返回内容未通过质量校验，请稍后重试",
  MODEL_SERVICE_ERROR: "AI 服务暂时不可用，请稍后再试",
  TASK_RETRY_EXHAUSTED: "任务多次尝试后仍未成功",
  RESULT_EXPIRED: "生成结果已过期，请重新生成",
} as const;

export function aiGenerationErrorMessage(code: string | null | undefined): string {
  return code && Object.hasOwn(aiGenerationTaskErrorMessages, code)
    ? aiGenerationTaskErrorMessages[code as keyof typeof aiGenerationTaskErrorMessages]
    : "AI 提炼失败，请重试";
}
