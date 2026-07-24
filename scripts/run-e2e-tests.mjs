import { spawn } from "node:child_process";
import { localSupabaseBindings } from "./local-supabase-env.mjs";

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const bindings = localSupabaseBindings();
const child = spawn(command, ["playwright", "test", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ...bindings,
    INTEGRATION_TEST_BINDINGS: "true",
  },
  stdio: "inherit",
});

child.once("error", (error) => {
  throw error;
});
child.once("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
