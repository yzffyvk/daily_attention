import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const TARGET_PROJECT_REF = "jhiybzdvxvlkbqvamynp";

const TARGET_SUPABASE_URL = `https://${TARGET_PROJECT_REF}.supabase.co`;
const IMAGE_BUCKET = "checkin-images";
const AUTH_PAGE_SIZE = 1000;
const STORAGE_PAGE_SIZE = 100;
const REQUIRED_ZERO_SNAPSHOTS = 2;

class ResetScriptError extends Error {}

function fail(code) {
  throw new ResetScriptError(code);
}

export function validateTarget({ projectRef, supabaseUrl }) {
  if (projectRef !== TARGET_PROJECT_REF || supabaseUrl !== TARGET_SUPABASE_URL) {
    fail("PROJECT_REF_MISMATCH");
  }

  let url;
  try {
    url = new URL(supabaseUrl);
  } catch {
    fail("PROJECT_REF_MISMATCH");
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== `${TARGET_PROJECT_REF}.supabase.co` ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    fail("PROJECT_REF_MISMATCH");
  }

  return true;
}

export function parseArguments(argv) {
  let apply = false;
  let projectRef;

  for (const argument of argv) {
    if (argument === "--apply") {
      if (apply) fail("INVALID_ARGUMENTS");
      apply = true;
      continue;
    }

    if (argument.startsWith("--project-ref=")) {
      if (projectRef !== undefined) fail("INVALID_ARGUMENTS");
      projectRef = argument.slice("--project-ref=".length);
      continue;
    }

    fail("INVALID_ARGUMENTS");
  }

  if (!projectRef) fail("PROJECT_REF_REQUIRED");
  return { apply, projectRef };
}

async function countTable(client, table, errorCode) {
  let response;
  try {
    response = await client.from(table).select("*", {
      count: "exact",
      head: true,
    });
  } catch {
    fail("RESET_FAILED");
  }

  if (response.error) fail("RESET_FAILED");
  if (!Number.isSafeInteger(response.count) || response.count < 0) fail(errorCode);
  return response.count;
}

async function listAuthUserIds(client) {
  const userIds = new Set();
  const visitedPages = new Set();
  let page = 1;

  while (page !== null) {
    if (visitedPages.has(page)) fail("AUTH_PAGINATION_FAILED");
    visitedPages.add(page);

    let response;
    try {
      response = await client.auth.admin.listUsers({
        page,
        perPage: AUTH_PAGE_SIZE,
      });
    } catch {
      fail("RESET_FAILED");
    }
    if (response.error) fail("RESET_FAILED");
    if (!response.data || !Array.isArray(response.data.users)) fail("AUTH_LIST_FAILED");

    for (const user of response.data.users) {
      if (!user || typeof user.id !== "string" || user.id.length === 0) {
        fail("AUTH_LIST_FAILED");
      }
      userIds.add(user.id);
    }

    if (response.data.nextPage === null || response.data.nextPage === undefined) {
      page = null;
    } else if (Number.isSafeInteger(response.data.nextPage) && response.data.nextPage > 0) {
      page = response.data.nextPage;
    } else {
      fail("AUTH_PAGINATION_FAILED");
    }
  }

  return [...userIds];
}

export async function countAuthUsers(client) {
  return (await listAuthUserIds(client)).length;
}

export async function countStorageObjects(
  client,
  { bucket = IMAGE_BUCKET, pageSize = STORAGE_PAGE_SIZE } = {},
) {
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) fail("STORAGE_COUNT_FAILED");

  const storage = client.storage.from(bucket);
  const pendingPrefixes = [""];
  const queuedPrefixes = new Set(pendingPrefixes);
  let count = 0;

  while (pendingPrefixes.length > 0) {
    const prefix = pendingPrefixes.shift();
    let offset = 0;

    while (true) {
      let response;
      try {
        response = await storage.list(prefix, {
          limit: pageSize,
          offset,
          sortBy: { column: "name", order: "asc" },
        });
      } catch {
        fail("RESET_FAILED");
      }
      if (response.error) fail("RESET_FAILED");
      if (!Array.isArray(response.data)) fail("STORAGE_COUNT_FAILED");

      for (const object of response.data) {
        if (!object || typeof object.name !== "string" || object.name.length === 0) {
          fail("STORAGE_COUNT_FAILED");
        }

        if (object.id === null) {
          const childPrefix = prefix ? `${prefix}/${object.name}` : object.name;
          if (!queuedPrefixes.has(childPrefix)) {
            queuedPrefixes.add(childPrefix);
            pendingPrefixes.push(childPrefix);
          }
        } else if (typeof object.id === "string" && object.id.length > 0) {
          count += 1;
        } else {
          fail("STORAGE_COUNT_FAILED");
        }
      }

      if (response.data.length < pageSize) break;
      offset += pageSize;
    }
  }

  return count;
}

export function formatCounts({ users, profiles, checkIns, images }) {
  return [`users=${users}`, `profiles=${profiles}`, `check_ins=${checkIns}`, `images=${images}`];
}

async function inspectLegacyData(client) {
  const [profiles, checkIns, userIds, images] = await Promise.all([
    countTable(client, "profiles", "PROFILE_COUNT_FAILED"),
    countTable(client, "check_ins", "CHECK_IN_COUNT_FAILED"),
    listAuthUserIds(client),
    countStorageObjects(client),
  ]);

  return {
    counts: {
      users: userIds.length,
      profiles,
      checkIns,
      images,
    },
    userIds,
  };
}

function writeCounts(counts, writeLine) {
  for (const line of formatCounts(counts)) writeLine(line);
}

function countsAreZero(counts) {
  return Object.values(counts).every((count) => count === 0);
}

export async function runReset({ apply = false, client, writeLine = console.log }) {
  const before = await inspectLegacyData(client);
  writeCounts(before.counts, writeLine);

  if (!apply) return before.counts;

  let mutationFailed = false;
  let storageEmptied = false;

  try {
    const result = await client.storage.emptyBucket(IMAGE_BUCKET);
    if (result && result.error === null) {
      storageEmptied = true;
    } else {
      mutationFailed = true;
    }
  } catch {
    mutationFailed = true;
  }

  if (storageEmptied) {
    for (const userId of before.userIds) {
      try {
        const result = await client.auth.admin.deleteUser(userId);
        if (!result || result.error !== null) mutationFailed = true;
      } catch {
        mutationFailed = true;
      }
    }
  }

  const verificationCounts = [];
  let verificationError;
  for (let snapshot = 0; snapshot < REQUIRED_ZERO_SNAPSHOTS; snapshot += 1) {
    try {
      const verification = await inspectLegacyData(client);
      verificationCounts.push(verification.counts);
      writeCounts(verification.counts, writeLine);
    } catch (error) {
      verificationError ??= error;
    }
  }

  if (verificationError && !mutationFailed) throw verificationError;

  if (
    mutationFailed ||
    verificationCounts.length !== REQUIRED_ZERO_SNAPSHOTS ||
    verificationCounts.some((counts) => !countsAreZero(counts))
  ) {
    fail("RESET_INCOMPLETE");
  }

  return verificationCounts.at(-1);
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  createSupabaseClient = createClient,
  writeLine = console.log,
} = {}) {
  const { apply, projectRef } = parseArguments(argv);
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !secretKey) fail("SUPABASE_ENV_REQUIRED");
  validateTarget({ projectRef, supabaseUrl });

  const client = createSupabaseClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return runReset({ apply, client, writeLine });
}

function publicError(error) {
  if (error instanceof ResetScriptError) return error.message;
  return "RESET_FAILED";
}

export async function runCli(options = {}) {
  const { writeError = console.error, ...mainOptions } = options;
  try {
    await main(mainOptions);
    return 0;
  } catch (error) {
    writeError(publicError(error));
    return 1;
  }
}

const isDirectExecution =
  typeof process.argv[1] === "string" && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectExecution) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
