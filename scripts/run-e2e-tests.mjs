import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localSupabaseBindings } from "./local-supabase-env.mjs";

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const managedSignals = ["SIGINT", "SIGTERM"];

function localApiUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("E2E tests require a valid local Supabase API URL.");
  }
  const localHosts = new Set(["127.0.0.1", "::1", "localhost"]);
  if (url.protocol !== "http:" || !localHosts.has(url.hostname)) {
    throw new Error(`E2E tests refuse non-local Supabase URL: ${url.origin}`);
  }
  return url;
}

async function acquireRunLock(apiUrl) {
  const lockName = `ai-learning-checkin-e2e-${apiUrl.hostname.replaceAll(":", "_")}-${apiUrl.port || "80"}.lock`;
  const lockPath = join(tmpdir(), lockName);
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") {
      throw new Error(`An E2E run is already running for ${apiUrl.origin}.`);
    }
    throw error;
  }

  try {
    await writeFile(join(lockPath, "owner"), `${process.pid}\n`, { flag: "wx" });
  } catch (error) {
    await rm(lockPath, { force: true, recursive: true });
    throw error;
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await rm(lockPath, { force: true, recursive: true });
  };
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function signalExitCode(signal) {
  return signal === "SIGINT" ? 130 : 143;
}

async function run() {
  const bindings = localSupabaseBindings();
  const apiUrl = localApiUrl(bindings.NEXT_PUBLIC_SUPABASE_URL);
  const releaseLock = await acquireRunLock(apiUrl);
  let activeChild = null;
  let receivedSignal = null;

  const signalHandlers = Object.fromEntries(managedSignals.map((signal) => [
    signal,
    () => {
      if (receivedSignal) return;
      receivedSignal = signal;
      if (activeChild?.exitCode === null) {
        try {
          activeChild.kill(signal);
        } catch {
          // The child may have exited between the exitCode check and kill.
        }
      }
    },
  ]));
  for (const signal of managedSignals) process.once(signal, signalHandlers[signal]);

  async function runChild(args, env = process.env) {
    if (receivedSignal) return { code: null, signal: receivedSignal };
    activeChild = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });
    try {
      return await waitForChild(activeChild);
    } finally {
      activeChild = null;
    }
  }

  try {
    const reset = await runChild(["supabase", "db", "reset", "--local"]);
    if (receivedSignal) return signalExitCode(receivedSignal);
    if (reset.signal || reset.code !== 0) {
      throw new Error(`Local Supabase reset failed with ${reset.signal ?? `exit ${reset.code ?? 1}`}.`);
    }

    const playwright = await runChild(
      ["playwright", "test", ...process.argv.slice(2)],
      {
        ...process.env,
        ...bindings,
        INTEGRATION_TEST_BINDINGS: "true",
      },
    );
    if (receivedSignal) return signalExitCode(receivedSignal);
    return playwright.signal ? 1 : (playwright.code ?? 1);
  } finally {
    for (const signal of managedSignals) process.removeListener(signal, signalHandlers[signal]);
    if (activeChild?.exitCode === null) activeChild.kill("SIGTERM");
    await releaseLock();
  }
}

try {
  process.exitCode = await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
