import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as e2eHelpers from "../../e2e/helpers";

const { uniquePhone } = e2eHelpers;

describe("E2E phone allocation", () => {
  it("assigns non-overlapping legal phones across projects, workers, retries, and calls", () => {
    const phones = [
      uniquePhone("flows-desktop", 0, 0, 0),
      uniquePhone("desktop", 0, 0, 0),
      uniquePhone("tablet", 0, 0, 0),
      uniquePhone("mobile", 0, 0, 0),
      uniquePhone("flows-desktop", 1, 0, 0),
      uniquePhone("flows-desktop", 0, 1, 0),
      uniquePhone("flows-desktop", 0, 0, 1),
    ];

    expect(phones).toEqual([
      "13910000000",
      "13920000000",
      "13930000000",
      "13940000000",
      "13910010000",
      "13910001000",
      "13910000001",
    ]);
    expect(new Set(phones)).toHaveLength(phones.length);
    phones.forEach((phone) => expect(phone).toMatch(/^139[0-9]{8}$/));
  });

  it("rejects allocation dimensions that cannot fit without overlap", () => {
    expect(() => uniquePhone("unknown", 0, 0, 0)).toThrow("Unknown E2E project");
    expect(() => uniquePhone("desktop", 1_000, 0, 0)).toThrow("workerIndex");
    expect(() => uniquePhone("desktop", 0, 10, 0)).toThrow("retry");
    expect(() => uniquePhone("desktop", 0, 0, 1_000)).toThrow("invocation");
  });

  it("atomically records only reserved E2E phones in the runner registry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "e2e-helper-registry-"));
    const registry = join(directory, "phones");
    const previousRegistry = process.env.E2E_PHONE_REGISTRY_FILE;
    const recordE2EPhone = (
      e2eHelpers as typeof e2eHelpers & { recordE2EPhone?: (phone: string) => void }
    ).recordE2EPhone;
    process.env.E2E_PHONE_REGISTRY_FILE = registry;

    try {
      expect(recordE2EPhone).toBeTypeOf("function");
      recordE2EPhone!("13910000000");
      recordE2EPhone!("13920000000");
      expect(await readFile(registry, "utf8")).toBe("13910000000\n13920000000\n");
      expect(() => recordE2EPhone!("13988888888")).toThrow("reserved E2E phone");
      delete process.env.E2E_PHONE_REGISTRY_FILE;
      expect(() => recordE2EPhone!("13910000000")).toThrow("registry");
    } finally {
      if (previousRegistry === undefined) delete process.env.E2E_PHONE_REGISTRY_FILE;
      else process.env.E2E_PHONE_REGISTRY_FILE = previousRegistry;
      await rm(directory, { force: true, recursive: true });
    }
  });
});
