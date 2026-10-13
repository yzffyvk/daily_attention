import { parseQuestionSummary, serializeQuestionSummary } from "../../../../lib/domain/knowledge-questions.ts";
import { SOURCE_TRUNCATION_NOTICE } from "../../../../lib/domain/summary-limits.ts";
import type {
  AiGenerationResult,
  AiSummaryProviderResult,
  AiUsage,
} from "./contracts.ts";
import { DeepSeekProviderError } from "./deepseek.ts";

const MAX_ATTEMPTS = 3;

const fetchFailureMessages: Record<string, string> = {
  URL_NOT_ALLOWED: "该链接不支持访问",
  FETCH_TIMEOUT: "读取页面超时",
  FETCH_SERVICE_UNAVAILABLE: "网页读取服务暂时不可用，请稍后重试",
  TOO_MANY_REDIRECTS: "页面跳转次数过多",
  RESPONSE_TOO_LARGE: "页面内容过大",
  UNSUPPORTED_CONTENT_TYPE: "该链接不是可读取的网页",
  CONTENT_NOT_EXTRACTABLE: "无法从该页面提取正文",
  CONTENT_BLOCKED: "无法安全读取该页面",
  TASK_RETRY_EXHAUSTED: "页面多次读取后仍不可用",
};

const providerFailureMessages: Record<string, string> = {
  MODEL_RATE_LIMITED: "AI 服务繁忙，请稍后重试",
  MODEL_SERVICE_ERROR: "AI 服务暂时不可用",
  MODEL_OUTPUT_INVALID: "AI 返回内容格式异常",
  CONTENT_BLOCKED: "资料内容无法生成摘要",
  TASK_RETRY_EXHAUSTED: "AI 服务多次重试后仍不可用",
};

const permanentFetchCodes = new Set([
  "URL_NOT_ALLOWED",
  "TOO_MANY_REDIRECTS",
  "RESPONSE_TOO_LARGE",
  "UNSUPPORTED_CONTENT_TYPE",
  "CONTENT_NOT_EXTRACTABLE",
  "CONTENT_BLOCKED",
]);

const emptyUsage: AiUsage = {
  promptTokens: 0,
  promptCacheHitTokens: 0,
  promptCacheMissTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0,
};

export type AiClaimedJob = {
  id: string;
  userId: string;
  sourceUrl: string;
  attemptCount: number;
  userPrompt?: string;
  promptVersion?: string;
};

export type AiExtractedSource = {
  title: string;
  text: string;
  contentDigestHex: string;
  truncated?: boolean;
};

export type AiJobRunnerPorts = {
  claim(jobId: string): Promise<AiClaimedJob | null>;
  loadSource(sourceUrl: string): Promise<AiExtractedSource>;
  begin(jobId: string): Promise<void>;
  anonymousUserId(userId: string): Promise<string>;
  generate(input: {
    sourceTitle: string;
    sourceText: string;
    sourceTruncated?: boolean;
    userPrompt?: string;
    promptVersion?: string;
    anonymousUserId: string;
  }): Promise<AiSummaryProviderResult>;
  complete(input: {
    jobId: string;
    sourceTitle: string;
    contentDigestHex: string;
    result: AiGenerationResult;
    usage: AiUsage;
    providerCallCount: number;
    model: string;
    systemFingerprint: string | null;
  }): Promise<void>;
  markFetchFailure(input: {
    jobId: string;
    code: string;
    message: string;
    retryable: boolean;
  }): Promise<void>;
  markProviderFailure(input: {
    jobId: string;
    code: string;
    message: string;
    retryable: boolean;
    providerCallCount: number;
    usage: AiUsage;
  }): Promise<void>;
};

export type AiJobRunResult = "completed" | "retryable" | "ignored";

function stableErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; message?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  return typeof candidate.message === "string" ? candidate.message : null;
}

export async function runAiJob(
  jobId: string,
  ports: AiJobRunnerPorts,
): Promise<AiJobRunResult> {
  const job = await ports.claim(jobId);
  if (!job) return "ignored";

  let source: AiExtractedSource;
  try {
    source = await ports.loadSource(job.sourceUrl);
  } catch (error) {
    const candidate = stableErrorCode(error);
    const transient = candidate === "FETCH_TIMEOUT" || candidate === "FETCH_SERVICE_UNAVAILABLE";
    const knownCode = transient || permanentFetchCodes.has(candidate ?? "")
      ? candidate!
      : "CONTENT_BLOCKED";
    const retryable = transient && job.attemptCount < MAX_ATTEMPTS;
    const code = knownCode === "FETCH_TIMEOUT" && !retryable
      ? "TASK_RETRY_EXHAUSTED"
      : knownCode;
    await ports.markFetchFailure({
      jobId,
      code,
      message: fetchFailureMessages[code] ?? fetchFailureMessages.CONTENT_BLOCKED!,
      retryable,
    });
    return retryable ? "retryable" : "completed";
  }

  await ports.begin(jobId);

  try {
    const anonymousUserId = await ports.anonymousUserId(job.userId);
    const generated = await ports.generate({
      sourceTitle: source.title,
      sourceText: source.text,
      sourceTruncated: source.truncated ?? false,
      userPrompt: job.userPrompt?.trim() ?? "",
      promptVersion: job.promptVersion,
      anonymousUserId,
    });
    const result = { ...generated.result };
    if (source.truncated) {
      const notice = SOURCE_TRUNCATION_NOTICE;
      result.warnings = [...new Set([notice, ...result.warnings])].slice(0, 10);
      const questions = parseQuestionSummary(result.summary);
      if (questions) {
        questions.warnings = result.warnings;
        result.summary = serializeQuestionSummary(questions);
      } else result.summary = `${notice}\n\n${result.summary}`;
    }
    await ports.complete({
      jobId,
      sourceTitle: source.title,
      contentDigestHex: source.contentDigestHex,
      result,
      usage: generated.usage,
      providerCallCount: generated.providerCallCount,
      model: generated.model,
      systemFingerprint: generated.systemFingerprint,
    });
    return "completed";
  } catch (error) {
    const providerError = error instanceof DeepSeekProviderError ? error : null;
    const candidate = providerError?.code ?? "MODEL_SERVICE_ERROR";
    const retryable = (providerError?.retryable ?? true) && job.attemptCount < MAX_ATTEMPTS;
    const code = !retryable && (providerError?.retryable ?? true)
      ? "TASK_RETRY_EXHAUSTED"
      : candidate;
    await ports.markProviderFailure({
      jobId,
      code,
      message: providerFailureMessages[code] ?? providerFailureMessages.MODEL_SERVICE_ERROR!,
      retryable,
      providerCallCount: providerError?.providerCallCount ?? 1,
      usage: providerError?.usage ?? emptyUsage,
    });
    return retryable ? "retryable" : "completed";
  }
}
