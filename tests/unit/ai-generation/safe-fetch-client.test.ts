import { describe, expect, it, vi } from "vitest";
import { createSafeFetchClient } from "@/supabase/functions/_shared/ai/safe-fetch-client";

describe("safe-fetch Edge client", () => {
  it("allows explicitly enabled loopback HTTP only", () => {
    const token = "dedicated-gateway-token-with-32-characters";
    expect(() => createSafeFetchClient({ baseUrl: "http://127.0.0.1:8788", token,
      allowLoopbackHttp: true })).not.toThrow();
    for (const baseUrl of ["http://gateway.example.test", "http://127.0.0.1.evil.test", "http://192.168.1.1"]) {
      expect(() => createSafeFetchClient({baseUrl, token, allowLoopbackHttp: true}))
        .toThrow("SAFE_FETCH_GATEWAY_CONFIG_INVALID");
    }
    expect(() => createSafeFetchClient({baseUrl: "http://127.0.0.1:8788", token}))
      .toThrow("SAFE_FETCH_GATEWAY_CONFIG_INVALID");
  });
  it("uses only the authenticated HTTPS gateway", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      finalUrl: "https://example.com/article",
      contentType: "text/html",
      body: "public article",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const signal = new AbortController().signal;
    const fetchPublic = createSafeFetchClient({
      baseUrl: "https://gateway.example.test/",
      token: "dedicated-gateway-token-with-32-characters",
      fetchImpl,
    });

    await expect(fetchPublic("https://example.com/article", signal)).resolves.toEqual({
      finalUrl: "https://example.com/article",
      contentType: "text/html",
      body: "public article",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gateway.example.test/v1/fetch",
      expect.objectContaining({
        method: "POST",
        signal,
        headers: expect.objectContaining({
          Authorization: "Bearer dedicated-gateway-token-with-32-characters",
        }),
      }),
    );
  });

  it("rejects non-HTTPS configuration without a direct-fetch fallback", () => {
    expect(() => createSafeFetchClient({
      baseUrl: "http://gateway.example.test",
      token: "dedicated-gateway-token-with-32-characters",
      fetchImpl: vi.fn(),
    })).toThrow("SAFE_FETCH_GATEWAY_CONFIG_INVALID");
  });

  it("maps stable gateway errors without retaining response details", async () => {
    const fetchPublic = createSafeFetchClient({
      baseUrl: "https://gateway.example.test",
      token: "dedicated-gateway-token-with-32-characters",
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        error: {
          code: "RESPONSE_TOO_LARGE",
          message: "leaked upstream body and 10.0.0.1",
        },
      }), { status: 413 })),
    });

    const failure = await fetchPublic(
      "https://example.com/article",
      new AbortController().signal,
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "RESPONSE_TOO_LARGE" });
    expect(String(failure)).not.toContain("10.0.0.1");
    expect(String(failure)).not.toContain("upstream body");
  });

  it("fails closed for malformed or oversized success payloads", async () => {
    const malformed = createSafeFetchClient({
      baseUrl: "https://gateway.example.test",
      token: "dedicated-gateway-token-with-32-characters",
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ body: 123 }), { status: 200 })),
    });
    await expect(malformed("https://example.com", new AbortController().signal))
      .rejects.toMatchObject({ code: "CONTENT_BLOCKED" });

    const oversized = createSafeFetchClient({
      baseUrl: "https://gateway.example.test",
      token: "dedicated-gateway-token-with-32-characters",
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        finalUrl: "https://example.com",
        contentType: "text/plain",
        body: "a".repeat(2 * 1024 * 1024 + 1),
      }), { status: 200 })),
    });
    await expect(oversized("https://example.com", new AbortController().signal))
      .rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });
});
