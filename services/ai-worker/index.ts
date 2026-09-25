import { createServer } from "node:http";
import { createProductionDependencies, processQueueBatch } from "../../supabase/functions/ai-generation-worker/index.ts";
import { runPollLoop } from "./poll-loop.ts";
import { createNarrativeWorker, runNarrativeJob } from "./knowledge-narratives.ts";
import { dedicatedAiTiming } from "../../supabase/functions/_shared/ai/timeouts.ts";

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
let narrativeReady = false;
const narrativeWorker = createNarrativeWorker((name) => process.env[name]);
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
  server.listen(port, "127.0.0.1", resolve);
});
let forcedShutdown: ReturnType<typeof setTimeout> | undefined;
function stop() {
  if (controller.signal.aborted) return;
  ready = false;
  controller.abort();
  // Let source fetching, the long model request, and result persistence finish.
  forcedShutdown = setTimeout(() => process.exit(1), dedicatedAiTiming.shutdownTimeoutMs);
  forcedShutdown.unref();
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
console.info(JSON.stringify({ event: "ai_worker_started", healthPort: port }));
try {
  await Promise.all([runPollLoop({
    signal: controller.signal,
    processBatch: () => processQueueBatch(dependencies),
    onSuccess: () => { ready = !controller.signal.aborted; },
    onError: () => {
      ready = false;
      console.warn(JSON.stringify({ event: "ai_worker_queue_error" }));
    },
  }), runPollLoop({
    signal: controller.signal,
    processBatch: () => runNarrativeJob(narrativeWorker),
    onSuccess: () => { narrativeReady = !controller.signal.aborted; },
    onError: () => {
      narrativeReady = false;
      console.warn(JSON.stringify({ event: "knowledge_narrative_queue_error" }));
    },
  })]);
} finally {
  if (forcedShutdown) clearTimeout(forcedShutdown);
  server.close();
}
