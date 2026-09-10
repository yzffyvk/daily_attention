import { setTimeout as sleep } from "node:timers/promises";

export async function runPollLoop(options: {
  signal: AbortSignal;
  processBatch: () => Promise<void>;
  onSuccess?: () => void;
  onError?: () => void;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}) {
  const wait = options.wait ?? (async (ms, signal) => {
    await sleep(ms, undefined, { signal });
  });
  let backoff = 1000;
  while (!options.signal.aborted) {
    let delay = 1000;
    try {
      await options.processBatch();
      options.onSuccess?.();
      backoff = 1000;
    } catch {
      options.onError?.();
      delay = backoff;
      backoff = Math.min(backoff * 2, 30_000);
    }
    if (options.signal.aborted) break;
    try { await wait(delay, options.signal); }
    catch (error) { if (!options.signal.aborted) throw error; }
  }
}
