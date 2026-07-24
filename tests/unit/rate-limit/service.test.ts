import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeRateLimit } from "@/server/rate-limit/service";

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
