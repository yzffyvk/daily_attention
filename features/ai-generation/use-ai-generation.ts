"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AiGenerationResult } from "@/lib/domain/ai-generation";
import {
  cancelAiGeneration,
  createAiGeneration,
  getAiGeneration,
} from "./api";
import type {
  ActiveAiJob,
  AiGenerationStage,
} from "./types";

const visiblePollDelays = [1_500, 3_000, 5_000] as const;
const slowPollDelay = 15_000;
const longRunningAfterMs = 120_000;

type CreateRequest = {
  sourceUrl: string;
  targetDate: string;
  idempotencyKey: string;
};

type UseAiGenerationInput = {
  activeJob: ActiveAiJob | null;
  onActiveJobChange?: (activeJob: ActiveAiJob | null) => void;
  onSucceeded(result: AiGenerationResult, targetDate: string): void;
  onTerminal(jobId: string): void;
};

export type AiGenerationController = {
  activeJob: ActiveAiJob | null;
  stage: AiGenerationStage | "idle" | "creating";
  error: string;
  quotaRemaining: number | null;
  isLongRunning: boolean;
  isCreating: boolean;
  canRetryCreate: boolean;
  clearError(): void;
  generate(input: { sourceUrl: string; targetDate: string }): Promise<void>;
  retryCreate(): Promise<void>;
  cancel(): Promise<void>;
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
  const [quotaRemaining, setQuotaRemaining] = useState<number | null>(null);
  const [isLongRunning, setIsLongRunning] = useState(false);
  const [canRetryCreate, setCanRetryCreate] = useState(false);
  const activeJobRef = useRef(activeJob);
  const timerRef = useRef<number | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const pollIndexRef = useRef(0);
  const pendingCreateRef = useRef<CreateRequest | null>(null);
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
    callbacksRef.current.onActiveJobChange?.(null);
    callbacksRef.current.onTerminal(jobId);
  }, [clearPolling]);

  const pollRef = useRef<() => Promise<void>>(async () => undefined);

  const schedulePoll = useCallback((job: ActiveAiJob, suggestedDelay?: number) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    const elapsed = Math.max(0, Date.now() - Date.parse(job.createdAt));
    const longRunning = elapsed >= longRunningAfterMs;
    if (longRunning) setIsLongRunning(true);
    const delay = isDocumentHidden() || longRunning
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
      setStage(next.stage);
      setError("");
      if (next.status === "succeeded" && next.result) {
        callbacksRef.current.onSucceeded(next.result, job.targetDate);
        finish(job.jobId);
        return;
      }
      if (next.status === "failed" || next.status === "cancelled" || next.error) {
        if (next.error) setError(next.error.message);
        finish(job.jobId);
        return;
      }
      pollIndexRef.current += 1;
      schedulePoll(job);
    } catch (nextError) {
      if (controller.signal.aborted) return;
      setError(errorMessage(nextError));
      pollIndexRef.current += 1;
      schedulePoll(job);
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [finish, schedulePoll]);

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  const performCreate = useCallback(async (request: CreateRequest) => {
    clearPolling();
    setStage("creating");
    setError("");
    try {
      const created = await createAiGeneration(request);
      const job: ActiveAiJob = {
        jobId: created.jobId,
        targetDate: request.targetDate,
        sourceUrl: request.sourceUrl,
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
    }
  }, [clearPolling, schedulePoll]);

  const generate = useCallback(async ({ sourceUrl, targetDate }: {
    sourceUrl: string;
    targetDate: string;
  }) => {
    const pending = pendingCreateRef.current;
    const request = pending?.sourceUrl === sourceUrl && pending.targetDate === targetDate
      ? pending
      : { sourceUrl, targetDate, idempotencyKey: crypto.randomUUID() };
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

  const cancel = useCallback(async () => {
    const job = activeJobRef.current;
    if (!job || stage !== "queued") return;
    setError("");
    try {
      await cancelAiGeneration(job.jobId);
      finish(job.jobId);
      setStage("idle");
    } catch (nextError) {
      setError(errorMessage(nextError));
    }
  }, [finish, stage]);

  useEffect(() => {
    const restored = input.activeJob;
    if (!restored || activeJobRef.current?.jobId === restored.jobId) return;
    clearPolling();
    activeJobRef.current = restored;
    setActiveJob(restored);
    setStage("queued");
    setError("");
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

  return {
    activeJob,
    stage,
    error,
    quotaRemaining,
    isLongRunning,
    isCreating: stage === "creating",
    canRetryCreate,
    clearError,
    generate,
    retryCreate,
    cancel,
  };
}
