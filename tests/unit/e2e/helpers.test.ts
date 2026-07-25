import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as e2eHelpers from "../../e2e/helpers";

const { recordE2EOwnership, uniquePhone } = e2eHelpers;
const registryDirectoryName = "ai-learning-checkin-phone-auth-e2e-registry";

async function registryFixture() {
  const root = await mkdtemp(join(tmpdir(), "e2e-helper-registry-"));
  const registryDirectory = join(root, registryDirectoryName);
  const registry = join(registryDirectory, "phones");
  const previousTmpdir = process.env.TMPDIR;
  const previousRegistry = process.env.E2E_PHONE_REGISTRY_FILE;
  process.env.TMPDIR = root;
  process.env.E2E_PHONE_REGISTRY_FILE = registry;

  return {
    registry,
    registryDirectory,
    root,
    async cleanup() {
      if (previousTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmpdir;
      if (previousRegistry === undefined) delete process.env.E2E_PHONE_REGISTRY_FILE;
      else process.env.E2E_PHONE_REGISTRY_FILE = previousRegistry;
      await rm(root, { force: true, recursive: true });
    },
  };
}

describe("E2E phone allocation", () => {
  it("assigns non-overlapping legal phones across projects, workers, retries, and calls", () => {
    const phones = [
      uniquePhone("flows-desktop", 0, 0, 0, 0),
      uniquePhone("desktop", 0, 0, 0, 0),
      uniquePhone("tablet", 0, 0, 0, 0),
      uniquePhone("mobile", 0, 0, 0, 0),
      uniquePhone("flows-desktop", 1, 0, 0, 0),
      uniquePhone("flows-desktop", 0, 1, 0, 0),
      uniquePhone("flows-desktop", 0, 0, 1, 0),
    ];

    expect(phones).toEqual([
      "13910000000",
      "13920000000",
      "13930000000",
      "13940000000",
      "13910000100",
      "13910000010",
      "13910000001",
    ]);
    expect(new Set(phones)).toHaveLength(phones.length);
    phones.forEach((phone) => expect(phone).toMatch(/^139[0-9]{8}$/));
  });

  it("rejects allocation dimensions that cannot fit without overlap", () => {
    expect(() => uniquePhone("unknown", 0, 0, 0, 0)).toThrow("Unknown E2E project");
    expect(() => uniquePhone("desktop", 10, 0, 0, 0)).toThrow("workerIndex");
    expect(() => uniquePhone("desktop", 0, 10, 0, 0)).toThrow("retry");
    expect(() => uniquePhone("desktop", 0, 0, 10, 0)).toThrow("invocation");
    expect(() => uniquePhone("desktop", 0, 0, 0, 10_000)).toThrow("runScope");
  });

  it("isolates the same test allocation across consecutive run scopes", () => {
    expect(uniquePhone("flows-desktop", 0, 0, 0, 1)).toBe("13910001000");
    expect(uniquePhone("flows-desktop", 0, 0, 0, 2)).toBe("13910002000");
  });

  it("rejects a symlink registry without changing its target", async () => {
    const fixture = await registryFixture();
    const target = join(fixture.root, "unrelated");
    try {
      await mkdir(fixture.registryDirectory);
      await writeFile(target, "unchanged\n");
      await symlink(target, fixture.registry);
      let failedClosed = false;
      try {
        recordE2EOwnership("00000000-0000-4000-8000-000000000001", "13910000000");
      } catch {
        failedClosed = true;
      }

      expect(await readFile(target, "utf8")).toBe("unchanged\n");
      expect(failedClosed).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects a missing registry without creating it", async () => {
    const fixture = await registryFixture();
    try {
      await mkdir(fixture.registryDirectory);
      expect(() => recordE2EOwnership(
        "00000000-0000-4000-8000-000000000001",
        "13910000000",
      )).toThrow();
      await expect(lstat(fixture.registry)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects a registry path outside the runner-owned location", async () => {
    const fixture = await registryFixture();
    const outside = join(fixture.root, "outside");
    process.env.E2E_PHONE_REGISTRY_FILE = outside;
    try {
      await writeFile(outside, "unchanged\n");
      let failedClosed = false;
      try {
        recordE2EOwnership("00000000-0000-4000-8000-000000000001", "13910000000");
      } catch {
        failedClosed = true;
      }

      expect(await readFile(outside, "utf8")).toBe("unchanged\n");
      expect(failedClosed).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it("appends ownership to an existing runner-owned registry", async () => {
    const fixture = await registryFixture();
    try {
      await mkdir(fixture.registryDirectory);
      await writeFile(fixture.registry, "");
      recordE2EOwnership("00000000-0000-4000-8000-000000000001", "13910000000");
      recordE2EOwnership("00000000-0000-4000-8000-000000000002", "13920000000");

      expect(await readFile(fixture.registry, "utf8")).toBe(
        '{"userId":"00000000-0000-4000-8000-000000000001","phone":"13910000000"}\n' +
        '{"userId":"00000000-0000-4000-8000-000000000002","phone":"13920000000"}\n',
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("validates ownership fields and requires a registry setting", async () => {
    const fixture = await registryFixture();
    try {
      await mkdir(fixture.registryDirectory);
      await writeFile(fixture.registry, "");
      expect(() => recordE2EOwnership("not-a-user", "13910000000")).toThrow("user ownership");
      expect(() => recordE2EOwnership(
        "00000000-0000-4000-8000-000000000003",
        "13988888888",
      )).toThrow("reserved E2E phone");
      delete process.env.E2E_PHONE_REGISTRY_FILE;
      expect(() => recordE2EOwnership(
        "00000000-0000-4000-8000-000000000003",
        "13910000000",
      )).toThrow("registry");
    } finally {
      await fixture.cleanup();
    }
  });
});
