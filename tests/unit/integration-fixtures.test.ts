import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as integrationFixtures from "../helpers/integration-fixtures";

const runScope = "0000000000000001";
const expectedEmail = `integration-${runScope}-10000@integration.daily-attention.invalid`;
const secondExpectedEmail = `integration-${runScope}-10001@integration.daily-attention.invalid`;
const userId = "00000000-0000-4000-8000-000000000001";
const otherUserId = "00000000-0000-4000-8000-000000000002";
const thirdUserId = "00000000-0000-4000-8000-000000000003";
const thirdExpectedEmail = `integration-${runScope}-10002@integration.daily-attention.invalid`;
let previousScope: string | undefined;
let previousRegistryFile: string | undefined;
const temporaryDirectories = new Set<string>();

const missingUserResult = {
  data: { user: null },
  error: { code: "user_not_found", status: 404 },
};

beforeEach(() => {
  previousScope = process.env.INTEGRATION_RUN_SCOPE;
  previousRegistryFile = process.env.INTEGRATION_USER_REGISTRY_FILE;
  process.env.INTEGRATION_RUN_SCOPE = runScope;
});

afterEach(async () => {
  if (previousScope === undefined) delete process.env.INTEGRATION_RUN_SCOPE;
  else process.env.INTEGRATION_RUN_SCOPE = previousScope;
  if (previousRegistryFile === undefined) delete process.env.INTEGRATION_USER_REGISTRY_FILE;
  else process.env.INTEGRATION_USER_REGISTRY_FILE = previousRegistryFile;
  await Promise.all([...temporaryDirectories].map((directory) => (
    rm(directory, { force: true, recursive: true })
  )));
  temporaryDirectories.clear();
});

function fixtureExports() {
  return integrationFixtures as unknown as {
    confirmIntegrationAuthOwnership?: (
      user: { id?: unknown; email?: unknown },
      email: string,
    ) => { userId: string; email: string };
    deleteOwnedIntegrationUsers?: (
      admin: {
        auth: {
          admin: {
            getUserById: (ownedUserId: string) => Promise<unknown>;
            deleteUser: (ownedUserId: string) => Promise<unknown>;
          };
        };
      },
      ownership: ReadonlyArray<{ userId: string; email: string }>,
      checkpoint?: (remaining: ReadonlyArray<{ userId: string; email: string }>) => void,
    ) => Promise<void>;
    readIntegrationUserRegistry?: (
      registryFile: string,
    ) => Array<{ userId: string; email: string }>;
  };
}

async function registryPath() {
  const root = await mkdtemp(join(tmpdir(), "integration-registry-test-"));
  temporaryDirectories.add(root);
  return {
    directory: join(root, "registry"),
    file: join(root, "registry", "users"),
  };
}

function cleanupAdmin(
  deleteResponse: unknown,
  ...postDeleteReads: unknown[]
) {
  const postDeleteRead = postDeleteReads.length === 0
    ? missingUserResult
    : postDeleteReads[0];
  let deleted = false;
  return {
    auth: {
      admin: {
        getUserById: vi.fn().mockImplementation(async () => (
          deleted
            ? postDeleteRead
            : {
                data: { user: { id: userId, email: expectedEmail } },
                error: null,
              }
        )),
        deleteUser: vi.fn().mockImplementation(async () => {
          deleted = true;
          return deleteResponse;
        }),
        listUsers: vi.fn(),
      },
    },
  };
}

describe("integration fixture ownership", () => {
  it("tracks an unexpected public sign-up only after exact Auth ownership verification", () => {
    const confirmOwnership = fixtureExports().confirmIntegrationAuthOwnership;
    expect(typeof confirmOwnership).toBe("function");
    if (!confirmOwnership) return;

    const ownership = confirmOwnership(
      { id: userId, email: expectedEmail },
      expectedEmail,
    );

    expect(ownership.userId === userId).toBe(true);
    expect(ownership.email === expectedEmail).toBe(true);
    expect(() => confirmOwnership(
      {
        id: userId,
        email: `integration-${runScope}-10001@integration.daily-attention.invalid`,
      },
      expectedEmail,
    )).toThrow("Integration Auth ownership does not match the expected fixture");
  });

  it("deletes an unexpected public sign-up after exact Admin readback and an empty success body", async () => {
    const deleteOwnedUsers = fixtureExports().deleteOwnedIntegrationUsers;
    expect(typeof deleteOwnedUsers).toBe("function");
    if (!deleteOwnedUsers) return;

    const admin = cleanupAdmin({
      data: { user: {} },
      error: null,
    });

    await deleteOwnedUsers(admin, [{ userId, email: expectedEmail }]);
    expect(admin.auth.admin.getUserById).toHaveBeenCalledTimes(3);
  });

  it("proves target absence without depending on concurrent global Auth population", async () => {
    const deleteOwnedUsers = fixtureExports().deleteOwnedIntegrationUsers;
    expect(typeof deleteOwnedUsers).toBe("function");
    if (!deleteOwnedUsers) return;
    const admin = cleanupAdmin({ data: {}, error: null });
    admin.auth.admin.listUsers.mockRejectedValue(
      new Error("simulated concurrent global population change"),
    );

    await deleteOwnedUsers(admin, [{ userId, email: expectedEmail }]);

    expect(admin.auth.admin.getUserById).toHaveBeenCalledTimes(3);
    expect(admin.auth.admin.listUsers).not.toHaveBeenCalled();
  });

  it("refuses deletion when Admin readback does not exactly match ownership", async () => {
    const deleteOwnedUsers = fixtureExports().deleteOwnedIntegrationUsers;
    expect(typeof deleteOwnedUsers).toBe("function");
    if (!deleteOwnedUsers) return;

    let deleteCount = 0;
    const admin = {
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: userId,
                email: `integration-${runScope}-10001@integration.daily-attention.invalid`,
              },
            },
            error: null,
          }),
          deleteUser: vi.fn().mockImplementation(async () => {
            deleteCount += 1;
            return {
              data: { user: { id: userId, email: expectedEmail } },
              error: null,
            };
          }),
        },
      },
    };

    await expect(
      deleteOwnedUsers(admin, [{ userId, email: expectedEmail }]),
    ).rejects.toThrow("Integration cleanup ownership does not match the current Auth user");
    expect(deleteCount).toBe(0);
  });

  it("revalidates each exact owner immediately before deleting that user", async () => {
    const deleteOwnedUsers = fixtureExports().deleteOwnedIntegrationUsers;
    expect(typeof deleteOwnedUsers).toBe("function");
    if (!deleteOwnedUsers) return;

    const readsByUser = new Map<string, number>();
    const deletedUserIds: string[] = [];
    const deletedUsers = new Set<string>();
    const admin = {
      auth: {
        admin: {
          getUserById: vi.fn().mockImplementation(async (ownedUserId: string) => {
            if (deletedUsers.has(ownedUserId)) return missingUserResult;
            const readCount = (readsByUser.get(ownedUserId) ?? 0) + 1;
            readsByUser.set(ownedUserId, readCount);
            const expectedOwnedEmail = ownedUserId === userId
              ? expectedEmail
              : secondExpectedEmail;
            return {
              data: {
                user: {
                  id: ownedUserId,
                  email: ownedUserId === otherUserId && readCount > 1
                    ? expectedEmail
                    : expectedOwnedEmail,
                },
              },
              error: null,
            };
          }),
          deleteUser: vi.fn().mockImplementation(async (ownedUserId: string) => {
            deletedUserIds.push(ownedUserId);
            deletedUsers.add(ownedUserId);
            return { data: {}, error: null };
          }),
        },
      },
    };

    await expect(deleteOwnedUsers(admin, [
      { userId, email: expectedEmail },
      { userId: otherUserId, email: secondExpectedEmail },
    ])).rejects.toThrow(
      "Integration cleanup ownership does not match the current Auth user",
    );
    expect(deletedUserIds).toEqual([userId]);
  });

  it("checkpoints a partial multi-user cleanup and resumes only the remaining exact owner", async () => {
    const deleteOwnedUsers = fixtureExports().deleteOwnedIntegrationUsers;
    expect(typeof deleteOwnedUsers).toBe("function");
    if (!deleteOwnedUsers) return;

    const ownership = [
      { userId, email: expectedEmail },
      { userId: otherUserId, email: secondExpectedEmail },
    ];
    const deleted = new Set<string>();
    const firstRunDeletes: string[] = [];
    const firstRunCheckpoints: Array<ReadonlyArray<{ userId: string; email: string }>> = [];
    const firstAdmin = {
      auth: {
        admin: {
          getUserById: vi.fn().mockImplementation(async (ownedUserId: string) => (
            deleted.has(ownedUserId)
              ? missingUserResult
              : {
                  data: {
                    user: {
                      id: ownedUserId,
                      email: ownedUserId === userId ? expectedEmail : secondExpectedEmail,
                    },
                  },
                  error: null,
                }
          )),
          deleteUser: vi.fn().mockImplementation(async (ownedUserId: string) => {
            firstRunDeletes.push(ownedUserId);
            if (ownedUserId === otherUserId) throw new Error("simulated delete failure");
            deleted.add(ownedUserId);
            return { data: {}, error: null };
          }),
        },
      },
    };

    await expect(deleteOwnedUsers(
      firstAdmin,
      ownership,
      (remaining) => firstRunCheckpoints.push([...remaining]),
    )).rejects.toThrow("Unable to delete an owned integration user");
    expect(firstRunDeletes).toEqual([userId, otherUserId]);
    expect(firstRunCheckpoints).toEqual([[ownership[1]]]);

    const secondRunDeletes: string[] = [];
    const secondRunCheckpoints: Array<ReadonlyArray<{ userId: string; email: string }>> = [];
    const secondAdmin = {
      auth: {
        admin: {
          getUserById: vi.fn().mockImplementation(async (ownedUserId: string) => (
            deleted.has(ownedUserId)
              ? missingUserResult
              : {
                  data: { user: { id: ownedUserId, email: secondExpectedEmail } },
                  error: null,
                }
          )),
          deleteUser: vi.fn().mockImplementation(async (ownedUserId: string) => {
            secondRunDeletes.push(ownedUserId);
            deleted.add(ownedUserId);
            return { data: {}, error: null };
          }),
        },
      },
    };

    await deleteOwnedUsers(
      secondAdmin,
      firstRunCheckpoints.at(-1) ?? [],
      (remaining) => secondRunCheckpoints.push([...remaining]),
    );
    expect(secondRunDeletes).toEqual([otherUserId]);
    expect(secondRunCheckpoints).toEqual([[]]);
  });

  it("stores only confirmed exact ownership in a private regular-file registry", async () => {
    const registry = await registryPath();
    process.env.INTEGRATION_USER_REGISTRY_FILE = registry.file;

    integrationFixtures.trackIntegrationUser(thirdUserId, thirdExpectedEmail);

    const directoryMetadata = await stat(registry.directory).catch(() => null);
    const fileMetadata = await lstat(registry.file).catch(() => null);
    expect(directoryMetadata?.isDirectory()).toBe(true);
    expect(directoryMetadata && (directoryMetadata.mode & 0o777)).toBe(0o700);
    expect(fileMetadata?.isFile()).toBe(true);
    expect(fileMetadata?.isSymbolicLink()).toBe(false);
    expect(fileMetadata && (fileMetadata.mode & 0o777)).toBe(0o600);
    expect(await readFile(registry.file, "utf8")).toBe(
      `${JSON.stringify({ userId: thirdUserId, email: thirdExpectedEmail })}\n`,
    );
    expect(() => integrationFixtures.trackIntegrationUser(
      thirdUserId,
      thirdExpectedEmail,
    )).toThrow("Conflicting integration ownership");
  });

  it.each([
    ["an unconfirmed email line", `${expectedEmail}\n`],
    ["malformed JSON", "{\n"],
    ["an entry with an extra field", `${JSON.stringify({ userId, email: expectedEmail, state: "deleting" })}\n`],
    ["an exact duplicate", `${JSON.stringify({ userId, email: expectedEmail })}\n${JSON.stringify({ userId, email: expectedEmail })}\n`],
    ["a conflicting user ID", `${JSON.stringify({ userId, email: expectedEmail })}\n${JSON.stringify({ userId, email: secondExpectedEmail })}\n`],
    ["a conflicting email", `${JSON.stringify({ userId, email: expectedEmail })}\n${JSON.stringify({ userId: otherUserId, email: expectedEmail })}\n`],
  ])("rejects registry contents containing %s", async (_label, contents) => {
    const readRegistry = fixtureExports().readIntegrationUserRegistry;
    expect(typeof readRegistry).toBe("function");
    if (!readRegistry) return;
    const registry = await registryPath();
    await mkdir(registry.directory, { mode: 0o700 });
    await writeFile(registry.file, contents, { mode: 0o600 });

    expect(() => readRegistry(registry.file)).toThrow("Invalid integration ownership registry");
  });

  it("rejects a symlink registry without reading its target", async () => {
    const readRegistry = fixtureExports().readIntegrationUserRegistry;
    expect(typeof readRegistry).toBe("function");
    if (!readRegistry) return;
    const registry = await registryPath();
    const target = join(registry.directory, "target");
    await mkdir(registry.directory, { mode: 0o700 });
    await writeFile(target, `${JSON.stringify({ userId, email: expectedEmail })}\n`, { mode: 0o600 });
    await symlink(target, registry.file);

    expect(() => readRegistry(registry.file)).toThrow("Invalid integration ownership registry");
  });

  it("does not delete an unrelated Auth user that is absent from exact ownership", async () => {
    const deleteOwnedUsers = fixtureExports().deleteOwnedIntegrationUsers;
    expect(typeof deleteOwnedUsers).toBe("function");
    if (!deleteOwnedUsers) return;

    let deleted = false;
    const admin = {
      auth: {
        admin: {
          getUserById: vi.fn().mockImplementation(async (ownedUserId: string) => (
            deleted
              ? missingUserResult
              : {
                  data: { user: { id: ownedUserId, email: expectedEmail } },
                  error: null,
                }
          )),
          deleteUser: vi.fn().mockImplementation(async () => {
            deleted = true;
            return { data: {}, error: null };
          }),
        },
      },
    };

    await deleteOwnedUsers(admin, [{ userId, email: expectedEmail }]);

    expect(admin.auth.admin.getUserById).not.toHaveBeenCalledWith(otherUserId);
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith(userId);
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalledWith(otherUserId);
  });

  it("accepts a successful integration delete response with a null user after absence proof", async () => {
    const deleteOwnedUsers = fixtureExports().deleteOwnedIntegrationUsers;
    expect(typeof deleteOwnedUsers).toBe("function");
    if (!deleteOwnedUsers) return;
    const admin = cleanupAdmin({ data: { user: null }, error: null });

    await deleteOwnedUsers(admin, [{ userId, email: expectedEmail }]);
  });

  it("accepts a successful integration delete response with null data after absence proof", async () => {
    const deleteOwnedUsers = fixtureExports().deleteOwnedIntegrationUsers;
    expect(typeof deleteOwnedUsers).toBe("function");
    if (!deleteOwnedUsers) return;
    const admin = cleanupAdmin({ data: null, error: null });

    await deleteOwnedUsers(admin, [{ userId, email: expectedEmail }]);
  });

  it("accepts malformed successful integration delete data after absence proof", async () => {
    const deleteOwnedUsers = fixtureExports().deleteOwnedIntegrationUsers;
    expect(typeof deleteOwnedUsers).toBe("function");
    if (!deleteOwnedUsers) return;
    const admin = cleanupAdmin({ data: "malformed-test-data", error: null });

    await deleteOwnedUsers(admin, [{ userId, email: expectedEmail }]);
  });

  it("accepts unrelated successful integration delete data after absence proof", async () => {
    const deleteOwnedUsers = fixtureExports().deleteOwnedIntegrationUsers;
    expect(typeof deleteOwnedUsers).toBe("function");
    if (!deleteOwnedUsers) return;
    const admin = cleanupAdmin({
      data: { user: { id: otherUserId, email: expectedEmail } },
      error: null,
    });

    await deleteOwnedUsers(admin, [{ userId, email: expectedEmail }]);
  });

  it("rejects an integration delete error before accepting absence proof", async () => {
    const deleteOwnedUsers = fixtureExports().deleteOwnedIntegrationUsers;
    expect(typeof deleteOwnedUsers).toBe("function");
    if (!deleteOwnedUsers) return;
    const admin = cleanupAdmin({
      data: { user: {} },
      error: { message: "test delete failure" },
    });

    await expect(
      deleteOwnedUsers(admin, [{ userId, email: expectedEmail }]),
    ).rejects.toThrow("Unable to delete an owned integration user");
  });

  it.each([
    ["missing response", undefined],
    ["missing error field", { data: {} }],
    ["undefined error", { data: {}, error: undefined }],
    ["false error", { data: {}, error: false }],
    ["zero error", { data: {}, error: 0 }],
    ["empty-string error", { data: {}, error: "" }],
  ])("rejects a delete result with %s", async (_label, deleteResponse) => {
    const deleteOwnedUsers = fixtureExports().deleteOwnedIntegrationUsers;
    expect(typeof deleteOwnedUsers).toBe("function");
    if (!deleteOwnedUsers) return;
    const admin = cleanupAdmin(deleteResponse);

    await expect(
      deleteOwnedUsers(admin, [{ userId, email: expectedEmail }]),
    ).rejects.toThrow("Unable to delete an owned integration user");
  });

  it("rejects integration cleanup when a fresh targeted read still returns the user", async () => {
    const deleteOwnedUsers = fixtureExports().deleteOwnedIntegrationUsers;
    expect(typeof deleteOwnedUsers).toBe("function");
    if (!deleteOwnedUsers) return;
    const admin = cleanupAdmin(
      {
        data: { user: {} },
        error: null,
      },
      {
        data: { user: { id: userId, email: expectedEmail } },
        error: null,
      },
    );

    await expect(
      deleteOwnedUsers(admin, [{ userId, email: expectedEmail }]),
    ).rejects.toThrow("Integration Auth cleanup did not complete");
  });

  const inheritedMissingError = Object.create({
    code: "user_not_found",
    status: 404,
  }) as Record<string, unknown>;
  it.each([
    ["missing result", undefined],
    ["missing data", { error: { code: "user_not_found", status: 404 } }],
    ["missing own user", {
      data: Object.create({ user: null }),
      error: { code: "user_not_found", status: 404 },
    }],
    ["non-null user", {
      data: { user: undefined },
      error: { code: "user_not_found", status: 404 },
    }],
    ["missing error", { data: { user: null } }],
    ["null error", { data: { user: null }, error: null }],
    ["wrong status", {
      data: { user: null },
      error: { code: "user_not_found", status: 400 },
    }],
    ["wrong code", {
      data: { user: null },
      error: { code: "unexpected_error", status: 404 },
    }],
    ["inherited status and code", {
      data: { user: null },
      error: inheritedMissingError,
    }],
  ])("rejects a targeted missing-user response with %s", async (_label, postDeleteRead) => {
    const deleteOwnedUsers = fixtureExports().deleteOwnedIntegrationUsers;
    expect(typeof deleteOwnedUsers).toBe("function");
    if (!deleteOwnedUsers) return;
    const admin = cleanupAdmin({ data: {}, error: null }, postDeleteRead);

    await expect(
      deleteOwnedUsers(admin, [{ userId, email: expectedEmail }]),
    ).rejects.toThrow("Unable to verify integration Auth cleanup");
  });

  it("isolates the same counter across runner-provided scopes", () => {
    process.env.INTEGRATION_RUN_SCOPE = "0000000000000001";
    const first = integrationFixtures.uniqueEmail(10000);
    process.env.INTEGRATION_RUN_SCOPE = "0000000000000002";
    const second = integrationFixtures.uniqueEmail(10000);

    expect(first === second).toBe(false);
  });

  it("keeps unexpected public sign-up assertions identity-safe after ownership tracking", async () => {
    const source = await readFile("tests/integration/auth-routes.test.ts", "utf8");
    const trackingIndex = source.indexOf("trackIntegrationUser(ownership.userId, ownership.email);");
    const assertionIndex = source.indexOf("expect(data.user === null).toBe(true);");

    expect(trackingIndex >= 0).toBe(true);
    expect(assertionIndex > trackingIndex).toBe(true);
    expect(source.includes("expect(data.user).toBeNull()")).toBe(false);
    expect(source.includes("expect(data.session).toBeNull()")).toBe(false);
    expect(source.includes("expect(error).toMatchObject")).toBe(false);
  });
});
