import { lookup } from "node:dns/promises";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Socket } from "node:net";
import type { ClientRequest, IncomingMessage } from "node:http";
import { SafeFetchError } from "./errors.js";
import { assertPublicAddresses, type ResolvedAddress } from "./ip-policy.js";
import { dnsHostname, normalizeSourceUrl } from "./normalize-url.js";

export { SafeFetchError } from "./errors.js";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const CONNECT_TIMEOUT_MS = 5_000;
const TOTAL_TIMEOUT_MS = 15_000;
const allowedContentTypes = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/plain",
]);

export type ResolveAll = (
  hostname: string,
) => Promise<Array<ResolvedAddress>>;

type PinnedRequestOptions = RequestOptions & {
  servername?: string;
};

type RequestLike = Pick<ClientRequest, "on" | "once" | "end" | "destroy">;

export type RequestTransport = (
  options: PinnedRequestOptions,
  onResponse: (response: IncomingMessage) => void,
) => RequestLike;

function defaultResolveAll(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true }) as Promise<ResolvedAddress[]>;
}

const defaultRequestTransport: RequestTransport = (options, onResponse) => (
  options.protocol === "https:"
    ? httpsRequest(options, onResponse)
    : httpRequest(options, onResponse)
);

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new SafeFetchError("FETCH_TIMEOUT"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new SafeFetchError("FETCH_TIMEOUT"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function contentType(response: IncomingMessage) {
  return (headerValue(response.headers["content-type"]) ?? "")
    .split(";", 1)[0]!
    .trim()
    .toLowerCase();
}

async function readBody(response: IncomingMessage, signal: AbortSignal) {
  const declaredLength = Number(headerValue(response.headers["content-length"]));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    response.destroy();
    throw new SafeFetchError("RESPONSE_TOO_LARGE");
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response) {
    if (signal.aborted) {
      response.destroy();
      throw new SafeFetchError("FETCH_TIMEOUT");
    }
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      response.destroy();
      throw new SafeFetchError("RESPONSE_TOO_LARGE");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function requestOptions(url: URL, selected: ResolvedAddress): PinnedRequestOptions {
  const hostname = dnsHostname(url);
  return {
    protocol: url.protocol,
    hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    method: "GET",
    path: `${url.pathname}${url.search}`,
    agent: false,
    ...(url.protocol === "https:" ? { servername: hostname } : {}),
    headers: {
      Host: url.host,
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
      "Accept-Encoding": "identity",
      "User-Agent": "TodayAI-SafeFetch/1.0",
      Connection: "close",
    },
    lookup: (_lookupHostname, options, callback) => {
      if (typeof options === "object" && options !== null && options.all === true) {
        callback(null, [selected]);
        return;
      }
      callback(null, selected.address, selected.family);
    },
  };
}

type HopResult =
  | { type: "redirect"; location: string }
  | { type: "success"; contentType: string; body: string };

function requestHop(input: {
  url: URL;
  selected: ResolvedAddress;
  signal: AbortSignal;
  requestTransport: RequestTransport;
}): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request: RequestLike | null = null;
    function finish(callback: () => void) {
      if (settled) return;
      settled = true;
      input.signal.removeEventListener("abort", abort);
      callback();
    }
    function abort() {
      request?.destroy(new SafeFetchError("FETCH_TIMEOUT"));
      finish(() => reject(new SafeFetchError("FETCH_TIMEOUT")));
    }
    request = input.requestTransport(
      requestOptions(input.url, input.selected),
      (response) => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = headerValue(response.headers.location);
          response.resume();
          if (!location) {
            finish(() => reject(new SafeFetchError("CONTENT_BLOCKED")));
            return;
          }
          finish(() => resolve({ type: "redirect", location }));
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          finish(() => reject(new SafeFetchError("CONTENT_BLOCKED")));
          return;
        }
        const responseContentType = contentType(response);
        if (!allowedContentTypes.has(responseContentType)) {
          response.resume();
          finish(() => reject(new SafeFetchError("UNSUPPORTED_CONTENT_TYPE")));
          return;
        }
        void readBody(response, input.signal).then(
          (body) => finish(() => resolve({
            type: "success",
            contentType: responseContentType,
            body,
          })),
          (error: unknown) => finish(() => reject(error)),
        );
      },
    );

    if (input.signal.aborted) {
      abort();
      return;
    }
    input.signal.addEventListener("abort", abort, { once: true });
    request.once("socket", (socket: Socket) => {
      if (!socket.connecting) return;
      const timer = setTimeout(
        () => request?.destroy(new SafeFetchError("FETCH_TIMEOUT")),
        CONNECT_TIMEOUT_MS,
      );
      const clear = () => clearTimeout(timer);
      socket.once(input.url.protocol === "https:" ? "secureConnect" : "connect", clear);
      socket.once("error", clear);
      socket.once("close", clear);
    });
    request.once("error", (error: unknown) => {
      const safeError = error instanceof SafeFetchError
        ? error
        : input.signal.aborted
          ? new SafeFetchError("FETCH_TIMEOUT")
          : new SafeFetchError("CONTENT_BLOCKED");
      finish(() => reject(safeError));
    });
    request.end();
  });
}

export async function fetchPublicHtml(input: {
  sourceUrl: string;
  resolveAll?: ResolveAll;
  signal: AbortSignal;
  requestTransport?: RequestTransport;
}): Promise<{
  finalUrl: string;
  contentType: string;
  body: string;
}> {
  const totalSignal = AbortSignal.any([
    input.signal,
    AbortSignal.timeout(TOTAL_TIMEOUT_MS),
  ]);
  const resolveAll = input.resolveAll ?? defaultResolveAll;
  const requestTransport = input.requestTransport ?? defaultRequestTransport;
  let current = normalizeSourceUrl(input.sourceUrl);
  let redirects = 0;

  while (true) {
    let addresses: ResolvedAddress[];
    try {
      addresses = await withAbort(resolveAll(dnsHostname(current)), totalSignal);
    } catch (error) {
      if (error instanceof SafeFetchError) throw error;
      throw new SafeFetchError("CONTENT_BLOCKED");
    }
    assertPublicAddresses(addresses);
    const selected = addresses[0]!;
    const result = await requestHop({
      url: current,
      selected,
      signal: totalSignal,
      requestTransport,
    });
    if (result.type === "success") {
      return {
        finalUrl: current.toString(),
        contentType: result.contentType,
        body: result.body,
      };
    }
    if (redirects >= MAX_REDIRECTS) {
      throw new SafeFetchError("TOO_MANY_REDIRECTS");
    }
    redirects += 1;
    let redirected: URL;
    try {
      redirected = new URL(result.location, current);
    } catch {
      throw new SafeFetchError("URL_NOT_ALLOWED");
    }
    current = normalizeSourceUrl(redirected.toString());
  }
}
