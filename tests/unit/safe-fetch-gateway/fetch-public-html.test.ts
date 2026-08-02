import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  fetchPublicHtml,
  type RequestTransport,
} from "@/services/safe-fetch-gateway/src/fetch-public-html";

type FakeResponse = {
  status: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
  neverRespond?: boolean;
};

function transportFor(
  responses: FakeResponse[],
  inspect?: (options: Record<string, unknown>, call: number) => void,
) {
  let call = 0;
  const transport: RequestTransport = (options, onResponse) => {
    const request = new EventEmitter() as EventEmitter & {
      end(): void;
      destroy(error?: Error): void;
      setTimeout(ms: number, callback: () => void): typeof request;
    };
    request.setTimeout = () => request;
    request.destroy = (error) => {
      queueMicrotask(() => request.emit("error", error ?? new Error("destroyed")));
    };
    request.end = () => {
      inspect?.(options as unknown as Record<string, unknown>, call);
      const response = responses[call++];
      if (!response || response.neverRespond) return;
      const stream = new PassThrough() as PassThrough & {
        statusCode: number;
        headers: Record<string, string>;
      };
      stream.statusCode = response.status;
      stream.headers = response.headers ?? { "content-type": "text/html" };
      queueMicrotask(() => {
        onResponse(stream as unknown as Parameters<typeof onResponse>[0]);
        stream.end(response.body ?? "<main>public article</main>");
      });
    };
    return request as unknown as ReturnType<RequestTransport>;
  };
  return transport;
}

const publicResolver = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);

describe("DNS-pinned public fetch", () => {
  it("pins the socket lookup while retaining the original HTTPS hostname", async () => {
    const resolveAll = vi.fn(publicResolver);
    const transport = transportFor([{ status: 200 }], (options) => {
      expect(options.hostname).toBe("example.com");
      expect(options.servername).toBe("example.com");
      expect(options.agent).toBe(false);
      expect(options.headers).toMatchObject({
        Host: "example.com",
        "Accept-Encoding": "identity",
      });
      const lookup = options.lookup as (
        hostname: string,
        settings: unknown,
        callback: (error: Error | null, address: string, family: number) => void,
      ) => void;
      lookup("example.com", {}, (error, address, family) => {
        expect(error).toBeNull();
        expect(address).toBe("93.184.216.34");
        expect(family).toBe(4);
      });
    });

    await expect(fetchPublicHtml({
      sourceUrl: "https://example.com/article",
      resolveAll,
      signal: new AbortController().signal,
      requestTransport: transport,
    })).resolves.toMatchObject({
      finalUrl: "https://example.com/article",
      contentType: "text/html",
    });
    expect(resolveAll).toHaveBeenCalledTimes(1);
  });

  it("revalidates every redirect and rejects a private target", async () => {
    const resolveAll = vi.fn(async (hostname: string) => hostname === "example.com"
      ? [{ address: "93.184.216.34", family: 4 as const }]
      : [{ address: "10.0.0.1", family: 4 as const }]);
    const transport = transportFor([{
      status: 302,
      headers: { location: "https://internal.example/private" },
    }]);

    await expect(fetchPublicHtml({
      sourceUrl: "https://example.com/start",
      resolveAll,
      signal: new AbortController().signal,
      requestTransport: transport,
    })).rejects.toThrow("URL_NOT_ALLOWED");
    expect(resolveAll).toHaveBeenCalledTimes(2);
  });

  it("stops after five redirects", async () => {
    const responses = Array.from({ length: 6 }, (_, index) => ({
      status: 302,
      headers: { location: `/redirect-${index + 1}` },
    }));

    await expect(fetchPublicHtml({
      sourceUrl: "https://example.com/start",
      resolveAll: publicResolver,
      signal: new AbortController().signal,
      requestTransport: transportFor(responses),
    })).rejects.toThrow("TOO_MANY_REDIRECTS");
  });

  it("rejects unsupported content types and streamed bodies over 2 MiB", async () => {
    await expect(fetchPublicHtml({
      sourceUrl: "https://example.com/image",
      resolveAll: publicResolver,
      signal: new AbortController().signal,
      requestTransport: transportFor([{
        status: 200,
        headers: { "content-type": "image/png" },
        body: "not-an-image",
      }]),
    })).rejects.toThrow("UNSUPPORTED_CONTENT_TYPE");

    await expect(fetchPublicHtml({
      sourceUrl: "https://example.com/large",
      resolveAll: publicResolver,
      signal: new AbortController().signal,
      requestTransport: transportFor([{
        status: 200,
        body: Buffer.alloc(2 * 1024 * 1024 + 1, 97),
      }]),
    })).rejects.toThrow("RESPONSE_TOO_LARGE");
  });

  it("maps an aborted request to a stable timeout", async () => {
    await expect(fetchPublicHtml({
      sourceUrl: "https://example.com/slow",
      resolveAll: publicResolver,
      signal: AbortSignal.timeout(5),
      requestTransport: transportFor([{ status: 200, neverRespond: true }]),
    })).rejects.toThrow("FETCH_TIMEOUT");
  });
});
