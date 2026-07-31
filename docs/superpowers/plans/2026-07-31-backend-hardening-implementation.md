# Backend Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the existing Supabase-backed authentication, check-in, statistics, storage, and API observability paths without changing user-visible behavior.

**Architecture:** Keep the current Next.js/vinext API and Supabase data model. Move streak aggregation into a security-invoker database function, add service-role-only storage maintenance primitives plus a scheduled Edge Function, and centralize sanitized structured server logging.

**Tech Stack:** TypeScript 5.9, Next.js 16/vinext, Supabase CLI 2.109.1, PostgreSQL 17, pgTAP, Supabase Edge Functions, Vitest, Playwright.

## Global Constraints

- Preserve the existing authentication, manual check-in, optimistic concurrency, image upload, and API envelope behavior.
- Create every migration with `npx supabase migration new <name>`; do not invent migration filenames.
- Keep `private` schema unexposed and enable RLS on every table in exposed schemas.
- Every `SECURITY DEFINER` function must use `set search_path = ''`, revoke execution from `PUBLIC`, `anon`, and `authenticated`, and grant only the required role.
- Never log request bodies, email addresses, recovery codes, signed URLs, secrets, complete source URLs, or database stack traces.
- Do not stage or modify the user-owned untracked `AGENTS.md`.
- Run the focused failing test before implementation, then the focused passing test, then the full phase verification.

---

## File Structure

### New files

- Migration created by `npx supabase migration new checkin_stats_rpc`: database statistics function.
- Migration created by `npx supabase migration new storage_maintenance_primitives`: storage-maintenance functions.
- `supabase/tests/database/checkin-stats.test.sql`: pgTAP coverage for statistics semantics and privileges.
- `supabase/tests/database/storage-maintenance.test.sql`: pgTAP coverage for expired reservations, orphan candidates, and privileges.
- `lib/server/logging.ts`: sanitized structured logging helpers shared by auth, check-in, upload, and maintenance paths.
- `tests/unit/server/logging.test.ts`: redaction and output-shape tests.
- `supabase/functions/storage-maintenance/index.ts`: authenticated maintenance worker.
- `supabase/functions/storage-maintenance/deno.json`: pinned Edge Function dependency map.
- `tests/unit/storage/maintenance.test.ts`: orchestration tests with fake RPC and Storage ports.

### Modified files

- `server/checkins/repository.ts`: replace `findAllDates` with one stats RPC.
- `server/checkins/stats-service.ts`: delegate to the repository result.
- `tests/unit/checkins/stats-service.test.ts`: assert delegation and mapping.
- `tests/integration/checkins-api.test.ts`: preserve API behavior with database aggregation.
- `server/checkins/http.ts`: use centralized sanitized logging.
- `server/auth/response.ts`: use centralized sanitized logging.
- `app/api/checkins/[date]/route.ts`: use centralized cleanup-failure logging.
- `docs/operations/supabase-runbook.md`: advisor, secret, schedule, manual invocation, alert, and rollback instructions.
- `package.json`: add focused maintenance verification scripts only if repeated commands otherwise remain error-prone.
- `lib/supabase/database.types.ts`: regenerate after the migration.

---

### Task 1: Move Check-In Statistics Into PostgreSQL

**Files:**

- Create via CLI: `npx supabase migration new checkin_stats_rpc`
- Create: `supabase/tests/database/checkin-stats.test.sql`
- Modify: `server/checkins/repository.ts`
- Modify: `server/checkins/stats-service.ts`
- Modify: `tests/unit/checkins/stats-service.test.ts`
- Modify: `tests/integration/checkins-api.test.ts`

**Interfaces:**

- Produces database RPC:

```ts
get_check_in_stats(target_today: string): Promise<{
  total_count: number;
  current_streak: number;
  has_today_record: boolean;
}>
```

- Produces repository method:

```ts
getStats(today: string): Promise<CheckInStats>
```

- Preserves service signature:

```ts
getCheckInStats(
  userId: string,
  today: string,
  repository: CheckInRepository,
): Promise<CheckInStats>
```

- `userId` remains in the service signature for compatibility and audit context; authorization comes from the authenticated Supabase client and `auth.uid()`, never from an RPC user argument.

- [ ] **Step 1: Add failing pgTAP tests for statistics and privileges**

Create `supabase/tests/database/checkin-stats.test.sql` with authenticated users and records covering:

```sql
begin;
select plan(8);

-- Insert two auth users and matching profiles using the same fixture columns
-- already used in rls.test.sql.
-- User one has 2026-06-29, 2026-06-30, 2026-07-01 and an older record.
-- User two has unrelated dates.

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000701","role":"authenticated"}',
  true
);

select results_eq(
  $$select total_count, current_streak, has_today_record
    from public.get_check_in_stats('2026-07-01'::date)$$,
  $$values (4::bigint, 3, true)$$,
  'statistics aggregate only the current user and cross month boundaries'
);

select results_eq(
  $$select total_count, current_streak, has_today_record
    from public.get_check_in_stats('2026-07-02'::date)$$,
  $$values (4::bigint, 3, false)$$,
  'a missing today continues the streak from yesterday'
);

select function_privs_are(
  'public',
  'get_check_in_stats',
  array['date'],
  'anon',
  array[]::text[],
  'anonymous users cannot execute statistics'
);

select function_privs_are(
  'public',
  'get_check_in_stats',
  array['date'],
  'authenticated',
  array['EXECUTE'],
  'authenticated users can execute their own statistics'
);

select * from finish();
rollback;
```

Fill the four remaining assertions with the empty-history, single-day, future-record exclusion, and cross-user isolation cases using explicit expected rows.

- [ ] **Step 2: Run the database test and verify it fails**

Run:

```bash
npx supabase test db --local supabase/tests/database/checkin-stats.test.sql
```

Expected: FAIL because `public.get_check_in_stats(date)` does not exist.

- [ ] **Step 3: Create the migration through Supabase CLI**

Run:

```bash
npx supabase migration new checkin_stats_rpc
```

Use the exact migration path printed by the CLI for this task. Add a `security invoker`, `stable`, SQL function:

```sql
create function public.get_check_in_stats(target_today date)
returns table (
  total_count bigint,
  current_streak integer,
  has_today_record boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive
  owned_dates as (
    select records.checkin_date
    from public.check_ins records
    where records.user_id = (select auth.uid())
      and records.checkin_date <= target_today
  ),
  anchor as (
    select case
      when exists (
        select 1 from owned_dates where checkin_date = target_today
      ) then target_today
      else target_today - 1
    end as day
  ),
  streak(day, length) as (
    select anchor.day, 0
    from anchor
    union all
    select streak.day - 1, streak.length + 1
    from streak
    where exists (
      select 1 from owned_dates where checkin_date = streak.day
    )
  )
  select
    (select count(*) from public.check_ins records
      where records.user_id = (select auth.uid()))::bigint,
    coalesce((select max(length) from streak), 0)::integer,
    exists (
      select 1 from owned_dates where checkin_date = target_today
    );
$$;

revoke all on function public.get_check_in_stats(date)
from public, anon;
grant execute on function public.get_check_in_stats(date)
to authenticated;
```

Do not use `SECURITY DEFINER`; the function must remain subject to `check_ins` RLS.

- [ ] **Step 4: Run the pgTAP test and correct SQL semantics until it passes**

Run:

```bash
npx supabase db reset
npx supabase test db --local supabase/tests/database/checkin-stats.test.sql
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Add the failing repository and service tests**

Replace the date-array fake in `tests/unit/checkins/stats-service.test.ts` with:

```ts
const expected = {
  totalCount: 5,
  currentStreak: 3,
  hasTodayRecord: true,
};
const store = {
  getStats: vi.fn().mockResolvedValue(expected),
} as unknown as CheckInRepository;

await expect(
  getCheckInStats("user-1", "2026-07-01", store),
).resolves.toEqual(expected);
expect(store.getStats).toHaveBeenCalledExactlyOnceWith("2026-07-01");
```

Add an integration assertion in `tests/integration/checkins-api.test.ts` that user two's records do not affect user one's `/api/checkins/stats?today=2026-07-01` response.

- [ ] **Step 6: Run focused TypeScript tests and verify the old interface fails**

Run:

```bash
npx vitest run tests/unit/checkins/stats-service.test.ts
```

Expected: FAIL because `CheckInRepository.getStats` is not implemented.

- [ ] **Step 7: Implement the repository RPC and service delegation**

In `server/checkins/repository.ts`:

```ts
getStats(today: string): Promise<CheckInStats>;
```

Implementation:

```ts
async getStats(today) {
  const { data, error } = await supabase
    .rpc("get_check_in_stats", { target_today: today })
    .single();
  if (error) throw error;
  return {
    totalCount: Number(data.total_count),
    currentStreak: data.current_streak,
    hasTodayRecord: data.has_today_record,
  };
}
```

Remove `findAllDates`. Replace `server/checkins/stats-service.ts` with a thin delegation that preserves the public signature and explicitly ignores the already-authenticated `userId`:

```ts
export async function getCheckInStats(
  _userId: string,
  today: string,
  repository: CheckInRepository,
) {
  return repository.getStats(today);
}
```

- [ ] **Step 8: Run focused and integration tests**

Run:

```bash
npx vitest run tests/unit/checkins/stats-service.test.ts
npm run test:integration
```

Expected: PASS, including the unchanged API response fields.

- [ ] **Step 9: Commit Task 1**

Stage the CLI-created migration, database test, repository, service, and affected tests:

```bash
git add supabase/migrations supabase/tests/database/checkin-stats.test.sql \
  server/checkins/repository.ts server/checkins/stats-service.ts \
  tests/unit/checkins/stats-service.test.ts tests/integration/checkins-api.test.ts
git commit -m "perf: aggregate check-in statistics in postgres"
```

---

### Task 2: Centralize Sanitized Structured Logging

**Files:**

- Create: `lib/server/logging.ts`
- Create: `tests/unit/server/logging.test.ts`
- Modify: `server/checkins/http.ts`
- Modify: `server/auth/response.ts`
- Modify: `app/api/checkins/[date]/route.ts`
- Modify: `app/api/uploads/checkin-image/route.ts`

**Interfaces:**

```ts
type SafeLogValue = string | number | boolean | null | undefined;

export function operationalErrorFields(error: unknown): {
  errorType: string;
  errorCode: string;
};

export function logServerError(
  event: string,
  fields: Record<string, SafeLogValue>,
): void;
```

- [ ] **Step 1: Write failing redaction and shape tests**

In `tests/unit/server/logging.test.ts`, spy on `console.error` and assert:

```ts
logServerError("check-in request failed", {
  requestId: "request-1",
  errorCode: "PGRST001",
});

expect(console.error).toHaveBeenCalledWith("server_error", {
  event: "check-in request failed",
  requestId: "request-1",
  errorCode: "PGRST001",
});
```

Also assert the function throws during tests if a forbidden key is passed:

```ts
expect(() =>
  logServerError("unsafe", { email: "person@example.com" }),
).toThrow("Unsafe log field: email");
```

The forbidden normalized keys are:

```ts
["body", "email", "password", "recoverycode", "token", "secret",
 "signedurl", "sourceurl", "reasoningcontent", "stack"]
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest run tests/unit/server/logging.test.ts
```

Expected: FAIL because `lib/server/logging.ts` does not exist.

- [ ] **Step 3: Implement the minimal logging helper**

Implement key normalization by removing `_` and `-` and lowercasing. Accept primitives only; reject arrays and objects so accidental request/response logging cannot slip through.

`operationalErrorFields` returns:

```ts
{
  errorType: error instanceof AggregateError
    ? "AggregateError"
    : error instanceof Error
      ? error.name
      : typeof error,
  errorCode: typeof candidate.code === "string"
    ? candidate.code
    : error instanceof Error && /^[A-Z][A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : "INTERNAL_ERROR",
}
```

- [ ] **Step 4: Replace ad hoc `console.error` calls**

Use:

```ts
logServerError("check-in request failed", {
  requestId,
  ...operationalErrorFields(error),
});
```

For image cleanup include only `requestId`, `job`-independent event name, `errorType`, and `errorCode`. Do not pass image paths.

- [ ] **Step 5: Run focused route and logging tests**

Run:

```bash
npx vitest run tests/unit/server/logging.test.ts \
  tests/unit/auth/response.test.ts \
  tests/unit/checkins/date-route.test.ts \
  tests/unit/storage/upload-route.test.ts
```

Expected: PASS with no raw error object assertions.

- [ ] **Step 6: Commit Task 2**

```bash
git add lib/server/logging.ts tests/unit/server/logging.test.ts \
  server/checkins/http.ts server/auth/response.ts \
  'app/api/checkins/[date]/route.ts' app/api/uploads/checkin-image/route.ts
git commit -m "refactor: centralize sanitized server logging"
```

---

### Task 3: Add Storage Maintenance Database Primitives

**Files:**

- Create via CLI: `npx supabase migration new storage_maintenance_primitives`
- Create: `supabase/tests/database/storage-maintenance.test.sql`
- Modify: `lib/supabase/database.types.ts` after regeneration

**Interfaces:**

```sql
public.delete_expired_storage_upload_reservations(target_limit integer)
returns integer

public.list_orphan_checkin_image_paths(target_limit integer)
returns table(path text)
```

Both functions are executable only by `service_role`.

- [ ] **Step 1: Write failing pgTAP tests**

Create fixtures with:

- one expired reservation without a Storage object;
- one future reservation;
- one expired reservation whose Storage object already exists;
- one Storage object referenced by `check_ins.image_path`;
- one unreferenced Storage object older than 24 hours;
- one unreferenced Storage object newer than 24 hours.

Assert:

```sql
select is(
  public.delete_expired_storage_upload_reservations(100),
  1,
  'only expired reservations without stored objects are deleted'
);

select results_eq(
  $$select path from public.list_orphan_checkin_image_paths(100) order by path$$,
  $$values (
    '00000000-0000-4000-8000-000000000801/2026-07-01/00000000-0000-4000-8000-000000000899.png'
  )$$,
  'only old unreferenced check-in images are candidates'
);
```

Add privilege assertions for `anon`, `authenticated`, and `service_role`.

- [ ] **Step 2: Run the database test and verify it fails**

```bash
npx supabase test db --local supabase/tests/database/storage-maintenance.test.sql
```

Expected: FAIL because both functions are absent.

- [ ] **Step 3: Create a separate migration and add bounded service-role-only functions**

```bash
npx supabase migration new storage_maintenance_primitives
```

Use the exact migration path printed by the CLI. Validate `target_limit between 1 and 500`. Delete expired reservations with a bounded CTE:

```sql
with candidates as (
  select reservations.path
  from private.storage_upload_reservations reservations
  where reservations.expires_at <= pg_catalog.now()
    and not exists (
      select 1
      from storage.objects objects
      where objects.bucket_id = 'checkin-images'
        and objects.name = reservations.path
    )
  order by reservations.expires_at
  limit target_limit
),
deleted as (
  delete from private.storage_upload_reservations reservations
  using candidates
  where reservations.path = candidates.path
  returning 1
)
select count(*)::integer from deleted;
```

List orphan candidates from `storage.objects` where:

```sql
bucket_id = 'checkin-images'
and created_at < pg_catalog.now() - interval '24 hours'
and not exists (
  select 1 from public.check_ins records
  where records.image_path = objects.name
)
```

Use `SECURITY DEFINER`, empty `search_path`, immediate revokes, and `service_role` grants.

- [ ] **Step 4: Reset the database and run focused pgTAP tests**

```bash
npx supabase db reset
npx supabase test db --local supabase/tests/database/storage-maintenance.test.sql
```

Expected: PASS.

- [ ] **Step 5: Regenerate and verify database types**

```bash
npm run supabase:types
npm run typecheck
```

Expected: PASS and generated RPC signatures present in `lib/supabase/database.types.ts`.

- [ ] **Step 6: Commit Task 3**

```bash
git add supabase/migrations supabase/tests/database/storage-maintenance.test.sql \
  lib/supabase/database.types.ts
git commit -m "feat: add bounded storage maintenance functions"
```

---

### Task 4: Implement the Storage Maintenance Edge Function

**Files:**

- Create via CLI: `npx supabase functions new storage-maintenance`
- Create: `supabase/functions/storage-maintenance/deno.json`
- Modify: `supabase/functions/storage-maintenance/index.ts`
- Create: `tests/unit/storage/maintenance.test.ts`
- Create: `server/storage/maintenance.ts`
- Modify: `docs/operations/supabase-runbook.md`

**Interfaces:**

```ts
export type StorageMaintenancePort = {
  deleteExpiredReservations(limit: number): Promise<number>;
  listOrphanPaths(limit: number): Promise<string[]>;
  removeObjects(paths: string[]): Promise<void>;
};

export async function runStorageMaintenance(
  port: StorageMaintenancePort,
  limit?: number,
): Promise<{
  deletedReservations: number;
  deletedOrphans: number;
}>;
```

- [ ] **Step 1: Write failing orchestration tests**

Cover:

```ts
it("deletes expired reservations before orphan objects", async () => {
  const port = {
    deleteExpiredReservations: vi.fn().mockResolvedValue(3),
    listOrphanPaths: vi.fn().mockResolvedValue(["a", "b"]),
    removeObjects: vi.fn().mockResolvedValue(undefined),
  };

  await expect(runStorageMaintenance(port, 100)).resolves.toEqual({
    deletedReservations: 3,
    deletedOrphans: 2,
  });
  expect(port.removeObjects).toHaveBeenCalledWith(["a", "b"]);
});
```

Also assert empty orphan lists do not call Storage remove, and failures are propagated for platform retry.

- [ ] **Step 2: Run the test and verify it fails**

```bash
npx vitest run tests/unit/storage/maintenance.test.ts
```

Expected: FAIL because `server/storage/maintenance.ts` does not exist.

- [ ] **Step 3: Implement the pure orchestration service**

Implement `runStorageMaintenance` with default limit `100`, validate `1..500`, call operations in the tested order, and return counts. Do not catch port errors.

- [ ] **Step 4: Generate the Edge Function scaffold**

```bash
npx supabase functions new storage-maintenance
```

Replace the generated handler. Pin imports in `deno.json`:

```json
{
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2.110.8"
  }
}
```

The handler must:

1. Require an `Authorization` bearer equal to `STORAGE_MAINTENANCE_TOKEN` using a constant-time comparison.
2. Create a Supabase client from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Call both service-role RPCs with limit `100`.
4. Delete returned paths from the private `checkin-images` bucket in one bounded batch.
5. Return only counts and a generated `requestId`.
6. Log only `requestId`, event, counts, error type, and safe error code.

- [ ] **Step 5: Run unit tests and serve the function locally**

```bash
npx vitest run tests/unit/storage/maintenance.test.ts
npx supabase functions serve storage-maintenance --env-file .dev.vars
```

In a second terminal, call without the maintenance bearer and expect `401`; call with the configured bearer and expect a JSON count response. Stop the local function server afterward.

- [ ] **Step 6: Document production scheduling and rollback**

Add exact runbook steps:

- store `STORAGE_MAINTENANCE_TOKEN` as a Supabase Edge Function secret;
- deploy with JWT verification enabled;
- create a Supabase Cron HTTP invocation every hour with the dedicated bearer;
- manually invoke and verify counts;
- disable the Cron job before rollback;
- never use `SUPABASE_SERVICE_ROLE_KEY` as the scheduler bearer.

Do not commit real tokens, project refs, URLs, or dashboard screenshots.

- [ ] **Step 7: Commit Task 4**

```bash
git add supabase/functions/storage-maintenance server/storage/maintenance.ts \
  tests/unit/storage/maintenance.test.ts docs/operations/supabase-runbook.md
git commit -m "feat: add scheduled storage maintenance worker"
```

---

### Task 5: Run Phase-One Security and Regression Verification

**Files:**

- Modify only if verification reveals a defect: files owned by Tasks 1–4.
- Modify: `docs/operations/supabase-runbook.md` only for verified command corrections.

**Interfaces:**

- Produces a clean, deployable hardening phase with no AI schema or DeepSeek code.

- [ ] **Step 1: Run all database tests**

```bash
npm run supabase:test
```

Expected: all pgTAP files PASS.

- [ ] **Step 2: Run local database advisors**

```bash
npx supabase db advisors --local --type security --level warn --fail-on error
npx supabase db advisors --local --type performance --level warn --fail-on error
```

Expected: exit 0. Record acceptable informational warnings in the runbook; fix every error and every warning caused by this phase.

- [ ] **Step 3: Run application verification**

```bash
npm run test:unit
npm run test:integration
npm run test:rendered
npm run lint
npm run typecheck
npm run build
```

Expected: every command exits 0.

- [ ] **Step 4: Run end-to-end regression**

```bash
npm run test:e2e
```

Expected: authentication, manual check-in, statistics, image upload, responsive layout, and offline draft cases PASS.

- [ ] **Step 5: Review the final diff against phase-one scope**

Run:

```bash
git diff --check
git status --short
git log --oneline -5
```

Confirm there is no AI generation table, DeepSeek dependency, model secret, or unrelated UI change. Confirm `AGENTS.md` remains untracked and unstaged.

- [ ] **Step 6: Commit verification-only corrections if needed**

If and only if the verification steps required corrections:

Stage only corrected phase-one paths from this explicit allowlist, omitting paths that were not changed:

```bash
git add supabase/migrations/*_checkin_stats_rpc.sql \
  supabase/migrations/*_storage_maintenance_primitives.sql \
  supabase/tests/database/checkin-stats.test.sql \
  supabase/tests/database/storage-maintenance.test.sql \
  lib/supabase/database.types.ts lib/server/logging.ts \
  server/checkins/repository.ts server/checkins/stats-service.ts \
  server/checkins/http.ts server/auth/response.ts \
  server/storage/maintenance.ts 'app/api/checkins/[date]/route.ts' \
  app/api/uploads/checkin-image/route.ts \
  supabase/functions/storage-maintenance \
  tests/unit/checkins/stats-service.test.ts \
  tests/unit/server/logging.test.ts tests/unit/storage/maintenance.test.ts \
  tests/integration/checkins-api.test.ts docs/operations/supabase-runbook.md
git commit -m "fix: close backend hardening verification gaps"
```

If no correction was needed, do not create an empty commit.
