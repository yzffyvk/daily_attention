import { fork, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  acquireIntegrationRunLock,
  cleanupIntegrationUserRegistry,
  integrationRegistryPaths,
  localIntegrationApiUrl,
} from "./integration-user-registry.mjs";

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const vitestWorkerPath = fileURLToPath(
  new URL("./integration-vitest-worker.mjs", import.meta.url),
);

function statusEnvironment() {
  const result = spawnSync(command, ["supabase", "status", "-o", "env"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error("Local Supabase is not available. Start it with npm run supabase:start.");

  const values = Object.fromEntries(
    result.stdout.split("\n").flatMap((line) => {
      const match = /^([A-Z0-9_]+)=(.+)$/u.exec(line);
      if (!match) return [];
      try {
        return [[match[1], JSON.parse(match[2])]];
      } catch {
        return [];
      }
    }),
  );
  const bindings = {
    NEXT_PUBLIC_SUPABASE_URL: values.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: values.PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: values.SECRET_KEY,
    AUTH_RATE_LIMIT_PEPPER: "integration-test-rate-limit-pepper",
    APP_ORIGIN: "http://127.0.0.1:3100",
  };
  if (Object.values(bindings).some((value) => typeof value !== "string" || value.length === 0)) {
    throw new Error("Local Supabase did not report the bindings required by integration tests.");
  }
  return bindings;
}

async function runIntegrationVitestWorker(environment, runLock) {
  let worker;
  try {
    worker = fork(vitestWorkerPath, [], {
      cwd: process.cwd(),
      env: environment,
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });
  } catch {
    throw new Error("Unable to start the integration Vitest worker.");
  }

  let lockHeld = false;
  let protocolFailed = false;
  const outcome = new Promise((resolve) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    worker.once("error", () => settle({ failed: true }));
    worker.once("exit", (code, signal) => settle({ code, signal }));
  });
  worker.on("message", (message) => {
    if (
      !lockHeld
      && message
      && typeof message === "object"
      && !Array.isArray(message)
      && Object.keys(message).length === 1
      && message.type === "integration-run-lock-held"
    ) {
      lockHeld = true;
      return;
    }
    protocolFailed = true;
    if (worker.exitCode === null && worker.signalCode === null) {
      worker.kill("SIGTERM");
    }
  });

  try {
    await Promise.race([
      runLock.shareWith(worker),
      outcome.then(() => {
        throw new Error("Unable to start the integration Vitest worker.");
      }),
    ]);
  } catch {
    if (worker.exitCode === null && worker.signalCode === null) {
      worker.kill("SIGTERM");
    }
    await outcome;
    throw new Error("Unable to start the integration Vitest worker.");
  }

  const result = await outcome;
  if (
    result.failed
    || protocolFailed
    || !lockHeld
    || result.signal
    || typeof result.code !== "number"
  ) {
    throw new Error("Integration Vitest worker failed.");
  }
  return result.code;
}

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const { registryFile } = integrationRegistryPaths();
  const runLock = await acquireIntegrationRunLock();
  let bindingDirectory;
  let devServer;
  let devServerExited;

  try {
    const bindings = statusEnvironment();
    const apiUrl = localIntegrationApiUrl(bindings.NEXT_PUBLIC_SUPABASE_URL);
    const admin = createClient(apiUrl.origin, bindings.SUPABASE_SECRET_KEY, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    await cleanupIntegrationUserRegistry(admin, registryFile);

    const integrationRunScope = randomBytes(8).toString("hex");
    bindingDirectory = await mkdtemp(join(tmpdir(), "task-5-integration-"));
    await writeFile(join(bindingDirectory, "wrangler.json"), '{"name":"task-5-integration"}\n');
    await writeFile(
      join(bindingDirectory, ".dev.vars"),
      `${Object.entries(bindings).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join("\n")}\n`,
    );
    const environment = {
      ...process.env,
      ...bindings,
      TEST_SUPABASE_URL: bindings.NEXT_PUBLIC_SUPABASE_URL,
      TEST_SUPABASE_SECRET_KEY: bindings.SUPABASE_SECRET_KEY,
      INTEGRATION_RUN_SCOPE: integrationRunScope,
      INTEGRATION_TEST_BINDINGS: "true",
      INTEGRATION_USER_REGISTRY_FILE: registryFile,
      CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: join(bindingDirectory, "wrangler.json"),
    };
    devServer = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", "3100"], {
      cwd: process.cwd(),
      env: environment,
      stdio: "inherit",
    });
    devServerExited = new Promise((resolve) => devServer.once("exit", resolve));

    await waitForServer("http://127.0.0.1:3100");
    const exitCode = await runIntegrationVitestWorker(environment, runLock);
    await cleanupIntegrationUserRegistry(admin, registryFile);
    return exitCode;
  } finally {
    try {
      if (devServer?.exitCode === null) devServer.kill("SIGTERM");
      if (devServerExited) await devServerExited;
      if (bindingDirectory) await rm(bindingDirectory, { force: true, recursive: true });
    } finally {
      await runLock.release();
    }
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Integration test runner failed.");
  process.exitCode = 1;
}
