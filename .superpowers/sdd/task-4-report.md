# Task 4 Report: Supabase Clients, Session Refresh, And Auth Core

## Status

Implemented in `/Users/yanzifeng/Documents/今天你Ai了吗？/.worktrees/supabase-web-v1` on branch `codex/supabase-web-v1`. No package dependency or lockfile changes were required: `@supabase/ssr` and `@supabase/supabase-js` were already locked dependencies.

## Implementation Summary

- Added typed browser, request-scoped server, and server-only admin Supabase client factories.
- Added `proxy.ts` session refresh using the Supabase SSR `getAll`/`setAll` cookie pattern. It carries every Supabase cookie option and each supplied cache-control header, calls `getClaims()` to trigger refresh, and excludes static/image routes.
- Added framework-independent `AuthPorts`, account orchestration, exported `RecoveryCodeResult`, recovery-code generation/digestion, constant-time digest comparison, registration compensation, login, recovery, profile update, and recovery-code rotation.
- Added HMAC-SHA-256 bucketing with a required server pepper and action-specific rate limits.
- Added the service-role-only `consume_auth_rate_limit` PostgreSQL RPC migration.
- Added auth and rate-limit unit coverage requested by the brief. The rate-limit test supplies and cleans up a test-only pepper so it does not depend on a developer environment file.

## TDD Evidence

### RED

After adding `server/auth/ports.ts` and both requested tests, before either service implementation existed:

```bash
npm run test:unit -- tests/unit/auth/service.test.ts
```

Result: failed as expected. `tests/unit/auth/service.test.ts` could not resolve `@/server/auth/service`; the runner also reported the corresponding missing `@/server/rate-limit/service` import because the project `test:unit` script always includes the whole `tests/unit` directory.

### GREEN

After implementing `server/auth/service.ts` and `server/rate-limit/service.ts`:

```bash
npm run test:unit -- tests/unit/auth tests/unit/rate-limit
```

Result: PASS, 4 test files and 7 tests.

## Commands And Results

| Command | Result |
| --- | --- |
| `npm ci` | PASS; installed the lockfile contents without changing `package-lock.json`. npm reported 17 dependency audit findings, none introduced or changed by this task. |
| `npm test` (baseline) | PASS; Vinext build and 7 rendered tests passed. |
| `npm run typecheck` (baseline) | FAIL; the legacy D1/R2/WeChat files lack `cloudflare:workers`, `Fetcher`, `D1Database`, and `R2Bucket` ambient types. |
| `npm run test:unit -- tests/unit/auth/service.test.ts` | Expected RED; missing Task 4 service imports. |
| `npm run test:unit -- tests/unit/auth tests/unit/rate-limit` | PASS; 4 files, 7 tests. |
| `npx supabase db reset` | PASS; applied migrations `202607230001`, `202607230002`, and `202607230003`. |
| `npx supabase test db` | PASS; 3 files, 68 database tests. |
| `npm run test:unit` (final) | PASS; 4 files, 7 tests. |
| `npm run lint` (final) | PASS. |
| `npm test` (final) | PASS; Vinext build and 7 rendered tests. |
| `npm run typecheck` (final) | FAIL only with the identical pre-existing legacy Cloudflare ambient-type errors; no Task 4 path appears in the diagnostics. |

## Files Changed

- `lib/supabase/browser.ts`
- `lib/supabase/server.ts`
- `lib/supabase/admin.ts`
- `proxy.ts`
- `server/auth/ports.ts`
- `server/auth/service.ts`
- `server/rate-limit/service.ts`
- `supabase/migrations/202607230003_rate_limit_function.sql`
- `tests/unit/auth/service.test.ts`
- `tests/unit/rate-limit/service.test.ts`
- `.superpowers/sdd/task-4-report.md`

## Security Self-Review

- Recovery codes use 26 cryptographically random symbols from a 32-character alphabet, yielding 130 bits of entropy; the modulo mapping is unbiased because 32 divides 256 exactly.
- Stored and compared recovery values are SHA-256 digests. Equal-length digests use `node:crypto` `timingSafeEqual`; callers are expected to use the Task 1 recovery schema before this orchestration layer.
- Registration creates an internal random UUID email and compensates any profile-completion or server sign-in failure by deleting the created auth user. Auth-user deletion cascades the profile/alias rows created by the Task 3 RPC. A failed compensation call would mask the original failure and may leave an orphan; this is a residual concern for a future adapter-level retry/alert policy.
- The recovery flow changes the auth password before compare-and-swap digest replacement, exactly as prescribed. A race between two valid simultaneous recoveries can therefore produce a password/recovery-code mismatch when one compare-and-swap loses. Resolving that cross-system atomicity needs a separately designed recovery transaction/compensation protocol.
- The admin factory imports `server-only`, reads `SUPABASE_SECRET_KEY` only on the server, disables session persistence/refresh/URL detection, and fails closed when required values are absent. Browser/server/proxy public credentials and the rate-limit pepper also fail closed when absent.
- The proxy mutates both request and response cookies, preserves every Supabase cookie option, forwards Supabase-provided no-cache headers, and refreshes only after `getClaims()`. A client artifact scan found neither `SUPABASE_SECRET_KEY` nor `AUTH_RATE_LIMIT_PEPPER`, and no local secret value.
- Raw rate-limit bucket values never leave the service; the RPC receives an HMAC digest encoded as PostgreSQL `bytea` input. RPC execution is revoked from public, anonymous, and authenticated roles, then granted only to `service_role`.

## Concerns

1. Global `npm run typecheck` remains blocked by the pre-existing legacy Cloudflare type setup. It reproduced unchanged before and after Task 4 and is outside this task's permitted scope.
2. The exact prescribed rate-limit migration locks an existing bucket row, but two first-use requests for the same absent `(bucket_digest, action)` can race to insert and one can receive a unique-key error. A follow-up should use an `INSERT ... ON CONFLICT` acquisition step before row locking; existing database tests do not exercise this concurrency case.
3. Auth tests cover the requested compensation and successful recovery rotation paths. Invalid-recovery, stale-replacement, and cookie-client behavior remain appropriate integration coverage for Task 5 rather than duplicate unit coverage here.

## Concurrency-Fix Follow-Up

### Scope And Rationale

- `recoverAccount` now generates and digests the next code, then compare-and-swaps the old digest to the next digest before calling `updatePassword`. A concurrent loser receives `RECOVERY_ALREADY_USED` before changing the password or signing in.
- If `updatePassword` rejects after the successful claim, the service compensates with a compare-and-swap from the claimed next digest back to the old digest. A successful compensation rethrows the password error. A rejected or false compensation result throws `RECOVERY_ROLLBACK_FAILED` as an `AggregateError`, containing the password failure and, where present, the rollback failure. It never signs in or returns a recovery code on either failure path.
- `consume_auth_rate_limit` now first inserts attempt one with `on conflict do nothing`; an insert winner returns immediately. A conflict loser then locks the existing row before applying the prior window/count/block logic. PostgreSQL waits on an uncommitted unique-key conflict, so simultaneous first-use calls serialize instead of leaking a unique-key error.

### RED Evidence

Auth regressions were added before the service edit and run with:

```bash
npm run test:unit -- tests/unit/auth/service.test.ts
```

Result: expected RED, 4 failed auth tests (10 unit tests total). The failures proved the old implementation called `updatePassword` before `replaceRecoveryDigest`, changed the password after a CAS loser, performed no rollback after a password failure, and surfaced the original password error when rollback failure needed an explicit recovery state.

Rate-limit database behavior coverage was added before the migration edit and run after a local reset with:

```bash
NPM_CONFIG_UPDATE_NOTIFIER=false npx supabase test db
```

Result: expected RED, 4 failing rate-limit assertions. The first call failed with `window_started_at is of type timestamp with time zone but expression is of type time with time zone`: `current_time` resolved to PostgreSQL's special time keyword rather than the intended PL/pgSQL value. This prevented a first request from recording attempt one. A single-connection pgTAP transaction cannot deterministically reproduce the absent-row insert race, so no SQL-text assertion was used as a stand-in for concurrency.

### GREEN Evidence And Tests

- `npx vitest run tests/unit/auth/service.test.ts tests/unit/rate-limit/service.test.ts`: PASS, 2 files and 6 tests. Auth coverage proves CAS-before-password call order, loser no-password-change behavior, successful rollback, and explicit rollback failure handling.
- `NPM_CONFIG_UPDATE_NOTIFIER=false npx supabase db reset`: PASS after applying migrations through `202607230003`.
- `NPM_CONFIG_UPDATE_NOTIFIER=false npx supabase test db`: PASS, 4 files and 78 pgTAP assertions. `supabase/tests/database/rate-limit.test.sql` covers first attempt, within-window increments, threshold blocking with a positive retry interval, and window reset.
- A non-committed real two-session local probe held the first function call's transaction open for two seconds while the second first-use call started. The second call returned `t|0` after `real 1.80` seconds, and the final bucket `attempt_count` was `2`; it did not raise a unique-key error. The probe row was deleted afterward.
- `npm run test:unit`: PASS, 4 files and 10 tests.
- `npm run lint`: PASS.
- `npm test`: PASS; Vinext build completed and 7 rendered tests passed.
- `git diff --check`: PASS.

### Files Changed

- `server/auth/service.ts`
- `tests/unit/auth/service.test.ts`
- `supabase/migrations/202607230003_rate_limit_function.sql`
- `supabase/tests/database/rate-limit.test.sql`
- `.superpowers/sdd/task-4-report.md`

### Self-Review And Residual Concerns

- The recovery digest is consumed before an external password change, so a CAS loser cannot change the password. The compensating CAS is conditional on the claimed digest, so it cannot overwrite a later recovery result.
- There is no cross-system transaction with Supabase Auth. If `updatePassword` rejects after the provider actually changed the password and the digest rollback succeeds, the old recovery code may remain valid for a password that may already have changed. The operation still rejects and never signs in or returns a replacement code; resolving this ambiguity needs provider-level idempotency or a dedicated recovery transaction design.
- If compensation fails, the digest remains claimed and the service throws `RECOVERY_ROLLBACK_FAILED` with causal errors for operational handling. No retry loop is attempted because it could overwrite a newer recovery claim.

## Independent Review Fixes (2026-07-24)

### Scope And Security Rationale

- `server/rate-limit/service.ts` now imports `server-only`, establishing the same real production bundler boundary as the pepper-consuming admin path. Vitest maps only that bare import to the empty `tests/stubs/server-only.ts` stub; this test-only alias does not alter production bundler protection. `npm test` built every application environment with the real boundary intact.
- `consume_auth_rate_limit` validates all arguments before its conflict-safe insert or row lock. A bucket must be a non-null 32-byte HMAC digest, and the action/attempt/window tuple must exactly be `register/5/3600`, `login/10/900`, `recover/5/1800`, or `rotate/5/3600`. Invalid values, including non-positive attempts or windows, raise the stable `22023` error `invalid auth rate limit parameters` without creating or changing a bucket row. The existing `SECURITY DEFINER`, empty `search_path`, exact revokes, service-role grant, and conflict-safe acquisition remain unchanged.
- The rate-limit client now fails closed for malformed RPC error/data shapes rather than consuming arbitrary values. New unit coverage confirms missing browser/admin/pepper configuration fails before client/RPC use. The proxy test directly exercises request-cookie mutation, response cookie options, supplied cache headers, and `getClaims()` refresh using a small module-level Next/Supabase seam; a full middleware harness was not needed.

### TDD Evidence

**RED:** Added the invalid-parameter pgTAP cases and malformed RPC/client/proxy unit cases before changing production code. `npm run test:unit -- tests/unit/rate-limit/service.test.ts` produced the expected malformed-data and malformed-error failures: the old code dereferenced `null` and threw a string error. During initial test scaffolding, Vitest also showed that bare `server-only` is not resolved outside Next and required a test-only alias; the proxy/client mock factories were then hoisted to satisfy Vitest's module-mock lifecycle. `NPM_CONFIG_UPDATE_NOTIFIER=false npx supabase test db` against the old migration rejected a null bucket with `23502` and allowed every other invalid tuple to insert a row; 13 behavioral assertions failed (plus the initially corrected pgTAP plan count).

**GREEN:** `npx vitest run tests/unit/rate-limit/service.test.ts tests/unit/supabase-clients.test.ts tests/unit/proxy.test.ts` passed 3 files and 8 tests. After reset, pgTAP passed all 4 files and 92 tests, including 24 rate-limit assertions. The complete unit suite passed 6 files and 17 tests.

### Verification

| Command | Result |
| --- | --- |
| `NPM_CONFIG_UPDATE_NOTIFIER=false npx supabase db reset` | PASS; migrations through `202607230003` applied. |
| `NPM_CONFIG_UPDATE_NOTIFIER=false npx supabase test db` | PASS; 4 files, 92 tests. |
| `npm run test:unit` | PASS; 6 files, 17 tests. |
| `npm run lint` | PASS. |
| `npm test` | PASS; Vinext build plus 7 rendered tests. |
| `git diff --check` | PASS. |

### Files Changed

- `server/rate-limit/service.ts`
- `supabase/migrations/202607230003_rate_limit_function.sql`
- `supabase/tests/database/rate-limit.test.sql`
- `tests/unit/rate-limit/service.test.ts`
- `tests/unit/supabase-clients.test.ts`
- `tests/unit/proxy.test.ts`
- `tests/stubs/server-only.ts`
- `vitest.config.ts`
- `.superpowers/sdd/task-4-report.md`

### Self-Review And Residual Concerns

- This section supersedes the earlier report's stale assertions that password changes before recovery-code CAS and that the first-use rate-limit race remains. Commit `276295d` already claims the digest before password mutation and uses conflict-safe first-use acquisition; these review fixes preserve both behaviors.
- The invalid-input tests use approved 32-byte fixture digests, reject every requested invalid class, and verify that each rejected request leaves no targeted private row (or, for the null bucket, leaves the private bucket count unchanged). Validation occurs before the function's first data-access statement.
- The existing global `npm run typecheck` limitation remains confined to the known legacy Cloudflare type paths reported above; this pass did not modify them and it was outside the requested verification list.
