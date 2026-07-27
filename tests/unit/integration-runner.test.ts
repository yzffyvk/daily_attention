// @vitest-environment node

import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireIntegrationRunLock } from "../../scripts/integration-user-registry.mjs";

const temporaryDirectories = new Set<string>();
const detachedProcessGroups = new Set<number>();
const integrationProcessTreeIt = process.platform === "win32" ? it.skip : it;

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
  return new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stderr: string;
    stdout: string;
  }>((resolve) => {
    let stderr = "";
    let stdout = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.once("exit", (code, signal) => resolve({
      code,
      signal,
      stderr,
      stdout,
    }));
  });
}

function processIsRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsRunning(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for integration runner process exit");
}

async function readCounter(path: string) {
  try {
    return Number.parseInt(await readFile(path, "utf8"), 10);
  } catch {
    return 0;
  }
}

function spawnDetachedIntegrationRunner(environment: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, ["scripts/run-integration-tests.mjs"], {
    cwd: process.cwd(),
    detached: true,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!child.pid) throw new Error("Integration runner fixture did not start");
  detachedProcessGroups.add(child.pid);
  return child;
}

afterEach(async () => {
  for (const processGroup of detachedProcessGroups) {
    try {
      process.kill(-processGroup, "SIGKILL");
    } catch {
      // The fixture process group has already exited.
    }
  }
  detachedProcessGroups.clear();
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
    expect(secondOutcome.stderr).not.toContain("local-secret");
  });

  it("awaits integration lock release and makes repeated release idempotent", async () => {
    const runLock = await acquireIntegrationRunLock();

    await Promise.all([runLock.release(), runLock.release()]);

    const nextRunLock = await acquireIntegrationRunLock();
    await nextRunLock.release();
  });

  integrationProcessTreeIt("keeps the lock while an orphaned integration writer is active", async () => {
    const directory = await mkdtemp(join(tmpdir(), "integration-runner-process-tree-test-"));
    temporaryDirectories.add(directory);
    const bin = join(directory, "bin");
    const devPidFile = join(directory, "dev.pid");
    const releaseFile = join(directory, "release-vitest");
    const statusCountFile = join(directory, "status-count");
    const vitestCountFile = join(directory, "vitest-count");
    const vitestReadyFile = join(directory, "vitest-ready");
    const registryFile = join(
      directory,
      "ai-learning-checkin-email-auth-integration-registry",
      "users",
    );
    const ownedUser = {
      email: "integration-aaaaaaaaaaaaaaaa-1@integration.daily-attention.invalid",
      userId: "11111111-1111-4111-8111-111111111111",
    };
    const adminRequests: string[] = [];
    let userDeleted = false;

    const authServer = createServer((request, response) => {
      const expectedPath = `/auth/v1/admin/users/${ownedUser.userId}`;
      if (request.url !== expectedPath) {
        response.writeHead(404).end();
        return;
      }

      if (request.method === "GET") {
        adminRequests.push("GET");
        response.setHeader("content-type", "application/json");
        if (userDeleted) {
          response.writeHead(404).end(JSON.stringify({
            error_code: "user_not_found",
            message: "User not found",
          }));
          return;
        }
        response.writeHead(200).end(JSON.stringify({
          app_metadata: { provider: "email", providers: ["email"] },
          aud: "authenticated",
          confirmed_at: "2026-07-28T00:00:00.000Z",
          created_at: "2026-07-28T00:00:00.000Z",
          email: ownedUser.email,
          email_confirmed_at: "2026-07-28T00:00:00.000Z",
          id: ownedUser.userId,
          identities: [],
          is_anonymous: false,
          last_sign_in_at: "2026-07-28T00:00:00.000Z",
          phone: "",
          role: "authenticated",
          updated_at: "2026-07-28T00:00:00.000Z",
          user_metadata: {},
        }));
        return;
      }

      if (request.method === "DELETE") {
        adminRequests.push("DELETE");
        userDeleted = true;
        response.setHeader("content-type", "application/json");
        response.writeHead(200).end("{}");
        return;
      }

      response.writeHead(405).end();
    });
    await new Promise<void>((resolve, reject) => {
      authServer.once("error", reject);
      authServer.listen(0, "127.0.0.1", resolve);
    });
    const authAddress = authServer.address();
    if (!authAddress || typeof authAddress === "string") {
      throw new Error("Local Auth fixture did not report an address");
    }

    await mkdir(bin);
    await writeFile(join(bin, "npx"), `#!/usr/bin/env node
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");
const args = process.argv.slice(2);
const increment = (path) => {
  const value = existsSync(path) ? Number.parseInt(readFileSync(path, "utf8"), 10) + 1 : 1;
  writeFileSync(path, String(value));
  return value;
};
if (args[0] === "supabase" && args[1] === "status") {
  increment(process.env.FAKE_STATUS_COUNT);
  console.log(\`API_URL=\${JSON.stringify(process.env.FAKE_API_URL)}\`);
  console.log('PUBLISHABLE_KEY="local-publishable"');
  console.log('SECRET_KEY="local-secret"');
  process.exit(0);
}
if (args[0] === "vitest") {
  const run = increment(process.env.FAKE_VITEST_COUNT);
  if (run !== 1) process.exit(0);
  mkdirSync(dirname(process.env.INTEGRATION_USER_REGISTRY_FILE), {
    mode: 0o700,
    recursive: true,
  });
  writeFileSync(
    process.env.INTEGRATION_USER_REGISTRY_FILE,
    JSON.stringify({
      email: process.env.FAKE_OWNED_EMAIL,
      userId: process.env.FAKE_OWNED_USER_ID,
    }) + "\\n",
    { mode: 0o600 },
  );
  writeFileSync(
    process.env.FAKE_VITEST_READY,
    JSON.stringify({ holderPid: process.ppid, writerPid: process.pid }),
  );
  const deadline = Date.now() + 20000;
  const interval = setInterval(() => {
    if (existsSync(process.env.FAKE_VITEST_RELEASE)) process.exit(0);
    if (Date.now() >= deadline) process.exit(3);
  }, 25);
  interval.unref();
  setTimeout(() => process.exit(3), 20000);
}
if (args[0] !== "vitest") process.exit(2);
`);
    await writeFile(join(bin, "npm"), `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
const { createServer } = require("node:http");
const ownerPid = process.ppid;
const server = createServer((_request, response) => {
  response.writeHead(200);
  response.end("ready");
});
const stop = () => server.close(() => process.exit(0));
server.on("error", () => process.exit(0));
server.listen(3100, "127.0.0.1", () => {
  writeFileSync(process.env.FAKE_DEV_PID_FILE, String(process.pid));
});
setInterval(() => {
  try {
    process.kill(ownerPid, 0);
  } catch {
    stop();
  }
}, 25);
process.on("SIGTERM", stop);
`);
    await Promise.all([
      chmod(join(bin, "npx"), 0o755),
      chmod(join(bin, "npm"), 0o755),
    ]);

    const environment = {
      ...process.env,
      FAKE_API_URL: `http://127.0.0.1:${authAddress.port}`,
      FAKE_DEV_PID_FILE: devPidFile,
      FAKE_OWNED_EMAIL: ownedUser.email,
      FAKE_OWNED_USER_ID: ownedUser.userId,
      FAKE_STATUS_COUNT: statusCountFile,
      FAKE_VITEST_COUNT: vitestCountFile,
      FAKE_VITEST_READY: vitestReadyFile,
      FAKE_VITEST_RELEASE: releaseFile,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      TMPDIR: directory,
      TMP: directory,
      TEMP: directory,
    };

    let first;
    let blocked;
    let finalRun;
    try {
      first = spawnDetachedIntegrationRunner(environment);
      const firstResult = childResult(first);
      await waitForFile(vitestReadyFile);
      await waitForFile(devPidFile);
      const processTree = JSON.parse(await readFile(vitestReadyFile, "utf8")) as {
        holderPid: number;
        writerPid: number;
      };
      const devPid = Number.parseInt(await readFile(devPidFile, "utf8"), 10);

      process.kill(first.pid!, "SIGKILL");
      const firstOutcome = await firstResult;
      await waitForProcessExit(devPid);
      expect(processIsRunning(processTree.writerPid)).toBe(true);

      blocked = spawnDetachedIntegrationRunner(environment);
      const blockedOutcome = await childResult(blocked);
      detachedProcessGroups.delete(blocked.pid!);
      const statusCallsWhileWriterActive = await readCounter(statusCountFile);
      const adminCallsWhileWriterActive = [...adminRequests];
      let registryWhileWriterActive = "";
      try {
        registryWhileWriterActive = await readFile(registryFile, "utf8");
      } catch {
        // The missing registry is asserted below.
      }

      await writeFile(releaseFile, "release");
      await waitForProcessExit(processTree.writerPid);
      await waitForProcessExit(processTree.holderPid);
      detachedProcessGroups.delete(first.pid!);

      finalRun = spawnDetachedIntegrationRunner(environment);
      const finalOutcome = await childResult(finalRun);
      detachedProcessGroups.delete(finalRun.pid!);

      expect(firstOutcome.code).toBeNull();
      expect(firstOutcome.signal).toBe("SIGKILL");
      expect(blockedOutcome.code).toBe(1);
      expect(blockedOutcome.stderr).toContain("An integration test run is already active.");
      expect(statusCallsWhileWriterActive).toBe(1);
      expect(adminCallsWhileWriterActive).toEqual([]);
      expect(registryWhileWriterActive).toBe(`${JSON.stringify(ownedUser)}\n`);
      expect(processTree.holderPid).not.toBe(first.pid);
      expect(finalOutcome.code).toBe(0);
      await expect(readFile(registryFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(adminRequests).toEqual(["GET", "GET", "DELETE", "GET"]);
      expect(processIsRunning(processTree.writerPid)).toBe(false);
      expect(processIsRunning(processTree.holderPid)).toBe(false);

      const output = [
        firstOutcome.stdout,
        firstOutcome.stderr,
        blockedOutcome.stdout,
        blockedOutcome.stderr,
        finalOutcome.stdout,
        finalOutcome.stderr,
      ].join("");
      expect(output).not.toContain(ownedUser.email);
      expect(output).not.toContain("local-secret");
    } finally {
      await writeFile(releaseFile, "release");
      for (const child of [first, blocked, finalRun]) {
        if (!child?.pid) continue;
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // The fixture process group has already exited.
        }
      }
      authServer.closeAllConnections();
      await new Promise<void>((resolve) => authServer.close(() => resolve()));
    }
  }, 20_000);
});
