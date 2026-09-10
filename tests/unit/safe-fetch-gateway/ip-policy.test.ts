import { describe, expect, it } from "vitest";
import {
  assertPublicAddresses,
  isForbiddenIp,
} from "@/services/safe-fetch-gateway/src/ip-policy";
import { normalizeSourceUrl } from "@/services/safe-fetch-gateway/src/normalize-url";

describe("safe-fetch IP policy", () => {
  it("strips section anchors while preserving encoded path and query data", () => {
    expect(normalizeSourceUrl("https://example.com/a%23b?q=x%23y#skills").toString())
      .toBe("https://example.com/a%23b?q=x%23y");
  });

  it.each(["#/page", "#!/page", "#%2fpage", "#?page=1"])("rejects hash routing %s", (hash) => {
    expect(() => normalizeSourceUrl(`https://example.com/${hash}`)).toThrow("URL_NOT_ALLOWED");
  });
  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
  ])("rejects forbidden address %s", (address) => {
    expect(isForbiddenIp(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"])(
    "allows public address %s",
    (address) => {
      expect(isForbiddenIp(address)).toBe(false);
    },
  );

  it("rejects the entire DNS answer set when any address is forbidden", () => {
    expect(() => assertPublicAddresses([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ])).toThrow("URL_NOT_ALLOWED");
  });

  it.each([
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0177.0.0.1/",
    "http://127.1/",
  ])("rejects ambiguous numeric host %s before DNS", (sourceUrl) => {
    expect(() => normalizeSourceUrl(sourceUrl)).toThrow("URL_NOT_ALLOWED");
  });

  it("keeps canonical public literal addresses available for policy checks", () => {
    expect(normalizeSourceUrl("https://8.8.8.8/article").hostname).toBe("8.8.8.8");
  });
});
