// @vitest-environment node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";

it("probes both queues and drains on repeated SIGTERM without reading more work", async () => {
  let hold = true;
  const requests: string[] = [];
  const pending: ServerResponse[] = [];
  const database = createServer((request, response) => {
    request.resume();
    requests.push(request.url!);
    response.setHeader("Content-Type", "application/json");
    if (hold) pending.push(response);
    else response.end("[]");
  });
  database.listen(0, "127.0.0.1");
  await once(database, "listening");
  const databasePort = (database.address() as AddressInfo).port;
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const healthPort = (reservation.address() as AddressInfo).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = spawn(process.execPath, ["--experimental-strip-types", "services/ai-worker/index.ts"], {
    cwd: process.cwd(),
    // Deliberately isolated: no production credentials or model requests.
    env: {
      PATH: process.env.PATH, NODE_ENV: "production", PORT: String(healthPort),
      AI_WORKER_HEALTH_HOST: "0.0.0.0", AI_WORKER_HEALTH_PORT: "0",
      SUPABASE_URL: `http://127.0.0.1:${databasePort}`, SUPABASE_SECRET_KEY: "test-key",
      DEEPSEEK_API_KEY: "test-key", AI_USER_ID_PEPPER: "p".repeat(32),
      SAFE_FETCH_GATEWAY_URL: "https://gateway.example.com", SAFE_FETCH_GATEWAY_TOKEN: "t".repeat(32),
    },
    stdio: "ignore",
  });
  const exited = once(child, "exit");
  const probe = (path: string) => fetch(`http://127.0.0.1:${healthPort}${path}`, {
    signal: AbortSignal.timeout(1000),
  });
  const release = () => { for (const response of pending.splice(0)) response.end("[]"); };
  try {
    await vi.waitFor(async () => {
      expect(pending).toHaveLength(2);
      expect((await probe("/healthz")).status).toBe(200);
      expect((await probe("/readyz")).status).toBe(503);
      expect((await probe("/unknown")).status).toBe(404);
    }, { timeout: 5000 });
    hold = false;
    release();
    await vi.waitFor(async () => expect((await probe("/readyz")).status).toBe(200));
    hold = true;
    await vi.waitFor(() => expect(pending).toHaveLength(2), { timeout: 3000 });
    const requestsBeforeShutdown = [...requests];
    child.kill("SIGTERM");
    await vi.waitFor(async () => expect((await probe("/readyz")).status).toBe(503));
    child.kill("SIGTERM");
    // A duplicate platform signal must not interrupt the work being drained.
    expect((await probe("/healthz")).status).toBe(200);
    hold = false;
    release();
    expect(await exited).toEqual([0, null]);
    expect(requests).toEqual(requestsBeforeShutdown);
    expect(requests).toContain("/rest/v1/rpc/read_ai_generation_queue");
    expect(requests).toContain("/rest/v1/rpc/claim_knowledge_narrative");
  } finally {
    child.kill("SIGKILL");
    release();
    database.closeAllConnections();
    await new Promise<void>((resolve) => database.close(() => resolve()));
  }
}, 15_000);
