import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeRateLimit,
  reserveStorageUpload,
} from "@/server/rate-limit/service";

describe("consumeRateLimit", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the action-specific limit and a digested bucket", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT_PEPPER", "test-rate-limit-pepper");
    const rpc = vi.fn().mockResolvedValue({
      data: [{ allowed: false, retry_after_seconds: 37 }],
      error: null,
    });
    await expect(
      consumeRateLimit("login", "203.0.113.1:学习者", { rpc }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 37 });
    expect(rpc).toHaveBeenCalledWith(
      "consume_auth_rate_limit",
      expect.objectContaining({
        target_action: "login",
        target_max_attempts: 10,
        target_window_seconds: 900,
      }),
    );
  });

  it("fails closed when the RPC returns malformed data", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT_PEPPER", "test-rate-limit-pepper");
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await expect(consumeRateLimit("login", "203.0.113.1", { rpc })).rejects.toThrow(
      "Malformed rate-limit RPC response",
    );
  });

  it("fails closed when the RPC returns a malformed error", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT_PEPPER", "test-rate-limit-pepper");
    const rpc = vi.fn().mockResolvedValue({ data: [], error: "upstream unavailable" });

    await expect(consumeRateLimit("login", "203.0.113.1", { rpc })).rejects.toThrow(
      "Rate-limit RPC failed",
    );
  });

  it("fails closed when the pepper is missing", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT_PEPPER", "");

    await expect(
      consumeRateLimit("login", "203.0.113.1", { rpc: vi.fn() }),
    ).rejects.toThrow("Missing AUTH_RATE_LIMIT_PEPPER");
  });
});

describe("reserveStorageUpload", () => {
  it("reserves a per-user upload through the server-only quota RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ allowed: true, reason: null, retry_after_seconds: 0 }],
      error: null,
    });

    await expect(
      reserveStorageUpload(
        {
          userId: "00000000-0000-4000-8000-000000000001",
          path: "00000000-0000-4000-8000-000000000001/2026-07-25/00000000-0000-4000-8000-000000000002.png",
          size: 1024,
        },
        { rpc },
      ),
    ).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledWith("reserve_checkin_image_upload", {
      target_user_id: "00000000-0000-4000-8000-000000000001",
      target_path: "00000000-0000-4000-8000-000000000001/2026-07-25/00000000-0000-4000-8000-000000000002.png",
      target_size: 1024,
    });
  });

  it.each([
    ["RATE_LIMITED", 91],
    ["STORAGE_QUOTA_EXCEEDED", 0],
  ])("fails with a 429-compatible error for %s", async (reason, retryAfterSeconds) => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ allowed: false, reason, retry_after_seconds: retryAfterSeconds }],
      error: null,
    });

    await expect(
      reserveStorageUpload(
        {
          userId: "00000000-0000-4000-8000-000000000001",
          path: "00000000-0000-4000-8000-000000000001/2026-07-25/00000000-0000-4000-8000-000000000002.png",
          size: 1024,
        },
        { rpc },
      ),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      reason,
      retryAfterSeconds,
    });
  });

  it("fails closed for a malformed quota response", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ allowed: true, reason: "unexpected", retry_after_seconds: 0 }],
      error: null,
    });

    await expect(
      reserveStorageUpload(
        {
          userId: "00000000-0000-4000-8000-000000000001",
          path: "00000000-0000-4000-8000-000000000001/2026-07-25/00000000-0000-4000-8000-000000000002.png",
          size: 1024,
        },
        { rpc },
      ),
    ).rejects.toThrow("Malformed storage upload limit response");
  });
});
