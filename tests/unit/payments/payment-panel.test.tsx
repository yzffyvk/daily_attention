import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PaymentPanel } from "@/features/payments/payment-panel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const account = { balance: { freeLimit: 2, freeRemaining: 1, paidRemaining: 10, remaining: 11, unlimited: false,
  resetsAt: "2026-10-18T00:00:00+08:00", lots: [{ orderNo: "old", remaining: 10, expiresAt: "2027-01-15T12:00:00+08:00" }] }, orders: [] };

it("shows the approved three packs with a login entry for guests", () => {
  render(<PaymentPanel signedIn={false} enabled sandbox />);
  expect(screen.getByText("0.90")).toBeInTheDocument();
  expect(screen.getByText("8.90")).toBeInTheDocument();
  expect(screen.getByText("16.90")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "登录后购买" })).toHaveAttribute("href", "/login");
});
it("shows free and paid balances and requires confirmation before creating a priced order", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => account });
  vi.stubGlobal("fetch", fetcher);
  render(<PaymentPanel signedIn enabled sandbox />);
  await screen.findByText("今日剩余 1 次");
  expect(screen.getByText("每日免费 2 次")).toBeVisible();
  expect(screen.getByText("付费余额 10 次")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "购买次数包" }));
  expect(screen.getByRole("region", { name: "确认购买" })).toHaveTextContent("8.90");
  expect(fetcher.mock.calls.some(c => c[1]?.method === "POST")).toBe(false);
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ orderNo: "new", state: "PENDING_PAYMENT" }) });
  fireEvent.click(screen.getByRole("button", { name: "确认并前往支付宝" }));
  await waitFor(() => expect(fetcher.mock.calls.some(c => c[1]?.method === "POST")).toBe(true));
  const call = fetcher.mock.calls.find(c => c[1]?.method === "POST");
  expect(JSON.parse(call![1].body)).toEqual({ productId: "ai_10", idempotencyKey: expect.any(String) });
});
it("keeps the catalog visible while production sales are unavailable", () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => account }));
  render(<PaymentPanel signedIn enabled={false} />);
  expect(screen.getByRole("button", { name: "购买暂未开放" })).toBeDisabled();
  expect(screen.getByText("16.90")).toBeInTheDocument();
});
it("lets a learner retry a failed quota read while purchases are unavailable", async () => {
  const fetcher = vi.fn()
    .mockRejectedValueOnce(new Error("额度暂时无法读取"))
    .mockResolvedValue({ ok: true, json: async () => account });
  vi.stubGlobal("fetch", fetcher);
  render(<PaymentPanel overview signedIn enabled={false} />);
  expect(screen.getByRole("heading", { level: 1, name: "AI 额度" })).toBeVisible();
  expect(await screen.findByRole("alert")).toHaveTextContent("额度暂时无法读取");
  expect(screen.queryByText("正在读取账户余额…")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "刷新额度" }));
  expect(await screen.findByText("今日剩余 1 次")).toBeVisible();
  expect(screen.getByText("付费余额 10 次")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "购买暂未开放" })).toBeDisabled();
});
it("treats a return without order context as neutral", () => {
  render(<PaymentPanel returning signedIn={false} />);
  expect(screen.getByText(/尚无待确认的订单/)).toBeInTheDocument();
  expect(screen.queryByText("支付已确认")).not.toBeInTheDocument();
});
it("allows retrying an undelivered refund while its credits remain frozen", async () => {
  const pending = { ...account, orders: [{ orderNo: "pending-refund", productTitle: "10 次提炼包", amount: "8.90", credits: 10,
    state: "PAID", refundState: "PENDING", refundable: false, expiresAt: null, creditsRemaining: 10, createdAt: "2026-10-17T12:00:00+08:00" }] };
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => pending });
  vi.stubGlobal("fetch", fetcher);
  render(<PaymentPanel signedIn enabled />);
  fireEvent.click(await screen.findByRole("button", { name: "重试退款" }));
  await waitFor(() => expect(fetcher.mock.calls.some(c => c[0] === "/api/payments/pending-refund/refund-unused")).toBe(true));
});
it("makes older orders reachable beyond the first page", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...account,
    nextCursor: { createdAt: "2026-10-16T12:00:00+08:00", orderNo: "AI00000000000000000000000000000001" } }) });
  vi.stubGlobal("fetch", fetcher);
  render(<PaymentPanel signedIn enabled />);
  const older = await screen.findByRole("button", { name: "加载更早订单" });
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ ...account, orders: [{ orderNo: "older", productTitle: "更早的单次提炼", amount: "0.90", credits: 1, state: "PAID", refundState: null, refundable: true, creditsRemaining: 1, expiresAt: null, createdAt: "2026-10-15T12:00:00+08:00" }], nextCursor: null }) });
  fireEvent.click(older);
  expect(await screen.findByText("更早的单次提炼")).toBeInTheDocument();
});
it("shows a refunded payment result without claiming credits have just arrived", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => url === "/api/payments" ? account : { state: "PAID", refundState: "REFUNDED" } })));
  render(<PaymentPanel returning signedIn orderNo="refunded-order" />);
  expect(await screen.findByText("已退款，对应次数已收回")).toBeInTheDocument();
  expect(screen.queryByText("支付已确认，次数已到账")).not.toBeInTheDocument();
});
