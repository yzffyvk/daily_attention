import { describe, expect, it } from "vitest";
import { uniquePhone } from "../../e2e/helpers";

describe("E2E phone allocation", () => {
  it("assigns non-overlapping legal phones across projects, workers, retries, and calls", () => {
    const phones = [
      uniquePhone("flows-desktop", 0, 0, 0, "stable-run"),
      uniquePhone("desktop", 0, 0, 0, "stable-run"),
      uniquePhone("tablet", 0, 0, 0, "stable-run"),
      uniquePhone("mobile", 0, 0, 0, "stable-run"),
      uniquePhone("flows-desktop", 1, 0, 0, "stable-run"),
      uniquePhone("flows-desktop", 0, 1, 0, "stable-run"),
      uniquePhone("flows-desktop", 0, 0, 1, "stable-run"),
    ];

    expect(new Set(phones)).toHaveLength(phones.length);
    phones.forEach((phone) => expect(phone).toMatch(/^139[0-9]{8}$/));
  });

  it("rejects allocation dimensions that cannot fit without overlap", () => {
    expect(() => uniquePhone("unknown", 0, 0, 0)).toThrow("Unknown E2E project");
    expect(() => uniquePhone("desktop", 1_000, 0, 0)).toThrow("workerIndex");
    expect(() => uniquePhone("desktop", 0, 10, 0)).toThrow("retry");
    expect(() => uniquePhone("desktop", 0, 0, 1_000)).toThrow("invocation");
  });

  it("does not reuse a phone across separate E2E runs", () => {
    const firstRun = uniquePhone("flows-desktop", 0, 0, 0, "run-a");
    const secondRun = uniquePhone("flows-desktop", 0, 0, 0, "run-b");

    expect(firstRun).not.toBe(secondRun);
    expect(firstRun).toMatch(/^139[0-9]{8}$/);
    expect(secondRun).toMatch(/^139[0-9]{8}$/);
  });
});
