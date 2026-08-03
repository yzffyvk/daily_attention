# AI Generation Local and Production Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make queued AI generation start reliably in both local Supabase and production, and restore safe public HTTPS source fetching on Node 22.

**Architecture:** The Supabase Edge Function will authenticate the wake-up request, register queue processing with `EdgeRuntime.waitUntil`, and return `202` before generation finishes. The application will wait up to five seconds only for that acknowledgement. The safe-fetch gateway will preserve DNS pinning while returning the callback shape Node requests for either single-address or `all: true` lookups.

**Tech Stack:** TypeScript, Vitest, Supabase Edge Functions/Deno, `pgmq`, Node.js 22 HTTP/HTTPS, Vinext/Next.js 16, DeepSeek API.

## Global Constraints

- Do not change the page design, user-facing interaction copy, or database schema.
- Do not introduce another permanent service, queue, or scheduling platform.
- Do not change the DeepSeek model, prompt, or thinking-mode configuration.
- Preserve the existing daily five-generation quota, job state machine, retry policy, and polling response contract.
- Preserve DNS pinning, original-host TLS SNI, certificate validation, and SSRF protections.
- Do not modify the image-upload or mobile-layout code in this implementation.

---

### Task 1: Return early from the queue worker and process the batch in the background

**Files:**
- Modify: `supabase/functions/ai-generation-worker/index.ts:1-390`
- Modify: `tests/unit/ai-generation/worker.test.ts:1-155`

**Interfaces:**
- Consumes: existing `AiWorkerDependencies`, `createWorkerHandler`, `runAiJob`, and queue RPC functions.
- Produces: `BackgroundTaskScheduler = (task: Promise<void>) => void`; `createWorkerHandler(dependencies, scheduleTask)` returning `202` after scheduling a batch; production scheduling through `EdgeRuntime.waitUntil`.

- [ ] **Step 1: Write a failing test for acknowledgement-before-completion**

Add a scheduler capture helper and a test whose `runJob` waits on a controlled promise:

```ts
type ScheduledTask = Promise<void>;

function handlerWithCapturedTask(dependencies: AiWorkerDependencies) {
  let task: ScheduledTask | null = null;
  const handler = createWorkerHandler(dependencies, (scheduled) => {
    task = scheduled;
  });
  return {
    handler,
    scheduledTask: () => task,
  };
}

it("acknowledges before the scheduled queue batch completes", async () => {
  let releaseJob!: () => void;
  const jobGate = new Promise<void>((resolve) => {
    releaseJob = resolve;
  });
  const runJob = vi.fn(async () => {
    await jobGate;
    return "completed" as const;
  });
  const captured = handlerWithCapturedTask({
    triggerToken: token,
    readMessages: vi.fn().mockResolvedValue([{
      msgId: 1,
      readCount: 1,
      message: { job_id: "10000000-0000-4000-8000-000000000001" },
    }]),
    runJob,
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    delayMessage: vi.fn(),
  });

  const response = await captured.handler(request(`Bearer ${token}`));

  expect(response.status).toBe(202);
  await expect(response.json()).resolves.toMatchObject({
    accepted: true,
    requestId: expect.any(String),
  });
  expect(captured.scheduledTask()).toBeInstanceOf(Promise);
  releaseJob();
  await captured.scheduledTask();
  expect(runJob).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run tests/unit/ai-generation/worker.test.ts
```

Expected: FAIL because `createWorkerHandler` does not accept a scheduler and currently waits for the entire batch before returning `200`.

- [ ] **Step 3: Extract batch processing and schedule it after authentication**

Add the scheduler type and a focused batch function. Keep the existing per-message logic unchanged inside `processQueueBatch`:

```ts
export type BackgroundTaskScheduler = (task: Promise<void>) => void;

async function processQueueBatch(dependencies: AiWorkerDependencies) {
  const counts = { received: 0, completed: 0, retryable: 0, failed: 0 };
  const messages = (await dependencies.readMessages()).slice(0, QUEUE_BATCH_LIMIT);
  counts.received = messages.length;
  await mapWithConcurrency(messages, WORKER_CONCURRENCY, async (delivery) => {
    const payload = jobPayloadSchema.safeParse(delivery.message);
    if (!payload.success) {
      try {
        await dependencies.deleteMessage(delivery.msgId);
      } catch {
        // The message becomes visible again; keep processing the batch.
      }
      counts.failed += 1;
      return;
    }
    try {
      const outcome = await dependencies.runJob(payload.data.job_id);
      if (outcome === "retryable") {
        await dependencies.delayMessage(
          delivery.msgId,
          retryDelaySeconds(delivery.readCount),
        );
        counts.retryable += 1;
      } else {
        await dependencies.deleteMessage(delivery.msgId);
        counts.completed += 1;
      }
    } catch {
      counts.failed += 1;
    }
  });
  return counts;
}
```

Change the handler to schedule a promise and return immediately:

```ts
export function createWorkerHandler(
  dependencies: AiWorkerDependencies,
  scheduleTask: BackgroundTaskScheduler,
) {
  return async function handleRequest(request: Request) {
    const requestId = crypto.randomUUID();
    if (!await constantTimeEqual(bearerToken(request), dependencies.triggerToken)) {
      return jsonResponse({ ok: false, requestId }, 401);
    }
    if (request.method !== "POST") {
      return jsonResponse({ ok: false, requestId }, 405);
    }

    scheduleTask(processQueueBatch(dependencies).then(() => undefined));
    return jsonResponse({ accepted: true, requestId }, 202);
  };
}
```

Declare the Supabase runtime scheduler and use it in the default handler:

```ts
declare const EdgeRuntime: {
  waitUntil(task: Promise<unknown>): void;
};

function scheduleWithEdgeRuntime(task: Promise<void>) {
  EdgeRuntime.waitUntil(task);
}

const aiGenerationWorkerHandler = {
  fetch(request: Request) {
    try {
      return createWorkerHandler(
        createProductionDependencies(),
        scheduleWithEdgeRuntime,
      )(request);
    } catch {
      return Promise.resolve(jsonResponse({ ok: false, requestId: crypto.randomUUID() }, 500));
    }
  },
};
```

- [ ] **Step 4: Adapt existing worker tests to await the captured task**

For tests that verify queue counts and side effects, pass a scheduler that captures the Promise, assert the HTTP response is `202`, then await the captured Promise before asserting `runJob`, `deleteMessage`, `delayMessage`, or concurrency measurements. Authentication tests must assert that the scheduler is not called.

- [ ] **Step 5: Run worker tests and verify GREEN**

Run:

```bash
npx vitest run tests/unit/ai-generation/worker.test.ts
```

Expected: all worker tests PASS; the new test proves the HTTP acknowledgement is independent of job completion.

- [ ] **Step 6: Commit the Worker scheduling change**

```bash
git add supabase/functions/ai-generation-worker/index.ts tests/unit/ai-generation/worker.test.ts
git commit -m "fix: run ai queue batches in edge background tasks"
```

---

### Task 2: Allow a five-second Worker acknowledgement window

**Files:**
- Modify: `server/ai/http.ts:12-165`
- Modify: `tests/unit/ai-generation/http.test.ts:1-120`

**Interfaces:**
- Consumes: the Worker `202` acknowledgement introduced in Task 1.
- Produces: `triggerAiWorker` with a 5,000 ms acknowledgement timeout while preserving the durable queued job on failure.

- [ ] **Step 1: Change the timeout test to require five seconds**

Replace the current one-second assertion with:

```ts
it("allows five seconds for a worker acknowledgement", async () => {
  vi.useFakeTimers();
  vi.stubEnv("AI_WORKER_TRIGGER_TOKEN", "worker-trigger-token-with-at-least-32-characters");
  const invoke = vi.fn(() => new Promise(() => undefined));
  const pending = triggerAiWorker({ functions: { invoke } } as never);
  const rejection = expect(pending).rejects.toThrow("AI_WORKER_TRIGGER_TIMEOUT");

  await vi.advanceTimersByTimeAsync(4_999);
  expect(invoke).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);

  await rejection;
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run tests/unit/ai-generation/http.test.ts
```

Expected: FAIL because the current timeout rejects after 1,000 ms.

- [ ] **Step 3: Increase only the acknowledgement timeout**

Change:

```ts
const workerTriggerTimeoutMs = 5_000;
```

Do not change `createGeneration` error swallowing or the durable queue semantics.

- [ ] **Step 4: Run HTTP and service tests and verify GREEN**

Run:

```bash
npx vitest run tests/unit/ai-generation/http.test.ts tests/unit/ai-generation/service.test.ts tests/unit/ai-generation/routes.test.ts
```

Expected: all selected tests PASS.

- [ ] **Step 5: Commit the acknowledgement timeout change**

```bash
git add server/ai/http.ts tests/unit/ai-generation/http.test.ts
git commit -m "fix: wait for ai worker acknowledgement"
```

---

### Task 3: Support Node 22 `all: true` DNS lookup callbacks

**Files:**
- Modify: `services/safe-fetch-gateway/src/fetch-public-html.ts:90-122`
- Modify: `tests/unit/safe-fetch-gateway/fetch-public-html.test.ts:50-95`

**Interfaces:**
- Consumes: the already validated `ResolvedAddress` selected by `resolveAll` and SSRF checks.
- Produces: a custom Node lookup function that returns either `(address, family)` or `[{ address, family }]` according to the lookup options.

- [ ] **Step 1: Add a failing test for `all: true`**

Extend the transport inspection with a second lookup invocation:

```ts
it("returns an address array when Node requests all lookup results", async () => {
  const transport = transportFor([{ status: 200 }], (options) => {
    const lookup = options.lookup as (
      hostname: string,
      settings: { all?: boolean },
      callback: (
        error: Error | null,
        address: string | Array<{ address: string; family: number }>,
        family?: number,
      ) => void,
    ) => void;

    lookup("example.com", { all: true }, (error, addresses, family) => {
      expect(error).toBeNull();
      expect(addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
      expect(family).toBeUndefined();
    });
  });

  await expect(fetchPublicHtml({
    sourceUrl: "https://example.com/article",
    resolveAll: publicResolver,
    signal: new AbortController().signal,
    requestTransport: transport,
  })).resolves.toMatchObject({ finalUrl: "https://example.com/article" });
});
```

- [ ] **Step 2: Run the gateway test and verify RED**

Run:

```bash
npx vitest run tests/unit/safe-fetch-gateway/fetch-public-html.test.ts
```

Expected: FAIL because the existing lookup callback returns a string and family even when `all: true` is requested.

- [ ] **Step 3: Implement the overloaded callback shape**

Change only the lookup callback in `requestOptions`:

```ts
lookup: (_lookupHostname, options, callback) => {
  if (typeof options === "object" && options !== null && options.all === true) {
    callback(null, [selected]);
    return;
  }
  callback(null, selected.address, selected.family);
},
```

If TypeScript cannot infer the Node overload, add a local `PinnedLookup` type matching the two supported callback forms; do not weaken the transport type to `any`.

- [ ] **Step 4: Run gateway and server tests and verify GREEN**

Run:

```bash
npx vitest run tests/unit/safe-fetch-gateway/fetch-public-html.test.ts tests/unit/safe-fetch-gateway/server.test.ts
```

Expected: all selected tests PASS, including the original single-address lookup test.

- [ ] **Step 5: Commit the Node 22 gateway fix**

```bash
git add services/safe-fetch-gateway/src/fetch-public-html.ts tests/unit/safe-fetch-gateway/fetch-public-html.test.ts
git commit -m "fix: support node 22 pinned dns lookups"
```

---

### Task 4: Verify the complete local and production-compatible flow

**Files:**
- Modify only if a newly failing regression requires a scoped correction in files already listed above.
- Verify: `.dev.vars` values without printing secrets.

**Interfaces:**
- Consumes: Worker background scheduling from Task 1, five-second acknowledgement from Task 2, and Node 22 DNS compatibility from Task 3.
- Produces: a verified automatically processed AI generation using `deepseek-v4-pro`, with no manual Worker trigger.

- [ ] **Step 1: Run static and automated verification**

Run:

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:rendered
npm run build
```

Expected: every command exits 0. If `supabase:test` is run against the dirty acceptance database, report the known display-name sequence isolation failure separately rather than resetting user data.

- [ ] **Step 2: Restart only the services that load changed code**

Stop and restart the safe-fetch gateway and `supabase functions serve` using their existing local commands and `.dev.vars`. Keep the front-end on port 3000; restart it only if the server module change is not hot-reloaded.

- [ ] **Step 3: Verify the public HTTPS gateway path**

Run an authenticated local request without printing the token:

```bash
node --env-file=.dev.vars - <<'NODE'
const response = await fetch("http://127.0.0.1:8788/v1/fetch", {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.SAFE_FETCH_GATEWAY_TOKEN}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ sourceUrl: "https://api-docs.deepseek.com/zh-cn/" }),
});
const body = await response.json();
console.log(JSON.stringify({
  status: response.status,
  contentType: body.contentType ?? null,
  bodyPresent: typeof body.body === "string" && body.body.length > 0,
}));
NODE
```

Expected: status `200`, a supported text content type, and `bodyPresent: true`.

- [ ] **Step 4: Create one AI job through the product without manually calling the Worker**

Use the existing localhost account and submit the DeepSeek documentation URL. Record the created job ID from the product API response without recording credentials or tokens.

- [ ] **Step 5: Verify automatic queue pickup and DeepSeek completion**

Poll only the created job record and assert:

- within 5 seconds, `attempt_count >= 1` or status is `fetching`, `generating`, `succeeded`, `retryable`, or `failed`;
- the terminal status is `succeeded` under normal upstream availability;
- `model = 'deepseek-v4-pro'` and `provider_call_count = 1`;
- the queue message for that job is deleted;
- the browser receives an editable draft and does not save it until the user explicitly clicks save.

- [ ] **Step 6: Review the final diff and repository state**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intentional task files are changed. Preserve the pre-existing `AGENTS.md` and generated `tsconfig.tsbuildinfo` state unless they were explicitly part of the task.

- [ ] **Step 7: Commit any verification-only scoped correction**

If Step 1 through Step 6 required no additional code, skip this commit. If a scoped correction was required, stage only the files listed in Tasks 1–3 and commit:

```bash
git add supabase/functions/ai-generation-worker/index.ts tests/unit/ai-generation/worker.test.ts server/ai/http.ts tests/unit/ai-generation/http.test.ts services/safe-fetch-gateway/src/fetch-public-html.ts tests/unit/safe-fetch-gateway/fetch-public-html.test.ts
git commit -m "fix: complete ai generation reliability verification"
```
