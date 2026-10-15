"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AiGenerationResult } from "@/lib/domain/ai-generation";
import type { AiGenerationProgress } from "@/lib/domain/ai-progress";
import { aiUserPromptSchema, type AiGenerationContext } from "@/lib/domain/ai-prompt";
import { ApiError } from "@/features/checkins/api";
import {
  cancelAiGeneration,
  createAiGeneration,
  getAiGeneration,
} from "./api";
import type {
  ActiveAiJob,
  AiCancellationInfo,
  AiGenerationJobData,
  AiGenerationStage,
} from "./types";

const visiblePollDelays = [1_500, 3_000, 5_000] as const;
const slowPollDelay = 15_000;
const longRunningAfterMs = 120_000;

type CreateRequest = {
  recordId?: string;
  userPrompt: string;
  sourceUrl: string;
  targetDate: string;
  idempotencyKey: string;
};

type UseAiGenerationInput = {
  activeJob: ActiveAiJob | null;
  onActiveJobChange?: (activeJob: ActiveAiJob | null) => void;
  onSucceeded(result: AiGenerationResult, targetDate: string, generationContext?: AiGenerationContext, recordId?: string): void;
  onTerminal(jobId: string): void;
};

export type AiGenerationController = {
  activeJob: ActiveAiJob | null;
  stage: AiGenerationStage | "idle" | "creating";
  error: string;
  progress: AiGenerationProgress | null;
  attemptCount: number;
  retryMessage: string;
  quotaRemaining: number | null;
  isLongRunning: boolean;
  isCreating: boolean;
  canRetryCreate: boolean;
  isCancelling: boolean;
  cancellation: AiCancellationInfo | null;
  cancellationMessage: string;
  cancellationConfirmationRequired: boolean;
  dismissCancellationConfirmation(): void;
  clearError(): void;
  generate(input: { recordId?: string; sourceUrl: string; targetDate: string; userPrompt?: string }): Promise<void>;
  retryCreate(): Promise<void>;
  cancel(confirmQuotaConsumption?: boolean): Promise<void>;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "AI 服务暂时不可用，请稍后重试";
}

function isDocumentHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

export function useAiGeneration(input: UseAiGenerationInput): AiGenerationController {
  const [activeJob, setActiveJob] = useState<ActiveAiJob | null>(input.activeJob);
  const [stage, setStage] = useState<AiGenerationController["stage"]>(
    input.activeJob ? "queued" : "idle",
  );
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<AiGenerationProgress | null>(null);
  const [attemptCount, setAttemptCount] = useState(0);
  const [retryContext, setRetryContext] = useState<{ attemptCount: number; message: string } | null>(null);
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const [isLongRunning, setIsLongRunning] = useState(false);
  const [canRetryCreate, setCanRetryCreate] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancellation, setCancellation] = useState<AiCancellationInfo | null>(null);
  const [cancellationMessage, setCancellationMessage] = useState("");
  const [cancellationConfirmationRequired, setCancellationConfirmationRequired] = useState(false);
  const cancellationRef = useRef<AiCancellationInfo | null>(null);
  const cancellingJobRef = useRef<string | null>(null);
  const activeJobRef = useRef(activeJob);
  const timerRef = useRef<number | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const pollIndexRef = useRef(0);
  const pendingCreateRef = useRef<CreateRequest | null>(null);
  const creatingRef = useRef(false);
  const callbacksRef = useRef(input);

  useEffect(() => {
    callbacksRef.current = input;
  }, [input]);

  const clearPolling = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);

  const finish = useCallback((jobId: string) => {
    clearPolling();
    activeJobRef.current = null;
    setActiveJob(null);
    setIsLongRunning(false);
    setProgress(null);
    setAttemptCount(0);
    setRetryContext(null);
    setCancellationConfirmationRequired(false);
    setIsCancelling(false);
    if (cancellingJobRef.current === jobId) cancellingJobRef.current = null;
    callbacksRef.current.onActiveJobChange?.(null);
    callbacksRef.current.onTerminal(jobId);
  }, [clearPolling]);

  const receiveJob = useCallback((next: AiGenerationJobData, job: ActiveAiJob) => {
    if (activeJobRef.current?.jobId !== job.jobId) return true;
    setStage(next.stage);
    setProgress(next.status === "generating" ? next.progress ?? null : null);
    setAttemptCount(next.attemptCount ?? 0);
    if (next.quota) setQuotaRemaining(next.quota.remaining);
    if (next.cancellation) {
      cancellationRef.current = next.cancellation;
      setCancellation(next.cancellation);
    }
    if (next.status === "retryable") setRetryContext({
      attemptCount: next.attemptCount ?? 0,
      message: next.retryMessage ?? "上一轮未完成，正在重新尝试。",
    });
    setError("");
    if (next.status === "succeeded" && next.result) {
      setCancellationMessage("");
      if (job.recordId) {
        callbacksRef.current.onSucceeded(next.result, job.targetDate, next.generationContext ?? job.generationContext, job.recordId);
      } else {
        callbacksRef.current.onSucceeded(next.result, job.targetDate, next.generationContext ?? job.generationContext);
      }
      finish(job.jobId);
      return true;
    }
    if (next.status === "succeeded" && next.error) {
      if (!job.recordId) setError(next.error.message);
      finish(job.jobId);
      return true;
    }
    if (next.status === "failed" || next.status === "cancelled") {
      if (next.error) setError(next.error.message);
      if (next.status === "cancelled") {
        const outcome = next.cancellation;
        const charge = outcome?.charged === true
          ? "本次保留扣除 1 次额度。"
          : outcome?.charged === false ? "本次额度已退回。" : "已有小结与修改已保留。";
        setCancellationMessage(`任务已取消，${charge}${outcome ? `今日免费取消剩余 ${outcome.freeRemaining} 次。` : ""}`);
      }
      finish(job.jobId);
      return true;
    }
    return false;
  }, [finish]);

  const pollRef = useRef<() => Promise<void>>(async () => undefined);

  const schedulePoll = useCallback((job: ActiveAiJob, suggestedDelay?: number) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    const elapsed = Math.max(0, Date.now() - Date.parse(job.createdAt));
    const longRunning = elapsed >= longRunningAfterMs;
    if (longRunning) setIsLongRunning(true);
    const delay = isDocumentHidden()
      ? slowPollDelay
      : suggestedDelay ?? visiblePollDelays[Math.min(
        pollIndexRef.current,
        visiblePollDelays.length - 1,
      )]!;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void pollRef.current();
    }, delay);
  }, []);

  const poll = useCallback(async () => {
    const job = activeJobRef.current;
    if (!job) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const next = await getAiGeneration(job.jobId, controller.signal);
      if (controller.signal.aborted || activeJobRef.current?.jobId !== job.jobId) return;
      if (receiveJob(next, job)) return;
      pollIndexRef.current += 1;
      schedulePoll(job, next.status === "generating" ? 1_000 : undefined);
    } catch (nextError) {
      if (controller.signal.aborted) return;
      setError(errorMessage(nextError));
      pollIndexRef.current += 1;
      schedulePoll(job);
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [receiveJob, schedulePoll]);

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  const performCreate = useCallback(async (request: CreateRequest) => {
    if (creatingRef.current || activeJobRef.current) return;
    creatingRef.current = true;
    clearPolling();
    setStage("creating");
    setProgress(null);
    setAttemptCount(0);
    setRetryContext(null);
    setIsLongRunning(false);
    setError("");
    setCancellationMessage("");
    setCancellationConfirmationRequired(false);
    cancellationRef.current = null;
    setCancellation(null);
    try {
      const created = await createAiGeneration(request);
      const job: ActiveAiJob = {
        jobId: created.jobId,
        ...((created.recordId ?? request.recordId) ? { recordId: created.recordId ?? request.recordId } : {}),
        targetDate: request.targetDate,
        sourceUrl: request.sourceUrl,
        userPrompt: request.userPrompt,
        generationContext: created.generationContext,
        createdAt: new Date().toISOString(),
      };
      pendingCreateRef.current = null;
      setCanRetryCreate(false);
      pollIndexRef.current = 0;
      activeJobRef.current = job;
      setActiveJob(job);
      setStage("queued");
      setQuotaRemaining(created.quota.remaining);
      callbacksRef.current.onActiveJobChange?.(job);
      schedulePoll(job, created.pollAfterMs);
    } catch (nextError) {
      setStage("idle");
      setCanRetryCreate(true);
      setError(errorMessage(nextError));
    } finally {
      creatingRef.current = false;
    }
  }, [clearPolling, schedulePoll]);

  const generate = useCallback(async ({ sourceUrl, targetDate, userPrompt = "", recordId }: {
    recordId?: string;
    sourceUrl: string;
    targetDate: string;
    userPrompt?: string;
  }) => {
    if (creatingRef.current || activeJobRef.current) return;
    const parsedPrompt = aiUserPromptSchema.safeParse(userPrompt);
    if (!parsedPrompt.success) {
      setError(parsedPrompt.error.issues[0].message);
      return;
    }
    const normalizedPrompt = parsedPrompt.data;
    const pending = pendingCreateRef.current;
    const request = pending?.recordId === recordId && pending?.sourceUrl === sourceUrl && pending.targetDate === targetDate && pending.userPrompt === normalizedPrompt
      ? pending
      : { ...(recordId ? { recordId } : {}), sourceUrl, targetDate, userPrompt: normalizedPrompt, idempotencyKey: crypto.randomUUID() };
    pendingCreateRef.current = request;
    setCanRetryCreate(false);
    await performCreate(request);
  }, [performCreate]);

  const retryCreate = useCallback(async () => {
    const request = pendingCreateRef.current;
    if (request) await performCreate(request);
  }, [performCreate]);

  const clearError = useCallback(() => {
    setError("");
  }, []);

  const cancel = useCallback(async (confirmQuotaConsumption = false) => {
    const job = activeJobRef.current;
    if (!job || cancellingJobRef.current === job.jobId) return;
    if (!confirmQuotaConsumption && cancellationRef.current?.requiresConfirmation) {
      setCancellationConfirmationRequired(true);
      return;
    }
    cancellingJobRef.current = job.jobId;
    setIsCancelling(true);
    setError("");
    try {
      const next = await cancelAiGeneration(job.jobId, confirmQuotaConsumption);
      receiveJob(next, job);
    } catch (nextError) {
      if (activeJobRef.current?.jobId !== job.jobId) return;
      if (nextError instanceof ApiError && nextError.code === "CANCELLATION_CONFIRMATION_REQUIRED") {
        const policy = { freeRemaining: 0, requiresConfirmation: true, charged: null };
        cancellationRef.current = policy;
        setCancellation(policy);
        setCancellationConfirmationRequired(true);
      } else setError(errorMessage(nextError));
    } finally {
      if (cancellingJobRef.current === job.jobId) {
        cancellingJobRef.current = null;
        setIsCancelling(false);
      }
    }
  }, [receiveJob]);

  const dismissCancellationConfirmation = useCallback(() => {
    if (!cancellingJobRef.current) setCancellationConfirmationRequired(false);
  }, []);

  useEffect(() => {
    const restored = input.activeJob;
    if (!restored || activeJobRef.current?.jobId === restored.jobId) return;
    clearPolling();
    activeJobRef.current = restored;
    cancellingJobRef.current = null;
    setIsCancelling(false);
    setActiveJob(restored);
    setStage("queued");
    setProgress(null);
    setAttemptCount(0);
    setRetryContext(null);
    setIsLongRunning(false);
    setError("");
    cancellationRef.current = null;
    setCancellation(null);
    setCancellationMessage("");
    setCancellationConfirmationRequired(false);
    pollIndexRef.current = 0;
    schedulePoll(restored);
  }, [clearPolling, input.activeJob, schedulePoll]);

  useEffect(() => {
    if (!input.activeJob || activeJobRef.current?.jobId !== input.activeJob.jobId) return;
    if (timerRef.current === null && requestRef.current === null) {
      schedulePoll(input.activeJob);
    }
  }, [input.activeJob, schedulePoll]);

  useEffect(() => () => clearPolling(), [clearPolling]);

  useEffect(() => {
    const resume = () => {
      if (!isDocumentHidden() && activeJobRef.current) {
        clearPolling();
        void pollRef.current();
      }
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [clearPolling]);

  return {
    activeJob,
    stage,
    error,
    progress,
    attemptCount,
    retryMessage: retryContext && attemptCount <= retryContext.attemptCount + 1 ? retryContext.message : "",
    quotaRemaining,
    isLongRunning,
    isCreating: stage === "creating",
    canRetryCreate,
    isCancelling,
    cancellation,
    cancellationMessage,
    cancellationConfirmationRequired,
    dismissCancellationConfirmation,
    clearError,
    generate,
    retryCreate,
    cancel,
  };
}
