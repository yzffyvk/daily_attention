import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.hoisted(() => vi.fn());

vi.mock("@supabase/supabase-js", () => ({ createClient }));

import {
  countAuthUsers,
  countStorageObjects,
  main,
  parseArguments,
  runCli,
  runReset,
  validateTarget,
} from "../../scripts/reset-legacy-accounts.mjs";

const TARGET_REF = "jhiybzdvxvlkbqvamynp";
const TARGET_URL = `https://${TARGET_REF}.supabase.co`;

function countQuery(count: number) {
  return {
    select: vi.fn().mockResolvedValue({ count, error: null }),
  };
}

describe("guarded legacy account reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not execute when the module is imported", () => {
    expect(createClient).not.toHaveBeenCalled();
  });

  it("accepts only the fixed project ref and exact raw Supabase URL", () => {
    expect(validateTarget({ projectRef: TARGET_REF, supabaseUrl: TARGET_URL })).toBe(true);

    expect(() =>
      validateTarget({
        projectRef: "wrong-project",
        supabaseUrl: TARGET_URL,
      }),
    ).toThrow("PROJECT_REF_MISMATCH");

    expect(() =>
      validateTarget({
        projectRef: TARGET_REF,
        supabaseUrl: `${TARGET_URL}.attacker.invalid`,
      }),
    ).toThrow("PROJECT_REF_MISMATCH");

    expect(() =>
      validateTarget({
        projectRef: "another-project",
        supabaseUrl: "https://another-project.supabase.co",
      }),
    ).toThrow("PROJECT_REF_MISMATCH");

    expect(() =>
      validateTarget({
        projectRef: TARGET_REF,
        supabaseUrl: `${TARGET_URL}/unexpected-path?secret=value#fragment`,
      }),
    ).toThrow("PROJECT_REF_MISMATCH");

    for (const normalizedVariant of [
      `${TARGET_URL}/`,
      `${TARGET_URL}:443`,
      `${TARGET_URL}/path/..`,
      ` ${TARGET_URL}`,
      `https://${TARGET_REF.toUpperCase()}.supabase.co`,
    ]) {
      expect(() =>
        validateTarget({
          projectRef: TARGET_REF,
          supabaseUrl: normalizedVariant,
        }),
      ).toThrow("PROJECT_REF_MISMATCH");
    }
  });

  it("parses dry-run by default and requires an explicit apply flag", () => {
    expect(parseArguments([`--project-ref=${TARGET_REF}`])).toEqual({
      apply: false,
      projectRef: TARGET_REF,
    });
    expect(parseArguments([`--project-ref=${TARGET_REF}`, "--apply"])).toEqual({
      apply: true,
      projectRef: TARGET_REF,
    });
    expect(() => parseArguments(["--apply"])).toThrow("PROJECT_REF_REQUIRED");
  });

  it("rejects a mismatched target before creating a Supabase client", async () => {
    await expect(
      main({
        argv: ["--project-ref=wrong-project"],
        createSupabaseClient: createClient,
        env: {
          ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: TARGET_URL,
          SUPABASE_SECRET_KEY: "must-not-be-used",
        },
        writeLine: vi.fn(),
      }),
    ).rejects.toThrow("PROJECT_REF_MISMATCH");

    expect(createClient).not.toHaveBeenCalled();
  });

  it("maps an upstream uppercase rejection to RESET_FAILED without raw details", async () => {
    const writeError = vi.fn();
    const listUsers = vi.fn().mockRejectedValue(new Error("ECONNRESET"));

    await expect(
      runCli({
        argv: [`--project-ref=${TARGET_REF}`],
        createSupabaseClient: vi.fn(() => ({
          auth: { admin: { listUsers } },
          from: vi.fn(() => countQuery(0)),
          storage: {
            from: vi.fn(() => ({
              list: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          },
        })),
        env: {
          ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: TARGET_URL,
          SUPABASE_SECRET_KEY: "must-not-be-output",
        },
        writeError,
        writeLine: vi.fn(),
      }),
    ).resolves.toBe(1);

    expect(writeError).toHaveBeenCalledExactlyOnceWith("RESET_FAILED");
    expect(JSON.stringify(writeError.mock.calls)).not.toMatch(/ECONNRESET|must-not-be-output/u);
  });

  it("preserves only script-owned public error codes", async () => {
    const writeError = vi.fn();

    await expect(
      runCli({
        argv: ["--project-ref=wrong-project"],
        createSupabaseClient: createClient,
        env: {
          ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: TARGET_URL,
          SUPABASE_SECRET_KEY: "must-not-be-output",
        },
        writeError,
        writeLine: vi.fn(),
      }),
    ).resolves.toBe(1);

    expect(writeError).toHaveBeenCalledExactlyOnceWith("PROJECT_REF_MISMATCH");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("maps a verification rejection to RESET_FAILED after attempting both snapshots", async () => {
    let deleted = false;
    let authInspection = 0;
    const listUsers = vi.fn(async () => {
      authInspection += 1;
      if (!deleted) {
        return {
          data: { users: [{ id: "sensitive-user-a" }], nextPage: null },
          error: null,
        };
      }
      if (authInspection === 2) throw new Error("ECONNRESET");
      return { data: { users: [], nextPage: null }, error: null };
    });
    const writeError = vi.fn();

    await expect(
      runCli({
        argv: [`--project-ref=${TARGET_REF}`, "--apply"],
        createSupabaseClient: vi.fn(() => ({
          auth: {
            admin: {
              deleteUser: vi.fn(async () => {
                deleted = true;
                return { data: null, error: null };
              }),
              listUsers,
            },
          },
          from: vi.fn(() => countQuery(deleted ? 0 : 1)),
          storage: {
            emptyBucket: vi.fn().mockResolvedValue({ data: null, error: null }),
            from: vi.fn(() => ({
              list: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          },
        })),
        env: {
          ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: TARGET_URL,
          SUPABASE_SECRET_KEY: "must-not-be-output",
        },
        writeError,
        writeLine: vi.fn(),
      }),
    ).resolves.toBe(1);

    expect(listUsers).toHaveBeenCalledTimes(3);
    expect(writeError).toHaveBeenCalledExactlyOnceWith("RESET_FAILED");
    expect(JSON.stringify(writeError.mock.calls)).not.toMatch(/ECONNRESET|sensitive-user|must-not-be-output/u);
  });

  it("counts Auth users across every page", async () => {
    const listUsers = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          users: [{ id: "sensitive-user-a" }, { id: "sensitive-user-b" }],
          nextPage: 2,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          users: [{ id: "sensitive-user-c" }],
          nextPage: null,
        },
        error: null,
      });

    await expect(countAuthUsers({ auth: { admin: { listUsers } } })).resolves.toBe(3);
    expect(listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: 1000 });
    expect(listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 1000 });
  });

  it("deduplicates Auth user IDs across pages", async () => {
    const listUsers = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          users: [{ id: "sensitive-user-a" }, { id: "sensitive-user-b" }],
          nextPage: 2,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          users: [{ id: "sensitive-user-a" }],
          nextPage: null,
        },
        error: null,
      });

    await expect(countAuthUsers({ auth: { admin: { listUsers } } })).resolves.toBe(2);
  });

  it("counts Storage objects recursively and paginates each folder", async () => {
    const list = vi.fn(async (prefix: string, options: { limit: number; offset: number }) => {
      const pages = new Map<string, Array<Array<{ id: string | null; name: string }>>>([
        [
          "",
          [
            [
              { id: null, name: "private-folder" },
              { id: "file-root-a", name: "secret-root-a.png" },
            ],
            [{ id: "file-root-b", name: "secret-root-b.png" }],
          ],
        ],
        [
          "private-folder",
          [
            [
              { id: "file-nested-a", name: "secret-nested-a.png" },
              { id: null, name: "deeper" },
            ],
            [{ id: "file-nested-b", name: "secret-nested-b.png" }],
          ],
        ],
        [
          "private-folder/deeper",
          [[{ id: "file-deep", name: "secret-deep.png" }]],
        ],
      ]);
      const page = options.offset / options.limit;
      return { data: pages.get(prefix)?.[page] ?? [], error: null };
    });
    const from = vi.fn(() => ({ list }));

    await expect(countStorageObjects({ storage: { from } }, { pageSize: 2 })).resolves.toBe(5);
    expect(from).toHaveBeenCalledWith("checkin-images");
    expect(list).toHaveBeenCalledWith("", expect.objectContaining({ limit: 2, offset: 0 }));
    expect(list).toHaveBeenCalledWith("", expect.objectContaining({ limit: 2, offset: 2 }));
    expect(list).toHaveBeenCalledWith("private-folder", expect.objectContaining({ limit: 2, offset: 0 }));
    expect(list).toHaveBeenCalledWith("private-folder/deeper", expect.objectContaining({ limit: 2, offset: 0 }));
  });

  it("keeps dry-run free of destructive calls and emits only aggregate counts", async () => {
    const deleteUser = vi.fn();
    const emptyBucket = vi.fn();
    const list = vi.fn(async (prefix: string) => ({
      data:
        prefix === ""
          ? [
              { id: null, name: "sensitive-user-folder" },
              { id: "image-root", name: "private-root.png" },
            ]
          : [{ id: "image-nested", name: "private-nested.png" }],
      error: null,
    }));
    const client = {
      auth: {
        admin: {
          deleteUser,
          listUsers: vi.fn().mockResolvedValue({
            data: {
              users: [{ id: "sensitive-user-id", phone: "+8613800000000" }],
              nextPage: null,
            },
            error: null,
          }),
        },
      },
      from: vi.fn((table: string) => {
        if (table === "profiles") return countQuery(2);
        if (table === "check_ins") return countQuery(3);
        throw new Error("unexpected table");
      }),
      storage: {
        emptyBucket,
        from: vi.fn(() => ({ list })),
      },
    };
    const output: string[] = [];

    await expect(runReset({ apply: false, client, writeLine: (line: string) => output.push(line) })).resolves.toEqual({
      checkIns: 3,
      images: 2,
      profiles: 2,
      users: 1,
    });

    expect(emptyBucket).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(output).toEqual(["users=1", "profiles=2", "check_ins=3", "images=2"]);
    expect(output.join("\n")).not.toMatch(
      /sensitive-user|private-root|private-nested|\+8613800000000|checkin-images\//u,
    );
  });

  it("empties Storage before deleting paginated users and fails when post-apply counts are nonzero", async () => {
    const state = {
      emptied: false,
      postApply: false,
    };
    const emptyBucket = vi.fn(async () => {
      state.emptied = true;
      return { data: null, error: null };
    });
    const deleteUser = vi.fn(async () => {
      expect(state.emptied).toBe(true);
      state.postApply = true;
      return { data: null, error: null };
    });
    const listUsers = vi.fn(async ({ page }: { page: number }) => {
      if (state.postApply) return { data: { users: [], nextPage: null }, error: null };
      if (page === 1) {
        return {
          data: { users: [{ id: "sensitive-user-a" }], nextPage: 2 },
          error: null,
        };
      }
      return {
        data: { users: [{ id: "sensitive-user-b" }], nextPage: null },
        error: null,
      };
    });
    const profileCounts = [2, 1, 1];
    const checkInCounts = [2, 0, 0];
    const client = {
      auth: { admin: { deleteUser, listUsers } },
      from: vi.fn((table: string) => {
        const counts = table === "profiles" ? profileCounts : checkInCounts;
        return countQuery(counts.shift() ?? 0);
      }),
      storage: {
        emptyBucket,
        from: vi.fn(() => ({
          list: vi.fn().mockImplementation(async () => ({
            data: state.emptied ? [] : [{ id: "image-a", name: "private-image.png" }],
            error: null,
          })),
        })),
      },
    };
    const output: string[] = [];

    await expect(
      runReset({ apply: true, client, writeLine: (line: string) => output.push(line) }),
    ).rejects.toThrow("RESET_INCOMPLETE");

    expect(emptyBucket).toHaveBeenCalledOnce();
    expect(deleteUser).toHaveBeenCalledTimes(2);
    expect(emptyBucket.mock.invocationCallOrder[0]).toBeLessThan(deleteUser.mock.invocationCallOrder[0]);
    expect(output.slice(-8)).toEqual([
      "users=0",
      "profiles=1",
      "check_ins=0",
      "images=0",
      "users=0",
      "profiles=1",
      "check_ins=0",
      "images=0",
    ]);
    expect(output.join("\n")).not.toMatch(/sensitive-user|private-image/u);
  });

  it("recounts twice and skips Auth deletion when emptying Storage fails", async () => {
    const deleteUser = vi.fn();
    const emptyBucket = vi.fn().mockResolvedValue({
      data: null,
      error: new Error("ECONNRESET"),
    });
    const listUsers = vi.fn().mockResolvedValue({
      data: { users: [{ id: "sensitive-user-a" }], nextPage: null },
      error: null,
    });
    const from = vi.fn(() => countQuery(1));
    const list = vi.fn().mockResolvedValue({
      data: [{ id: "image-a", name: "private-image.png" }],
      error: null,
    });
    const output: string[] = [];

    await expect(
      runReset({
        apply: true,
        client: {
          auth: { admin: { deleteUser, listUsers } },
          from,
          storage: { emptyBucket, from: vi.fn(() => ({ list })) },
        },
        writeLine: (line: string) => output.push(line),
      }),
    ).rejects.toThrow("RESET_INCOMPLETE");

    expect(deleteUser).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledTimes(6);
    expect(listUsers).toHaveBeenCalledTimes(3);
    expect(list).toHaveBeenCalledTimes(3);
    expect(output.join("\n")).not.toMatch(/ECONNRESET|sensitive-user|private-image/u);
  });

  it("continues deleting the frozen snapshot and recounts twice after one deletion rejects", async () => {
    const remainingUsers = new Set(["sensitive-user-a", "sensitive-user-b"]);
    const deleteUser = vi.fn(async (userId: string) => {
      if (userId === "sensitive-user-a") throw new Error("ECONNRESET");
      remainingUsers.delete(userId);
      return { data: null, error: null };
    });
    const listUsers = vi.fn(async () => ({
      data: {
        users: [...remainingUsers].map((id) => ({ id })),
        nextPage: null,
      },
      error: null,
    }));
    const from = vi.fn(() => countQuery(remainingUsers.size));
    const output: string[] = [];

    await expect(
      runReset({
        apply: true,
        client: {
          auth: { admin: { deleteUser, listUsers } },
          from,
          storage: {
            emptyBucket: vi.fn().mockResolvedValue({ data: null, error: null }),
            from: vi.fn(() => ({
              list: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          },
        },
        writeLine: (line: string) => output.push(line),
      }),
    ).rejects.toThrow("RESET_INCOMPLETE");

    expect(deleteUser).toHaveBeenCalledTimes(2);
    expect(deleteUser).toHaveBeenNthCalledWith(1, "sensitive-user-a");
    expect(deleteUser).toHaveBeenNthCalledWith(2, "sensitive-user-b");
    expect(from).toHaveBeenCalledTimes(6);
    expect(listUsers).toHaveBeenCalledTimes(3);
    expect(output.join("\n")).not.toMatch(/ECONNRESET|sensitive-user/u);
  });

  it("fails when a concurrent writer appears between zero verification snapshots", async () => {
    let deleted = false;
    let authInspection = 0;
    const listUsers = vi.fn(async () => {
      authInspection += 1;
      if (!deleted) {
        return {
          data: { users: [{ id: "sensitive-user-a" }], nextPage: null },
          error: null,
        };
      }
      return {
        data: {
          users: authInspection === 2 ? [] : [{ id: "concurrent-sensitive-user" }],
          nextPage: null,
        },
        error: null,
      };
    });
    const deleteUser = vi.fn(async () => {
      deleted = true;
      return { data: null, error: null };
    });
    const output: string[] = [];

    await expect(
      runReset({
        apply: true,
        client: {
          auth: { admin: { deleteUser, listUsers } },
          from: vi.fn(() => countQuery(deleted ? 0 : 1)),
          storage: {
            emptyBucket: vi.fn().mockResolvedValue({ data: null, error: null }),
            from: vi.fn(() => ({
              list: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          },
        },
        writeLine: (line: string) => output.push(line),
      }),
    ).rejects.toThrow("RESET_INCOMPLETE");

    expect(listUsers).toHaveBeenCalledTimes(3);
    expect(output.slice(-8)).toEqual([
      "users=0",
      "profiles=0",
      "check_ins=0",
      "images=0",
      "users=1",
      "profiles=0",
      "check_ins=0",
      "images=0",
    ]);
    expect(output.join("\n")).not.toContain("concurrent-sensitive-user");
  });

  it("deletes each unique Auth user once and succeeds after two stable-zero snapshots", async () => {
    let deleted = false;
    let emptied = false;
    const listUsers = vi.fn(async ({ page }: { page: number }) => {
      if (deleted) return { data: { users: [], nextPage: null }, error: null };
      if (page === 1) {
        return {
          data: { users: [{ id: "sensitive-user-a" }], nextPage: 2 },
          error: null,
        };
      }
      return {
        data: { users: [{ id: "sensitive-user-a" }], nextPage: null },
        error: null,
      };
    });
    const deleteUser = vi.fn(async () => {
      deleted = true;
      return { data: null, error: null };
    });
    const emptyBucket = vi.fn(async () => {
      emptied = true;
      return { data: null, error: null };
    });
    const from = vi.fn(() => countQuery(deleted ? 0 : 1));
    const output: string[] = [];

    await expect(
      runReset({
        apply: true,
        client: {
          auth: { admin: { deleteUser, listUsers } },
          from,
          storage: {
            emptyBucket,
            from: vi.fn(() => ({
              list: vi.fn().mockResolvedValue({
                data: emptied ? [] : [{ id: "image-a", name: "private-image.png" }],
                error: null,
              }),
            })),
          },
        },
        writeLine: (line: string) => output.push(line),
      }),
    ).resolves.toEqual({
      checkIns: 0,
      images: 0,
      profiles: 0,
      users: 0,
    });

    expect(deleteUser).toHaveBeenCalledOnce();
    expect(emptyBucket.mock.invocationCallOrder[0]).toBeLessThan(deleteUser.mock.invocationCallOrder[0]);
    expect(from).toHaveBeenCalledTimes(6);
    expect(listUsers).toHaveBeenCalledTimes(4);
    expect(output).toHaveLength(12);
    expect(output.slice(-8)).toEqual([
      "users=0",
      "profiles=0",
      "check_ins=0",
      "images=0",
      "users=0",
      "profiles=0",
      "check_ins=0",
      "images=0",
    ]);
  });
});
