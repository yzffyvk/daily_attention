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
const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
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

function isCanonicalCalendarDate(value) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!parts) return false;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

async function listOwnedStoragePaths(userId) {
  if (!userIdPattern.test(userId)) {
    throw new Error("Invalid E2E Storage ownership.");
  }
  const query = `
    select
      objects.bucket_id,
      objects.name,
      objects.owner_id,
      exists (
        select 1
        from public.check_ins check_ins
        where check_ins.user_id = '${userId}'
          and check_ins.image_path = objects.name
      ) as has_check_in_reference,
      exists (
        select 1
        from private.storage_upload_reservations reservations
        where reservations.user_id = '${userId}'
          and reservations.path = objects.name
      ) as has_reservation_reference,
      (
        exists (
          select 1
          from public.check_ins check_ins
          where check_ins.user_id <> '${userId}'
            and check_ins.image_path = objects.name
        )
        or exists (
          select 1
          from private.storage_upload_reservations reservations
          where reservations.user_id <> '${userId}'
            and reservations.path = objects.name
        )
      ) as has_conflicting_reference
    from storage.objects objects
    where (
      objects.owner_id = '${userId}'
      or objects.name like '${userId}/%'
    )
    order by objects.name;
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

  const ownedPathPattern = new RegExp(
    `^${userId}/([0-9]{4}-[0-9]{2}-[0-9]{2})/` +
    "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$",
    "u",
  );
  const paths = [];
  const seenPaths = new Set();
  for (const row of result.rows) {
    const pathMatch = typeof row?.name === "string" ? ownedPathPattern.exec(row.name) : null;
    if (
      !row
      || typeof row !== "object"
      || Array.isArray(row)
      || Object.keys(row).sort().join(",")
        !== "bucket_id,has_check_in_reference,has_conflicting_reference,has_reservation_reference,name,owner_id"
      || row.bucket_id !== checkInImageBucket
      || (typeof row.owner_id !== "string" && row.owner_id !== null)
      || typeof row.has_check_in_reference !== "boolean"
      || typeof row.has_reservation_reference !== "boolean"
      || typeof row.has_conflicting_reference !== "boolean"
      || typeof row.name !== "string"
      || !pathMatch
      || !isCanonicalCalendarDate(pathMatch[1])
      || row.has_conflicting_reference
      || (
        row.owner_id !== userId
        && (
          row.owner_id !== null
          || (!row.has_check_in_reference && !row.has_reservation_reference)
        )
      )
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

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isMissingUserResult(value) {
  return (
    isRecord(value)
    && hasOwn(value, "data")
    && hasOwn(value, "error")
    && isRecord(value.data)
    && hasOwn(value.data, "user")
    && value.data.user === null
    && isRecord(value.error)
    && hasOwn(value.error, "status")
    && value.error.status === 404
    && hasOwn(value.error, "code")
    && value.error.code === "user_not_found"
  );
}

function isSuccessfulDeleteResult(response) {
  return (
    response
    && typeof response === "object"
    && !Array.isArray(response)
    && Object.prototype.hasOwnProperty.call(response, "error")
    && response.error === null
  );
}

async function readCurrentAuthUser(admin, entry, allowMissing) {
  let response;
  try {
    response = await admin.auth.admin.getUserById(entry.userId);
  } catch {
    throw new Error("Unable to verify local E2E Auth cleanup.");
  }
  if (isMissingUserResult(response)) {
    if (allowMissing) return null;
    throw new Error("Local E2E ownership cannot be verified against Auth.");
  }
  if (
    !isRecord(response)
    || !hasOwn(response, "data")
    || !hasOwn(response, "error")
    || response.error !== null
    || !isRecord(response.data)
    || !hasOwn(response.data, "user")
    || !isRecord(response.data.user)
    || typeof response.data.user.id !== "string"
    || !userIdPattern.test(response.data.user.id)
    || response.data.user.id !== entry.userId
  ) {
    throw new Error("Unable to verify local E2E Auth cleanup.");
  }
  const user = response.data.user;
  const email = reservedE2EAuthEmail(user.email);
  if (email !== entry.email) {
    throw new Error("Local E2E ownership no longer matches the current Auth email.");
  }
  return user;
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
      await readCurrentAuthUser(admin, entry, false);
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

    const currentUser = await readCurrentAuthUser(admin, entry, true);
    if (shouldStop()) return false;
    if (currentUser) {
      let response;
      try {
        response = await admin.auth.admin.deleteUser(entry.userId);
      } catch {
        throw new Error("Unable to delete a local E2E user.");
      }
      if (!isSuccessfulDeleteResult(response)) {
        throw new Error("Unable to delete a local E2E user.");
      }
      if (await readCurrentAuthUser(admin, entry, true)) {
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
