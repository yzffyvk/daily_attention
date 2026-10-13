import { createServer } from "node:http";
import { createProductionDependencies, processQueueBatch } from "../../supabase/functions/ai-generation-worker/index.ts";
import { runPollLoop } from "./poll-loop.ts";
import { createNarrativeWorker, runNarrativeJob } from "./knowledge-narratives.ts";
import { dedicatedAiTiming } from "../../supabase/functions/_shared/ai/timeouts.ts";
import { readWorkerScope } from "./scoped-worker.ts";
import { readWorkerRuntimeConfig } from "./runtime-config.ts";

const controller = new AbortController();
const { port, host } = readWorkerRuntimeConfig();
const scope = readWorkerScope((name) => process.env[name]);
const dependencies = createProductionDependencies((name) => process.env[name], { dedicatedWorker: true, scope });
const runJob = dependencies.runJob.bind(dependencies);
dependencies.runJob = async (jobId) => {
  const start = Date.now();
  console.info(JSON.stringify({ event: "ai_job_started", jobId }));
  const outcome = await runJob(jobId);
  console.info(JSON.stringify({ event: "ai_job_finished", jobId, outcome, durationMs: Date.now() - start }));
  return outcome;
};
let ready = false;
let narrativeReady = Boolean(scope);
// The local account scope must never start the unrelated narrative queue.
const narrativeWorker = scope ? null : createNarrativeWorker((name) => process.env[name]);
const server = createServer((request, response) => {
  const known = request.url === "/healthz" || request.url === "/readyz";
  const ok = request.url === "/healthz" || (ready && narrativeReady);
  response.writeHead(!known ? 404 : ok ? 200 : 503, {
    "Content-Type": "application/json", "Cache-Control": "no-store",
  });
  response.end(JSON.stringify({ ok: known && ok }));
});
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, host, resolve);
});
let forcedShutdown: ReturnType<typeof setTimeout> | undefined;
function stop() {
  if (controller.signal.aborted) return;
  ready = false;
  controller.abort();
  console.info(JSON.stringify({ event: "ai_worker_draining" }));
  // Let source fetching, the long model request, and result persistence finish.
  forcedShutdown = setTimeout(() => process.exit(1), dedicatedAiTiming.shutdownTimeoutMs);
  forcedShutdown.unref();
}
// Keep handling repeated signals while the current jobs drain.
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
console.info(JSON.stringify({ event: "ai_worker_started", healthPort: port, mode: scope ? "local_account" : "all_queues" }));
try {
  await Promise.all([runPollLoop({
    signal: controller.signal,
    processBatch: () => processQueueBatch(dependencies, controller.signal),
    onSuccess: () => { ready = !controller.signal.aborted; },
    onError: () => {
      ready = false;
      console.warn(JSON.stringify({ event: "ai_worker_queue_error" }));
    },
  }), ...(narrativeWorker ? [runPollLoop({
    signal: controller.signal,
    processBatch: () => runNarrativeJob(narrativeWorker),
    onSuccess: () => { narrativeReady = !controller.signal.aborted; },
    onError: () => {
      narrativeReady = false;
      console.warn(JSON.stringify({ event: "knowledge_narrative_queue_error" }));
    },
  })] : [])]);
} finally {
  if (forcedShutdown) clearTimeout(forcedShutdown);
  server.close();
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
