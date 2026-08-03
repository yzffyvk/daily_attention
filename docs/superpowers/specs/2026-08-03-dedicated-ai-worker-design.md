# Dedicated AI Worker Design

**Date:** 2026-08-03

## Objective

Replace request-scoped Supabase Edge background processing with a dedicated,
long-running Node.js AI Worker. A generation request must return quickly after
the durable job and queue message are created, while a separate process keeps
consuming queued work regardless of browser, application-request, or Edge
Function lifetimes.

The change addresses the observed local failure mode where an authenticated
Edge Function returned `202`, never completed its first queue read, and was
terminated by the local Edge Runtime after about 200 seconds. It does not try
to bypass target-site access controls: a page that returns HTTP 403 remains a
safe-fetch failure, but the user receives that failure promptly instead of
waiting indefinitely.

## Scope

This design includes:

- a production-capable `services/ai-worker` Node.js service;
- extraction of reusable queue and job-processing logic from the active Edge
  Function path;
- local and production-safe gateway URL policy;
- worker lifecycle, health, retry, and graceful shutdown behavior;
- application changes that enqueue and return without invoking an Edge
  Function;
- a stalled-queue hint for the frontend;
- local orchestration and a production container definition;
- automated and real-flow acceptance coverage.

This design does not:

- bypass anti-bot, authentication, paywall, or target-site restrictions;
- change the fixed daily quota of five generation attempts;
- automatically save AI output as a check-in;
- add support for uploaded documents, private pages, or browser-session
  extraction;
- redesign unrelated authentication, storage, or mobile behavior.

## Architecture

### Components

1. **Application API**
   - Authenticates the user, validates the URL, applies rate and daily limits,
     creates the durable job, and enqueues its ID.
   - Returns `202` immediately after the repository operation commits.
   - Does not invoke `ai-generation-worker` and does not own background work.

2. **Dedicated AI Worker**
   - Runs as a long-lived Node.js process in `services/ai-worker`.
   - Polls the Supabase queue once per second while idle.
   - Reads at most five deliveries per batch and processes at most two jobs
     concurrently.
   - Uses existing database claim, begin, complete, failure, queue-delay, and
     queue-delete RPC contracts.
   - Handles `SIGINT` and `SIGTERM` by stopping new reads, finishing in-flight
     work within a bounded shutdown window, and then exiting.

3. **Safe-fetch Gateway**
   - Remains a separate service and is the only component allowed to retrieve
     the user-provided source URL.
   - In local development, the worker may use loopback HTTP only for
     `127.0.0.1` or `localhost`.
   - Outside development, the worker requires an HTTPS gateway URL with no
     embedded credentials, query, or fragment.

4. **DeepSeek Provider**
   - Continues to use `deepseek-v4-pro`, the existing structured result
     contract, bounded timeout, token accounting, and safe error mapping.

5. **Supabase Queue and Job Tables**
   - Remain the durable handoff between application requests and processing.
   - Continue to enforce idempotent job claims and legal state transitions.
   - Preserve queue visibility and delayed retry semantics across worker
     restarts.

### Retired Active Path

The `ai-generation-worker` Edge Function is removed from the application’s
active dispatch path. It must not run concurrently with the dedicated worker,
because two independent consumers add avoidable operational ambiguity. Its
deployment and runbook references are retired or explicitly marked legacy as
part of the implementation. Other Edge Functions remain unchanged.

## Data Flow

1. The browser submits a generation request.
2. The application API authenticates and validates it, consumes applicable
   limits, and calls the existing repository create RPC.
3. The database transaction creates or reuses the idempotent job and enqueues
   the job ID.
4. The application returns `202` with the job ID, polling interval, and quota.
5. The dedicated worker reads visible queue messages.
6. For each valid delivery, the worker atomically claims the job.
7. The worker asks the safe-fetch gateway for bounded public text.
8. The worker extracts learnable content and starts the generation phase.
9. The worker calls DeepSeek and validates the structured result.
10. The worker stores the result and usage metadata, then deletes the queue
    message.
11. Browser polling receives the completed draft. The draft remains editable
    and unsaved until the user explicitly saves the check-in.

No user-request process, browser connection, or Edge Function isolate needs to
remain alive after step 4.

## Worker Boundaries

The service is divided into small units:

- **configuration:** validates Supabase, DeepSeek, gateway, polling, batch,
  concurrency, and shutdown settings without logging secret values;
- **queue adapter:** implements read, delay, and delete RPC operations;
- **job ports:** implements claim, fetch, begin, generate, complete, and failure
  operations consumed by the existing job runner;
- **batch processor:** validates deliveries and applies the existing retry-delay
  policy;
- **poll loop:** owns idle polling, transient read backoff, and shutdown state;
- **health server:** exposes process readiness without revealing queue payloads
  or configuration values;
- **entry point:** wires production dependencies and signal handlers.

Core batch and polling behavior is dependency-injected so tests use controlled
clocks and fakes without making network requests.

## Polling, Retry, and Recovery

- Idle polling interval defaults to 1,000 ms and is configurable within a
  bounded range.
- A queue read failure does not exit the worker. Read retries use exponential
  backoff capped at 30 seconds and reset after a successful read.
- A valid job delivery retains the existing processing outcomes:
  - completed or ignored: delete the queue message;
  - retryable: delay it by 5, 30, then 120 seconds according to read count;
  - terminal failure: persist the safe public error and delete the message;
  - unexpected per-message failure: leave the delivery for visibility-timeout
    recovery while continuing the rest of the batch.
- Database claiming remains the model-call idempotency boundary. A redelivered
  message for a terminal or already-owned job must not call DeepSeek again.
- Worker shutdown stops new queue reads first. In-flight tasks receive a
  bounded grace period; unfinished deliveries remain durable and become
  visible again.

## Health and Observability

The worker exposes a minimal health endpoint on a configurable local port:

- liveness reports that the process event loop is active;
- readiness reports that configuration loaded and the poll loop started;
- responses contain no secrets, source URLs, bodies, user IDs, or queue
  payloads.

Structured logs include only stable operational fields such as event name,
anonymous request or job identifier where already allowed, stage, outcome,
duration, retry delay, and sanitized error type/code. Page contents, provider
responses, bearer tokens, API keys, and raw upstream errors are never logged.

If a job remains `queued` without an attempt for more than 15 seconds, the
polling API response exposes a non-terminal stalled hint. The frontend explains
that the worker may be stopped or recovering and keeps cancellation available.
The database job stays queued so worker recovery can continue it without
creating another attempt.

## User-visible Errors

- A target page returning HTTP 403 or another unsupported response maps to a
  prompt failure such as “目标网站拒绝访问，请更换公开链接”.
- Other stable safe-fetch failures keep their existing bounded messages.
- Worker unavailability is distinguished from source access failure: it is a
  queued-state hint, not a fabricated terminal job error.
- DeepSeek rate limits and service failures retain the existing retry and
  terminal mappings.
- The UI must not encourage repeated submission while the original durable job
  is still queued.

## Configuration

The worker consumes the existing secrets and service settings:

- Supabase URL and server-only secret key;
- `DEEPSEEK_API_KEY`;
- `AI_USER_ID_PEPPER`;
- `SAFE_FETCH_GATEWAY_URL`;
- `SAFE_FETCH_GATEWAY_TOKEN`;
- `AI_PROVIDER_MODE`, restricted to the existing safe modes.

It adds bounded non-secret settings for polling, health port, and graceful
shutdown. Local `.dev.vars` uses `http://127.0.0.1:8788` for the gateway.
Production continues to require HTTPS. A missing or invalid required setting
fails worker startup before readiness is reported.

The worker no longer needs `AI_WORKER_TRIGGER_TOKEN`, because it exposes no
queue-processing HTTP trigger. The token remains only while legacy deployments
are being removed and is then deleted from the active environment template and
runbook.

## Local Development

Provide focused commands:

- `npm run dev` for the frontend only;
- `npm run dev:gateway` for the safe-fetch gateway;
- `npm run dev:ai-worker` for the dedicated worker;
- `npm run dev:all` for frontend, gateway, and worker together with coordinated
  shutdown.

The all-in-one command uses a repository script to supervise child processes
without printing environment values. Local generation no longer requires a
Cloudflare quick tunnel. Existing Supabase local services must still be
running.

## Production Deployment

`services/ai-worker` receives its own non-root OCI image and health check. It is
deployed as a single replica initially; database claims keep the design safe if
horizontal scaling is added later. The runtime must have outbound access only
to Supabase, the safe-fetch gateway, and DeepSeek as required.

Operational documentation covers:

- required secrets and non-secret settings;
- worker and gateway deployment order;
- health/readiness checks;
- rolling restart behavior;
- queue depth, oldest visible message age, retry, and terminal-failure alerts;
- retirement of the Edge worker trigger and temporary Cloudflare tunnel.

## Testing Strategy

### Unit tests

- idle polling and immediate processing of visible messages;
- batch limit five and concurrency two;
- exponential read backoff capped at 30 seconds;
- per-delivery retry delays of 5, 30, and 120 seconds;
- malformed delivery isolation;
- terminal, retryable, ignored, and completed outcomes;
- graceful shutdown and no new reads after shutdown begins;
- health response redaction and readiness transitions;
- local loopback HTTP allowance and production HTTPS enforcement;
- stalled-queue response mapping and frontend message.

### Integration tests

- enqueue through the application API and consume through the dedicated worker
  with local Supabase;
- deterministic fake provider success without an Edge Function trigger;
- stop the worker, enqueue a task, restart it, and verify automatic recovery;
- redelivery does not produce a second provider call;
- a protected source fails promptly with the expected stable code;
- daily quota and cancellation behavior remain unchanged.

### Product acceptance

- use the DeepSeek documentation URL and verify `succeeded`,
  `attempt_count = 1`, `model = 'deepseek-v4-pro'`, and
  `provider_call_count = 1`;
- verify its queue message is deleted;
- verify the draft is editable and remains unsaved until explicit confirmation;
- use the known HTTP-403 OpenAI URL and verify a clear source-access failure in
  seconds rather than an indefinite queued state;
- verify localhost uses no temporary tunnel and no manual worker invocation.

## Success Criteria

The change is complete when:

- application task creation no longer invokes the AI Edge Function;
- a running dedicated worker processes visible jobs within five seconds under
  normal local conditions;
- stopping and restarting the worker demonstrates durable recovery;
- successful DeepSeek generation completes through the product;
- inaccessible sources fail promptly and accurately;
- no duplicate provider call occurs during restart or redelivery tests;
- the five-per-day limit and explicit-save requirement remain intact;
- local and production instructions identify every required process and
  configuration value without exposing secrets.
