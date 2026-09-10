import { expect, it, vi } from "vitest";
import { runPollLoop } from "@/services/ai-worker/poll-loop";

it("keeps polling after read errors, caps backoff, and resets after recovery", async () => {
  const controller = new AbortController();
  const delays: number[] = [];
  let calls = 0;
  const processBatch = vi.fn(async () => { if (++calls <= 7) throw new Error("offline"); });
  await runPollLoop({signal: controller.signal, processBatch,
    wait: async (ms) => { delays.push(ms); if (delays.length === 8) controller.abort(); },
  });
  expect(delays).toEqual([1000,2000,4000,8000,16000,30000,30000,1000]);
  expect(processBatch).toHaveBeenCalledTimes(8);
});

it("finishes an in-flight batch and does not read again after shutdown", async () => {
  const controller = new AbortController();
  const wait = vi.fn();
  let finish!: () => void;
  const batch = new Promise<void>((resolve) => { finish = resolve; });
  const processBatch = vi.fn(() => batch);
  const running = runPollLoop({signal:controller.signal, processBatch, wait});
  controller.abort();
  finish();
  await running;
  expect(processBatch).toHaveBeenCalledTimes(1);
  expect(wait).not.toHaveBeenCalled();
});
