import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as integrationFixtures from "../helpers/integration-fixtures";

const runScope = "0000000000000001";
const expectedEmail = `integration-${runScope}-10000@integration.daily-attention.invalid`;
const secondExpectedEmail = `integration-${runScope}-10001@integration.daily-attention.invalid`;
const userId = "00000000-0000-4000-8000-000000000001";
const otherUserId = "00000000-0000-4000-8000-000000000002";
let previousScope: string | undefined;

beforeEach(() => {
  previousScope = process.env.INTEGRATION_RUN_SCOPE;
  process.env.INTEGRATION_RUN_SCOPE = runScope;
});

afterEach(() => {
  if (previousScope === undefined) delete process.env.INTEGRATION_RUN_SCOPE;
  else process.env.INTEGRATION_RUN_SCOPE = previousScope;
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
            getUserById: (ownedUserId: string) => Promise<{
              data: { user: { id: string; email: string } | null };
              error: null;
            }>;
            deleteUser: (ownedUserId: string) => Promise<unknown>;
            listUsers: (parameters: { page: number; perPage: number }) => Promise<{
              data: {
                lastPage: number;
                nextPage: number | null;
                total: number;
                users: unknown[];
              };
              error: unknown;
            }>;
          };
        };
      },
      ownership: ReadonlyArray<{ userId: string; email: string }>,
    ) => Promise<void>;
  };
}

function cleanupAdmin(
  deleteResponse: unknown,
  usersAfterDelete: unknown[] = [],
) {
  return {
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({
          data: { user: { id: userId, email: expectedEmail } },
          error: null,
        }),
        deleteUser: vi.fn().mockResolvedValue(deleteResponse),
        listUsers: vi.fn().mockResolvedValue({
          data: {
            lastPage: usersAfterDelete.length > 0 ? 1 : 0,
            nextPage: null,
            total: usersAfterDelete.length,
            users: usersAfterDelete,
          },
          error: null,
        }),
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
          listUsers: vi.fn().mockResolvedValue({
            data: { lastPage: 0, nextPage: null, total: 0, users: [] },
            error: null,
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
    const admin = {
      auth: {
        admin: {
          getUserById: vi.fn().mockImplementation(async (ownedUserId: string) => {
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
            return { data: {}, error: null };
          }),
          listUsers: vi.fn().mockResolvedValue({
            data: {
              lastPage: 1,
              nextPage: null,
              total: 1,
              users: [{ id: otherUserId, email: secondExpectedEmail }],
            },
            error: null,
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

  it("rejects integration cleanup when a fresh Admin list still contains the deleted user", async () => {
    const deleteOwnedUsers = fixtureExports().deleteOwnedIntegrationUsers;
    expect(typeof deleteOwnedUsers).toBe("function");
    if (!deleteOwnedUsers) return;
    const admin = cleanupAdmin(
      {
        data: { user: {} },
        error: null,
      },
      [{ id: userId, email: expectedEmail }],
    );

    await expect(
      deleteOwnedUsers(admin, [{ userId, email: expectedEmail }]),
    ).rejects.toThrow("Integration Auth cleanup did not complete");
  });

  it("rejects a malformed fresh Admin list as integration Auth absence proof", async () => {
    const deleteOwnedUsers = fixtureExports().deleteOwnedIntegrationUsers;
    expect(typeof deleteOwnedUsers).toBe("function");
    if (!deleteOwnedUsers) return;
    const admin = cleanupAdmin(
      { data: { user: {} }, error: null },
      [{}],
    );

    await expect(
      deleteOwnedUsers(admin, [{ userId, email: expectedEmail }]),
    ).rejects.toThrow("Unable to verify integration Auth cleanup");
  });

  it("follows a short-page continuation before proving integration Auth absence", async () => {
    const deleteOwnedUsers = fixtureExports().deleteOwnedIntegrationUsers;
    expect(typeof deleteOwnedUsers).toBe("function");
    if (!deleteOwnedUsers) return;
    const admin = cleanupAdmin({ data: {}, error: null });
    admin.auth.admin.listUsers
      .mockResolvedValueOnce({
        data: { lastPage: 2, nextPage: 2, total: 1, users: [] },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          lastPage: 2,
          nextPage: null,
          total: 1,
          users: [{ id: userId, email: expectedEmail }],
        },
        error: null,
      });

    await expect(
      deleteOwnedUsers(admin, [{ userId, email: expectedEmail }]),
    ).rejects.toThrow("Integration Auth cleanup did not complete");
    expect(admin.auth.admin.listUsers).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "missing metadata",
      [{ data: { users: [] }, error: null }],
    ],
    [
      "malformed continuation",
      [{
        data: { lastPage: 2, nextPage: Number.NaN, total: 0, users: [] },
        error: null,
      }],
    ],
    [
      "repeated continuation",
      [
        {
          data: { lastPage: 2, nextPage: 2, total: 1, users: [] },
          error: null,
        },
        {
          data: { lastPage: 2, nextPage: 2, total: 1, users: [] },
          error: null,
        },
      ],
    ],
    [
      "backward continuation",
      [
        {
          data: { lastPage: 3, nextPage: 2, total: 1, users: [] },
          error: null,
        },
        {
          data: { lastPage: 3, nextPage: 1, total: 1, users: [] },
          error: null,
        },
      ],
    ],
    [
      "inconsistent continuation",
      [{
        data: { lastPage: 3, nextPage: 3, total: 1, users: [] },
        error: null,
      }],
    ],
    [
      "impossible totals",
      [{
        data: { lastPage: 0, nextPage: null, total: 1, users: [] },
        error: null,
      }],
    ],
  ])("rejects integration Auth pagination with %s", async (_label, pages) => {
    const deleteOwnedUsers = fixtureExports().deleteOwnedIntegrationUsers;
    expect(typeof deleteOwnedUsers).toBe("function");
    if (!deleteOwnedUsers) return;
    const admin = cleanupAdmin({ data: {}, error: null });
    for (const page of pages) {
      admin.auth.admin.listUsers.mockResolvedValueOnce(page);
    }

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
