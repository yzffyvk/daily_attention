import { describe, expect, it } from "vitest";
import { phoneRateBucket, requestIp } from "@/server/auth/request";

describe("auth request identity", () => {
  it("ignores spoofed X-Forwarded-For values when no Cloudflare identity is present", () => {
    const first = new Request("https://example.test", { headers: { "X-Forwarded-For": "198.51.100.1" } });
    const second = new Request("https://example.test", { headers: { "X-Forwarded-For": "203.0.113.9" } });

    expect(requestIp(first)).toBe("local");
    expect(phoneRateBucket(first, " 138 0013 8000 ")).toBe(phoneRateBucket(second, "13800138000"));
  });

  it("uses a strictly normalized CF-Connecting-IP value when Cloudflare provides one", () => {
    const request = new Request("https://example.test", {
      headers: { "CF-Connecting-IP": " 203.0.113.7 ", "X-Forwarded-For": "198.51.100.1" },
    });

    expect(requestIp(request)).toBe("203.0.113.7");
    expect(phoneRateBucket(request, "13800138000")).toBe("203.0.113.7:13800138000");
  });
});
