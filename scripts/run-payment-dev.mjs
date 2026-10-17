import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
process.loadEnvFile(new URL("../.dev.vars", import.meta.url));
const port = process.env.PAYMENT_DEV_PORT || "3300";
if (!/^\d{4,5}$/u.test(port) || Number(port) > 65535) throw new Error("Invalid PAYMENT_DEV_PORT");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", port], {
  cwd: root, env: { ...process.env, APP_ORIGIN: `http://127.0.0.1:${port}`, ALIPAY_ENV: "sandbox" }, stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", code => process.exit(code ?? 1));
