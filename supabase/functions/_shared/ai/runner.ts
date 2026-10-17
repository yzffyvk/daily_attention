import { parseQuestionSummary, serializeQuestionSummary } from "../../../../lib/domain/knowledge-questions.ts";
import { SOURCE_TRUNCATION_NOTICE } from "../../../../lib/domain/summary-limits.ts";
import { AI_RESULT_WARNING_LIMIT } from "../../../../lib/domain/ai-review.ts";
import type {
  AiGenerationResult,
  AiSummaryProviderResult,
  AiUsage,
  AiReviewAudit,
  AiValidationAudit,
  AiRoleNormalizationAudit,
} from "./contracts.ts";
import { DeepSeekProviderError } from "./deepseek.ts";
import type { AiGenerationProgress } from "../../../../lib/domain/ai-progress.ts";

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
  MODEL_OUTPUT_INVALID: "AI 返回内容未通过质量校验",
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
  isCancelled?(jobId: string): Promise<boolean>;
  loadSource(sourceUrl: string, signal?: AbortSignal): Promise<AiExtractedSource>;
  begin(jobId: string): Promise<void>;
  anonymousUserId(userId: string): Promise<string>;
  reportProgress?(jobId: string, attemptCount: number, progress: AiGenerationProgress): Promise<void>;
  reportSemanticReview?(jobId: string, audit: AiReviewAudit): Promise<void> | void;
  reportValidationFailure?(jobId: string, audit: AiValidationAudit): Promise<void> | void;
  reportRoleNormalization?(jobId: string, audit: AiRoleNormalizationAudit): Promise<void> | void;
  generate(input: {
    sourceTitle: string;
    sourceText: string;
    sourceTruncated?: boolean;
    userPrompt?: string;
    promptVersion?: string;
    anonymousUserId: string;
    signal?: AbortSignal;
    onProgress?: (progress: AiGenerationProgress) => Promise<void>;
    onSemanticReview?: (audit: AiReviewAudit) => Promise<void>;
    onValidationFailure?: (audit: AiValidationAudit) => Promise<void>;
    onRoleNormalization?: (audit: AiRoleNormalizationAudit) => Promise<void>;
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

  const controller = ports.isCancelled ? new AbortController() : null;
  let watching = true;
  let cancelled = false;
  let polling = false;
  let watcher: ReturnType<typeof setInterval> | undefined;
  const checkCancelled = async () => {
    if (cancelled) return true;
    if (!ports.isCancelled) return false;
    try {
      const stopped = await ports.isCancelled(jobId);
      if (stopped && watching) {
        cancelled = true;
        controller?.abort();
      }
    } catch { /* A transient status read must not cancel a paid generation. */ }
    return cancelled;
  };

  try {
    if (await checkCancelled()) return "ignored";
    if (controller) watcher = setInterval(async () => {
      if (polling || !watching) return;
      polling = true;
      try { await checkCancelled(); } finally { polling = false; }
    }, 1_000);

    let source: AiExtractedSource;
    try {
      source = controller
        ? await ports.loadSource(job.sourceUrl, controller.signal)
        : await ports.loadSource(job.sourceUrl);
    } catch (error) {
      if (await checkCancelled()) return "ignored";
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

    if (await checkCancelled()) return "ignored";
    const anonymousUserId = await ports.anonymousUserId(job.userId);
    if (await checkCancelled()) return "ignored";
    await ports.begin(jobId);

    try {
      let progressAvailable = true;
      const generated = await ports.generate({
        sourceTitle: source.title,
        sourceText: source.text,
        sourceTruncated: source.truncated ?? false,
        userPrompt: job.userPrompt?.trim() ?? "",
        promptVersion: job.promptVersion,
        anonymousUserId,
        ...(controller ? { signal: controller.signal } : {}),
        ...(ports.reportValidationFailure ? { onValidationFailure: async (audit: AiValidationAudit) => {
          try { await ports.reportValidationFailure!(jobId, audit); }
          catch { /* Diagnostic availability must not change generation. */ }
        } } : {}),
        ...(ports.reportRoleNormalization ? { onRoleNormalization: async (audit: AiRoleNormalizationAudit) => {
          try { await ports.reportRoleNormalization!(jobId, audit); }
          catch { /* Diagnostic availability must not change generation. */ }
        } } : {}),
        ...(ports.reportSemanticReview ? { onSemanticReview: async (audit: AiReviewAudit) => {
          try { await ports.reportSemanticReview!(jobId, audit); }
          catch { /* Log availability does not change the quality verdict. */ }
        } } : {}),
        ...(ports.reportProgress ? { onProgress: async (progress: AiGenerationProgress) => {
          if (!progressAvailable || cancelled) return;
          try { await ports.reportProgress!(jobId, job.attemptCount, progress); }
          catch { progressAvailable = false; } // Preview failure must not fail a paid generation.
        } } : {}),
      });
      if (await checkCancelled()) return "ignored";
      const result = { ...generated.result };
      if (source.truncated) {
        const notice = SOURCE_TRUNCATION_NOTICE;
        result.warnings = [...new Set([notice, ...result.warnings])].slice(0, AI_RESULT_WARNING_LIMIT);
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
      if (await checkCancelled()) return "ignored";
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
  } catch (error) {
    if (await checkCancelled()) return "ignored";
    throw error;
  } finally {
    watching = false;
    if (watcher) clearInterval(watcher);
  }
}
