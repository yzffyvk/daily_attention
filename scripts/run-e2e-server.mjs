import { spawn } from "node:child_process";

const command = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(command, ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", "3200"], {
  env: process.env,
  stdio: "inherit",
});

function stop(signal) {
  if (child.exitCode === null) child.kill(signal);
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));
child.once("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
