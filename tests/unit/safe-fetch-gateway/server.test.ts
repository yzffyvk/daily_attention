import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SafeFetchError } from "@/services/safe-fetch-gateway/src/fetch-public-html";
import { createGatewayServer } from "@/services/safe-fetch-gateway/src/server";

const servers: Array<ReturnType<typeof createGatewayServer>> = [];

async function runningServer(options: Parameters<typeof createGatewayServer>[1]) {
  const server = createGatewayServer({
    host: "127.0.0.1",
    port: 0,
    token: "local-test-token-with-at-least-32-characters",
  }, options);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("safe-fetch gateway server", () => {
  it("serves a configuration-free health check", async () => {
    const baseUrl = await runningServer({ fetcher: vi.fn() });
    const response = await fetch(`${baseUrl}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it.each([undefined, "Bearer wrong-token"])(
    "rejects missing or invalid bearer before fetching",
    async (authorization) => {
      const fetcher = vi.fn();
      const baseUrl = await runningServer({ fetcher });
      const response = await fetch(`${baseUrl}/v1/fetch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authorization ? { Authorization: authorization } : {}),
        },
        body: JSON.stringify({ sourceUrl: "https://example.com/private" }),
      });

      expect(response.status).toBe(401);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("returns safe data and logs only bounded metadata", async () => {
    const logger = vi.fn();
    const fetcher = vi.fn().mockResolvedValue({
      finalUrl: "https://example.com/article",
      contentType: "text/html",
      body: "secret upstream body",
    });
    const baseUrl = await runningServer({ fetcher, logger });
    const response = await fetch(`${baseUrl}/v1/fetch`, {
      method: "POST",
      headers: {
        Authorization: "Bearer local-test-token-with-at-least-32-characters",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sourceUrl: "https://example.com/article?token=secret" }),
    });

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith("gateway_request", {
      requestId: expect.any(String),
      hostHash: expect.stringMatching(/^[0-9a-f]{16}$/u),
      status: 200,
      durationMs: expect.any(Number),
      byteCount: Buffer.byteLength("secret upstream body"),
    });
    expect(JSON.stringify(logger.mock.calls)).not.toContain("example.com");
    expect(JSON.stringify(logger.mock.calls)).not.toContain("secret upstream body");
    expect(JSON.stringify(logger.mock.calls)).not.toContain("token=secret");
  });

  it("maps gateway failures without exposing internal details", async () => {
    const fetcher = vi.fn().mockRejectedValue(
      new SafeFetchError("URL_NOT_ALLOWED", "resolved 10.0.0.1 with private body"),
    );
    const baseUrl = await runningServer({ fetcher });
    const response = await fetch(`${baseUrl}/v1/fetch`, {
      method: "POST",
      headers: {
        Authorization: "Bearer local-test-token-with-at-least-32-characters",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sourceUrl: "https://example.com/article" }),
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toMatchObject({ code: "URL_NOT_ALLOWED" });
    expect(JSON.stringify(body)).not.toContain("10.0.0.1");
    expect(JSON.stringify(body)).not.toContain("private body");
  });
});
