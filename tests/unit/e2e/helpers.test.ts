import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";
import * as e2eHelpers from "../../e2e/helpers";

const { recordE2EEmailOwnership, register, uniqueEmail } = e2eHelpers;
const registryDirectoryName = "ai-learning-checkin-email-auth-e2e-registry";

async function registryFixture() {
  const root = await mkdtemp(join(tmpdir(), "e2e-helper-registry-"));
  const registryDirectory = join(root, registryDirectoryName);
  const registry = join(registryDirectory, "emails");
  const previousTmpdir = process.env.TMPDIR;
  const previousRegistry = process.env.E2E_EMAIL_REGISTRY_FILE;
  process.env.TMPDIR = root;
  process.env.E2E_EMAIL_REGISTRY_FILE = registry;

  return {
    registry,
    registryDirectory,
    root,
    async cleanup() {
      if (previousTmpdir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmpdir;
      if (previousRegistry === undefined) delete process.env.E2E_EMAIL_REGISTRY_FILE;
      else process.env.E2E_EMAIL_REGISTRY_FILE = previousRegistry;
      await rm(root, { force: true, recursive: true });
    },
  };
}

describe("E2E email allocation", () => {
  it("assigns non-overlapping reserved emails across projects, workers, retries, calls, and run scopes", () => {
    const emails = [
      uniqueEmail("flows-desktop", 0, 0, 0, 0),
      uniqueEmail("desktop", 0, 0, 0, 0),
      uniqueEmail("tablet", 0, 0, 0, 0),
      uniqueEmail("mobile", 0, 0, 0, 0),
      uniqueEmail("flows-desktop", 1, 0, 0, 0),
      uniqueEmail("flows-desktop", 0, 1, 0, 0),
      uniqueEmail("flows-desktop", 0, 0, 1, 0),
      uniqueEmail("flows-desktop", 0, 0, 0, 1),
    ];

    expect(emails).toEqual([
      "email-1-0000-0-0-0@e2e.daily-attention.invalid",
      "email-2-0000-0-0-0@e2e.daily-attention.invalid",
      "email-3-0000-0-0-0@e2e.daily-attention.invalid",
      "email-4-0000-0-0-0@e2e.daily-attention.invalid",
      "email-1-0000-1-0-0@e2e.daily-attention.invalid",
      "email-1-0000-0-1-0@e2e.daily-attention.invalid",
      "email-1-0000-0-0-1@e2e.daily-attention.invalid",
      "email-1-0001-0-0-0@e2e.daily-attention.invalid",
    ]);
    expect(new Set(emails)).toHaveLength(emails.length);
    emails.forEach((email) => expect(email).toMatch(/^email-[1-4]-[0-9]{4}-[0-9]+-[0-9]+-[0-9]+@e2e\.daily-attention\.invalid$/u));
  });

  it("rejects allocation dimensions that cannot fit without overlap", () => {
    expect(() => uniqueEmail("unknown", 0, 0, 0, 0)).toThrow("Unknown E2E project");
    expect(() => uniqueEmail("desktop", 10, 0, 0, 0)).toThrow("workerIndex");
    expect(() => uniqueEmail("desktop", 0, 10, 0, 0)).toThrow("retry");
    expect(() => uniqueEmail("desktop", 0, 0, 10, 0)).toThrow("invocation");
    expect(() => uniqueEmail("desktop", 0, 0, 0, 10_000)).toThrow("runScope");
  });

  it("isolates the same test allocation across consecutive run scopes", () => {
    expect(uniqueEmail("flows-desktop", 0, 0, 0, 1)).toBe("email-1-0001-0-0-0@e2e.daily-attention.invalid");
    expect(uniqueEmail("flows-desktop", 0, 0, 0, 2)).toBe("email-1-0002-0-0-0@e2e.daily-attention.invalid");
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
        recordE2EEmailOwnership("00000000-0000-4000-8000-000000000001", "email-1-0000-0-0-0@e2e.daily-attention.invalid");
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
      expect(() => recordE2EEmailOwnership(
        "00000000-0000-4000-8000-000000000001",
        "email-1-0000-0-0-0@e2e.daily-attention.invalid",
      )).toThrow();
      await expect(lstat(fixture.registry)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects a registry path outside the runner-owned location", async () => {
    const fixture = await registryFixture();
    const outside = join(fixture.root, "outside");
    process.env.E2E_EMAIL_REGISTRY_FILE = outside;
    try {
      await writeFile(outside, "unchanged\n");
      let failedClosed = false;
      try {
        recordE2EEmailOwnership("00000000-0000-4000-8000-000000000001", "email-1-0000-0-0-0@e2e.daily-attention.invalid");
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
      recordE2EEmailOwnership("00000000-0000-4000-8000-000000000001", "email-1-0000-0-0-0@e2e.daily-attention.invalid");
      recordE2EEmailOwnership("00000000-0000-4000-8000-000000000002", "email-2-0000-0-0-0@e2e.daily-attention.invalid");

      expect(await readFile(fixture.registry, "utf8")).toBe(
        '{"userId":"00000000-0000-4000-8000-000000000001","email":"email-1-0000-0-0-0@e2e.daily-attention.invalid"}\n' +
        '{"userId":"00000000-0000-4000-8000-000000000002","email":"email-2-0000-0-0-0@e2e.daily-attention.invalid"}\n',
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
      expect(() => recordE2EEmailOwnership("not-a-user", "email-1-0000-0-0-0@e2e.daily-attention.invalid")).toThrow("user ownership");
      expect(() => recordE2EEmailOwnership(
        "00000000-0000-4000-8000-000000000003",
        "not-reserved@example.test",
      )).toThrow("reserved E2E email");
      delete process.env.E2E_EMAIL_REGISTRY_FILE;
      expect(() => recordE2EEmailOwnership(
        "00000000-0000-4000-8000-000000000003",
        "email-1-0000-0-0-0@e2e.daily-attention.invalid",
      )).toThrow("registry");
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects a non-reserved email before it touches the page or registry", async () => {
    await expect(register({} as Page, "not-a-reserved-shape@e2e.daily-attention.invalid"))
      .rejects
      .toThrow("reserved E2E email");
  });
});
