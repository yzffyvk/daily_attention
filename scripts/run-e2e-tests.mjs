import { spawn } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { localSupabaseBindings } from "./local-supabase-env.mjs";

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const managedSignals = ["SIGINT", "SIGTERM"];
const reservedE2EPhone = /^139[1-4][0-9]{7}$/u;
const lockPath = join(tmpdir(), "ai-learning-checkin-phone-auth-e2e.lock");
const registryDirectory = join(tmpdir(), "ai-learning-checkin-phone-auth-e2e-registry");
const registryFile = join(registryDirectory, "phones");

function localApiUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("E2E tests require a valid local Supabase API URL.");
  }
  const localHosts = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
  if (url.protocol !== "http:" || !localHosts.has(url.hostname)) {
    throw new Error(`E2E tests refuse non-local Supabase URL: ${url.origin}`);
  }
  return url;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && typeof error === "object" && error.code === "EPERM";
  }
}

function existingLockError() {
  let owner = "unknown";
  try {
    owner = readFileSync(join(lockPath, "owner"), "utf8").trim() || "unknown";
  } catch {
    // The recovery message below remains safe when owner metadata is unreadable.
  }
  const pid = /^[1-9][0-9]*$/u.test(owner) ? Number(owner) : null;
  if (pid && Number.isSafeInteger(pid) && processIsAlive(pid)) {
    return new Error(`An E2E run is already running (owner PID ${pid}).`);
  }
  return new Error(
    `Found a stale E2E lock${pid ? ` owned by dead PID ${pid}` : ""}; ` +
    `remove it manually after verifying no E2E run is active: ${lockPath}`,
  );
}

function acquireRunLock() {
  try {
    mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") {
      throw existingLockError();
    }
    throw error;
  }

  try {
    writeFileSync(join(lockPath, "owner"), `${process.pid}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    rmSync(lockPath, { force: true, recursive: true });
    throw error;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    rmSync(lockPath, { force: true, recursive: true });
  };
}

function ensureRegistryDirectory() {
  mkdirSync(registryDirectory, { mode: 0o700, recursive: true });
  const metadata = lstatSync(registryDirectory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Invalid E2E phone registry directory: ${registryDirectory}`);
  }
  chmodSync(registryDirectory, 0o700);
}

function readRegistryPhones() {
  let contents;
  try {
    const metadata = lstatSync(registryFile);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Invalid E2E phone registry file: ${registryFile}`);
    }
    contents = readFileSync(registryFile, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
  if (contents.length === 0) return [];
  const body = contents.endsWith("\n") ? contents.slice(0, -1) : contents;
  const phones = body.split("\n");
  if (phones.some((phone) => !reservedE2EPhone.test(phone))) {
    throw new Error(`Invalid E2E phone registry contents: ${registryFile}`);
  }
  return [...new Set(phones)];
}

function removeRegistryFile() {
  rmSync(registryFile, { force: true });
}

function createRegistryFile() {
  writeFileSync(registryFile, "", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

function normalizedReservedPhone(value) {
  if (typeof value !== "string") return null;
  const raw = value.startsWith("+") ? value.slice(1) : value;
  const phone = raw.startsWith("86") ? raw.slice(2) : raw;
  return reservedE2EPhone.test(phone) ? phone : null;
}

async function deleteRegisteredUsers(bindings, apiUrl, phones) {
  if (phones.length === 0) return;
  const targets = new Set(phones);
  const admin = createClient(apiUrl.origin, bindings.SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Unable to list local E2E users: ${error.message}`);
    if (!data || !Array.isArray(data.users)) {
      throw new Error("Local Supabase returned an invalid E2E user list.");
    }
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }

  for (const user of users) {
    const phone = normalizedReservedPhone(user.phone);
    if (!phone || !targets.has(phone)) continue;
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`Unable to delete local E2E user ${phone}: ${error.message}`);
  }
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
  let activeChild = null;
  let receivedSignal = null;
  let releaseLock = () => {};
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
  for (const signal of managedSignals) process.on(signal, signalHandlers[signal]);

  async function runPlaywright(env) {
    if (receivedSignal) return { code: null, signal: receivedSignal };
    activeChild = spawn(command, ["playwright", "test", ...process.argv.slice(2)], {
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
    if (receivedSignal) return signalExitCode(receivedSignal);
    releaseLock = acquireRunLock();
    if (receivedSignal) return signalExitCode(receivedSignal);

    const bindings = localSupabaseBindings();
    const apiUrl = localApiUrl(bindings.NEXT_PUBLIC_SUPABASE_URL);
    if (receivedSignal) return signalExitCode(receivedSignal);

    ensureRegistryDirectory();
    const stalePhones = readRegistryPhones();
    await deleteRegisteredUsers(bindings, apiUrl, stalePhones);
    if (receivedSignal) return signalExitCode(receivedSignal);
    removeRegistryFile();
    createRegistryFile();

    const playwright = await runPlaywright({
      ...process.env,
      ...bindings,
      E2E_PHONE_REGISTRY_FILE: registryFile,
      INTEGRATION_TEST_BINDINGS: "true",
    });
    if (receivedSignal) return signalExitCode(receivedSignal);
    if (playwright.signal || playwright.code !== 0) {
      return playwright.signal ? 1 : (playwright.code ?? 1);
    }

    const currentPhones = readRegistryPhones();
    await deleteRegisteredUsers(bindings, apiUrl, currentPhones);
    if (receivedSignal) return signalExitCode(receivedSignal);
    removeRegistryFile();
    return 0;
  } finally {
    if (activeChild?.exitCode === null) activeChild.kill("SIGTERM");
    releaseLock();
    for (const signal of managedSignals) process.removeListener(signal, signalHandlers[signal]);
  }
}

try {
  process.exitCode = await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
