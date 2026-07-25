import { describe, expect, it } from "vitest";
import { uniquePhone } from "../../e2e/helpers";

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
});
