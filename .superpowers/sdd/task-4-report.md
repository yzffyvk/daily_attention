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
