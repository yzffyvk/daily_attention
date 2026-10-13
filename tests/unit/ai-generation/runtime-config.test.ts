// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readWorkerRuntimeConfig } from "@/services/ai-worker/runtime-config";

describe("AI worker listener configuration", () => {
  it("keeps local health checks on loopback by default", () => {
    expect(readWorkerRuntimeConfig({})).toEqual({ host: "127.0.0.1", port: 8790 });
  });

  it("uses the platform port and container host ahead of the local port", () => {
    expect(readWorkerRuntimeConfig({
      PORT: "8080", AI_WORKER_HEALTH_PORT: "8791", AI_WORKER_HEALTH_HOST: "0.0.0.0",
    })).toEqual({ host: "0.0.0.0", port: 8080 });
  });

  it("still accepts the existing local health port", () => {
    expect(readWorkerRuntimeConfig({ AI_WORKER_HEALTH_PORT: "8791" }).port).toBe(8791);
  });

  it.each(["", "0", "65536", "1.5", "invalid"])("rejects invalid platform port %j", (port) => {
    expect(() => readWorkerRuntimeConfig({ PORT: port })).toThrow("AI_WORKER_HEALTH_PORT_INVALID");
  });
});
