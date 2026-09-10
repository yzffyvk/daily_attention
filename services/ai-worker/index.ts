import { createServer } from "node:http";
import { createProductionDependencies, processQueueBatch } from "../../supabase/functions/ai-generation-worker/index.ts";
import { runPollLoop } from "./poll-loop.ts";

const controller = new AbortController();
const port = Number(process.env.AI_WORKER_HEALTH_PORT ?? 8790);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error("AI_WORKER_HEALTH_PORT_INVALID");
}
const dependencies = createProductionDependencies((name) => process.env[name], { dedicatedWorker: true });
const runJob = dependencies.runJob.bind(dependencies);
dependencies.runJob = async (jobId) => {
  const start = Date.now();
  console.info(JSON.stringify({ event: "ai_job_started", jobId }));
  const outcome = await runJob(jobId);
  console.info(JSON.stringify({ event: "ai_job_finished", jobId, outcome, durationMs: Date.now() - start }));
  return outcome;
};
let ready = false;
const server = createServer((request, response) => {
  const known = request.url === "/healthz" || request.url === "/readyz";
  const ok = request.url === "/healthz" || ready;
  response.writeHead(!known ? 404 : ok ? 200 : 503, {
    "Content-Type": "application/json", "Cache-Control": "no-store",
  });
  response.end(JSON.stringify({ ok: known && ok }));
});
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", resolve);
});
let forcedShutdown: ReturnType<typeof setTimeout> | undefined;
function stop() {
  if (controller.signal.aborted) return;
  ready = false;
  controller.abort();
  // The normal fetch + provider deadlines are 25s + 120s; allow persistence.
  forcedShutdown = setTimeout(() => process.exit(1), 170_000);
  forcedShutdown.unref();
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
console.info(JSON.stringify({ event: "ai_worker_started", healthPort: port }));
try {
  await runPollLoop({
    signal: controller.signal,
    processBatch: () => processQueueBatch(dependencies),
    onSuccess: () => { ready = !controller.signal.aborted; },
    onError: () => {
      ready = false;
      console.warn(JSON.stringify({ event: "ai_worker_queue_error" }));
    },
  });
} finally {
  if (forcedShutdown) clearTimeout(forcedShutdown);
  server.close();
}
