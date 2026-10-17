"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AI_CREDIT_PACKS, DAILY_FREE_AI_LIMIT, type AiCreditBalance } from "@/lib/domain/billing";

type Order = { orderNo: string; productTitle: string; amount: string; credits: number; state: string;
  createdAt: string; refundState: string | null; expiresAt: string | null; creditsRemaining: number; refundable: boolean };
type Account = { balance: AiCreditBalance; orders: Order[]; nextCursor?: { createdAt: string; orderNo: string } | null };
type Checkout = { orderNo: string; state: string; paymentHtml?: string; paymentUrl?: string };
function paymentGateway(value: string) {
  const gateway = new URL(value);
  const allowed = (["openapi-sandbox.dl.alipaydev.com", "openapi.alipay.com"].includes(gateway.hostname) && gateway.pathname === "/gateway.do")
    || (gateway.hostname === "unitradeprod-sandbox.dl.alipaydev.com" && gateway.pathname === "/appAssign.htm");
  if (!allowed || gateway.protocol !== "https:" || gateway.username || gateway.password) throw new Error("支付网关不可用");
  return gateway;
}
const states: Record<string, string> = { PAID: "支付已确认，次数已到账", PENDING_PAYMENT: "等待付款", CLOSED: "交易已关闭", UNKNOWN: "支付结果待确认", REFUNDED: "已退款，对应次数已收回", REFUND_PENDING: "退款确认中，对应次数暂时冻结" };
function resultState(data: { state: string; refundState?: string | null }) {
  return data.refundState === "REFUNDED" ? "REFUNDED" : data.refundState === "PENDING" ? "REFUND_PENDING" : data.state;
}
const dateLabel = (date: string) => new Date(date).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
async function paymentRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "暂时无法处理，请稍后重试");
  return data as T;
}

export function PaymentPanel({ sandbox = false, enabled = false, signedIn = false, orderNo, returning = false, overview = false }: {
  sandbox?: boolean; enabled?: boolean; signedIn?: boolean; orderNo?: string; returning?: boolean; overview?: boolean;
}) {
  const [selected, setSelected] = useState<string>("ai_10");
  const [confirming, setConfirming] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [balanceError, setBalanceError] = useState("");
  const [refreshingBalance, setRefreshingBalance] = useState(false);
  const [order, setOrder] = useState(orderNo ?? "");
  const [state, setState] = useState("");
  const [busy, setBusy] = useState(Boolean(orderNo && signedIn));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refundOrder, setRefundOrder] = useState<string | null>(null);
  const key = useRef<{ product: string; value: string } | null>(null);
  const pack = AI_CREDIT_PACKS.find(p => p.id === selected)!;
  const refreshAccount = useCallback(async (signal?: AbortSignal) => {
    if (!signedIn) return;
    const data = await paymentRequest<Account>("/api/payments", { signal });
    if (!signal?.aborted) { setAccount(data); setBalanceError(""); }
  }, [signedIn]);

  async function refreshBalance() {
    setRefreshingBalance(true);
    try { await refreshAccount(); }
    catch (cause) { setBalanceError(cause instanceof Error ? cause.message : "额度暂时无法读取，请重试"); }
    finally { setRefreshingBalance(false); }
  }

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    void paymentRequest<Account>("/api/payments", { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setAccount(data);
    }).catch(cause => {
      if (!controller.signal.aborted) setBalanceError(cause instanceof Error ? cause.message : "额度暂时无法读取，请重试");
    });
    return () => controller.abort();
  }, [signedIn]);

  useEffect(() => {
    if (!orderNo || !signedIn) return;
    const controller = new AbortController();
    void paymentRequest<{ state: string; refundState?: string | null }>(`/api/payments/${encodeURIComponent(orderNo)}`, { signal: controller.signal })
      .then(async data => {
        if (controller.signal.aborted) return;
        setState(resultState(data));
        await refreshAccount(controller.signal);
      }).catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "暂时无法确认支付结果");
      }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [orderNo, signedIn, refreshAccount]);

  async function query(id: string) {
    setBusy(true); setError("");
    try {
      const data = await paymentRequest<{ state: string; refundState?: string | null }>(`/api/payments/${encodeURIComponent(id)}`);
      setOrder(id); setState(resultState(data));
      if (["PAID", "CLOSED"].includes(data.state)) key.current = null;
      await refreshAccount();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "暂时无法确认支付结果"); }
    finally { setBusy(false); }
  }

  async function pay(existingOrder?: string) {
    if ((!confirming && !existingOrder) || (!enabled && !existingOrder) || !signedIn) return;
    setBusy(true); setError("");
    try {
      if (key.current?.product !== pack.id) key.current = { product: pack.id, value: crypto.randomUUID() };
      const data = existingOrder ? await paymentRequest<Checkout>(`/api/payments/${encodeURIComponent(existingOrder)}/pay`, { method: "POST" }) : await paymentRequest<Checkout>("/api/payments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: pack.id, idempotencyKey: key.current.value }),
      });
      setOrder(data.orderNo); setState(data.state);
      if (!data.paymentHtml && !data.paymentUrl) {
        if (["PAID", "CLOSED"].includes(data.state)) { key.current = null; setConfirming(false); }
        await refreshAccount(); return;
      }
      if (data.paymentUrl) {
        window.open(paymentGateway(data.paymentUrl).href, "_self");
        return;
      }
      const container = document.createElement("div");
      container.hidden = true;
      container.innerHTML = data.paymentHtml!;
      const form = container.querySelector("form");
      if (!form || form.method.toUpperCase() !== "POST") throw new Error("支付表单不可用，请查询订单后重试");
      paymentGateway(form.action);
      document.body.appendChild(container);
      HTMLFormElement.prototype.submit.call(form);
      container.remove();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "暂时无法发起支付"); }
    finally { setBusy(false); }
  }

  async function action(id: string, kind: "close" | "refund-unused" | "refund-status") {
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await paymentRequest<{ state: string }>(`/api/payments/${encodeURIComponent(id)}/${kind}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        ...(kind === "refund-unused" ? { body: JSON.stringify({ requestNo: crypto.randomUUID() }) } : {}),
      });
      setNotice(kind === "close" ? "订单已关闭" : data.state === "REFUNDED" ? "退款已确认，对应次数已收回" : "退款正在确认中，对应次数暂时冻结，请稍后查询");
      if (kind === "close") { key.current = null; if (order === id) setState("CLOSED"); }
      setRefundOrder(null);
      await refreshAccount();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作未完成，请稍后重试"); }
    finally { setBusy(false); }
  }

  async function moreOrders() {
    if (!account?.nextCursor) return;
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ beforeCreatedAt: account.nextCursor.createdAt, beforeOrderNo: account.nextCursor.orderNo });
      const data = await paymentRequest<Account>(`/api/payments?${params}`);
      setAccount(previous => ({ ...data, orders: [...(previous?.orders ?? []), ...data.orders]
        .filter((item, index, all) => all.findIndex(other => other.orderNo === item.orderNo) === index) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "更早订单读取失败，请重试"); }
    finally { setBusy(false); }
  }

  return <div className="payment-shell">
    <nav className="payment-nav"><Link href="/">← 返回知序 Aura</Link><span>{overview ? "AI 额度" : "AI 次数包"}</span></nav>
    <header className="payment-heading">
      <p className="payment-eyebrow">给学习，多一点空间</p>
      <h1>{returning ? "查看支付结果" : overview ? "AI 额度" : "AI 次数包"}</h1>
      <p>{overview ? `查看今日免费额度，按需购买更多次数。每天 ${DAILY_FREE_AI_LIMIT} 次免费。` : `每天 ${DAILY_FREE_AI_LIMIT} 次免费，想多学一点时，再添几次。`}</p>
      {sandbox && <span className="payment-sandbox">沙箱体验 · 使用测试账号，不产生真实扣款</span>}
    </header>
    {sandbox && !returning && <aside className="payment-sandbox-help" aria-label="沙箱付款说明">
      <strong>本地沙箱付款说明</strong>
      <p>收银台请使用沙箱买家账号，并按页面提示填写支付密码；日常支付宝账号不可用于此环境。扫码付款需使用 Android 沙箱支付宝。</p>
      <p>若收银台登录失败、系统繁忙或超时，请回到购买记录选择“继续支付”，恢复原订单。付款后没有自动返回时，回到本页查询该订单，确认到账后再使用次数。</p>
    </aside>}
    {signedIn && <section className="payment-balance" aria-label="我的 AI 额度">
      {overview && <header className="payment-balance-heading"><h2>我的 AI 额度</h2>
        <button className="payment-text-button" disabled={busy || refreshingBalance} onClick={() => void refreshBalance()}>{refreshingBalance ? "正在刷新…" : "刷新额度"}</button></header>}
      {account ? <><div><span>{account.balance.unlimited ? "免费额度" : `每日免费 ${account.balance.freeLimit} 次`}</span><strong>{account.balance.unlimited ? "测试账号不限额" : `今日剩余 ${account.balance.freeRemaining} 次`}</strong></div>
        <div><span>次数包</span><strong>付费余额 {account.balance.paidRemaining} 次</strong></div>
        <p>先用免费次数，再使用最早到期的付费次数。免费次数于北京时间 0 点重置。</p></> : !balanceError && <p role="status">正在读取账户余额…</p>}
      {balanceError && <div className="payment-balance-error"><p role="alert">{balanceError}</p>
        {!overview && <button className="payment-text-button" disabled={busy || refreshingBalance} onClick={() => void refreshBalance()}>重试读取额度</button>}</div>}
    </section>}
    {overview && !signedIn && <section className="payment-balance" aria-label="我的 AI 额度"><p>登录后可查看今日免费剩余次数和付费余额。</p></section>}
    {returning && <section className="payment-card" aria-label="支付结果">
      {!order ? <p>尚无待确认的订单。请从付款页面发起支付，再返回查看结果。</p>
        : !signedIn ? <p>请登录购买时的账号，再查询这笔订单的支付结果。</p>
          : <><p className="payment-status" role="status">{busy ? "正在确认支付结果…" : states[state] ?? "支付结果待确认"}</p>
            <p className="payment-order">订单：{order}</p>
            <button className="payment-button secondary" disabled={busy} onClick={() => void query(order)}>查询支付结果</button></>}
      {!signedIn && <Link href="/login">登录后查询</Link>}
      <p className="payment-note">付款后暂未显示到账时，可以稍后再次查询。仅返回此页面不会增加次数。</p>
    </section>}
    {!returning && <section className="payment-card" aria-label="选择次数包">
      <fieldset className="payment-pack-fieldset" disabled={busy}>
        <legend>按需要，添一点学习额度</legend>
        <div className="payment-packs">
          {AI_CREDIT_PACKS.map(item => <label key={item.id} className={`payment-pack${selected === item.id ? " selected" : ""}`}>
            <input type="radio" name="credit-pack" value={item.id} checked={selected === item.id} onChange={() => { setSelected(item.id); setConfirming(false); }} />
            <span className="payment-pack-top"><strong>{item.credits} 次</strong>{item.id === "ai_10" && <span className="payment-pack-label">常用</span>}</span>
            <span className="payment-price"><small>¥</small><strong>{item.amount}</strong></span>
            <span className="payment-pack-detail">约 ¥{(Number(item.amount) / item.credits).toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "")} / 次 · {item.validDays} 天有效</span>
          </label>)}
        </div>
      </fieldset>
      <p className="payment-note">用于 AI 提炼与知识串联。一次完整生成扣 1 次，内部修复与重试不额外扣次。</p>
      {!signedIn ? <Link className="payment-button payment-login" href="/login">登录后购买</Link>
        : confirming ? <section className="payment-confirm" aria-label="确认购买">
          <h2>确认购买</h2><p>{pack.title} · {pack.credits} 次 · <strong>¥{pack.amount}</strong></p>
          <p>到账后 {pack.validDays} 天内有效，绑定当前登录账号；免费次数用完后才使用。</p>
          <p className="payment-note">系统失败无结果会返还次数。全部未使用且无生成中任务的套餐，可在购买记录申请整包退款。</p>
          <div className="payment-actions"><button disabled={busy || !enabled} onClick={() => void pay()}>{busy ? "正在处理…" : "确认并前往支付宝"}</button>
            <button className="secondary" disabled={busy} onClick={() => setConfirming(false)}>返回选择</button></div>
        </section> : <button className="payment-button" disabled={busy || !enabled || !account} onClick={() => { setConfirming(true); setError(""); }}>{enabled ? "购买次数包" : "购买暂未开放"}</button>}
      {!enabled && <p className="payment-note">次数包购买暂未开放，每日免费额度可正常使用。</p>}
      {order && <div className="payment-pending"><p role="status">{states[state] ?? "支付结果待确认"}</p><p className="payment-order">订单：{order}</p>
        <button className="payment-button secondary" disabled={busy} onClick={() => void query(order)}>查询这笔订单</button></div>}
    </section>}
    {error && <p role="alert" className="payment-error">{error}</p>}
    {notice && <p role="status" className="payment-notice">{notice}</p>}
    {signedIn && account && <section className="payment-card" aria-label="购买记录">
      <div className="payment-section-heading"><h2>购买记录</h2><button className="payment-text-button" disabled={busy} onClick={() => { void refreshAccount().catch(cause => setError(cause.message)); }}>刷新记录</button></div>
      {!account.orders.length ? <p className="payment-note">还没有购买记录。每天的免费次数已准备好，按需购买即可。</p> : <ul className="payment-orders">{account.orders.map(item => <li key={item.orderNo}>
        <div className="payment-order-heading"><strong>{item.productTitle}</strong><span>¥{item.amount}</span></div>
        <p>{item.refundState === "REFUNDED" ? "已退款" : item.refundState === "PENDING" ? "退款确认中，次数暂时冻结" : item.state === "PAID" ? `已到账 ${item.credits} 次 · 剩余 ${item.creditsRemaining} 次` : states[item.state] ?? "状态待确认"}</p>
        {item.expiresAt && item.refundState !== "REFUNDED" && <p className="payment-note">有效期至 {dateLabel(item.expiresAt)}（北京时间）</p>}
        <p className="payment-order">{item.orderNo} · {dateLabel(item.createdAt)}</p>
        <div className="payment-order-actions">
          {item.state !== "CLOSED" && <button disabled={busy} onClick={() => void query(item.orderNo)}>查询支付</button>}
          {["PENDING_PAYMENT", "UNKNOWN"].includes(item.state) && <button disabled={busy} onClick={() => void action(item.orderNo, "close")}>关闭订单</button>}
          {["PENDING_PAYMENT", "UNKNOWN"].includes(item.state) && <button disabled={busy} onClick={() => void pay(item.orderNo)}>继续支付</button>}
          {item.refundable && <button disabled={busy} onClick={() => setRefundOrder(item.orderNo)}>申请整包退款</button>}
          {item.refundState === "PENDING" && <><button disabled={busy} onClick={() => void action(item.orderNo, "refund-status")}>查询退款</button>
            <button disabled={busy} onClick={() => void action(item.orderNo, "refund-unused")}>重试退款</button></>}
        </div>
        {refundOrder === item.orderNo && <div className="payment-confirm"><p>将原路退还 ¥{item.amount}，并收回此套餐的全部 {item.credits} 次。退款确认期间，这些次数暂时冻结。</p>
          <div className="payment-actions"><button disabled={busy} onClick={() => void action(item.orderNo, "refund-unused")}>确认整包退款</button><button className="secondary" disabled={busy} onClick={() => setRefundOrder(null)}>暂不退款</button></div></div>}
      </li>)}</ul>}
      {account.nextCursor && <button className="payment-text-button" disabled={busy} onClick={() => void moreOrders()}>加载更早订单</button>}
    </section>}
    <details className="payment-rules"><summary>使用与退款规则</summary>
      <p>每日 2 次免费额度不结转。付费次数从确认到账起有效 90 天，先到期先使用；到期后不再用于新任务，已开始的任务可以完成。</p>
      <p>重新生成会使用 1 次额度，编辑、回看和复制已有内容不扣次。系统失败无结果时返还原额度，返还不延长原有效期。主动取消的扣次规则以生成页面的确认提示为准。</p>
      <p>全部未使用且没有预占任务的次数包可申请整包原路退款；已部分使用或其他异常情况，请保留订单号联系运营者核验。</p>
      <p>次数绑定购买账号，不支持转让。支付暂未确认时，请从购买记录查询，避免重复付款。</p>
    </details>
    <footer className="payment-footer">每一次整理，都是向理解再走一步。</footer>
  </div>;
}
