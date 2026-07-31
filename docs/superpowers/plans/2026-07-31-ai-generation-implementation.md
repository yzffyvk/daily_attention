# Asynchronous AI Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure, durable, asynchronous public-URL-to-editable-draft workflow using Supabase Queues and DeepSeek V4 Pro with thinking mode.

**Architecture:** The authenticated Next API creates and reads private jobs through service-role-only RPCs. A Supabase Queue delivers job IDs to an Edge Function. The worker obtains bounded HTML only through a separately deployed, DNS-pinning safe-fetch gateway, extracts text in memory, calls DeepSeek, validates JSON, and writes a temporary result for frontend polling.

**Tech Stack:** TypeScript 5.9, Node.js 22 HTTP/HTTPS/DNS, OCI container, React 19, Next.js 16/vinext, Supabase PostgreSQL 17/Auth/Queues/Edge Functions/Cron, DeepSeek Chat Completions, Zod 4.4.3, TanStack Query 5, IndexedDB, Vitest, pgTAP, Playwright.

## Global Constraints

- Complete and verify `2026-07-31-backend-hardening-implementation.md` before starting this plan.
- Input is one public HTTP/HTTPS URL; no file, PDF, image, audio, video upload, authenticated browsing, paywall bypass, or headless browser.
- Use the official DeepSeek endpoint `https://api.deepseek.com`, model `deepseek-v4-pro`, `thinking.type=enabled`, `reasoning_effort=high`, JSON Output, and `max_tokens=8192`.
- Never persist or log fetched page bodies or `reasoning_content`.
- Production Edge code must never fetch a user URL directly. It must call the authenticated safe-fetch gateway and fail closed when the gateway is unavailable.
- Pin every gateway connection to an address from the same validated DNS result; re-resolve and re-pin every redirect hop.
- AI output fills a local editable draft and never automatically writes `public.check_ins`.
- Enforce five occupied AI jobs per user per `Asia/Shanghai` quota day.
- A fetch-stage permanent failure or queued cancellation releases a reservation; once the provider call starts, the quota remains consumed.
- Internal retries keep one job and one user quota slot while accumulating actual provider-call and token counts.
- Keep job tables in `private`; all service RPCs must revoke `PUBLIC`, `anon`, and `authenticated`, then grant `service_role` only.
- Use a feature flag with default disabled. Existing manual check-in must remain available during AI outages or rollback.
- Create every migration and Edge Function scaffold with the Supabase CLI.
- Do not stage or modify the user-owned untracked `AGENTS.md`.

---

## File Structure

### Database and Edge runtime

- Migration created by `npx supabase migration new ai_generation_jobs`: private tables, Queue, functions, indexes, constraints, and grants.
- `supabase/tests/database/ai-generation.test.sql`: quota, idempotency, transitions, ownership, and privilege tests.
- `supabase/functions/_shared/ai/contracts.ts`: runtime-neutral task, provider, and result schemas.
- `supabase/functions/_shared/ai/safe-fetch-client.ts`: authenticated Edge client for the safe-fetch gateway.
- `supabase/functions/_shared/ai/extract.ts`: bounded HTML extraction.
- `supabase/functions/_shared/ai/deepseek.ts`: official DeepSeek HTTP adapter.
- `supabase/functions/_shared/ai/runner.ts`: one-job orchestration and retry classification.
- `supabase/functions/ai-generation-worker/index.ts`: Queue consumer HTTP entrypoint.
- `supabase/functions/ai-generation-worker/deno.json`: pinned imports.

### Safe-fetch gateway

- `services/safe-fetch-gateway/package.json` and `package-lock.json`: isolated Node.js 22 service dependencies and scripts.
- `services/safe-fetch-gateway/tsconfig.json`: service-only TypeScript build.
- `services/safe-fetch-gateway/Dockerfile`: non-root production OCI image.
- `services/safe-fetch-gateway/.dockerignore`: minimal container context.
- `services/safe-fetch-gateway/src/config.ts`: validated environment and limits.
- `services/safe-fetch-gateway/src/ip-policy.ts`: IPv4/IPv6 forbidden-range classification.
- `services/safe-fetch-gateway/src/normalize-url.ts`: canonical URL policy.
- `services/safe-fetch-gateway/src/fetch-public-html.ts`: DNS resolution, connection pinning, redirect, timeout, type, and size enforcement.
- `services/safe-fetch-gateway/src/server.ts`: authenticated `POST /v1/fetch` and health handler.
- `services/safe-fetch-gateway/src/index.ts`: process startup and safe shutdown.

### Next server

- `lib/domain/ai-generation.ts`: request and API response schemas.
- `server/ai/repository.ts`: service-role RPC adapter.
- `server/ai/service.ts`: create/read/cancel use cases and feature/short-rate limits.
- `server/ai/http.ts`: AI API envelope and safe error mapping.
- `app/api/ai/generations/route.ts`: create route.
- `app/api/ai/generations/[jobId]/route.ts`: read and cancel route.

### Frontend

- `features/ai-generation/types.ts`: client task/result types.
- `features/ai-generation/api.ts`: create, poll, and cancel client.
- `features/ai-generation/use-ai-generation.ts`: polling and draft-recovery hook.
- `features/checkins/checkin-editor.tsx`: wire the existing AI button and progress/result UI.
- `features/checkins/checkin-workspace.tsx`: store active job ID per target date and apply results to the correct draft.
- `lib/indexed-db/drafts.ts`: persist active AI job metadata with the existing local draft.

### Tests and operations

- `tests/unit/safe-fetch-gateway/*.test.ts`: URL/IP policy, DNS pinning, redirects, limits, authentication, and log redaction.
- `tests/unit/ai-generation/*.test.ts`: domain, safe-fetch client, extraction, DeepSeek, runner, repository, routes, API client, and hook tests.
- `tests/integration/ai-generation-api.test.ts`: local Supabase API and quota behavior.
- `tests/e2e/ai-generation.spec.ts`: user workflow using deterministic provider fixtures.
- `scripts/run-integration-tests.mjs`: add test-only worker/provider bindings.
- `scripts/run-e2e-server.mjs`: add deterministic AI provider mode.
- `.dev.vars.example`: non-secret configuration names.
- `docs/operations/supabase-runbook.md`: Queue, function, Cron, secret, monitoring, cleanup, and rollback.
- `lib/supabase/database.types.ts`: regenerated database types.

---

### Task 1: Create AI Job, Quota, Queue, and RPC Schema

**Files:**

- Create via CLI: `npx supabase migration new ai_generation_jobs`
- Create: `supabase/tests/database/ai-generation.test.sql`
- Modify after migration: `lib/supabase/database.types.ts`

**Interfaces:**

Service-role RPCs:

```ts
create_ai_generation_job(input): AiJobWithQuota
read_ai_generation_job(target_user_id, target_job_id): AiJobRow | null
cancel_ai_generation_job(target_user_id, target_job_id): AiJobRow
claim_ai_generation_job(target_job_id): AiJobRow | null
mark_ai_generation_fetch_failure(...): AiJobRow
begin_ai_generation(target_job_id): AiJobRow
complete_ai_generation_job(...): AiJobRow
expire_ai_generation_data(target_limit): ExpiryCounts
```

- [ ] **Step 1: Create failing pgTAP coverage**

Create `supabase/tests/database/ai-generation.test.sql` with explicit fixtures and at least these assertions:

1. `private.ai_generation_jobs` and `private.ai_daily_quotas` exist.
2. `anon` and `authenticated` have no table privileges.
3. `authenticated` cannot execute service RPCs.
4. Five distinct idempotency keys reserve five slots.
5. The sixth creation returns `DAILY_AI_LIMIT_REACHED`.
6. Repeating an existing key returns the same job and unchanged counts.
7. Cancelling `queued` releases one reservation.
8. Fetch failure releases one reservation.
9. `begin_ai_generation` moves one reserved count to consumed exactly once.
10. Provider failure after begin does not reduce consumed.
11. Wrong-owner read and cancel return no row or `FORBIDDEN_JOB`.
12. Illegal status transitions raise `AI_JOB_INVALID_TRANSITION`.
13. Queue message contains only `job_id`.
14. Result expiry clears text fields; metadata expiry deletes old rows.

Use six concurrent `dblink` sessions or six background `psql` transactions only if the existing pgTAP environment supports them; otherwise add the concurrency proof in integration tests and keep the database test focused on the locked quota function.

- [ ] **Step 2: Run the pgTAP test and verify it fails**

```bash
npx supabase test db --local supabase/tests/database/ai-generation.test.sql
```

Expected: FAIL because the tables, Queue, and functions do not exist.

- [ ] **Step 3: Generate the migration**

```bash
npx supabase migration new ai_generation_jobs
```

In the emitted file:

```sql
create extension if not exists pgmq with schema extensions;
select pgmq.create('ai_generation_jobs');

create table private.ai_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_date date not null,
  idempotency_key uuid not null,
  source_url text not null check (length(source_url) between 1 and 2048),
  source_host text not null check (length(source_host) between 1 and 253),
  source_title varchar(300),
  content_digest bytea,
  status text not null default 'queued'
    check (status in (
      'queued', 'fetching', 'generating', 'retryable',
      'succeeded', 'failed', 'cancelled'
    )),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 3),
  provider_call_count smallint not null default 0 check (provider_call_count >= 0),
  attention varchar(120),
  summary text check (summary is null or length(summary) <= 5000),
  inspiration text check (inspiration is null or length(inspiration) <= 2000),
  warnings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(warnings) = 'array'),
  error_code text,
  error_message text,
  provider text not null default 'deepseek',
  model text not null default 'deepseek-v4-pro',
  thinking_enabled boolean not null default true,
  reasoning_effort text not null default 'high'
    check (reasoning_effort in ('high', 'max')),
  prompt_version text not null default 'ai-summary-v1',
  prompt_tokens integer check (prompt_tokens is null or prompt_tokens >= 0),
  prompt_cache_hit_tokens integer
    check (prompt_cache_hit_tokens is null or prompt_cache_hit_tokens >= 0),
  prompt_cache_miss_tokens integer
    check (prompt_cache_miss_tokens is null or prompt_cache_miss_tokens >= 0),
  completion_tokens integer
    check (completion_tokens is null or completion_tokens >= 0),
  reasoning_tokens integer
    check (reasoning_tokens is null or reasoning_tokens >= 0),
  system_fingerprint text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  result_expires_at timestamptz,
  metadata_expires_at timestamptz not null default now() + interval '90 days',
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table private.ai_daily_quotas (
  user_id uuid not null references auth.users(id) on delete cascade,
  quota_date date not null,
  reserved_count smallint not null default 0,
  consumed_count smallint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, quota_date),
  check (
    reserved_count >= 0
    and consumed_count >= 0
    and reserved_count + consumed_count <= 5
  )
);
```

Add the spec's terminal-state constraints, indexes, touch triggers, Queue send, row locks, ownership predicates, and immediate revokes/grants. `create_ai_generation_job` computes the quota date with:

```sql
(pg_catalog.now() at time zone 'Asia/Shanghai')::date
```

Queue payload:

```sql
select pgmq.send(
  'ai_generation_jobs',
  jsonb_build_object('job_id', created_job.id)
);
```

- [ ] **Step 4: Reset, run pgTAP, and inspect migration order**

```bash
npx supabase db reset
npx supabase test db --local supabase/tests/database/ai-generation.test.sql
npx supabase migration list --local
```

Expected: all assertions PASS and the migration is applied once.

- [ ] **Step 5: Regenerate types**

```bash
npm run supabase:types
npm run typecheck
```

Expected: generated RPC signatures compile.

- [ ] **Step 6: Commit Task 1**

```bash
git add supabase/migrations supabase/tests/database/ai-generation.test.sql \
  lib/supabase/database.types.ts
git commit -m "feat: add durable ai generation jobs and quotas"
```

---

### Task 2: Define AI Domain Contracts and Safe API Envelopes

**Files:**

- Create: `lib/domain/ai-generation.ts`
- Create: `features/ai-generation/types.ts`
- Create: `server/ai/http.ts`
- Create: `tests/unit/ai-generation/domain.test.ts`
- Create: `tests/unit/ai-generation/http.test.ts`

**Interfaces:**

```ts
export const createAiGenerationSchema: ZodSchema<{
  sourceUrl: string;
  targetDate: string;
  idempotencyKey: string;
}>;

export const aiGenerationResultSchema: ZodSchema<{
  attention: string;
  summary: string;
  inspiration: string;
  sourceTitle: string;
  warnings: string[];
}>;
```

- [ ] **Step 1: Write failing schema tests**

Test accepted canonical HTTPS URLs and reject:

- `file:`, `ftp:`, credentials, fragments, ports other than 80/443;
- invalid dates and non-UUID idempotency keys;
- attention over 120, summary over 5000, inspiration over 2000, title over 300;
- non-string warnings and more than 10 warnings.

- [ ] **Step 2: Run the tests and verify failure**

```bash
npx vitest run tests/unit/ai-generation/domain.test.ts \
  tests/unit/ai-generation/http.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement schemas and API types**

Normalize URLs with `new URL`, lowercase the host, remove the default port, remove the fragment, and preserve path/query. Do not perform DNS checks in this browser/server validation layer.

Define stable client statuses and errors:

```ts
export type AiGenerationStatus =
  | "queued" | "fetching" | "generating" | "retryable"
  | "succeeded" | "failed" | "cancelled";
```

Map only documented error codes to HTTP statuses; unknown internal errors become:

```ts
{ code: "AI_SERVICE_UNAVAILABLE", message: "AI 服务暂时不可用，请稍后再试" }
```

- [ ] **Step 4: Run focused tests**

```bash
npx vitest run tests/unit/ai-generation/domain.test.ts \
  tests/unit/ai-generation/http.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add lib/domain/ai-generation.ts features/ai-generation/types.ts \
  server/ai/http.ts tests/unit/ai-generation
git commit -m "feat: define ai generation contracts"
```

---

### Task 3: Implement Service-Role Repository, Use Cases, and Routes

**Files:**

- Create: `server/ai/repository.ts`
- Create: `server/ai/service.ts`
- Create: `app/api/ai/generations/route.ts`
- Create: `app/api/ai/generations/[jobId]/route.ts`
- Create: `tests/unit/ai-generation/repository.test.ts`
- Create: `tests/unit/ai-generation/service.test.ts`
- Create: `tests/unit/ai-generation/routes.test.ts`
- Create: `tests/integration/ai-generation-api.test.ts`
- Modify: `server/rate-limit/service.ts`
- Modify through a new CLI migration: auth rate-limit allowed action list

**Interfaces:**

```ts
export interface AiGenerationRepository {
  create(input: CreateAiJob): Promise<AiJobWithQuota>;
  findOwned(userId: string, jobId: string): Promise<AiJob | null>;
  cancelOwned(userId: string, jobId: string): Promise<AiJob>;
}

export async function createGeneration(
  userId: string,
  input: CreateAiGenerationInput,
  repository: AiGenerationRepository,
  triggerWorker: () => Promise<void>,
): Promise<AiJobWithQuota>;
```

- [ ] **Step 1: Write failing repository, service, and route tests**

Cover:

- unauthenticated `POST`/`GET`/`DELETE` returns `401`;
- feature disabled returns `403 FEATURE_DISABLED`;
- create returns `202`, quota, no-store headers, and triggers worker after persistence;
- trigger failure still returns the durable queued job;
- sixth request returns `429 DAILY_AI_LIMIT_REACHED`;
- repeated idempotency key returns the original job;
- foreign job returns `403` without leaking existence;
- only queued jobs can cancel.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
npx vitest run tests/unit/ai-generation/repository.test.ts \
  tests/unit/ai-generation/service.test.ts \
  tests/unit/ai-generation/routes.test.ts
```

Expected: FAIL because server modules and routes are absent.

- [ ] **Step 3: Add AI burst limiting**

Add an `aiGenerate` policy of 10 accepted route attempts per 10 minutes to `RATE_LIMITS`. Create a separate CLI migration extending `consume_auth_rate_limit`'s allowed tuple:

```text
action = ai_generate
attempts = 10
window = 600
```

The raw bucket combines authenticated user ID and request IP before HMAC. This burst limit is separate from the five-call daily quota.

- [ ] **Step 4: Implement repository and service**

The repository uses `createAdminSupabase().rpc(...)` and validates every RPC response with Zod. The route obtains `userId` only from `createServerSupabase().auth.getUser()`.

Worker trigger:

```ts
await admin.functions.invoke("ai-generation-worker", {
  body: { source: "enqueue" },
  headers: {
    Authorization: `Bearer ${process.env.AI_WORKER_TRIGGER_TOKEN}`,
  },
});
```

Wrap only this invoke in a catch that emits a sanitized warning. Do not roll back the already committed job.

- [ ] **Step 5: Run unit and integration tests**

```bash
npx vitest run tests/unit/ai-generation
npm run test:integration
```

Expected: PASS, including concurrent daily quota coverage.

- [ ] **Step 6: Commit Task 3**

```bash
git add server/ai app/api/ai server/rate-limit/service.ts \
  supabase/migrations tests/unit/ai-generation tests/integration/ai-generation-api.test.ts
git commit -m "feat: add ai generation job api"
```

---

### Task 4: Build the DNS-Pinned Safe-Fetch Gateway and Edge Client

**Files:**

- Create: `services/safe-fetch-gateway/package.json`
- Create: `services/safe-fetch-gateway/package-lock.json`
- Create: `services/safe-fetch-gateway/tsconfig.json`
- Create: `services/safe-fetch-gateway/Dockerfile`
- Create: `services/safe-fetch-gateway/.dockerignore`
- Create: `services/safe-fetch-gateway/src/config.ts`
- Create: `services/safe-fetch-gateway/src/ip-policy.ts`
- Create: `services/safe-fetch-gateway/src/normalize-url.ts`
- Create: `services/safe-fetch-gateway/src/fetch-public-html.ts`
- Create: `services/safe-fetch-gateway/src/server.ts`
- Create: `services/safe-fetch-gateway/src/index.ts`
- Create: `supabase/functions/_shared/ai/safe-fetch-client.ts`
- Create: `tests/unit/safe-fetch-gateway/ip-policy.test.ts`
- Create: `tests/unit/safe-fetch-gateway/fetch-public-html.test.ts`
- Create: `tests/unit/safe-fetch-gateway/server.test.ts`
- Create: `tests/unit/ai-generation/safe-fetch-client.test.ts`

**Interfaces:**

```ts
export type ResolveAll = (
  hostname: string,
) => Promise<Array<{ address: string; family: 4 | 6 }>>;

export async function fetchPublicHtml(input: {
  sourceUrl: string;
  resolveAll: ResolveAll;
  signal: AbortSignal;
}): Promise<{
  finalUrl: string;
  contentType: string;
  body: string;
}>;

export function createSafeFetchClient(config: {
  baseUrl: string;
  token: string;
}): (sourceUrl: string, signal: AbortSignal) => Promise<SafeFetchResult>;
```

- [ ] **Step 1: Write failing gateway and client security tests**

Use table-driven cases for:

- IPv4 private, loopback, link-local, multicast, documentation and metadata ranges;
- IPv6 loopback, unique-local, link-local, IPv4-mapped private addresses;
- decimal/hex/octal-like host representations rejected before DNS;
- public DNS returning any private address rejected, even when another result is public;
- the socket lookup callback returns the selected validated address without performing a second DNS lookup;
- HTTPS retains the original hostname for `Host`, SNI, and certificate verification while connecting to the selected IP;
- redirect from public to private rejected;
- more than five redirects;
- response over 2 MiB;
- unsupported content type;
- total timeout.
- missing or incorrect gateway bearer returns `401` without invoking DNS;
- gateway errors map to stable worker errors without exposing DNS results or response bodies;
- gateway logs contain request ID, hashed host, status, timing, and byte count only.

- [ ] **Step 2: Run the test and verify failure**

```bash
npx vitest run tests/unit/safe-fetch-gateway \
  tests/unit/ai-generation/safe-fetch-client.test.ts
```

Expected: FAIL because the gateway and Edge client do not exist.

- [ ] **Step 3: Implement URL/IP policy and DNS-pinned transport**

Use Node.js 22 built-ins only. Normalize with `URL`, allow only HTTP/HTTPS on ports 80/443, reject credentials/fragments and ambiguous numeric host forms, and classify IPv4, IPv6, and IPv4-mapped IPv6 addresses.

For every hop:

1. call `dns.promises.lookup(hostname, { all: true, verbatim: true })`;
2. reject the entire hop if any answer is forbidden;
3. select one validated answer;
4. call `http.request` or `https.request` with the original hostname and a custom `lookup` callback that returns only the selected address;
5. disable connection reuse, keep the original hostname for `Host`, TLS SNI, and certificate verification;
6. handle redirects manually and repeat all checks, up to five redirects.

Enforce a 5-second connect timeout, 15-second total timeout, 2 MiB streamed body limit, and an allowlist of `text/html`, `application/xhtml+xml`, and `text/plain`. Never trust `Content-Length` as the only size check.

Send `Accept-Encoding: identity` so the byte limit applies to the transferred representation without an implicit decompression step. Resolve relative `Location` values against the current URL and reject redirects without a valid HTTP/HTTPS target.

- [ ] **Step 4: Implement authenticated gateway HTTP service and Edge client**

`POST /v1/fetch` accepts `{ "sourceUrl": "..." }` only after a constant-time comparison with `SAFE_FETCH_GATEWAY_TOKEN`. Return `{ finalUrl, contentType, body }`; return stable error codes and never include resolved IPs or upstream bodies. `/healthz` returns readiness without configuration values.

The Edge client calls `SAFE_FETCH_GATEWAY_URL/v1/fetch` over HTTPS with its dedicated bearer and an abort signal. It validates the response shape and maximum body length. It has no direct-fetch fallback.

Create a multi-stage Dockerfile that runs the compiled service as a non-root user, exposes only the configured HTTP port, and includes a health check. The production deployment must terminate TLS before the service and apply an egress firewall denying private, link-local, loopback, multicast, reserved, and cloud metadata networks.

- [ ] **Step 5: Run gateway and client tests, build, and smoke-test the container**

```bash
npx vitest run tests/unit/safe-fetch-gateway \
  tests/unit/ai-generation/safe-fetch-client.test.ts
npm --prefix services/safe-fetch-gateway run build
docker build -t today-ai-safe-fetch:test services/safe-fetch-gateway
docker run --rm -d --name today-ai-safe-fetch-test \
  -p 127.0.0.1:8788:8788 \
  -e PORT=8788 \
  -e SAFE_FETCH_GATEWAY_TOKEN=local-test-token-with-at-least-32-characters \
  today-ai-safe-fetch:test
curl --fail http://127.0.0.1:8788/healthz
docker stop today-ai-safe-fetch-test
```

Expected: tests and build PASS, health check returns `200`, and the explicitly named temporary container is removed after stopping.

- [ ] **Step 6: Commit Task 4**

```bash
git add services/safe-fetch-gateway \
  supabase/functions/_shared/ai/safe-fetch-client.ts \
  tests/unit/safe-fetch-gateway \
  tests/unit/ai-generation/safe-fetch-client.test.ts
git commit -m "feat: add dns-pinned safe fetch gateway"
```

---

### Task 5: Extract and Bound Article Content

**Files:**

- Create: `supabase/functions/_shared/ai/extract.ts`
- Create: `tests/unit/ai-generation/extract.test.ts`
- Add a pinned HTML parsing dependency to `supabase/functions/ai-generation-worker/deno.json`

**Interfaces:**

```ts
export function extractLearningSource(input: {
  html: string;
  finalUrl: string;
}): {
  title: string;
  text: string;
  contentDigestHex: string;
};
```

- [ ] **Step 1: Write failing extraction tests**

Fixtures must prove:

- script, style, form, nav, footer, hidden and advertisement content is absent;
- article/main content wins over navigation;
- OpenGraph title falls back to `<title>`;
- whitespace is normalized;
- fewer than 200 useful characters raises `CONTENT_NOT_EXTRACTABLE`;
- the model-bound text is capped at the configured 60,000 characters;
- digest is stable for equivalent normalized text;
- no source HTML appears in thrown errors.

- [ ] **Step 2: Run the test and verify failure**

```bash
npx vitest run tests/unit/ai-generation/extract.test.ts
```

Expected: FAIL because the extractor is absent.

- [ ] **Step 3: Implement the minimal deterministic extractor**

Use a pinned, Edge-compatible DOM parser. Prefer `<article>`, then `<main>`, then body. Remove unsafe/noisy elements and nodes with `hidden`, `aria-hidden=true`, or inline `display:none`.

Build the bounded text in this order:

1. normalized title;
2. first article paragraphs;
3. headings and remaining paragraphs;
4. final paragraphs while space remains.

Compute SHA-256 over normalized UTF-8 text using `crypto.subtle`.

- [ ] **Step 4: Run extraction tests**

```bash
npx vitest run tests/unit/ai-generation/extract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add supabase/functions/_shared/ai/extract.ts \
  supabase/functions/ai-generation-worker/deno.json \
  tests/unit/ai-generation/extract.test.ts
git commit -m "feat: extract bounded learning content"
```

---

### Task 6: Implement the DeepSeek V4 Pro Provider

**Files:**

- Create: `supabase/functions/_shared/ai/contracts.ts`
- Create: `supabase/functions/_shared/ai/deepseek.ts`
- Create: `tests/unit/ai-generation/deepseek.test.ts`

**Interfaces:**

```ts
export interface AiSummaryProvider {
  generate(input: {
    sourceTitle: string;
    sourceText: string;
    anonymousUserId: string;
  }): Promise<{
    result: AiGenerationResult;
    usage: AiUsage;
    model: string;
    systemFingerprint: string | null;
  }>;
}
```

- [ ] **Step 1: Write failing request and response tests**

Assert the outgoing JSON contains:

```json
{
  "model": "deepseek-v4-pro",
  "thinking": { "type": "enabled" },
  "reasoning_effort": "high",
  "response_format": { "type": "json_object" },
  "max_tokens": 8192,
  "stream": false
}
```

Assert it omits `temperature`, `top_p`, penalties, email, Supabase UUID, and source URL. Assert the system prompt says the source is untrusted data and requires JSON.

Cover successful usage mapping, empty content, truncated `finish_reason=length`, content filter, 429, 5xx, `insufficient_system_resource`, invalid JSON, schema overflow, and a response containing `reasoning_content` that is discarded.

- [ ] **Step 2: Run the test and verify failure**

```bash
npx vitest run tests/unit/ai-generation/deepseek.test.ts
```

Expected: FAIL because the provider does not exist.

- [ ] **Step 3: Implement direct HTTP adapter**

Use `fetch("https://api.deepseek.com/chat/completions")` with:

```ts
headers: {
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
}
```

Parse the outer response and `message.content` separately. Validate final content with `aiGenerationResultSchema`. Map usage:

```ts
{
  promptTokens: usage.prompt_tokens,
  promptCacheHitTokens: usage.prompt_cache_hit_tokens ?? 0,
  promptCacheMissTokens: usage.prompt_cache_miss_tokens ?? 0,
  completionTokens: usage.completion_tokens,
  reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
}
```

Never expose or return `reasoning_content`.

- [ ] **Step 4: Run provider tests**

```bash
npx vitest run tests/unit/ai-generation/deepseek.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add supabase/functions/_shared/ai/contracts.ts \
  supabase/functions/_shared/ai/deepseek.ts \
  tests/unit/ai-generation/deepseek.test.ts
git commit -m "feat: add deepseek v4 pro summary provider"
```

---

### Task 7: Build the Queue Worker and Retry State Machine

**Files:**

- Create: `supabase/functions/_shared/ai/runner.ts`
- Create via CLI: `npx supabase functions new ai-generation-worker`
- Modify: `supabase/functions/ai-generation-worker/index.ts`
- Modify: `supabase/functions/ai-generation-worker/deno.json`
- Create: `tests/unit/ai-generation/runner.test.ts`
- Create: `tests/unit/ai-generation/worker.test.ts`

**Interfaces:**

```ts
export async function runAiJob(
  jobId: string,
  ports: AiJobRunnerPorts,
): Promise<"completed" | "retryable" | "ignored">;
```

- [ ] **Step 1: Write failing runner tests**

Cover:

- duplicate delivery of a terminal job returns `ignored`;
- claim moves queued/retryable to fetching;
- permanent fetch error releases reservation and marks failed;
- provider begin consumes exactly one reserved quota;
- provider success validates and completes;
- 429/5xx/resource errors become retryable while attempts remain;
- fourth processing attempt becomes `TASK_RETRY_EXHAUSTED`;
- provider-started failures never refund quota;
- internal provider retry accumulates calls and usage;
- raw page body and reasoning are absent from port calls and log fields.

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run tests/unit/ai-generation/runner.test.ts \
  tests/unit/ai-generation/worker.test.ts
```

Expected: FAIL because runner and worker are absent.

- [ ] **Step 3: Implement runner with explicit error classes**

Permanent fetch errors:

```text
URL_NOT_ALLOWED
TOO_MANY_REDIRECTS
RESPONSE_TOO_LARGE
UNSUPPORTED_CONTENT_TYPE
CONTENT_NOT_EXTRACTABLE
CONTENT_BLOCKED
```

Retryable errors:

```text
FETCH_TIMEOUT
MODEL_RATE_LIMITED
MODEL_SERVICE_ERROR
MODEL_OUTPUT_INVALID
```

Retry delays are 5, 30, and 120 seconds. Use Queue visibility/delay rather than sleeping inside the function.

- [ ] **Step 4: Generate and implement the Edge Function**

```bash
npx supabase functions new ai-generation-worker
```

The handler:

1. validates `AI_WORKER_TRIGGER_TOKEN`;
2. reads at most five messages from `pgmq_public.read`;
3. runs jobs with a bounded concurrency of two;
4. deletes successful, permanent-failure, ignored, or retry-exhausted messages;
5. leaves retryable messages available with the computed delay;
6. returns `{ requestId, received, completed, retryable, failed }`.

Use `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DEEPSEEK_API_KEY`, `AI_USER_ID_PEPPER`, `AI_WORKER_TRIGGER_TOKEN`, `SAFE_FETCH_GATEWAY_URL`, and `SAFE_FETCH_GATEWAY_TOKEN`. Fail startup if any is absent or if the gateway URL is not HTTPS outside tests. The runner calls only `safe-fetch-client.ts`; it contains no source-URL `fetch` call.

- [ ] **Step 5: Run unit tests and local worker smoke test**

```bash
npx vitest run tests/unit/ai-generation/runner.test.ts \
  tests/unit/ai-generation/worker.test.ts
npx supabase functions serve ai-generation-worker --env-file .dev.vars
```

Invoke with a test message, the local safe-fetch gateway fixture, and a deterministic mocked DeepSeek endpoint. Verify one job reaches `succeeded`.

- [ ] **Step 6: Commit Task 7**

```bash
git add supabase/functions/_shared/ai/runner.ts \
  supabase/functions/ai-generation-worker \
  tests/unit/ai-generation/runner.test.ts \
  tests/unit/ai-generation/worker.test.ts
git commit -m "feat: process ai generation queue jobs"
```

---

### Task 8: Connect Polling and Draft Recovery to the Existing AI UI

**Files:**

- Create: `features/ai-generation/api.ts`
- Create: `features/ai-generation/use-ai-generation.ts`
- Modify: `features/checkins/checkin-editor.tsx`
- Modify: `features/checkins/checkin-workspace.tsx`
- Modify: `features/drafts/use-checkin-draft.ts`
- Modify: `lib/indexed-db/drafts.ts`
- Create: `tests/unit/ai-generation/api.test.ts`
- Create: `tests/unit/ai-generation/use-ai-generation.test.tsx`
- Modify: `tests/unit/checkins/checkin-editor.test.tsx`
- Modify: `tests/unit/checkins/workspace.test.tsx`
- Modify: `tests/unit/drafts/store.test.ts`

**Interfaces:**

```ts
export type ActiveAiJob = {
  jobId: string;
  targetDate: string;
  sourceUrl: string;
  createdAt: string;
};

export function useAiGeneration(input: {
  activeJob: ActiveAiJob | null;
  onSucceeded(result: AiGenerationResult, targetDate: string): void;
  onTerminal(jobId: string): void;
}): AiGenerationController;
```

- [ ] **Step 1: Write failing API and hook tests**

Cover:

- create sends one stable idempotency key;
- a network retry reuses the same key;
- polling intervals progress from 1500 ms to 3000 ms to 5000 ms;
- hidden document uses 15000 ms;
- refresh restores an active job from IndexedDB;
- success applies to `targetDate`, not the currently viewed date;
- failure preserves existing draft and URL;
- expired/cancelled jobs clear active metadata;
- unmount cancels timers and requests.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
npx vitest run tests/unit/ai-generation \
  tests/unit/checkins/checkin-editor.test.tsx \
  tests/unit/checkins/workspace.test.tsx \
  tests/unit/drafts/store.test.ts
```

Expected: FAIL because client and hook modules are absent.

- [ ] **Step 3: Extend local draft metadata**

Add optional `activeAiJob` without changing existing stored draft fields. The IndexedDB read path must treat old rows without this field as valid.

- [ ] **Step 4: Implement API and polling hook**

Reuse the existing `requestApi` envelope behavior. Do not use Supabase Realtime for private jobs. Abort in-flight GETs when the job changes or component unmounts.

After two minutes, set `isLongRunning=true` while continuing at the hidden/slow poll interval; do not mark the task failed.

- [ ] **Step 5: Replace the “尚未接入” button behavior**

In `checkin-editor.tsx`:

- remove the `即将接入` badge and placeholder notice;
- disable generate when URL empty, offline, saving, or job active;
- display queued/fetching/generating/validation copy;
- expose cancel only while queued;
- display quota remaining after create;
- keep attention and summary editable at all times after success.

In `checkin-workspace.tsx`, merge the successful result into the target date draft:

```ts
{
  attention: result.attention,
  summary: result.summary,
  inspiration: result.inspiration,
  sourceUrl: activeJob.sourceUrl,
}
```

Do not call `saveCheckIn`.

- [ ] **Step 6: Run focused UI and draft tests**

```bash
npx vitest run tests/unit/ai-generation \
  tests/unit/checkins/checkin-editor.test.tsx \
  tests/unit/checkins/workspace.test.tsx \
  tests/unit/drafts/store.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 8**

```bash
git add features/ai-generation features/checkins features/drafts \
  lib/indexed-db/drafts.ts tests/unit/ai-generation \
  tests/unit/checkins tests/unit/drafts/store.test.ts
git commit -m "feat: connect ai generation to editable drafts"
```

---

### Task 9: Add Cleanup, Configuration, Cron, and Operations

**Files:**

- Create through a CLI migration: AI result and metadata cleanup functions.
- Create: `supabase/functions/ai-generation-maintenance/index.ts`
- Create: `supabase/functions/ai-generation-maintenance/deno.json`
- Modify: `.dev.vars.example`
- Modify: `vite.config.ts`
- Modify: `scripts/run-integration-tests.mjs`
- Modify: `scripts/run-e2e-server.mjs`
- Modify: `docs/operations/supabase-runbook.md`
- Create: `tests/unit/ai-generation/maintenance.test.ts`

**Interfaces:**

```ts
expire_ai_generation_data(target_limit integer)
returns table(cleared_results integer, deleted_jobs integer)
```

- [ ] **Step 1: Write failing cleanup and configuration tests**

Assert:

- succeeded/failed text older than 24 hours is cleared;
- metadata older than 90 days is deleted;
- nonterminal jobs are never deleted;
- cleanup batch is bounded to 500;
- missing production AI secrets fail worker startup;
- test runner supplies deterministic fake provider bindings without a real key.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
npx vitest run tests/unit/ai-generation/maintenance.test.ts \
  tests/unit/supabase-clients.test.ts
```

Expected: FAIL because cleanup and bindings are absent.

- [ ] **Step 3: Create the cleanup migration and function**

```bash
npx supabase migration new ai_generation_cleanup
```

Implement a service-role-only, bounded function that first nulls result/error message fields when `result_expires_at <= now()`, then deletes terminal rows when `metadata_expires_at <= now()`.

- [ ] **Step 4: Implement maintenance Edge Function**

Generate with:

```bash
npx supabase functions new ai-generation-maintenance
```

Require a dedicated `AI_MAINTENANCE_TOKEN`, call the cleanup RPC with limit 500, and return counts only.

- [ ] **Step 5: Add environment names and deterministic test bindings**

Add names without values to `.dev.vars.example`:

```text
AI_GENERATION_ENABLED
AI_WORKER_TRIGGER_TOKEN
AI_MAINTENANCE_TOKEN
AI_USER_ID_PEPPER
DEEPSEEK_API_KEY
DEEPSEEK_BASE_URL
SAFE_FETCH_GATEWAY_URL
SAFE_FETCH_GATEWAY_TOKEN
```

Integration/E2E tests use `AI_PROVIDER_MODE=fake` and a local deterministic provider fixture. Production code must reject `AI_PROVIDER_MODE=fake` unless `NODE_ENV=test` or `INTEGRATION_TEST_BINDINGS=true`.

- [ ] **Step 6: Document production operations**

Runbook must include:

- enable Supabase Queue and deploy both functions with JWT verification;
- build and deploy the safe-fetch OCI image behind HTTPS, as a non-root process, with private/link-local/metadata egress denied;
- set and independently rotate `SAFE_FETCH_GATEWAY_TOKEN` on the gateway and Edge Function;
- verify `/healthz`, an allowed public fixture, private-address rejection, redirect-to-private rejection, and gateway-unavailable fail-closed behavior;
- set secrets without printing values;
- schedule worker safety-net every minute and maintenance hourly;
- test Queue depth and oldest-message queries;
- alert thresholds from the spec;
- feature flag rollout;
- rollback by setting `AI_GENERATION_ENABLED=false`;
- let `generating` jobs finish while blocking new jobs;
- never use a user token or the service-role key as a Cron bearer.

- [ ] **Step 7: Run focused tests and commit**

```bash
npx vitest run tests/unit/ai-generation/maintenance.test.ts \
  tests/unit/supabase-clients.test.ts
npm run typecheck
```

Then:

```bash
git add supabase/migrations supabase/functions/ai-generation-maintenance \
  .dev.vars.example vite.config.ts scripts docs/operations/supabase-runbook.md \
  tests/unit/ai-generation/maintenance.test.ts
git commit -m "feat: add ai generation operations and cleanup"
```

---

### Task 10: Complete Integration, E2E, Security, and Deployment Verification

**Files:**

- Modify: `tests/integration/ai-generation-api.test.ts`
- Create: `tests/e2e/ai-generation.spec.ts`
- Modify: `tests/e2e/helpers.ts`
- Modify only when a test exposes a defect: files owned by Tasks 1–9.

**Interfaces:**

- Produces a deployable feature that defaults off and is safe to enable for internal accounts.

- [ ] **Step 1: Add integration concurrency and retry scenarios**

Use six authenticated concurrent POST requests with distinct idempotency keys and assert exactly five `202` and one `429`. Add duplicate-delivery, gateway-unavailable, fetch-failure refund, provider-failure non-refund, retry exhaustion, foreign read, cancel race, and result-expiry cases.

- [ ] **Step 2: Add deterministic E2E workflow**

Cover:

1. submit a public fixture URL;
2. observe queued/fetching/generating copy;
3. receive deterministic result;
4. edit the generated summary;
5. verify no check-in exists before clicking save;
6. click save and verify the edited content persists;
7. refresh during processing and recover polling;
8. switch dates during processing and verify target-date isolation;
9. fail extraction without clearing existing draft;
10. show daily-limit messaging on request six.

- [ ] **Step 3: Run the AI-focused suite**

```bash
npx supabase test db --local supabase/tests/database/ai-generation.test.sql
npx vitest run tests/unit/ai-generation
npm run test:integration
npx playwright test tests/e2e/ai-generation.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Run full security and regression verification**

```bash
npm run supabase:test
npx supabase db advisors --local --type security --level warn --fail-on error
npx supabase db advisors --local --type performance --level warn --fail-on error
npm run test:unit
npm run test:integration
npm run test:rendered
npm run test:e2e
npm run lint
npm run typecheck
npm run build
npm --prefix services/safe-fetch-gateway run build
docker build -t today-ai-safe-fetch:verify services/safe-fetch-gateway
```

Expected: every command exits 0.

- [ ] **Step 5: Perform local log-leak scan**

Run the deterministic success, provider error, invalid URL, gateway rejection, and prompt-injection fixtures while capturing server/function/gateway logs to an explicitly created temporary directory. Search:

```bash
AI_LOG_SCAN_DIR="$(mktemp -d)"
rg -n 'DEEPSEEK_API_KEY|reasoning_content|person@example|https://example.com/private' \
  "$AI_LOG_SCAN_DIR"
rm -rf "$AI_LOG_SCAN_DIR"
```

Expected: no matches. Delete only the explicitly created temporary log directory after inspection.

- [ ] **Step 6: Verify rollout defaults and final diff**

```bash
git diff --check
git status --short
git log --oneline -12
```

Confirm:

- AI is disabled when `AI_GENERATION_ENABLED` is absent.
- Manual check-in works with worker, Queue, or DeepSeek unavailable.
- Worker fails closed when the safe-fetch gateway is unavailable and has no direct source-URL fetch path.
- No secret or real project identifier is staged.
- No page body or reasoning field exists in migrations, logs, fixtures, or snapshots.
- `AGENTS.md` remains untracked and unstaged.

- [ ] **Step 7: Commit verification corrections only if required**

If verification required corrections, stage only the explicitly corrected AI files and commit:

```bash
git commit -m "fix: close ai generation verification gaps"
```

Do not create an empty commit.
