// @vitest-environment node

import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories = new Set<string>();

async function waitForFile(path: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await readFile(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("Timed out waiting for integration runner fixture");
}

function childResult(child: ReturnType<typeof spawn>) {
  return new Promise<{ code: number | null; stderr: string }>((resolve) => {
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once("exit", (code) => resolve({ code, stderr }));
  });
}

afterEach(async () => {
  await Promise.all([...temporaryDirectories].map((directory) => (
    rm(directory, { force: true, recursive: true })
  )));
  temporaryDirectories.clear();
});

describe("integration test runner", () => {
  it("uses the explicit safe runner instead of mutating developer state", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(packageJson.scripts["test:integration"]).toBe("node scripts/run-integration-tests.mjs");
  });

  it("provides a fresh run scope to integration tests", async () => {
    const directory = await mkdtemp(join(tmpdir(), "integration-runner-test-"));
    temporaryDirectories.add(directory);
    const bin = join(directory, "bin");
    const scopeLog = join(directory, "scope.log");
    const argsLog = join(directory, "args.log");
    await mkdir(bin);
    await writeFile(join(bin, "npx"), `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "supabase" && args[1] === "status") {
  console.log('API_URL="http://127.0.0.1:54321"');
  console.log('PUBLISHABLE_KEY="local-publishable"');
  console.log('SECRET_KEY="local-secret"');
  process.exit(0);
}
if (args[0] === "vitest") {
  writeFileSync(process.env.FAKE_SCOPE_LOG, process.env.INTEGRATION_RUN_SCOPE || "missing");
  writeFileSync(process.env.FAKE_ARGS_LOG, JSON.stringify(args));
  process.exit(0);
}
process.exit(2);
`);
    await writeFile(join(bin, "npm"), `#!/usr/bin/env node
const { createServer } = require("node:http");
const server = createServer((_request, response) => {
  response.writeHead(200);
  response.end("ready");
});
server.listen(3100, "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`);
    await Promise.all([
      chmod(join(bin, "npx"), 0o755),
      chmod(join(bin, "npm"), 0o755),
    ]);

    const child = spawn(process.execPath, ["scripts/run-integration-tests.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FAKE_ARGS_LOG: argsLog,
        FAKE_SCOPE_LOG: scopeLog,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        TMPDIR: directory,
        TMP: directory,
        TEMP: directory,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("exit", (code) => resolve({ code, stderr }));
    });

    expect(result.code).toBe(0);
    expect(await readFile(scopeLog, "utf8")).toMatch(/^[0-9a-f]{16}$/u);
    expect(JSON.parse(await readFile(argsLog, "utf8"))).toEqual([
      "vitest",
      "run",
      "tests/integration",
      "--no-file-parallelism",
      "--maxWorkers=1",
    ]);
  });

  it("rejects a concurrent standard integration runner before registry writes can race", async () => {
    const directory = await mkdtemp(join(tmpdir(), "integration-runner-lock-test-"));
    temporaryDirectories.add(directory);
    const bin = join(directory, "bin");
    const started = join(directory, "vitest-started");
    const release = join(directory, "release-vitest");
    await mkdir(bin);
    await writeFile(join(bin, "npx"), `#!/usr/bin/env node
const { existsSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "supabase" && args[1] === "status") {
  console.log('API_URL="http://127.0.0.1:54321"');
  console.log('PUBLISHABLE_KEY="local-publishable"');
  console.log('SECRET_KEY="local-secret"');
  process.exit(0);
}
if (args[0] === "vitest") {
  writeFileSync(process.env.FAKE_VITEST_STARTED, "started");
  const deadline = Date.now() + 10000;
  while (!existsSync(process.env.FAKE_VITEST_RELEASE) && Date.now() < deadline) {}
  process.exit(existsSync(process.env.FAKE_VITEST_RELEASE) ? 0 : 3);
}
process.exit(2);
`);
    await writeFile(join(bin, "npm"), `#!/usr/bin/env node
const { createServer } = require("node:http");
const server = createServer((_request, response) => {
  response.writeHead(200);
  response.end("ready");
});
server.on("error", () => process.exit(0));
server.listen(3100, "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`);
    await Promise.all([
      chmod(join(bin, "npx"), 0o755),
      chmod(join(bin, "npm"), 0o755),
    ]);
    const environment = {
      ...process.env,
      FAKE_VITEST_RELEASE: release,
      FAKE_VITEST_STARTED: started,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      TMPDIR: directory,
      TMP: directory,
      TEMP: directory,
    };

    const first = spawn(process.execPath, ["scripts/run-integration-tests.mjs"], {
      cwd: process.cwd(),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const firstResult = childResult(first);
    await waitForFile(started);

    const second = spawn(process.execPath, ["scripts/run-integration-tests.mjs"], {
      cwd: process.cwd(),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const secondResult = childResult(second);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await writeFile(release, "release");

    const [firstOutcome, secondOutcome] = await Promise.all([firstResult, secondResult]);
    expect(firstOutcome.code).toBe(0);
    expect(secondOutcome.code).toBe(1);
    expect(secondOutcome.stderr).toContain("An integration test run is already active.");
    expect(secondOutcome.stderr).not.toContain("@integration.daily-attention.invalid");
  });
});
