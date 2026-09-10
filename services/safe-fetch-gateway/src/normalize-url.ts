import { SafeFetchError } from "./errors.js";

function rawHostname(sourceUrl: string) {
  const separator = sourceUrl.indexOf("://");
  if (separator < 0) return "";
  const authority = sourceUrl.slice(separator + 3).split(/[/?#]/u, 1)[0] ?? "";
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  if (hostPort.startsWith("[")) {
    const close = hostPort.indexOf("]");
    return close >= 0 ? hostPort.slice(0, close + 1) : hostPort;
  }
  const colon = hostPort.lastIndexOf(":");
  return colon >= 0 ? hostPort.slice(0, colon) : hostPort;
}

function canonicalIpv4(hostname: string) {
  const parts = hostname.split(".");
  return parts.length === 4 && parts.every((part) => {
    if (!/^(0|[1-9][0-9]{0,2})$/u.test(part)) return false;
    return Number(part) <= 255;
  });
}

function ambiguousNumericHostname(hostname: string) {
  const numericLike = /^(?:0x[0-9a-f]+|[0-9]+)(?:\.(?:0x[0-9a-f]+|[0-9]+)){0,3}$/iu;
  return numericLike.test(hostname) && !canonicalIpv4(hostname);
}

export function normalizeSourceUrl(sourceUrl: string) {
  if (typeof sourceUrl !== "string" || sourceUrl.length < 1 || sourceUrl.length > 2048) {
    throw new SafeFetchError("URL_NOT_ALLOWED");
  }
  const trimmed = sourceUrl.trim();
  const rawHost = rawHostname(trimmed);
  if (ambiguousNumericHostname(rawHost)) {
    throw new SafeFetchError("URL_NOT_ALLOWED");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new SafeFetchError("URL_NOT_ALLOWED");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || parsed.username !== ""
    || parsed.password !== ""
    || /^#(?:[!/?]|%(?:2f|21|3f))/iu.test(parsed.hash)
    || (parsed.port !== "" && parsed.port !== "80" && parsed.port !== "443")
  ) {
    throw new SafeFetchError("URL_NOT_ALLOWED");
  }
  // Section anchors are browser-only; never send them to the source server.
  parsed.hash = "";
  if (parsed.toString().length > 2048) throw new SafeFetchError("URL_NOT_ALLOWED");
  return parsed;
}

export function dnsHostname(url: URL) {
  return url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
}
