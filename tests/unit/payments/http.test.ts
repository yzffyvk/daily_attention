// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const dependencies = vi.hoisted(() => ({ getUser: vi.fn(), loadConfig: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({ auth: { getUser: dependencies.getUser } }) }));
vi.mock("@/server/payments/config", () => ({ loadPaymentConfig: dependencies.loadConfig }));
vi.mock("@/server/payments/service", () => ({ paymentService: () => ({ create: dependencies.create }) }));
import { paymentContext, paymentUser } from "@/server/payments/http";
import { POST } from "@/app/api/payments/route";
beforeEach(() => {
  vi.clearAllMocks();
  dependencies.getUser.mockResolvedValue({ data: { user: { id: "00000000-0000-4000-8000-000000009701" } }, error: null });
  dependencies.loadConfig.mockResolvedValue({ mode: "sandbox", origin: "http://127.0.0.1:3300" });
  dependencies.create.mockResolvedValue({ orderNo: "test-order", state: "PENDING_PAYMENT" });
});
const request = (extra: Record<string, unknown> = {}, origin = "http://127.0.0.1:3300") => new Request(`${origin}/api/payments`, {
  method: "POST", headers: { origin, "Content-Type": "application/json" },
  body: JSON.stringify({ productId: "ai_10", idempotencyKey: "00000000-0000-4000-8000-000000009711", ...extra }),
});
it("derives the same order owner from the verified account across browser sessions", async () => {
  expect(await paymentUser()).toEqual(await paymentUser());
});
it("requires an authenticated user before payment SDK setup", async () => {
  dependencies.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await POST(request())).status).toBe(401);
  expect(dependencies.loadConfig).not.toHaveBeenCalled();
  expect(dependencies.create).not.toHaveBeenCalled();
});
it("rejects cross-origin checkout", async () => {
  await expect(paymentContext(request({}, "https://unrelated.invalid"))).rejects.toThrow("PAYMENT_ORIGIN_INVALID");
});
it("never accepts a price or credit count supplied by the client", async () => {
  expect((await POST(request({ amount: "0.01", credits: 999 }))).status).toBe(422);
  expect(dependencies.create).not.toHaveBeenCalled();
});
it("creates the selected pack for the authenticated account", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(dependencies.create).toHaveBeenCalledWith(expect.any(String), "00000000-0000-4000-8000-000000009701", "ai_10", "00000000-0000-4000-8000-000000009711");
});
it("requires explicit production sales enablement while keeping sandbox available", async () => {
  dependencies.loadConfig.mockResolvedValue({ mode: "production", origin: "http://127.0.0.1:3300" });
  const prior = process.env.PAYMENTS_ENABLED;
  process.env.PAYMENTS_ENABLED = "false";
  try { expect((await POST(request())).status).toBe(503); expect(dependencies.create).not.toHaveBeenCalled(); }
  finally { if (prior === undefined) delete process.env.PAYMENTS_ENABLED; else process.env.PAYMENTS_ENABLED = prior; }
});
