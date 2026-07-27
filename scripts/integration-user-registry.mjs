import { randomUUID } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const integrationRunLockHost = "127.0.0.1";
const integrationRunLockPort = 47653;
const reservedIntegrationEmail =
  /^integration-[0-9a-f]{16}-[0-9]+@integration\.daily-attention\.invalid$/u;
const userIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * @typedef {{ userId: string, email: string }} IntegrationOwnership
 */

export function integrationRegistryPaths() {
  const registryDirectory = join(
    tmpdir(),
    "ai-learning-checkin-email-auth-integration-registry",
  );
  return {
    registryDirectory,
    registryFile: join(registryDirectory, "users"),
  };
}

export function localIntegrationApiUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Integration tests require a valid local Supabase API URL.");
  }
  if (
    url.protocol !== "http:"
    || !new Set(["127.0.0.1", "::1", "[::1]", "localhost"]).has(url.hostname)
  ) {
    throw new Error("Integration tests refuse a non-local Supabase URL.");
  }
  return url;
}

export async function acquireIntegrationRunLock() {
  const listener = createServer((socket) => socket.destroy());
  let listenerFailed = false;

  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        listener.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        listener.off("error", onError);
        listener.on("error", () => {
          listenerFailed = true;
        });
        listener.unref();
        resolve();
      };

      listener.once("error", onError);
      listener.once("listening", onListening);
      listener.listen({
        exclusive: true,
        host: integrationRunLockHost,
        port: integrationRunLockPort,
      });
    });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EADDRINUSE") {
      throw new Error("An integration test run is already active.");
    }
    throw new Error("Unable to acquire the integration test run lock.");
  }

  let releasePromise;
  return () => {
    if (releasePromise) return releasePromise;
    releasePromise = new Promise((resolve, reject) => {
      try {
        listener.close((error) => {
          if (error || listenerFailed) {
            reject(new Error("Unable to release the integration test run lock."));
            return;
          }
          resolve();
        });
      } catch {
        reject(new Error("Unable to release the integration test run lock."));
      }
    });
    return releasePromise;
  };
}

function ensureRegistryDirectory(registryFile) {
  const registryDirectory = dirname(registryFile);
  mkdirSync(registryDirectory, { mode: 0o700, recursive: true });
  const metadata = lstatSync(registryDirectory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Invalid integration ownership registry directory.");
  }
  chmodSync(registryDirectory, 0o700);
}

function validateOwnershipEntry(value) {
  return (
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === "email,userId"
    && typeof value.userId === "string"
    && userIdPattern.test(value.userId)
    && typeof value.email === "string"
    && reservedIntegrationEmail.test(value.email)
  );
}

function validateOwnership(ownership) {
  const byUserId = new Map();
  const byEmail = new Map();
  for (const entry of ownership) {
    if (
      !validateOwnershipEntry(entry)
      || byUserId.has(entry.userId)
      || byEmail.has(entry.email)
    ) {
      throw new Error("Invalid integration ownership registry.");
    }
    byUserId.set(entry.userId, entry.email);
    byEmail.set(entry.email, entry.userId);
  }
}

export function readIntegrationUserRegistry(registryFile) {
  let contents;
  try {
    const directoryMetadata = lstatSync(dirname(registryFile));
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
      throw new Error("Invalid integration ownership registry directory.");
    }
    chmodSync(dirname(registryFile), 0o700);

    const metadata = lstatSync(registryFile);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("Invalid integration ownership registry.");
    }
    chmodSync(registryFile, 0o600);
    contents = readFileSync(registryFile, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }

  if (!contents || !contents.endsWith("\n")) {
    throw new Error("Invalid integration ownership registry.");
  }
  const ownership = contents.slice(0, -1).split("\n").map((line) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error("Invalid integration ownership registry.");
    }
    if (!validateOwnershipEntry(value)) {
      throw new Error("Invalid integration ownership registry.");
    }
    return { userId: value.userId, email: value.email };
  });
  validateOwnership(ownership);
  return ownership;
}

function removeRegistryFile(registryFile) {
  try {
    const metadata = lstatSync(registryFile);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("Invalid integration ownership registry.");
    }
    rmSync(registryFile);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
  }
}

export function checkpointIntegrationUserRegistry(registryFile, ownership) {
  validateOwnership(ownership);
  if (ownership.length === 0) {
    removeRegistryFile(registryFile);
    return;
  }

  ensureRegistryDirectory(registryFile);
  try {
    const metadata = lstatSync(registryFile);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("Invalid integration ownership registry.");
    }
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
  }

  const temporaryFile = join(
    dirname(registryFile),
    `users.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(
      temporaryFile,
      `${ownership.map((entry) => JSON.stringify({
        userId: entry.userId,
        email: entry.email,
      })).join("\n")}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    chmodSync(temporaryFile, 0o600);
    renameSync(temporaryFile, registryFile);
  } finally {
    rmSync(temporaryFile, { force: true });
  }
}

export function trackIntegrationUserInRegistry(registryFile, entry) {
  if (!validateOwnershipEntry(entry)) {
    throw new Error("Cannot track invalid integration ownership.");
  }
  const ownership = readIntegrationUserRegistry(registryFile);
  if (
    ownership.some((owned) => (
      owned.userId === entry.userId
      || owned.email === entry.email
    ))
  ) {
    throw new Error("Conflicting integration ownership.");
  }
  checkpointIntegrationUserRegistry(registryFile, [...ownership, entry]);
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

function isCurrentOwnerResult(value, entry) {
  return (
    isRecord(value)
    && hasOwn(value, "data")
    && hasOwn(value, "error")
    && value.error === null
    && isRecord(value.data)
    && hasOwn(value.data, "user")
    && isRecord(value.data.user)
    && value.data.user.id === entry.userId
    && value.data.user.email === entry.email
  );
}

async function readCurrentOwner(admin, entry) {
  let response;
  try {
    response = await admin.auth.admin.getUserById(entry.userId);
  } catch {
    throw new Error("Integration cleanup ownership does not match the current Auth user.");
  }
  if (isMissingUserResult(response)) return null;
  if (!isCurrentOwnerResult(response, entry)) {
    throw new Error("Integration cleanup ownership does not match the current Auth user.");
  }
  return response.data.user;
}

async function verifyUserAbsent(admin, entry) {
  let response;
  try {
    response = await admin.auth.admin.getUserById(entry.userId);
  } catch {
    throw new Error("Unable to verify integration Auth cleanup.");
  }
  if (isMissingUserResult(response)) return;
  if (isCurrentOwnerResult(response, entry)) {
    throw new Error("Integration Auth cleanup did not complete.");
  }
  throw new Error("Unable to verify integration Auth cleanup.");
}

function isSuccessfulDeleteResult(value) {
  return isRecord(value) && hasOwn(value, "error") && value.error === null;
}

/**
 * @param {unknown} admin
 * @param {ReadonlyArray<IntegrationOwnership>} ownership
 * @param {(remaining: ReadonlyArray<IntegrationOwnership>) => void} [checkpoint]
 */
export async function deleteOwnedIntegrationUsers(
  admin,
  ownership,
  checkpoint = () => {},
) {
  validateOwnership(ownership);
  let remaining = [...ownership];
  while (remaining.length > 0) {
    const entry = remaining[0];
    const existing = await readCurrentOwner(admin, entry);
    if (existing) {
      const current = await readCurrentOwner(admin, entry);
      if (current) {
        let response;
        try {
          response = await admin.auth.admin.deleteUser(entry.userId);
        } catch {
          throw new Error("Unable to delete an owned integration user.");
        }
        if (!isSuccessfulDeleteResult(response)) {
          throw new Error("Unable to delete an owned integration user.");
        }
        await verifyUserAbsent(admin, entry);
      }
    }
    remaining = remaining.slice(1);
    checkpoint(remaining);
  }
}

export async function cleanupIntegrationUserRegistry(admin, registryFile) {
  const ownership = readIntegrationUserRegistry(registryFile);
  await deleteOwnedIntegrationUsers(
    admin,
    ownership,
    (remaining) => checkpointIntegrationUserRegistry(registryFile, remaining),
  );
}
