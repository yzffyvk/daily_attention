export function readWorkerRuntimeConfig(environment: Record<string, string | undefined> = process.env) {
  // Railway probes PORT; keep the existing port override for local development.
  const port = Number(environment.PORT ?? environment.AI_WORKER_HEALTH_PORT ?? 8790);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("AI_WORKER_HEALTH_PORT_INVALID");
  }
  return {
    port,
    host: environment.AI_WORKER_HEALTH_HOST?.trim() || "127.0.0.1",
  };
}
