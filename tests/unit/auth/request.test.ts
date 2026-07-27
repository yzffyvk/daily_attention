import { describe, expect, it } from "vitest";
import { emailRateBucket, requestIp } from "@/server/auth/request";

describe("auth request identity", () => {
  it("ignores spoofed X-Forwarded-For values when no Cloudflare identity is present", () => {
    const first = new Request("https://example.test", { headers: { "X-Forwarded-For": "198.51.100.1" } });
    const second = new Request("https://example.test", { headers: { "X-Forwarded-For": "203.0.113.9" } });

    expect(requestIp(first)).toBe("local");
    expect(emailRateBucket(first, " User@Example.com ")).toBe(emailRateBucket(second, "user@example.com"));
  });

  it("uses a strictly normalized CF-Connecting-IP value when Cloudflare provides one", () => {
    const request = new Request("https://example.test", {
      headers: { "CF-Connecting-IP": " 203.0.113.7 ", "X-Forwarded-For": "198.51.100.1" },
    });

    expect(requestIp(request)).toBe("203.0.113.7");
    expect(emailRateBucket(request, " User@Example.com ")).toBe("203.0.113.7:user@example.com");
  });
});
