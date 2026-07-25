import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const TARGET_PROJECT_REF = "jhiybzdvxvlkbqvamynp";

const IMAGE_BUCKET = "checkin-images";
const AUTH_PAGE_SIZE = 1000;
const STORAGE_PAGE_SIZE = 100;

function fail(code) {
  throw new Error(code);
}

export function validateTarget({ projectRef, supabaseUrl }) {
  let url;
  try {
    url = new URL(supabaseUrl);
  } catch {
    fail("PROJECT_REF_MISMATCH");
  }

  if (
    projectRef !== TARGET_PROJECT_REF ||
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
  const { count, error } = await client.from(table).select("*", {
    count: "exact",
    head: true,
  });

  if (error || !Number.isSafeInteger(count) || count < 0) fail(errorCode);
  return count;
}

async function listAuthUserIds(client) {
  const userIds = [];
  const visitedPages = new Set();
  let page = 1;

  while (page !== null) {
    if (visitedPages.has(page)) fail("AUTH_PAGINATION_FAILED");
    visitedPages.add(page);

    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: AUTH_PAGE_SIZE,
    });
    if (error || !data || !Array.isArray(data.users)) fail("AUTH_LIST_FAILED");

    for (const user of data.users) {
      if (!user || typeof user.id !== "string" || user.id.length === 0) {
        fail("AUTH_LIST_FAILED");
      }
      userIds.push(user.id);
    }

    if (data.nextPage === null || data.nextPage === undefined) {
      page = null;
    } else if (Number.isSafeInteger(data.nextPage) && data.nextPage > 0) {
      page = data.nextPage;
    } else {
      fail("AUTH_PAGINATION_FAILED");
    }
  }

  return userIds;
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
      const { data, error } = await storage.list(prefix, {
        limit: pageSize,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error || !Array.isArray(data)) fail("STORAGE_COUNT_FAILED");

      for (const object of data) {
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

      if (data.length < pageSize) break;
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

export async function runReset({ apply = false, client, writeLine = console.log }) {
  const before = await inspectLegacyData(client);
  writeCounts(before.counts, writeLine);

  if (!apply) return before.counts;

  const { error: emptyError } = await client.storage.emptyBucket(IMAGE_BUCKET);
  if (emptyError) fail("STORAGE_EMPTY_FAILED");

  for (const userId of before.userIds) {
    const { error } = await client.auth.admin.deleteUser(userId);
    if (error) fail("AUTH_DELETE_FAILED");
  }

  const after = await inspectLegacyData(client);
  writeCounts(after.counts, writeLine);

  if (Object.values(after.counts).some((count) => count !== 0)) {
    fail("RESET_INCOMPLETE");
  }

  return after.counts;
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
  if (error instanceof Error && /^[A-Z_]+$/u.test(error.message)) return error.message;
  return "RESET_FAILED";
}

const isDirectExecution =
  typeof process.argv[1] === "string" && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(publicError(error));
    process.exitCode = 1;
  });
}
