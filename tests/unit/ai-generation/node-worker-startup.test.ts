// @vitest-environment node
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("dedicated AI worker startup", () => {
  it("loads its full dependency graph in plain Node before checking runtime configuration", () => {
    const result = spawnSync(process.execPath, [
      "--experimental-strip-types",
      "services/ai-worker/index.ts",
    ], {
      cwd: process.cwd(),
      // Stop before opening listeners or consuming queues. No credentials are needed.
      env: { PATH: process.env.PATH, NODE_ENV: "test", AI_WORKER_HEALTH_PORT: "0" },
      encoding: "utf8",
      timeout: 10_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("AI_WORKER_HEALTH_PORT_INVALID");
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });
});
