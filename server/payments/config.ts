import "server-only";
import { AlipaySdk } from "alipay-sdk";

// The verified sandbox belongs to this project, independently of the process cwd.
export const sandboxConfigPath = "/Users/yanzifeng/Documents/今天你Ai了吗？/.alipay-sandbox.json";
export const sandboxGateway = "https://openapi-sandbox.dl.alipaydev.com/gateway.do";

export type PaymentConfig = {
  mode: "sandbox" | "production";
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
  sellerId: string;
  gateway: string;
  origin: string;
  returnUrl: string;
  notifyUrl?: string;
};

function required(value: unknown): string {
  if (typeof value !== "string" || !value || value !== value.trim()) throw new Error("PAYMENT_CONFIG_INVALID");
  return value;
}

export async function loadPaymentConfig(): Promise<PaymentConfig> {
  const mode = process.env.ALIPAY_ENV ?? (process.env.NODE_ENV === "development" ? "sandbox" : "");
  if (mode !== "sandbox" && mode !== "production") throw new Error("PAYMENT_CONFIG_INVALID");
  const origin = new URL(required(process.env.APP_ORIGIN));
  if (origin.pathname !== "/" || origin.search || origin.hash) throw new Error("PAYMENT_CONFIG_INVALID");
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname);
  if (mode === "production" && origin.protocol !== "https:") throw new Error("PAYMENT_CONFIG_INVALID");
  if (mode === "sandbox" && !loopback) throw new Error("PAYMENT_SANDBOX_REQUIRES_LOCAL_NODE");

  let appId: string, privateKey: string, alipayPublicKey: string, sellerId: string;
  if (mode === "sandbox") {
    const { readFile, stat } = await import("node:fs/promises");
    const info = await stat(sandboxConfigPath);
    if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error("PAYMENT_CONFIG_INVALID");
    const raw = JSON.parse(await readFile(sandboxConfigPath, "utf8"));
    if (!Array.isArray(raw.appIds) || raw.appIds.length !== 1) throw new Error("PAYMENT_CONFIG_INVALID");
    const app = raw.appIds[0];
    appId = required(app.appId);
    privateKey = required(app.appPrivatePkcsKey);
    alipayPublicKey = required(app.alipayPublicKey);
    sellerId = required(raw.sandboxAccounts?.partner?.userId);
  } else {
    appId = required(process.env.ALIPAY_APP_ID);
    privateKey = required(process.env.ALIPAY_PRIVATE_KEY);
    alipayPublicKey = required(process.env.ALIPAY_PUBLIC_KEY);
    sellerId = required(process.env.ALIPAY_SELLER_ID);
  }
  // SDK owns PEM wrapping. Never alter, encode or convert the original fields.
  if (privateKey.includes("-----") || /\s/u.test(privateKey)) throw new Error("PAYMENT_CONFIG_INVALID");
  const notifyUrl = process.env.ALIPAY_NOTIFY_URL?.trim();
  if (notifyUrl && new URL(notifyUrl).protocol !== "https:") throw new Error("PAYMENT_CONFIG_INVALID");
  if (mode === "production" && !notifyUrl) throw new Error("PAYMENT_CONFIG_INVALID");
  return {
    mode, appId, privateKey, alipayPublicKey, sellerId,
    gateway: mode === "sandbox" ? sandboxGateway : "https://openapi.alipay.com/gateway.do",
    origin: origin.origin, returnUrl: `${origin.origin}/payments/return`,
    ...(notifyUrl ? { notifyUrl } : {}),
  };
}

export function createPaymentSdk(config: PaymentConfig) {
  return new AlipaySdk({
    appId: config.appId, privateKey: config.privateKey, alipayPublicKey: config.alipayPublicKey,
    gateway: config.gateway, signType: "RSA2", keyType: "PKCS1", camelcase: false, timeout: 10_000,
  });
}
