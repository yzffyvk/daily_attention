import { createHmac, createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { GatewayConfig } from "./config.js";
import {
  fetchPublicHtml,
  SafeFetchError,
} from "./fetch-public-html.js";

type Fetcher = (input: {
  sourceUrl: string;
  signal: AbortSignal;
}) => Promise<{ finalUrl: string; contentType: string; body: string }>;

type GatewayLog = {
  requestId: string;
  hostHash: string;
  status: number;
  durationMs: number;
  byteCount: number;
};

type Logger = (event: "gateway_request", fields: GatewayLog) => void;

const errorResponses = {
  URL_NOT_ALLOWED: { status: 422, message: "该链接不允许访问" },
  FETCH_TIMEOUT: { status: 504, message: "读取网页超时" },
  TOO_MANY_REDIRECTS: { status: 422, message: "网页跳转次数过多" },
  RESPONSE_TOO_LARGE: { status: 413, message: "网页内容过大" },
  UNSUPPORTED_CONTENT_TYPE: { status: 415, message: "该链接不是可处理的文本网页" },
  CONTENT_BLOCKED: { status: 502, message: "网页暂时无法访问" },
} as const;

function bearerMatches(header: string | undefined, expectedToken: string) {
  const prefix = "Bearer ";
  const hasPrefix = typeof header === "string" && header.startsWith(prefix);
  const provided = hasPrefix ? header.slice(prefix.length) : "";
  const expectedDigest = createHash("sha256").update(expectedToken).digest();
  const providedDigest = createHash("sha256").update(provided).digest();
  return hasPrefix && timingSafeEqual(expectedDigest, providedDigest);
}

function requestId(request: IncomingMessage) {
  const candidate = request.headers["x-request-id"];
  return typeof candidate === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(candidate)
    ? candidate
    : randomUUID();
}

function writeJson(response: ServerResponse, status: number, body: unknown) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(encoded),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(encoded);
}

async function requestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > 8 * 1024) throw new SafeFetchError("URL_NOT_ALLOWED");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as unknown;
  } catch {
    throw new SafeFetchError("URL_NOT_ALLOWED");
  }
}

function sourceUrlFrom(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SafeFetchError("URL_NOT_ALLOWED");
  }
  const record = body as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1
    || typeof record.sourceUrl !== "string"
    || record.sourceUrl.length < 1
    || record.sourceUrl.length > 2048
  ) {
    throw new SafeFetchError("URL_NOT_ALLOWED");
  }
  return record.sourceUrl;
}

function hashHost(sourceUrl: string | null, token: string) {
  let hostname = "invalid";
  if (sourceUrl !== null) {
    try {
      hostname = new URL(sourceUrl).hostname.toLowerCase();
    } catch {
      // Invalid URLs share a bounded, non-sensitive log bucket.
    }
  }
  return createHmac("sha256", token).update(hostname).digest("hex").slice(0, 16);
}

function safeError(error: unknown) {
  return error instanceof SafeFetchError
    ? error
    : new SafeFetchError("CONTENT_BLOCKED");
}

export function createGatewayServer(
  config: GatewayConfig,
  options: {
    fetcher?: Fetcher;
    logger?: Logger;
    now?: () => number;
  } = {},
) {
  const fetcher = options.fetcher ?? ((input) => fetchPublicHtml(input));
  const logger = options.logger ?? ((event, fields) => console.info(event, fields));
  const now = options.now ?? Date.now;

  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      writeJson(response, 200, { ok: true });
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/fetch") {
      writeJson(response, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
      return;
    }

    const id = requestId(request);
    const startedAt = now();
    let sourceUrl: string | null = null;
    let status = 500;
    let byteCount = 0;
    try {
      if (!bearerMatches(request.headers.authorization, config.token)) {
        status = 401;
        writeJson(response, status, {
          error: { code: "UNAUTHORIZED", message: "Unauthorized" },
          requestId: id,
        });
        return;
      }
      sourceUrl = sourceUrlFrom(await requestBody(request));
      const abortController = new AbortController();
      request.once("aborted", () => abortController.abort());
      const result = await fetcher({
        sourceUrl,
        signal: abortController.signal,
      });
      byteCount = Buffer.byteLength(result.body);
      status = 200;
      writeJson(response, status, { ...result, requestId: id });
    } catch (error) {
      const failure = safeError(error);
      const mapped = errorResponses[failure.code];
      status = mapped.status;
      writeJson(response, status, {
        error: { code: failure.code, message: mapped.message },
        requestId: id,
      });
    } finally {
      logger("gateway_request", {
        requestId: id,
        hostHash: hashHost(sourceUrl, config.token),
        status,
        durationMs: Math.max(0, now() - startedAt),
        byteCount,
      });
    }
  });
}
