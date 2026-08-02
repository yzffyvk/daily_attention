const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_GATEWAY_RESPONSE_BYTES = 16 * 1024 * 1024;
const stableGatewayCodes = new Set([
  "URL_NOT_ALLOWED",
  "FETCH_TIMEOUT",
  "TOO_MANY_REDIRECTS",
  "RESPONSE_TOO_LARGE",
  "UNSUPPORTED_CONTENT_TYPE",
  "CONTENT_BLOCKED",
]);

export type SafeFetchResult = {
  finalUrl: string;
  contentType: string;
  body: string;
};

export class SafeFetchClientError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "SafeFetchClientError";
    this.code = code;
  }
}

function fail(code: string): never {
  throw new SafeFetchClientError(code);
}

function validResult(value: unknown): value is SafeFetchResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (
    typeof result.finalUrl !== "string"
    || result.finalUrl.length > 2048
    || typeof result.contentType !== "string"
    || typeof result.body !== "string"
  ) {
    return false;
  }
  let finalUrl: URL;
  try {
    finalUrl = new URL(result.finalUrl);
  } catch {
    return false;
  }
  return (
    (finalUrl.protocol === "https:" || finalUrl.protocol === "http:")
    && ["text/html", "application/xhtml+xml", "text/plain"].includes(
      result.contentType.split(";", 1)[0]!.trim().toLowerCase(),
    )
  );
}

async function readBoundedJson(response: Response) {
  if (!response.body) return fail("CONTENT_BLOCKED");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_GATEWAY_RESPONSE_BYTES) {
      await reader.cancel();
      return fail("CONTENT_BLOCKED");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return fail("CONTENT_BLOCKED");
  }
}

export function createSafeFetchClient(config: {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}) {
  let baseUrl: URL;
  try {
    baseUrl = new URL(config.baseUrl);
  } catch {
    return fail("SAFE_FETCH_GATEWAY_CONFIG_INVALID");
  }
  if (
    baseUrl.protocol !== "https:"
    || baseUrl.username
    || baseUrl.password
    || baseUrl.search
    || baseUrl.hash
    || (baseUrl.pathname !== "/" && baseUrl.pathname !== "")
    || config.token.length < 32
    || config.token.length > 512
  ) {
    return fail("SAFE_FETCH_GATEWAY_CONFIG_INVALID");
  }
  const endpoint = new URL("/v1/fetch", baseUrl).toString();
  const fetchImpl = config.fetchImpl ?? fetch;

  return async (sourceUrl: string, signal: AbortSignal): Promise<SafeFetchResult> => {
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ sourceUrl }),
        signal,
      });
    } catch {
      return fail(signal.aborted ? "FETCH_TIMEOUT" : "CONTENT_BLOCKED");
    }

    let payload: unknown;
    try {
      payload = await readBoundedJson(response);
    } catch {
      return fail(signal.aborted ? "FETCH_TIMEOUT" : "CONTENT_BLOCKED");
    }
    if (!response.ok) {
      const code = payload && typeof payload === "object"
        ? (payload as { error?: { code?: unknown } }).error?.code
        : undefined;
      return fail(typeof code === "string" && stableGatewayCodes.has(code)
        ? code
        : "CONTENT_BLOCKED");
    }
    if (!validResult(payload)) return fail("CONTENT_BLOCKED");
    if (new TextEncoder().encode(payload.body).byteLength > MAX_BODY_BYTES) {
      return fail("RESPONSE_TOO_LARGE");
    }
    return {
      finalUrl: payload.finalUrl,
      contentType: payload.contentType.split(";", 1)[0]!.trim().toLowerCase(),
      body: payload.body,
    };
  };
}
