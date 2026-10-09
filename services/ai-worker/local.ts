import { readWorkerScope } from "./scoped-worker.ts";

// This entry point must fail closed even when the acceptance file is incomplete.
if (!readWorkerScope(name => process.env[name])) {
  throw new Error("AI_WORKER_SCOPE_REQUIRED");
}
await import("./index.ts");
