// @vitest-environment node

import { spawn } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories = new Set<string>();
const servers = new Set<Server>();
const children = new Set<ReturnType<typeof spawn>>();

const fakeNpx = `#!/usr/bin/env node
const { appendFileSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
const loggedArgs = args[0] === "supabase" && args[1] === "db" && args[2] === "query"
  ? args.slice(0, 3)
  : args;
appendFileSync(process.env.FAKE_NPX_LOG, JSON.stringify(loggedArgs) + "\\n");

(async () => {
  if (args[0] === "supabase" && args[1] === "status") {
    console.log("API_URL=" + JSON.stringify(process.env.FAKE_API_URL));
    console.log('PUBLISHABLE_KEY="local-publishable"');
    console.log('SECRET_KEY="local-secret"');
    process.exit(0);
  }

  if (args[0] === "supabase" && args[1] === "db" && args[2] === "query") {
    const sql = args.at(-1) || "";
    const userId = sql.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0];
    if (!userId) process.exit(14);
    const response = await fetch(process.env.FAKE_API_URL + "/test/storage-query", {
      body: JSON.stringify({ userId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) process.exit(15);
    const rows = await response.json();
    console.log(JSON.stringify({ boundary: "test-boundary", rows, warning: "test-warning" }));
    process.exit(0);
  }

  if (args[0] === "playwright" && args[1] === "test") {
    if (process.env.FAKE_RUN_SCOPE_LOG) {
      appendFileSync(process.env.FAKE_RUN_SCOPE_LOG, process.env.E2E_RUN_SCOPE + "\\n");
    }
    if (process.env.FAKE_REGISTER_EMAIL) {
      const response = await fetch(process.env.FAKE_API_URL + "/test/register", {
        body: JSON.stringify({ email: process.env.FAKE_REGISTER_EMAIL }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) process.exit(12);
      const { id } = await response.json();
      appendFileSync(
        process.env.E2E_EMAIL_REGISTRY_FILE,
        JSON.stringify({ userId: id, email: process.env.FAKE_REGISTER_EMAIL }) + "\\n",
      );
    }
    if (process.env.FAKE_PLAYWRIGHT_MARKER) {
      writeFileSync(process.env.FAKE_PLAYWRIGHT_MARKER, String(process.pid));
    }
    const hold = Number(process.env.FAKE_PLAYWRIGHT_HOLD_MS || 0);
    const exitCode = Number(process.env.FAKE_PLAYWRIGHT_EXIT || 0);
    setTimeout(() => process.exit(exitCode), hold);
    return;
  }

  process.exit(2);
})().catch((error) => {
  console.error(error);
  process.exit(13);
});
`;

type RunnerResult = { code: number | null; signal: NodeJS.Signals | null; stderr: string; stdout: string };
type FakeUser = { id: string; email: string };
type FakeStorageObject = { bucketId: string; ownerId: string | null; path: string };

const staleUser: FakeUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "email-1-0000-0-0-0@e2e.daily-attention.invalid",
};
const secondStaleUser: FakeUser = {
  id: "00000000-0000-4000-8000-000000000003",
  email: "email-1-0000-0-0-1@e2e.daily-attention.invalid",
};
const localDeveloper: FakeUser = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "local-developer@integration.daily-attention.invalid",
};
const createdUserId = "00000000-0000-4000-8000-000000000010";

function ownershipLine(user: FakeUser) {
  return `${JSON.stringify({ userId: user.id, email: user.email })}\n`;
}

function deletingOwnershipLine(user: FakeUser) {
  return `${JSON.stringify({ userId: user.id, email: user.email, state: "deleting" })}\n`;
}

async function fixture(
  initialUsers: FakeUser[] = [],
  initialStorageObjects: FakeStorageObject[] = [],
) {
  const directory = await mkdtemp(join(tmpdir(), "e2e-runner-test-"));
  temporaryDirectories.add(directory);
  const bin = join(directory, "bin");
  const npx = join(bin, "npx");
  const users = new Map(initialUsers.map((user) => [user.id, user]));
  const storageObjects = new Map(initialStorageObjects.map((object) => [object.path, object]));
  const deletedEmails: string[] = [];
  const cleanup = {
    ambiguousStorageRemoval: false,
    delayMs: 0,
    deleteFailureIds: new Set<string>(),
    deleteResponseUser: undefined as FakeUser | null | undefined,
    failPostDeleteList: false,
    malformedPostDeleteList: false,
    marker: "",
    retainDeletedUserIds: new Set<string>(),
  };
  const authSettings = {
    disable_signup: true,
    external: {
      email: true,
      phone: false,
    },
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/auth/v1/settings") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(authSettings));
      return;
    }
    if (request.method === "GET" && url.pathname === "/auth/v1/admin/users") {
      if (cleanup.marker) void writeFile(cleanup.marker, "cleanup");
      if (deletedEmails.length > 0 && cleanup.failPostDeleteList) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: "test post-delete list failure" }));
        return;
      }
      const page = Number(url.searchParams.get("page") || 1);
      const perPage = Number(url.searchParams.get("per_page") || 1000);
      const allUsers = deletedEmails.length > 0 && cleanup.malformedPostDeleteList
        ? [{}]
        : [...users.values()];
      const selected = allUsers.slice((page - 1) * perPage, page * perPage);
      setTimeout(() => {
        response.writeHead(200, {
          "content-type": "application/json",
          "x-total-count": String(allUsers.length),
        });
        response.end(JSON.stringify({ users: selected }));
      }, cleanup.delayMs);
      return;
    }
    if (request.method === "DELETE" && url.pathname.startsWith("/auth/v1/admin/users/")) {
      const id = url.pathname.split("/").at(-1) ?? "";
      if (cleanup.deleteFailureIds.has(id)) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: "test delete failure" }));
        return;
      }
      const user = users.get(id);
      if (user) {
        deletedEmails.push(user.email);
        if (!cleanup.retainDeletedUserIds.has(id)) users.delete(id);
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(
        cleanup.deleteResponseUser === undefined
          ? (user ?? { id })
          : cleanup.deleteResponseUser,
      ));
      return;
    }
    if (request.method === "POST" && url.pathname === "/test/storage-query") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const userId = (JSON.parse(body) as { userId: string }).userId;
        const rows = [...storageObjects.values()]
          .filter((object) => (
            object.bucketId === "checkin-images"
            && (object.ownerId === userId || object.path.startsWith(`${userId}/`))
          ))
          .map((object) => ({
            bucket_id: object.bucketId,
            name: object.path,
            owner_id: object.ownerId,
          }));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(rows));
      });
      return;
    }
    if (request.method === "DELETE" && url.pathname === "/storage/v1/object/checkin-images") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const prefixes = (JSON.parse(body) as { prefixes?: unknown }).prefixes;
        if (!Array.isArray(prefixes) || prefixes.some((path) => typeof path !== "string")) {
          response.writeHead(422, { "content-type": "application/json" });
          response.end("{}");
          return;
        }
        if (cleanup.ambiguousStorageRemoval) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end("[]");
          return;
        }
        const removed = prefixes.flatMap((path) => {
          const object = storageObjects.get(path);
          if (!object) return [];
          storageObjects.delete(path);
          return [{
            bucket_id: object.bucketId,
            id: `storage-${storageObjects.size}`,
            name: object.path,
          }];
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(removed));
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/test/register") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const email = (JSON.parse(body) as { email: string }).email;
        const collision = [...users.values()].some((user) => user.email === email);
        if (collision) {
          response.writeHead(409, { "content-type": "application/json" });
          response.end("{}");
          return;
        }
        const id = `00000000-0000-4000-8000-${String(users.size + 10).padStart(12, "0")}`;
        users.set(id, { id, email });
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ id }));
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  servers.add(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake Supabase did not bind a TCP port");
  const apiUrl = `http://127.0.0.1:${address.port}`;

  await mkdir(bin);
  await writeFile(npx, fakeNpx);
  await chmod(npx, 0o755);
  const registryDirectory = join(directory, "ai-learning-checkin-email-auth-e2e-registry");
  return {
    apiUrl,
    cleanup,
    authSettings,
    deletedEmails,
    directory,
    lock: join(directory, "ai-learning-checkin-email-auth-e2e.lock"),
    log: join(directory, "npx.log"),
    marker: join(directory, "playwright.pid"),
    registryDirectory,
    registryFile: join(registryDirectory, "emails"),
    scopeLog: join(directory, "run-scopes.log"),
    storageObjects,
    users,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      TMPDIR: directory,
      TMP: directory,
      TEMP: directory,
      FAKE_API_URL: apiUrl,
      FAKE_NPX_LOG: join(directory, "npx.log"),
    },
  };
}

async function writeRegistry(setup: Awaited<ReturnType<typeof fixture>>, contents: string) {
  await mkdir(setup.registryDirectory, { recursive: true });
  await writeFile(setup.registryFile, contents);
}

function startRunner(env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, ["scripts/run-e2e-tests.mjs"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const result = new Promise<RunnerResult>((resolve) => {
    child.once("exit", (code, signal) => {
      children.delete(child);
      resolve({ code, signal, stderr, stdout });
    });
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
  if (!existsSync(path)) return [];
  return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
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
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  children.clear();
  await Promise.all([...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  servers.clear();
  await Promise.all([...temporaryDirectories].map((directory) => rm(directory, { force: true, recursive: true })));
  temporaryDirectories.clear();
});

describe("E2E runner isolation", () => {
  it("allocates distinct scopes to consecutive runs", async () => {
    const setup = await fixture();
    const env = {
      ...setup.env,
      FAKE_RUN_SCOPE_LOG: setup.scopeLog,
    };

    expect((await runRunner(env)).code).toBe(0);
    expect((await runRunner(env)).code).toBe(0);

    const scopes = (await readFile(setup.scopeLog, "utf8")).trim().split("\n");
    expect(scopes).toHaveLength(2);
    expect(scopes[0]).toMatch(/^[0-9]{4}$/u);
    expect(scopes[1]).toMatch(/^[0-9]{4}$/u);
    expect(scopes[1]).not.toBe(scopes[0]);
  });

  it("fails closed on an unconfirmed reserved-email collision", async () => {
    const setup = await fixture([staleUser]);
    await writeRegistry(setup, "email-1-0000-0-0-0@e2e.daily-attention.invalid\n");

    const result = await runRunner(setup.env);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("unconfirmed E2E ownership");
    expect(setup.deletedEmails).toEqual([]);
    expect([...setup.users.values()]).toEqual([staleUser]);
    expect(await readFile(setup.registryFile, "utf8")).toBe("email-1-0000-0-0-0@e2e.daily-attention.invalid\n");
    expect(await commandLog(setup.log)).toEqual([["supabase", "status", "-o", "env"]]);
  });

  it("cleans only registry users on the default path and never resets the local database", async () => {
    const setup = await fixture([staleUser, localDeveloper]);
    await writeRegistry(setup, ownershipLine(staleUser));

    const result = await runRunner({
      ...setup.env,
      FAKE_REGISTER_EMAIL: "email-1-0000-0-0-1@e2e.daily-attention.invalid",
    });

    expect(result).toMatchObject({ code: 0, signal: null });
    expect(await commandLog(setup.log)).toEqual([
      ["supabase", "status", "-o", "env"],
      ["supabase", "db", "query"],
      ["supabase", "db", "query"],
      ["playwright", "test"],
      ["supabase", "db", "query"],
      ["supabase", "db", "query"],
    ]);
    expect(setup.deletedEmails).toEqual([
      "email-1-0000-0-0-0@e2e.daily-attention.invalid",
      "email-1-0000-0-0-1@e2e.daily-attention.invalid",
    ]);
    expect([...setup.users.values()]).toEqual([localDeveloper]);
    expect(existsSync(setup.registryFile)).toBe(false);
  });

  it("removes stale owned images before deleting the verified Auth user", async () => {
    const image = {
      bucketId: "checkin-images",
      ownerId: staleUser.id,
      path: `${staleUser.id}/2026-07-27/00000000-0000-4000-8000-000000000020.png`,
    };
    const setup = await fixture([staleUser], [image]);
    await writeRegistry(setup, ownershipLine(staleUser));

    const result = await runRunner(setup.env);

    expect(result.code).toBe(0);
    expect(setup.storageObjects.size).toBe(0);
    expect(setup.users.has(staleUser.id)).toBe(false);
    expect(existsSync(setup.registryFile)).toBe(false);
  });

  it("refuses stale cleanup when a path-prefix object has a different owner", async () => {
    const image = {
      bucketId: "checkin-images",
      ownerId: localDeveloper.id,
      path: `${staleUser.id}/2026-07-27/00000000-0000-4000-8000-000000000020.png`,
    };
    const setup = await fixture([staleUser, localDeveloper], [image]);
    await writeRegistry(setup, ownershipLine(staleUser));

    const result = await runRunner(setup.env);

    expect(result.code).not.toBe(0);
    expect(setup.storageObjects.size).toBe(1);
    expect(setup.users.has(staleUser.id)).toBe(true);
    expect(existsSync(setup.registryFile)).toBe(true);
  });

  it("refuses stale cleanup when an owner object is outside the user path prefix", async () => {
    const image = {
      bucketId: "checkin-images",
      ownerId: staleUser.id,
      path: `${localDeveloper.id}/2026-07-27/00000000-0000-4000-8000-000000000020.png`,
    };
    const setup = await fixture([staleUser, localDeveloper], [image]);
    await writeRegistry(setup, ownershipLine(staleUser));

    const result = await runRunner(setup.env);

    expect(result.code).not.toBe(0);
    expect(setup.storageObjects.size).toBe(1);
    expect(setup.users.has(staleUser.id)).toBe(true);
    expect(existsSync(setup.registryFile)).toBe(true);
  });

  it("retains Auth ownership and the registry on an ambiguous Storage removal", async () => {
    const image = {
      bucketId: "checkin-images",
      ownerId: staleUser.id,
      path: `${staleUser.id}/2026-07-27/00000000-0000-4000-8000-000000000020.png`,
    };
    const setup = await fixture([staleUser], [image]);
    setup.cleanup.ambiguousStorageRemoval = true;
    await writeRegistry(setup, ownershipLine(staleUser));

    const result = await runRunner(setup.env);

    expect(result.code).not.toBe(0);
    expect(setup.storageObjects.size).toBe(1);
    expect(setup.users.has(staleUser.id)).toBe(true);
    expect(existsSync(setup.registryFile)).toBe(true);
  });

  it("retains the registry when its Auth owner is missing", async () => {
    const image = {
      bucketId: "checkin-images",
      ownerId: staleUser.id,
      path: `${staleUser.id}/2026-07-27/00000000-0000-4000-8000-000000000020.png`,
    };
    const setup = await fixture([], [image]);
    await writeRegistry(setup, ownershipLine(staleUser));

    const result = await runRunner(setup.env);

    expect(result.code).not.toBe(0);
    expect(setup.storageObjects.size).toBe(1);
    expect(existsSync(setup.registryFile)).toBe(true);
  });

  it("rejects a successful delete response with a null user and retains a deleting checkpoint", async () => {
    const setup = await fixture([staleUser]);
    setup.cleanup.deleteResponseUser = null;
    await writeRegistry(setup, ownershipLine(staleUser));

    const result = await runRunner(setup.env);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("delete response");
    expect(result.stderr).not.toContain(staleUser.id);
    expect(result.stderr).not.toContain(staleUser.email);
    expect(await readFile(setup.registryFile, "utf8")).toBe(deletingOwnershipLine(staleUser));
  });

  it("rejects a successful delete response with a different user ID", async () => {
    const setup = await fixture([staleUser]);
    setup.cleanup.deleteResponseUser = { id: localDeveloper.id, email: staleUser.email };
    await writeRegistry(setup, ownershipLine(staleUser));

    const result = await runRunner(setup.env);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("delete response");
    expect(result.stderr).not.toContain(staleUser.id);
    expect(result.stderr).not.toContain(staleUser.email);
    expect(await readFile(setup.registryFile, "utf8")).toBe(deletingOwnershipLine(staleUser));
  });

  it("rejects a successful delete response with a different email", async () => {
    const setup = await fixture([staleUser]);
    setup.cleanup.deleteResponseUser = { id: staleUser.id, email: secondStaleUser.email };
    await writeRegistry(setup, ownershipLine(staleUser));

    const result = await runRunner(setup.env);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("delete response");
    expect(result.stderr).not.toContain(staleUser.id);
    expect(result.stderr).not.toContain(staleUser.email);
    expect(await readFile(setup.registryFile, "utf8")).toBe(deletingOwnershipLine(staleUser));
  });

  it("rejects an exact delete response when a fresh Admin list still contains the user", async () => {
    const setup = await fixture([staleUser]);
    setup.cleanup.retainDeletedUserIds.add(staleUser.id);
    await writeRegistry(setup, ownershipLine(staleUser));

    const result = await runRunner(setup.env);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Auth cleanup did not complete");
    expect(result.stderr).not.toContain(staleUser.id);
    expect(result.stderr).not.toContain(staleUser.email);
    expect(setup.users.get(staleUser.id)).toEqual(staleUser);
    expect(await readFile(setup.registryFile, "utf8")).toBe(deletingOwnershipLine(staleUser));
  });

  it("rejects a malformed fresh Admin list as proof of Auth absence", async () => {
    const setup = await fixture([staleUser]);
    setup.cleanup.malformedPostDeleteList = true;
    await writeRegistry(setup, ownershipLine(staleUser));

    const result = await runRunner(setup.env);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("invalid E2E user list");
    expect(result.stderr).not.toContain(staleUser.id);
    expect(result.stderr).not.toContain(staleUser.email);
    expect(await readFile(setup.registryFile, "utf8")).toBe(deletingOwnershipLine(staleUser));
  });

  it("checkpoints each completed user so a partial multi-user failure resumes safely", async () => {
    const setup = await fixture([staleUser, secondStaleUser]);
    setup.cleanup.deleteFailureIds.add(secondStaleUser.id);
    await writeRegistry(setup, ownershipLine(staleUser) + ownershipLine(secondStaleUser));

    const failed = await runRunner(setup.env);

    expect(failed.code).not.toBe(0);
    expect(setup.users.has(staleUser.id)).toBe(false);
    expect(setup.users.get(secondStaleUser.id)).toEqual(secondStaleUser);
    expect(await readFile(setup.registryFile, "utf8")).toBe(deletingOwnershipLine(secondStaleUser));
    expect((await stat(setup.registryFile)).mode & 0o777).toBe(0o600);

    setup.cleanup.deleteFailureIds.clear();
    const retried = await runRunner(setup.env);

    expect(retried.code).toBe(0);
    expect(setup.users.size).toBe(0);
    expect(existsSync(setup.registryFile)).toBe(false);
  });

  it("resumes a deleting checkpoint left before the Auth delete request mutates the user", async () => {
    const setup = await fixture([staleUser]);
    setup.cleanup.deleteFailureIds.add(staleUser.id);
    await writeRegistry(setup, ownershipLine(staleUser));
    const interrupted = await runRunner(setup.env);

    expect(interrupted.code).not.toBe(0);
    expect(await readFile(setup.registryFile, "utf8")).toBe(deletingOwnershipLine(staleUser));
    expect(setup.users.get(staleUser.id)).toEqual(staleUser);

    setup.cleanup.deleteFailureIds.clear();
    const retried = await runRunner(setup.env);

    expect(retried.code).toBe(0);
    expect(setup.users.size).toBe(0);
    expect(existsSync(setup.registryFile)).toBe(false);
  });

  it("removes a deleting checkpoint only after retry proves Auth and Storage absence", async () => {
    const setup = await fixture([staleUser]);
    setup.cleanup.failPostDeleteList = true;
    await writeRegistry(setup, ownershipLine(staleUser));
    const interrupted = await runRunner(setup.env);

    expect(interrupted.code).not.toBe(0);
    expect(setup.users.has(staleUser.id)).toBe(false);
    expect(await readFile(setup.registryFile, "utf8")).toBe(deletingOwnershipLine(staleUser));

    setup.cleanup.failPostDeleteList = false;
    const retried = await runRunner(setup.env);

    expect(retried.code).toBe(0);
    expect(setup.users.size).toBe(0);
    expect(setup.storageObjects.size).toBe(0);
    expect(existsSync(setup.registryFile)).toBe(false);
  });

  it("fails closed on a non-local URL and releases the lock", async () => {
    const setup = await fixture();

    const rejected = await runRunner({
      ...setup.env,
      FAKE_API_URL: "https://project.supabase.co",
    });

    expect(rejected.code).not.toBe(0);
    expect(await commandLog(setup.log)).toEqual([["supabase", "status", "-o", "env"]]);
    expect(existsSync(setup.lock)).toBe(false);
    expect((await runRunner(setup.env)).code).toBe(0);
  });

  it("fails closed before cleanup or Playwright when local Auth settings enable phone or signups", async () => {
    const setup = await fixture([staleUser]);
    setup.authSettings.external.phone = true;
    setup.authSettings.disable_signup = false;
    await writeRegistry(setup, ownershipLine(staleUser));

    const rejected = await runRunner(setup.env);

    expect(rejected.code).not.toBe(0);
    expect(rejected.stderr).toContain("Local Supabase Auth settings do not meet the E2E release gate");
    expect(setup.deletedEmails).toEqual([]);
    expect([...setup.users.values()]).toEqual([staleUser]);
    expect(await commandLog(setup.log)).toEqual([["supabase", "status", "-o", "env"]]);
  });

  it("fails closed on a corrupted registry without deleting users or starting Playwright", async () => {
    const setup = await fixture([staleUser, localDeveloper]);
    const contents = `${ownershipLine(staleUser)}not-an-ownership-record\n`;
    await writeRegistry(setup, contents);

    const rejected = await runRunner(setup.env);

    expect(rejected.code).not.toBe(0);
    expect(rejected.stderr).toContain("Invalid E2E ownership registry");
    expect(setup.deletedEmails).toEqual([]);
    expect([...setup.users.values()]).toEqual([staleUser, localDeveloper]);
    expect(await commandLog(setup.log)).toEqual([["supabase", "status", "-o", "env"]]);
    expect(await readFile(setup.registryFile, "utf8")).toBe(contents);

    await writeRegistry(setup, "");
    expect((await runRunner(setup.env)).code).toBe(0);
  });

  it("fails closed when one userId is recorded with multiple reserved emails", async () => {
    const setup = await fixture([staleUser]);
    await writeRegistry(
      setup,
      ownershipLine(staleUser) +
      '{"userId":"00000000-0000-4000-8000-000000000001","email":"email-1-0000-0-0-1@e2e.daily-attention.invalid"}\n',
    );

    const rejected = await runRunner(setup.env);

    expect(rejected.code).not.toBe(0);
    expect(rejected.stderr).toContain("Conflicting E2E ownership registry");
    expect(setup.deletedEmails).toEqual([]);
    expect([...setup.users.values()]).toEqual([staleUser]);
  });

  it("fails closed on a duplicate ownership record", async () => {
    const setup = await fixture([staleUser]);
    await writeRegistry(setup, ownershipLine(staleUser) + ownershipLine(staleUser));

    const rejected = await runRunner(setup.env);

    expect(rejected.code).not.toBe(0);
    expect(rejected.stderr).toContain("Conflicting E2E ownership registry");
    expect(setup.deletedEmails).toEqual([]);
    expect([...setup.users.values()]).toEqual([staleUser]);
  });

  it("fails closed when one reserved email is recorded for multiple userIds", async () => {
    const setup = await fixture([staleUser]);
    await writeRegistry(
      setup,
      ownershipLine(staleUser) +
      '{"userId":"00000000-0000-4000-8000-000000000003","email":"email-1-0000-0-0-0@e2e.daily-attention.invalid"}\n',
    );

    const rejected = await runRunner(setup.env);

    expect(rejected.code).not.toBe(0);
    expect(rejected.stderr).toContain("Conflicting E2E ownership registry");
    expect(setup.deletedEmails).toEqual([]);
    expect([...setup.users.values()]).toEqual([staleUser]);
  });

  it("fails closed when a registry userId no longer owns its recorded Auth email", async () => {
    const setup = await fixture([staleUser]);
    const mismatchedEmail = "email-1-0000-0-0-1@e2e.daily-attention.invalid";
    await writeRegistry(
      setup,
      `{"userId":"${staleUser.id}","email":"${mismatchedEmail}"}\n`,
    );

    const rejected = await runRunner(setup.env);

    expect(rejected.code).not.toBe(0);
    expect(rejected.stderr).toContain("ownership no longer matches");
    expect(rejected.stderr).not.toContain(staleUser.id);
    expect(rejected.stderr).not.toContain(staleUser.email);
    expect(rejected.stderr).not.toContain(mismatchedEmail);
    expect(setup.deletedEmails).toEqual([]);
    expect([...setup.users.values()]).toEqual([staleUser]);
  });

  it("rejects a concurrent run before status or cleanup", async () => {
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
    expect(await commandLog(setup.log)).toEqual([
      ["supabase", "status", "-o", "env"],
      ["playwright", "test"],
    ]);
    expect((await first.result).code).toBe(0);
  });

  it("retains the registry after Playwright failure and cleans it on the next run", async () => {
    const setup = await fixture();

    const failed = await runRunner({
      ...setup.env,
      FAKE_PLAYWRIGHT_EXIT: "8",
      FAKE_REGISTER_EMAIL: "email-1-0000-0-0-0@e2e.daily-attention.invalid",
    });

    expect(failed.code).toBe(8);
    expect(await readFile(setup.registryFile, "utf8")).toBe(
      ownershipLine({ id: createdUserId, email: "email-1-0000-0-0-0@e2e.daily-attention.invalid" }),
    );
    expect([...setup.users.values()].map((user) => user.email)).toEqual(["email-1-0000-0-0-0@e2e.daily-attention.invalid"]);

    expect((await runRunner(setup.env)).code).toBe(0);
    expect(setup.deletedEmails).toEqual(["email-1-0000-0-0-0@e2e.daily-attention.invalid"]);
    expect(setup.users.size).toBe(0);
    expect(existsSync(setup.registryFile)).toBe(false);
  });

  it("retains the registry and synchronously releases the lock when SIGTERM arrives during cleanup", async () => {
    const setup = await fixture([staleUser]);
    await writeRegistry(setup, ownershipLine(staleUser));
    setup.cleanup.delayMs = 300;
    setup.cleanup.marker = join(setup.directory, "cleanup.started");
    const first = startRunner(setup.env);
    await waitForFile(setup.cleanup.marker);

    first.child.kill("SIGTERM");
    const result = await first.result;

    expect(result).toMatchObject({ code: 143, signal: null });
    expect(existsSync(setup.lock)).toBe(false);
    expect(await readFile(setup.registryFile, "utf8")).toBe(ownershipLine(staleUser));
    expect(setup.users.has(staleUser.id)).toBe(true);

    setup.cleanup.delayMs = 0;
    setup.cleanup.marker = "";
    expect((await runRunner(setup.env)).code).toBe(0);
    expect(existsSync(setup.registryFile)).toBe(false);
  });

  it("does not leave a lock when SIGINT arrives before or around lock creation", async () => {
    const setup = await fixture();
    const first = startRunner(setup.env);
    first.child.kill("SIGINT");
    await first.result;

    expect(existsSync(setup.lock)).toBe(false);
    expect((await runRunner(setup.env)).code).toBe(0);
  });

  it("forwards SIGTERM after lock creation, retains the registry, and permits the next run", async () => {
    const setup = await fixture();
    const first = startRunner({
      ...setup.env,
      FAKE_PLAYWRIGHT_HOLD_MS: "10000",
      FAKE_PLAYWRIGHT_MARKER: setup.marker,
      FAKE_REGISTER_EMAIL: "email-1-0000-0-0-0@e2e.daily-attention.invalid",
    });
    await waitForFile(setup.marker);
    const childPid = Number(await readFile(setup.marker, "utf8"));

    first.child.kill("SIGTERM");
    const result = await first.result;
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      expect(result).toMatchObject({ code: 143, signal: null });
      expect(isAlive(childPid)).toBe(false);
      expect(existsSync(setup.lock)).toBe(false);
      expect(await readFile(setup.registryFile, "utf8")).toBe(
        ownershipLine({ id: createdUserId, email: "email-1-0000-0-0-0@e2e.daily-attention.invalid" }),
      );
      expect((await runRunner(setup.env)).code).toBe(0);
    } finally {
      if (isAlive(childPid)) process.kill(childPid, "SIGKILL");
    }
  });

  it("reports a dead-owner stale lock and never removes it automatically", async () => {
    const setup = await fixture();
    await mkdir(setup.lock);
    await writeFile(join(setup.lock, "owner"), "2147483647\n");

    const result = await runRunner(setup.env);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("stale E2E lock");
    expect(result.stderr).toContain("remove it manually");
    expect(existsSync(setup.lock)).toBe(true);
    expect(await commandLog(setup.log)).toEqual([]);
  });
});
