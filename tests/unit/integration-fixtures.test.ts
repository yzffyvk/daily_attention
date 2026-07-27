import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as integrationFixtures from "../helpers/integration-fixtures";

const runScope = "0000000000000001";
const expectedEmail = `integration-${runScope}-10000@integration.daily-attention.invalid`;
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
            deleteUser: (ownedUserId: string) => Promise<{
              data: unknown;
              error: unknown;
            }>;
            listUsers: (parameters: { page: number; perPage: number }) => Promise<{
              data: { users: unknown[] };
              error: unknown;
            }>;
          };
        };
      },
      ownership: ReadonlyArray<{ userId: string; email: string }>,
    ) => Promise<void>;
  };
}

type DeleteResponse = {
  data: unknown;
  error: unknown;
};

function cleanupAdmin(
  deleteResponse: DeleteResponse,
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
          data: { users: usersAfterDelete },
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
          listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
        },
      },
    };

    await expect(
      deleteOwnedUsers(admin, [{ userId, email: expectedEmail }]),
    ).rejects.toThrow("Integration cleanup ownership does not match the current Auth user");
    expect(deleteCount).toBe(0);
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
