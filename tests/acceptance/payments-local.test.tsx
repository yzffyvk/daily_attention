import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PaymentPanel } from "@/features/payments/payment-panel";
import { GET as accountGet, POST as orderPost } from "@/app/api/payments/route";
import { GET as orderGet } from "@/app/api/payments/[id]/route";
import { POST as orderAction } from "@/app/api/payments/[id]/[action]/route";

// Test-only gateway/auth adapters. The shipped server has no simulated-payment switch or endpoint.
const fixture = vi.hoisted(() => ({ userId: "", email: "", lastOrder: "",
  trades: new Map<string, { amount: string; status: string; refunded: boolean }>() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: fixture.userId } }, error: null }) },
}) }));
vi.mock("@/server/payments/config", () => ({
  loadPaymentConfig: async () => ({ mode: "sandbox", appId: "LOCAL_ACCEPTANCE_ONLY", sellerId: "local-seller",
    origin: "http://127.0.0.1:3300", returnUrl: "http://127.0.0.1:3300/payments/return" }),
  createPaymentSdk: () => ({
    pageExec(_method: string, verb: string, params: { bizContent: { out_trade_no: string; total_amount: string } }) {
      const biz = params.bizContent;
      fixture.lastOrder = biz.out_trade_no;
      if (!fixture.trades.has(biz.out_trade_no)) fixture.trades.set(biz.out_trade_no, { amount: biz.total_amount, status: "WAIT_BUYER_PAY", refunded: false });
      return verb === "GET" ? "https://openapi-sandbox.dl.alipaydev.com/gateway.do?method=alipay.trade.page.pay"
        : '<form method="POST" action="https://openapi-sandbox.dl.alipaydev.com/gateway.do"></form>';
    },
    async exec(method: string, params: { bizContent: { out_trade_no: string; out_request_no?: string } }) {
      const biz = params.bizContent;
      const trade = fixture.trades.get(biz.out_trade_no);
      if (!trade) return { code: "40004", sub_code: "ACQ.TRADE_NOT_EXIST" };
      const identity = { code: "10000", out_trade_no: biz.out_trade_no, trade_no: `local-${biz.out_trade_no}` };
      if (method === "alipay.trade.query") return { ...identity, total_amount: trade.amount, seller_id: "local-seller", trade_status: trade.status };
      if (method === "alipay.trade.refund") { trade.refunded = true; return { ...identity, fund_change: "Y", refund_fee: trade.amount }; }
      throw new Error("Unexpected local gateway method");
    },
  }),
}));

const origin = "http://127.0.0.1:3300";
let nativeFetch: typeof fetch;
beforeAll(async () => {
  if (process.env.PAYMENT_LOCAL_ACCEPTANCE !== "true") throw new Error("请使用 npm run test:payments:local。");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) throw new Error("Local database required");
  const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  fixture.email = `payment-${crypto.randomUUID()}@payment-acceptance.invalid`;
  const { data, error } = await admin.auth.admin.createUser({ email: fixture.email, password: crypto.randomUUID(), email_confirm: true });
  if (error || !data.user) throw new Error("无法创建本地验收账户");
  fixture.userId = data.user.id;
  nativeFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), origin);
    if (url.hostname === "openapi-sandbox.dl.alipaydev.com") return new Response(null, { status: 302,
      headers: { location: "https://unitradeprod-sandbox.dl.alipaydev.com/appAssign.htm?ticket=local-only" } });
    if (url.origin !== origin) return nativeFetch(input, init);
    const request = new Request(url, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), origin } });
    if (url.pathname === "/api/payments") return request.method === "POST" ? orderPost(request) : accountGet(request);
    const action = /^\/api\/payments\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (action) return orderAction(request, { params: Promise.resolve({ id: action[1], action: action[2] }) });
    const order = /^\/api\/payments\/([^/]+)$/u.exec(url.pathname);
    if (order) return orderGet(request, { params: Promise.resolve({ id: order[1] }) });
    throw new Error("Unexpected local application route");
  });
});

afterAll(() => {
  cleanup(); vi.unstubAllGlobals();
  if (!fixture.userId) return;
  if (!/^[a-f0-9-]{36}$/u.test(fixture.userId) || !/^payment-[a-f0-9-]{36}@payment-acceptance\.invalid$/u.test(fixture.email)) throw new Error("Unsafe cleanup refused");
  // Only the newly generated account can be deleted; never use a reset or a shared account.
  execFileSync("docker", ["exec", "supabase_db_supabase-web-v1", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `
    begin;
    do $$ begin
      if not exists(select 1 from auth.users where id='${fixture.userId}' and email='${fixture.email}') then raise exception 'Fixture ownership mismatch'; end if;
      if exists(select 1 from public.payment_orders where user_id='${fixture.userId}' and (app_id<>'LOCAL_ACCEPTANCE_ONLY' or environment<>'sandbox')) then raise exception 'Unexpected fixture orders'; end if;
      delete from private.ai_credit_lots where user_id='${fixture.userId}';
      delete from public.payment_events where out_trade_no in(select out_trade_no from public.payment_orders where user_id='${fixture.userId}');
      delete from public.payment_refunds where out_trade_no in(select out_trade_no from public.payment_orders where user_id='${fixture.userId}');
      delete from public.payment_orders where user_id='${fixture.userId}';
      delete from auth.users where id='${fixture.userId}' and email='${fixture.email}';
    end $$;
    commit;`], { stdio: "pipe" });
});

it("本地完整验收：免费余额 → 下单 → 原单继续支付 → 付款后回跳查单 → 一次到账 → 重复查单 → 整包退款", async () => {
  vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => undefined);
  vi.spyOn(window, "open").mockReturnValue(null);
  render(<PaymentPanel overview signedIn enabled sandbox />);
  expect(await screen.findByText("今日剩余 2 次")).toBeVisible();
  expect(screen.getByText("付费余额 0 次")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "购买次数包" }));
  fireEvent.click(screen.getByRole("button", { name: "确认并前往支付宝" }));
  await screen.findByRole("button", { name: "查询这笔订单" });
  const orderNo = fixture.lastOrder;
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(fixture.trades.get(orderNo)?.amount).toBe("8.90");
  // Re-open the existing order through the same HTTP route the browser uses.
  const resumed = await fetch(`/api/payments/${orderNo}/pay`, { method: "POST" });
  expect((await resumed.json()).orderNo).toBe(orderNo);
  expect(fixture.trades.size).toBe(1);
  fixture.trades.get(orderNo)!.status = "TRADE_SUCCESS";
  cleanup();
  render(<PaymentPanel returning signedIn orderNo={orderNo} />);
  expect(await screen.findByText("支付已确认，次数已到账")).toBeVisible();
  expect(await screen.findByText("付费余额 10 次")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "查询支付结果" }));
  await screen.findByText("支付已确认，次数已到账");
  expect(screen.getByText("付费余额 10 次")).toBeVisible();
  fireEvent.click(await screen.findByRole("button", { name: "申请整包退款" }));
  fireEvent.click(screen.getByRole("button", { name: "确认整包退款" }));
  expect(await screen.findByText("退款已确认，对应次数已收回")).toBeVisible();
  expect(await screen.findByText("付费余额 0 次")).toBeVisible();
}, 30000);
