import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as e2eHelpers from "../../e2e/helpers";

const { uniquePhone } = e2eHelpers;

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

  it("records only confirmed user ownership in the runner registry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "e2e-helper-registry-"));
    const registry = join(directory, "phones");
    const previousRegistry = process.env.E2E_PHONE_REGISTRY_FILE;
    const recordE2EOwnership = (
      e2eHelpers as typeof e2eHelpers & {
        recordE2EOwnership?: (userId: string, phone: string) => void;
      }
    ).recordE2EOwnership;
    process.env.E2E_PHONE_REGISTRY_FILE = registry;

    try {
      expect(recordE2EOwnership).toBeTypeOf("function");
      recordE2EOwnership!("00000000-0000-4000-8000-000000000001", "13910000000");
      recordE2EOwnership!("00000000-0000-4000-8000-000000000002", "13920000000");
      expect(await readFile(registry, "utf8")).toBe(
        '{"userId":"00000000-0000-4000-8000-000000000001","phone":"13910000000"}\n' +
        '{"userId":"00000000-0000-4000-8000-000000000002","phone":"13920000000"}\n',
      );
      expect(() => recordE2EOwnership!("not-a-user", "13910000000")).toThrow("user ownership");
      expect(() => recordE2EOwnership!(
        "00000000-0000-4000-8000-000000000003",
        "13988888888",
      )).toThrow("reserved E2E phone");
      delete process.env.E2E_PHONE_REGISTRY_FILE;
      expect(() => recordE2EOwnership!(
        "00000000-0000-4000-8000-000000000003",
        "13910000000",
      )).toThrow("registry");
    } finally {
      if (previousRegistry === undefined) delete process.env.E2E_PHONE_REGISTRY_FILE;
      else process.env.E2E_PHONE_REGISTRY_FILE = previousRegistry;
      await rm(directory, { force: true, recursive: true });
    }
  });
});
