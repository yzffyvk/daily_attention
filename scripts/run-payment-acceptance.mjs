import { spawnSync } from "node:child_process";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const status = spawnSync(npx, ["supabase", "status", "-o", "env"], { encoding: "utf8" });
if (status.status !== 0) throw new Error("请先运行 npm run supabase:start，完成本地迁移后再验收。");
const values = Object.fromEntries(status.stdout.split("\n").flatMap(line => {
  const match = /^([A-Z0-9_]+)=(.+)$/u.exec(line);
  if (!match) return [];
  try { return [[match[1], JSON.parse(match[2])]]; } catch { return []; }
}));
if (!values.API_URL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(values.API_URL).hostname)
  || !values.SECRET_KEY) throw new Error("此验收命令仅允许连接本机 Supabase。");
console.log("本地业务验收：支付宝响应使用测试替身；页面、API、到账和退款使用真实代码及本机数据库，不代表真实沙箱付款成功。");
const ui = spawnSync(npx, ["vitest", "run", "tests/acceptance/payments-local.test.tsx"], {
  stdio: "inherit", env: { ...process.env, PAYMENT_LOCAL_ACCEPTANCE: "true",
    NEXT_PUBLIC_SUPABASE_URL: values.API_URL, SUPABASE_SECRET_KEY: values.SECRET_KEY },
});
if (ui.status !== 0) process.exit(ui.status ?? 1);
console.log("继续校验免费额度、付费扣次、失败返还、到期和退款冻结（事务回滚测试）…");
const database = spawnSync(npx, ["supabase", "test", "db", "supabase/tests/database/ai-credit-packages.test.sql"], { stdio: "inherit" });
process.exit(database.status ?? 1);
