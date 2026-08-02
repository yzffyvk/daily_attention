import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aiFailure,
  aiSuccess,
  aiValidationFailure,
  isAiGenerationEnabled,
  triggerAiWorker,
} from "@/server/ai/http";

describe("AI generation HTTP responses", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("keeps the AI feature disabled unless explicitly enabled", () => {
    vi.stubEnv("AI_GENERATION_ENABLED", "");
    expect(isAiGenerationEnabled()).toBe(false);
    vi.stubEnv("AI_GENERATION_ENABLED", "true");
    expect(isAiGenerationEnabled()).toBe(true);
    vi.stubEnv("AI_GENERATION_ENABLED", "TRUE");
    expect(isAiGenerationEnabled()).toBe(false);
  });

  it.each([
    ["SESSION_EXPIRED", 401],
    ["FEATURE_DISABLED", 403],
    ["FORBIDDEN_JOB", 403],
    ["JOB_ALREADY_STARTED", 409],
    ["VALIDATION_ERROR", 422],
    ["URL_NOT_ALLOWED", 422],
    ["DAILY_AI_LIMIT_REACHED", 429],
    ["RATE_LIMITED", 429],
    ["AI_SERVICE_UNAVAILABLE", 503],
  ] as const)("maps %s to HTTP %i", async (code, status) => {
    const response = aiFailure(new Error(code), "request-id");

    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code },
      requestId: "request-id",
    });
  });

  it("returns a no-store success envelope", async () => {
    const response = aiSuccess({ jobId: "job-1" }, "request-id", 202);

    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { jobId: "job-1" },
      requestId: "request-id",
    });
  });

  it("returns a field-safe validation error", async () => {
    const response = aiValidationFailure(
      { message: "链接格式不正确", path: ["sourceUrl"] },
      "request-id",
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: { field: "sourceUrl" },
      },
    });
  });

  it("keeps unknown errors opaque and logs only sanitized fields", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = aiFailure(
      new Error("upstream leaked https://secret.invalid and token-123"),
      "request-id",
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      ok: false,
      error: {
        code: "AI_SERVICE_UNAVAILABLE",
        message: "AI 服务暂时不可用，请稍后再试",
        details: {},
      },
      requestId: "request-id",
    });
    expect(errorSpy).toHaveBeenCalledWith("server_error", {
      event: "AI generation request failed",
      requestId: "request-id",
      errorType: "Error",
      errorCode: "INTERNAL_ERROR",
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("secret.invalid");
    expect(JSON.stringify(body)).not.toContain("token-123");
  });

  it("bounds a stalled worker wake-up without losing the durable queue job", async () => {
    vi.useFakeTimers();
    vi.stubEnv("AI_WORKER_TRIGGER_TOKEN", "worker-trigger-token-with-at-least-32-characters");
    const invoke = vi.fn(() => new Promise(() => undefined));
    const pending = triggerAiWorker({ functions: { invoke } } as never);
    const rejection = expect(pending).rejects.toThrow("AI_WORKER_TRIGGER_TIMEOUT");

    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(invoke).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
