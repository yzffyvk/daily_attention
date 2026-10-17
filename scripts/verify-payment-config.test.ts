// @vitest-environment node
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { createPaymentSdk, loadPaymentConfig, sandboxConfigPath, sandboxGateway } from "../server/payments/config";
describe("local payment configuration post-check", () => {
  it("directly loads the verified file and maps the original SDK fields without logging them", async () => {
    process.env.ALIPAY_ENV = "sandbox";
    process.env.APP_ORIGIN = "http://127.0.0.1:3300";
    const raw = JSON.parse(await readFile(sandboxConfigPath, "utf8"));
    const config = await loadPaymentConfig();
    const sdk = createPaymentSdk(config);
    expect(config.appId === raw.appIds[0].appId).toBe(true);
    expect(config.privateKey === raw.appIds[0].appPrivatePkcsKey).toBe(true);
    expect(config.alipayPublicKey === raw.appIds[0].alipayPublicKey).toBe(true);
    expect(config.sellerId === raw.sandboxAccounts.partner.userId).toBe(true);
    expect(sdk.config.gateway === sandboxGateway && sdk.config.keyType === "PKCS1" && sdk.config.signType === "RSA2").toBe(true);
    expect(config.returnUrl === "http://127.0.0.1:3300/payments/return").toBe(true);
    const ignored = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
    expect(ignored.includes("/.alipay-sandbox.json")).toBe(true);
    // Exercise real SDK signing, report only its shape and exact return URL equality.
    const html = sdk.pageExec("alipay.trade.page.pay", "POST", { returnUrl: config.returnUrl, bizContent: { out_trade_no: "CONFIG_CHECK_ONLY", total_amount: "0.01", subject: "configuration check", product_code: "FAST_INSTANT_TRADE_PAY" } });
    expect(html.includes("<form")).toBe(true);
    expect(html.includes("method=alipay.trade.page.pay")).toBe(true);
    const action = html.match(/action="([^"]+)"/u)?.[1];
    expect(Boolean(action && new URL(action.replaceAll("&amp;", "&")).searchParams.get("return_url") === config.returnUrl)).toBe(true);
  });
  it.skipIf(process.env.PAYMENT_SANDBOX_NETWORK_DIAG !== "true")("can reach the real sandbox query API without exposing requests or credentials", async () => {
    process.env.ALIPAY_ENV = "sandbox";
    process.env.APP_ORIGIN = "http://127.0.0.1:3300";
    let code = "UNREACHABLE";
    let subCode = "";
    try {
      const sdk = createPaymentSdk(await loadPaymentConfig());
      const result = await sdk.exec("alipay.trade.query", { bizContent: { out_trade_no: `DIAG${crypto.randomUUID().replaceAll("-", "")}` } }, { validateSign: true });
      // Only the two documented non-sensitive status fields can leave this diagnostic.
      if (typeof result.code === "string") code = result.code;
      if (typeof result.sub_code === "string") subCode = result.sub_code;
    } catch { /* SDK errors may contain signed request details: do not print or rethrow. */ }
    console.info(JSON.stringify({ sandboxQueryCode: code, sandboxQuerySubCode: subCode }));
    expect(code, "支付宝沙箱查单接口当前不可达；此诊断不创建或支付订单").toBe("40004");
    expect(subCode).toBe("ACQ.TRADE_NOT_EXIST");
  }, 15000);
  it.skipIf(!process.env.PAYMENT_SANDBOX_ORDER)("diagnoses official POST and GET page-pay delivery for the same existing sandbox order", async () => {
    const orderNo = process.env.PAYMENT_SANDBOX_ORDER!;
    expect(orderNo).toMatch(/^AI[a-f0-9]{32}$/u);
    process.env.ALIPAY_ENV = "sandbox";
    process.env.APP_ORIGIN = "http://127.0.0.1:3300";
    const config = await loadPaymentConfig();
    const sdk = createPaymentSdk(config);
    const params = { returnUrl: config.returnUrl, bizContent: { out_trade_no: orderNo, total_amount: "0.90", subject: "知序 Aura · 单次提炼", product_code: "FAST_INSTANT_TRADE_PAY", timeout_express: "15m" } };
    const { document } = parseHTML(sdk.pageExec("alipay.trade.page.pay", "POST", params));
    const form = document.querySelector("form")!;
    const body = new URLSearchParams();
    for (const input of form.querySelectorAll("input")) body.append(input.getAttribute("name")!, input.getAttribute("value")!);
    for (const method of ["POST", "GET"] as const) {
      let status = 0; let redirectHost = ""; let redirectPath = "";
      try {
        const url = method === "POST" ? form.getAttribute("action")! : sdk.pageExec("alipay.trade.page.pay", "GET", params);
        const response = await fetch(url, { method, redirect: "manual", signal: AbortSignal.timeout(10000),
          ...(method === "POST" ? { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body } : {}) });
        status = response.status;
        const location = response.headers.get("location");
        if (location) { const target = new URL(location, url); redirectHost = target.hostname; redirectPath = target.pathname; }
        await response.body?.cancel();
      } catch { /* Never output SDK errors, signed URLs or response bodies. */ }
      console.info(JSON.stringify({ sandboxPageMethod: method, status, redirectHost, redirectPath }));
      expect(status, `${method} request timed out`).toBeGreaterThan(0);
    }
  }, 25000);
});
