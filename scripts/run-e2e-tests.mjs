import { execFile, spawn } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { localSupabaseBindings } from "./local-supabase-env.mjs";

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const execFileAsync = promisify(execFile);
const managedSignals = ["SIGINT", "SIGTERM"];
const checkInImageBucket = "checkin-images";
const reservedE2EEmail = /^email-[1-4]-[0-9]{4}-[0-9]+-[0-9]+-[0-9]+@e2e\.daily-attention\.invalid$/u;
const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const storageBatchSize = 100;
const lockPath = join(tmpdir(), "ai-learning-checkin-email-auth-e2e.lock");
const registryDirectory = join(tmpdir(), "ai-learning-checkin-email-auth-e2e-registry");
const registryFile = join(registryDirectory, "emails");
const runScopeFile = join(registryDirectory, "run-scope");

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

async function verifyLocalAuthSettings(bindings, apiUrl) {
  let response;
  try {
    response = await fetch(new URL("/auth/v1/settings", apiUrl), {
      headers: { apikey: bindings.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
    });
  } catch {
    throw new Error("Unable to verify local Supabase Auth settings.");
  }
  if (!response.ok) {
    throw new Error("Unable to verify local Supabase Auth settings.");
  }

  let settings;
  try {
    settings = await response.json();
  } catch {
    throw new Error("Unable to verify local Supabase Auth settings.");
  }
  if (
    !settings
    || typeof settings !== "object"
    || !settings.external
    || typeof settings.external !== "object"
    || settings.external.email !== true
    || settings.external.phone !== false
    || settings.disable_signup !== true
  ) {
    throw new Error("Local Supabase Auth settings do not meet the E2E release gate.");
  }
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
    throw new Error(`Invalid E2E email registry directory: ${registryDirectory}`);
  }
  chmodSync(registryDirectory, 0o700);
}

function readRegistryOwnership() {
  let contents;
  try {
    const metadata = lstatSync(registryFile);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Invalid E2E email registry file: ${registryFile}`);
    }
    contents = readFileSync(registryFile, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
  if (contents.length === 0) return [];
  const body = contents.endsWith("\n") ? contents.slice(0, -1) : contents;
  const ownership = body.split("\n").map((line) => {
    if (reservedE2EEmail.test(line)) {
      throw new Error(`Found unconfirmed E2E ownership in registry: ${registryFile}`);
    }
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`Invalid E2E ownership registry contents: ${registryFile}`);
    }
    if (
      !value
      || typeof value !== "object"
      || Array.isArray(value)
      || (
        Object.keys(value).sort().join(",") !== "email,userId"
        && (
          Object.keys(value).sort().join(",") !== "email,state,userId"
          || value.state !== "deleting"
        )
      )
      || typeof value.userId !== "string"
      || !userIdPattern.test(value.userId)
      || typeof value.email !== "string"
      || !reservedE2EEmail.test(value.email)
    ) {
      throw new Error(`Invalid E2E ownership registry contents: ${registryFile}`);
    }
    return value.state === "deleting"
      ? { userId: value.userId, email: value.email, state: "deleting" }
      : { userId: value.userId, email: value.email };
  });
  const byUserId = new Map();
  const byEmail = new Map();
  for (const entry of ownership) {
    if (
      byUserId.has(entry.userId)
      || byEmail.has(entry.email)
    ) {
      throw new Error(`Conflicting E2E ownership registry contents: ${registryFile}`);
    }
    byUserId.set(entry.userId, entry.email);
    byEmail.set(entry.email, entry.userId);
  }
  return ownership;
}

function removeRegistryFile() {
  try {
    const metadata = lstatSync(registryFile);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Invalid E2E email registry file: ${registryFile}`);
    }
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
  }
  rmSync(registryFile);
}

function serializeRegistryOwnership(ownership) {
  return `${ownership.map((entry) => JSON.stringify(
    entry.state === "deleting"
      ? { userId: entry.userId, email: entry.email, state: "deleting" }
      : { userId: entry.userId, email: entry.email },
  )).join("\n")}\n`;
}

function checkpointRegistryOwnership(ownership) {
  if (ownership.length === 0) {
    removeRegistryFile();
    return;
  }

  ensureRegistryDirectory();
  const temporaryFile = join(
    registryDirectory,
    `emails.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(temporaryFile, serializeRegistryOwnership(ownership), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    chmodSync(temporaryFile, 0o600);

    const metadata = lstatSync(registryFile);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Invalid E2E email registry file: ${registryFile}`);
    }
    renameSync(temporaryFile, registryFile);
  } finally {
    rmSync(temporaryFile, { force: true });
  }
}

function createRegistryFile() {
  writeFileSync(registryFile, "", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

function allocateRunScope() {
  let previous = null;
  try {
    const metadata = lstatSync(runScopeFile);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Invalid E2E run scope file: ${runScopeFile}`);
    }
    const contents = readFileSync(runScopeFile, "utf8");
    if (!/^[0-9]{4}\n$/u.test(contents)) {
      throw new Error(`Invalid E2E run scope contents: ${runScopeFile}`);
    }
    previous = Number(contents.trim());
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
  }

  const scope = previous === null ? randomInt(10_000) : (previous + 1) % 10_000;
  const value = String(scope).padStart(4, "0");
  const temporaryFile = join(registryDirectory, `run-scope.${process.pid}.tmp`);
  try {
    writeFileSync(temporaryFile, `${value}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporaryFile, runScopeFile);
  } finally {
    rmSync(temporaryFile, { force: true });
  }
  return value;
}

function reservedE2EAuthEmail(value) {
  return typeof value === "string" && reservedE2EEmail.test(value) ? value : null;
}

async function listOwnedStoragePaths(userId) {
  if (!userIdPattern.test(userId)) {
    throw new Error("Invalid E2E Storage ownership.");
  }
  const query = `
    select bucket_id, name, owner_id
    from storage.objects
    where bucket_id = '${checkInImageBucket}'
      and (
        owner_id = '${userId}'
        or name like '${userId}/%'
      )
    order by name;
  `;
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      command,
      ["supabase", "db", "query", "--local", "--output-format", "json", query],
      { cwd: process.cwd(), encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    ));
  } catch {
    throw new Error("Unable to list local E2E Storage ownership.");
  }

  let result;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw new Error("Local Supabase returned an invalid E2E Storage listing.");
  }
  if (!result || typeof result !== "object" || !Array.isArray(result.rows)) {
    throw new Error("Local Supabase returned an invalid E2E Storage listing.");
  }

  const expectedPrefix = `${userId}/`;
  const ownedPathPattern = new RegExp(
    `^${userId}/[0-9]{4}-[0-9]{2}-[0-9]{2}/` +
    "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$",
    "iu",
  );
  const paths = [];
  const seenPaths = new Set();
  for (const row of result.rows) {
    if (
      !row
      || typeof row !== "object"
      || Array.isArray(row)
      || Object.keys(row).sort().join(",") !== "bucket_id,name,owner_id"
      || row.bucket_id !== checkInImageBucket
      || row.owner_id !== userId
      || typeof row.name !== "string"
      || !row.name.startsWith(expectedPrefix)
      || !ownedPathPattern.test(row.name)
      || seenPaths.has(row.name)
    ) {
      throw new Error("Local E2E Storage ownership is ambiguous.");
    }
    seenPaths.add(row.name);
    paths.push(row.name);
  }
  return paths;
}

async function removeOwnedStoragePaths(admin, paths) {
  const storage = admin.storage.from(checkInImageBucket);
  for (let offset = 0; offset < paths.length; offset += storageBatchSize) {
    const batch = paths.slice(offset, offset + storageBatchSize);
    let response;
    try {
      response = await storage.remove(batch);
    } catch {
      throw new Error("Unable to remove local E2E Storage objects.");
    }
    if (response.error || !Array.isArray(response.data)) {
      throw new Error("Unable to remove local E2E Storage objects.");
    }
    const removedPaths = new Set();
    for (const row of response.data) {
      if (
        !row
        || typeof row !== "object"
        || row.bucket_id !== checkInImageBucket
        || typeof row.name !== "string"
        || !batch.includes(row.name)
        || removedPaths.has(row.name)
      ) {
        throw new Error("Local E2E Storage removal is ambiguous.");
      }
      removedPaths.add(row.name);
    }
    if (removedPaths.size !== batch.length) {
      throw new Error("Local E2E Storage removal is ambiguous.");
    }
  }
}

async function listLocalE2EUsers(admin) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("Unable to list local E2E users.");
    if (
      !data
      || !Array.isArray(data.users)
      || data.users.some((user) => (
        !user
        || typeof user !== "object"
        || Array.isArray(user)
        || typeof user.id !== "string"
        || !userIdPattern.test(user.id)
      ))
    ) {
      throw new Error("Local Supabase returned an invalid E2E user list.");
    }
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

function confirmCurrentAuthUser(users, entry, allowMissing) {
  const user = users.find((candidate) => candidate?.id === entry.userId);
  if (!user) {
    if (allowMissing) return null;
    throw new Error("Local E2E ownership cannot be verified against Auth.");
  }
  const email = reservedE2EAuthEmail(user.email);
  if (email !== entry.email) {
    throw new Error("Local E2E ownership no longer matches the current Auth email.");
  }
  return user;
}

function confirmDeleteResponse(response, entry) {
  if (response?.error) throw new Error("Unable to delete a local E2E user.");
  const deletedUser = response?.data?.user;
  if (
    !deletedUser
    || deletedUser.id !== entry.userId
    || reservedE2EAuthEmail(deletedUser.email) !== entry.email
  ) {
    throw new Error("Local E2E Auth delete response did not match verified ownership.");
  }
}

async function deleteRegisteredUsers(bindings, apiUrl, ownership, shouldStop) {
  if (ownership.length === 0) {
    if (shouldStop()) return false;
    checkpointRegistryOwnership(ownership);
    return true;
  }
  const admin = createClient(apiUrl.origin, bindings.SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  let remaining = ownership;
  while (remaining.length > 0) {
    if (shouldStop()) return false;
    let entry = remaining[0];

    if (entry.state !== "deleting") {
      confirmCurrentAuthUser(await listLocalE2EUsers(admin), entry, false);
      if (shouldStop()) return false;

      const paths = await listOwnedStoragePaths(entry.userId);
      if (shouldStop()) return false;
      await removeOwnedStoragePaths(admin, paths);
      if ((await listOwnedStoragePaths(entry.userId)).length !== 0) {
        throw new Error("Local E2E Storage cleanup did not complete.");
      }
      if (shouldStop()) return false;

      entry = { userId: entry.userId, email: entry.email, state: "deleting" };
      remaining = [entry, ...remaining.slice(1)];
      checkpointRegistryOwnership(remaining);
    } else {
      if ((await listOwnedStoragePaths(entry.userId)).length !== 0) {
        throw new Error("Local E2E Storage cleanup did not complete.");
      }
      if (shouldStop()) return false;
    }

    const currentUser = confirmCurrentAuthUser(
      await listLocalE2EUsers(admin),
      entry,
      true,
    );
    if (shouldStop()) return false;
    if (currentUser) {
      let response;
      try {
        response = await admin.auth.admin.deleteUser(entry.userId);
      } catch {
        throw new Error("Local E2E Auth delete response did not match verified ownership.");
      }
      confirmDeleteResponse(response, entry);
      const usersAfterDelete = await listLocalE2EUsers(admin);
      if (usersAfterDelete.some((user) => user?.id === entry.userId)) {
        throw new Error("Local E2E Auth cleanup did not complete.");
      }
    }

    remaining = remaining.slice(1);
    checkpointRegistryOwnership(remaining);
  }
  return true;
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
    await verifyLocalAuthSettings(bindings, apiUrl);
    if (receivedSignal) return signalExitCode(receivedSignal);

    ensureRegistryDirectory();
    const runScope = allocateRunScope();
    const staleOwnership = readRegistryOwnership();
    const staleCleanupComplete = await deleteRegisteredUsers(
      bindings,
      apiUrl,
      staleOwnership,
      () => Boolean(receivedSignal),
    );
    if (!staleCleanupComplete) return signalExitCode(receivedSignal);
    if (receivedSignal) return signalExitCode(receivedSignal);
    createRegistryFile();

    const playwright = await runPlaywright({
      ...process.env,
      ...bindings,
      E2E_EMAIL_REGISTRY_FILE: registryFile,
      E2E_RUN_SCOPE: runScope,
      INTEGRATION_TEST_BINDINGS: "true",
    });
    if (receivedSignal) return signalExitCode(receivedSignal);
    if (playwright.signal || playwright.code !== 0) {
      return playwright.signal ? 1 : (playwright.code ?? 1);
    }

    const currentOwnership = readRegistryOwnership();
    const currentCleanupComplete = await deleteRegisteredUsers(
      bindings,
      apiUrl,
      currentOwnership,
      () => Boolean(receivedSignal),
    );
    if (!currentCleanupComplete) return signalExitCode(receivedSignal);
    if (receivedSignal) return signalExitCode(receivedSignal);
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
