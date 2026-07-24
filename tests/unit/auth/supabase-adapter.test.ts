import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: vi.fn(() => ({})),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { signInWithPassword: mocks.signInWithPassword },
  })),
}));

vi.mock("@/server/rate-limit/service", () => ({
  consumeRateLimit: vi.fn(),
}));

import { createSupabaseAuthAdapter } from "@/server/auth/supabase-adapter";

afterEach(() => {
  vi.clearAllMocks();
});

describe("Supabase auth adapter", () => {
  it("maps only Supabase invalid-credentials errors to the public credential failure", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "invalid_credentials", message: "Invalid login credentials" },
    });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(ports.signIn("internal@internal.invalid", "wrong-password")).rejects.toThrow("INVALID_CREDENTIALS");
  });

  it("keeps Supabase availability failures opaque to the response mapper", async () => {
    const outage = { code: "overloaded", message: "database host 10.0.0.8 is unavailable" };
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: outage,
    });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(ports.signIn("internal@internal.invalid", "password123")).rejects.toBe(outage);
  });

  it("rejects malformed sign-in results instead of treating them as a session", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: null });
    const { ports } = await createSupabaseAuthAdapter();

    await expect(ports.signIn("internal@internal.invalid", "password123")).rejects.toThrow(
      "Malformed sign-in response",
    );
  });
});
