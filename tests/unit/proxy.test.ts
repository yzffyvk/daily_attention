import { afterEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getClaims: vi.fn(),
  responses: [] as Array<{ cookies: CookieJar; headers: Headers }>,
}));

class CookieJar {
  values = new Map<string, { value: string; options?: Record<string, unknown> }>();

  getAll() {
    return Array.from(this.values, ([name, { value }]) => ({ name, value }));
  }

  set(name: string, value: string, options?: Record<string, unknown>) {
    this.values.set(name, { value, options });
  }

  get(name: string) {
    const cookie = this.values.get(name);
    return cookie ? { name, ...cookie } : undefined;
  }
}

vi.mock("@supabase/ssr", () => ({ createServerClient: mockState.createServerClient }));
vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => {
      const response = { cookies: new CookieJar(), headers: new Headers() };
      mockState.responses.push(response);
      return response;
    }),
  },
}));

import { proxy } from "@/proxy";

describe("proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    mockState.responses.length = 0;
  });

  it("propagates refreshed cookies, options, headers, and calls getClaims", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    mockState.createServerClient.mockImplementation((_url, _key, options) => {
      options.cookies.setAll(
        [{ name: "sb-access-token", value: "fresh", options: { httpOnly: true, sameSite: "lax" } }],
        { "Cache-Control": "private, no-store" },
      );
      return { auth: { getClaims: mockState.getClaims } };
    });
    mockState.getClaims.mockResolvedValue({ data: { claims: {} }, error: null });
    const request = { cookies: new CookieJar() };
    request.cookies.set("sb-access-token", "stale");

    const response = await proxy(request as never) as unknown as { cookies: CookieJar; headers: Headers };

    expect(mockState.getClaims).toHaveBeenCalledOnce();
    expect(request.cookies.get("sb-access-token")).toMatchObject({ value: "fresh" });
    expect(response.cookies.get("sb-access-token")).toMatchObject({
      value: "fresh",
      options: { httpOnly: true, sameSite: "lax" },
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("fails closed when proxy public configuration is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    await expect(proxy({ cookies: new CookieJar() } as never)).rejects.toThrow(
      "Missing public Supabase environment variables",
    );
    expect(mockState.createServerClient).not.toHaveBeenCalled();
  });
});
