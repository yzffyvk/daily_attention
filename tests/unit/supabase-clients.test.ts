import { afterEach, describe, expect, it, vi } from "vitest";

const mockClients = vi.hoisted(() => ({
  createBrowserClient: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({ createBrowserClient: mockClients.createBrowserClient }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mockClients.createClient }));

import { createAdminSupabase } from "@/lib/supabase/admin";
import { createBrowserSupabase } from "@/lib/supabase/browser";

describe("Supabase client factories", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("fails closed when browser public configuration is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    expect(() => createBrowserSupabase()).toThrow("Missing public Supabase environment variables");
    expect(mockClients.createBrowserClient).not.toHaveBeenCalled();
  });

  it("fails closed when the admin secret is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");

    expect(() => createAdminSupabase()).toThrow("Missing server Supabase environment variables");
    expect(mockClients.createClient).not.toHaveBeenCalled();
  });
});
