import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("integration test runner", () => {
  it("uses the explicit safe runner instead of mutating developer state", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(packageJson.scripts["test:integration"]).toBe("node scripts/run-integration-tests.mjs");
  });
});
