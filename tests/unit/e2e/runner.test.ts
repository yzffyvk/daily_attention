// @vitest-environment node

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories = new Set<string>();

const fakeNpx = `#!/usr/bin/env node
const { appendFileSync, existsSync, rmSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_NPX_LOG, JSON.stringify(args) + "\\n");

if (args[0] === "supabase" && args[1] === "status") {
  console.log('API_URL=' + JSON.stringify(process.env.FAKE_API_URL || "http://127.0.0.1:54321"));
  console.log('PUBLISHABLE_KEY="local-publishable"');
  console.log('SECRET_KEY="local-secret"');
  process.exit(0);
}

if (args[0] === "supabase" && args[1] === "db" && args[2] === "reset") {
  if (process.env.FAKE_RESET_EXIT) process.exit(Number(process.env.FAKE_RESET_EXIT));
  if (process.env.FAKE_STALE_STATE) rmSync(process.env.FAKE_STALE_STATE, { force: true });
  process.exit(0);
}

if (args[0] === "playwright" && args[1] === "test") {
  if (process.env.FAKE_PLAYWRIGHT_MARKER) {
    writeFileSync(process.env.FAKE_PLAYWRIGHT_MARKER, String(process.pid));
  }
  if (process.env.FAKE_STALE_STATE && existsSync(process.env.FAKE_STALE_STATE)) process.exit(9);
  const hold = Number(process.env.FAKE_PLAYWRIGHT_HOLD_MS || 0);
  const exitCode = Number(process.env.FAKE_PLAYWRIGHT_EXIT || 0);
  setTimeout(() => process.exit(exitCode), hold);
  return;
}

process.exit(2);
`;

type RunnerResult = { code: number | null; signal: NodeJS.Signals | null; stderr: string; stdout: string };

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "e2e-runner-test-"));
  temporaryDirectories.add(directory);
  const bin = join(directory, "bin");
  const npx = join(bin, "npx");
  await mkdir(bin);
  await writeFile(npx, fakeNpx);
  await chmod(npx, 0o755);
  return {
    directory,
    log: join(directory, "npx.log"),
    marker: join(directory, "playwright.pid"),
    staleState: join(directory, "stale-account"),
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      TMPDIR: directory,
      TMP: directory,
      TEMP: directory,
      FAKE_NPX_LOG: join(directory, "npx.log"),
    },
  };
}

function startRunner(env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, ["scripts/run-e2e-tests.mjs"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const result = new Promise<RunnerResult>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal, stderr, stdout }));
  });
  return { child, result };
}

async function runRunner(env: NodeJS.ProcessEnv) {
  return startRunner(env).result;
}

async function waitForFile(path: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await access(path, constants.F_OK);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function commandLog(path: string) {
  return (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all([...temporaryDirectories].map((directory) => rm(directory, { force: true, recursive: true })));
  temporaryDirectories.clear();
});

describe("E2E runner isolation", () => {
  it("uses the default runner path to reset stale local state before the first Playwright registration", async () => {
    const setup = await fixture();
    await writeFile(setup.staleState, "registered");

    const result = await runRunner({
      ...setup.env,
      FAKE_STALE_STATE: setup.staleState,
    });

    expect(result).toMatchObject({ code: 0, signal: null });
    expect(await commandLog(setup.log)).toEqual([
      ["supabase", "status", "-o", "env"],
      ["supabase", "db", "reset", "--local"],
      ["playwright", "test"],
    ]);
  });

  it("fails closed before reset or Playwright when Supabase reports a non-local URL", async () => {
    const setup = await fixture();

    const result = await runRunner({
      ...setup.env,
      FAKE_API_URL: "https://project.supabase.co",
    });

    expect(result.code).not.toBe(0);
    expect(await commandLog(setup.log)).toEqual([["supabase", "status", "-o", "env"]]);
  });

  it("rejects a concurrent run before it can reset the shared local database", async () => {
    const setup = await fixture();
    const first = startRunner({
      ...setup.env,
      FAKE_PLAYWRIGHT_HOLD_MS: "1200",
      FAKE_PLAYWRIGHT_MARKER: setup.marker,
    });
    await waitForFile(setup.marker);

    const second = await runRunner(setup.env);

    expect(second.code).not.toBe(0);
    expect(second.stderr).toContain("already running");
    expect((await commandLog(setup.log)).filter((args) => args[0] === "supabase" && args[1] === "db")).toHaveLength(1);
    expect((await first.result).code).toBe(0);
  });

  it("releases the lock after reset and Playwright failures", async () => {
    const setup = await fixture();

    const resetFailure = await runRunner({ ...setup.env, FAKE_RESET_EXIT: "7" });
    expect(resetFailure.code).not.toBe(0);
    expect((await runRunner(setup.env)).code).toBe(0);

    const playwrightFailure = await runRunner({ ...setup.env, FAKE_PLAYWRIGHT_EXIT: "8" });
    expect(playwrightFailure.code).toBe(8);
    expect((await runRunner(setup.env)).code).toBe(0);
  });

  it("forwards SIGTERM, releases the lock, and permits the next run", async () => {
    const setup = await fixture();
    const first = startRunner({
      ...setup.env,
      FAKE_PLAYWRIGHT_HOLD_MS: "10000",
      FAKE_PLAYWRIGHT_MARKER: setup.marker,
    });
    await waitForFile(setup.marker);
    const childPid = Number(await readFile(setup.marker, "utf8"));

    first.child.kill("SIGTERM");
    const result = await first.result;
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      expect(result).toMatchObject({ code: 143, signal: null });
      expect(isAlive(childPid)).toBe(false);
      expect((await runRunner(setup.env)).code).toBe(0);
    } finally {
      if (isAlive(childPid)) process.kill(childPid, "SIGKILL");
    }
  });
});
