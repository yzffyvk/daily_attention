# Auth Security Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove recovery email timing asymmetry and make failed registration compensation observable and operationally recoverable without exposing account identity.

**Architecture:** Recovery uses one service-role PostgreSQL RPC that always returns one fixed-shape row containing either the real user/digest or a null user with a 32-byte sentinel digest. Registration continues to compensate cross-system failures by deleting the newly created Auth user, but a failed compensation preserves both errors in an `AggregateError` and emits a sanitized request-scoped operational alert with a documented exact-ID reconciliation procedure.

**Tech Stack:** Next.js 16 App Router, TypeScript 5.9, Supabase Auth/Postgres, Vitest, pgTAP.

## Global Constraints

- Do not send verification email, Magic Link, email OTP, password-reset email, or SMS.
- Do not print or log email addresses, passwords, recovery codes, digests, Auth user IDs, Supabase keys, pepper values, or raw error objects.
- Sensitive RPCs remain executable only by `service_role`, with empty `search_path`.
- Missing and existing emails with an invalid recovery code must execute the same application-level RPC and digest-comparison path.
- Registration compensation must still hard-delete only the exact Auth user returned by the current registration attempt.
- No production Supabase operation or `main` merge occurs while implementing these tasks.

---

### Task 1: Fixed-Shape Recovery Challenge

**Files:**
- Create: `supabase/migrations/202607280001_recovery_challenge.sql`
- Modify: `supabase/tests/database/account-functions.test.sql`
- Modify: `supabase/tests/database/schema.test.sql`
- Regenerate: `lib/supabase/database.types.ts`
- Modify: `server/auth/ports.ts`
- Modify: `server/auth/service.ts`
- Modify: `server/auth/supabase-adapter.ts`
- Modify: `tests/unit/auth/service.test.ts`
- Modify: `tests/unit/auth/supabase-adapter.test.ts`
- Modify: `docs/operations/supabase-runbook.md`

**Interfaces:**
- Produces: `public.resolve_recovery_challenge(target_email text) -> table(user_id uuid, recovery_code_digest bytea)`
- Produces: `AuthPorts.resolveRecoveryChallenge(email: string): Promise<{ userId: string | null; recoveryDigest: Uint8Array }>`
- Preserves: `resolveEmail(email)` and `readRecoveryDigest(userId)` for authenticated recovery-code rotation.

- [ ] **Step 1: Write failing pgTAP expectations**

Require the new function to exist, have empty `search_path`, and be executable only by `service_role`. Insert one known profile and recovery digest, then assert:

```sql
select results_eq(
  $$ select user_id, encode(recovery_code_digest, 'hex')
     from public.resolve_recovery_challenge('known@example.com') $$,
  $$ values ('00000000-0000-4000-8000-000000000001'::uuid, repeat('ab', 32)) $$,
  'known email returns its user and digest'
);

select results_eq(
  $$ select user_id is null, octet_length(recovery_code_digest)
     from public.resolve_recovery_challenge('missing@example.com') $$,
  $$ values (true, 32) $$,
  'missing email returns one fixed-shape sentinel row'
);
```

- [ ] **Step 2: Run database tests and verify RED**

```bash
npm run supabase:test
```

Expected: FAIL because `resolve_recovery_challenge(text)` does not exist.

- [ ] **Step 3: Add the fixed-shape RPC**

Create a `security definer` SQL function with `set search_path = ''` that always returns exactly one row. Use a one-row seed and left joins against `public.profiles` and `private.account_recovery_credentials`; return the real digest when present and `decode(repeat('00', 32), 'hex')` otherwise. Revoke execution from `PUBLIC`, `anon`, and `authenticated`; grant only `service_role`.

- [ ] **Step 4: Reset, regenerate types, and verify database GREEN**

```bash
npm run supabase:reset
npm run supabase:types
npm run supabase:test
```

Expected: reset succeeds, generated types contain `resolve_recovery_challenge`, and all pgTAP tests pass.

- [ ] **Step 5: Write failing service and adapter tests**

Require both a known and missing email to call exactly one recovery challenge and perform digest comparison before returning `INVALID_RECOVERY`.

```ts
expect(ports.resolveRecoveryChallenge).toHaveBeenCalledWith("missing@example.com");
expect(ports.resolveEmail).not.toHaveBeenCalled();
expect(ports.readRecoveryDigest).not.toHaveBeenCalled();
```

Adapter tests must require exactly one returned row, `user_id` as string or null, and a valid 32-byte `bytea` digest. Reject zero rows, multiple rows, malformed user IDs, and malformed digests.

- [ ] **Step 6: Run focused tests and verify RED**

```bash
npx vitest run tests/unit/auth/service.test.ts tests/unit/auth/supabase-adapter.test.ts
```

Expected: FAIL because the port and RPC adapter do not exist and recovery still resolves email before reading a digest.

- [ ] **Step 7: Implement the recovery challenge path**

Add the new port and adapter. In `recoverAccount`, call `resolveRecoveryChallenge(input.email)`, hash the supplied code, compare it with the returned digest, and only then require a non-null `userId`:

```ts
const challenge = await ports.resolveRecoveryChallenge(input.email);
const supplied = await digest(input.recoveryCode);
if (!sameDigest(challenge.recoveryDigest, supplied) || !challenge.userId) {
  throw new Error("INVALID_RECOVERY");
}
```

Use `challenge.userId` for profile read, conditional digest replacement, password update, rollback, and sign-in. Keep all existing rollback behavior.

- [ ] **Step 8: Run Task 1 verification**

```bash
npx vitest run tests/unit/auth/service.test.ts tests/unit/auth/supabase-adapter.test.ts
npm run supabase:test
npm run lint
npm run typecheck
git diff --check
```

Expected: all commands pass.

- [ ] **Step 9: Update the runbook and commit**

Document that recovery uses one fixed-shape service-role challenge RPC and that its sentinel digest is never logged or returned to the browser.

```bash
git add supabase/migrations/202607280001_recovery_challenge.sql \
  supabase/tests/database/account-functions.test.sql \
  supabase/tests/database/schema.test.sql lib/supabase/database.types.ts \
  server/auth/ports.ts server/auth/service.ts server/auth/supabase-adapter.ts \
  tests/unit/auth/service.test.ts tests/unit/auth/supabase-adapter.test.ts \
  docs/operations/supabase-runbook.md
git commit -m "fix: equalize recovery challenge path"
```

---

### Task 2: Registration Compensation Alert

**Files:**
- Modify: `server/auth/service.ts`
- Modify: `server/auth/response.ts`
- Modify: `tests/unit/auth/service.test.ts`
- Modify: `tests/unit/auth/response.test.ts`
- Modify: `docs/operations/supabase-runbook.md`

**Interfaces:**
- Produces: `AggregateError([registrationError, cleanupError], "REGISTRATION_COMPENSATION_FAILED")`
- Produces: sanitized server log `auth request failed` with `{ requestId, errorType, errorCode }`
- Preserves: generic browser response `{ code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后再试" }`

- [ ] **Step 1: Write failing compensation tests**

Require a failed profile/sign-in followed by a failed `deleteAuthUser` to preserve both errors:

```ts
await expect(registerAccount(input, ports)).rejects.toMatchObject({
  name: "AggregateError",
  message: "REGISTRATION_COMPENSATION_FAILED",
  errors: [registrationError, cleanupError],
});
```

Require successful compensation to continue throwing only the original registration error.

- [ ] **Step 2: Write failing sanitized alert tests**

Spy on `console.error`, pass the compensation `AggregateError` to `authFailure`, and require:

```ts
expect(console.error).toHaveBeenCalledWith("auth request failed", {
  requestId: "request-id",
  errorType: "AggregateError",
  errorCode: "REGISTRATION_COMPENSATION_FAILED",
});
```

Assert the log and browser response contain neither nested error message, email, Auth user ID, nor raw error object. Require ordinary mapped 4xx errors not to emit an operational alert.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npx vitest run tests/unit/auth/service.test.ts tests/unit/auth/response.test.ts
```

Expected: FAIL because cleanup errors currently replace the original error and authentication failures are not logged.

- [ ] **Step 4: Preserve both compensation errors**

Wrap only the compensation call:

```ts
} catch (registrationError) {
  try {
    await ports.deleteAuthUser(authUser.id);
  } catch (cleanupError) {
    throw new AggregateError(
      [registrationError, cleanupError],
      "REGISTRATION_COMPENSATION_FAILED",
    );
  }
  throw registrationError;
}
```

- [ ] **Step 5: Emit a sanitized operational alert**

In `authFailure`, after mapping the error, log only 500-level failures. Derive `errorType` from the built-in error class and use an allowlist so `errorCode` is only `REGISTRATION_COMPENSATION_FAILED`, `RECOVERY_ROLLBACK_FAILED`, or `INTERNAL_ERROR`. Never log the input error object or its raw message.

- [ ] **Step 6: Document exact reconciliation**

Add a runbook procedure for `REGISTRATION_COMPENSATION_FAILED`:

1. Correlate the alert by request ID and timestamp without recording request bodies.
2. Pause the Admin registration route.
3. Read Auth users created in the narrow incident window and compare only their IDs with `profiles.id`; do not export or log emails.
4. Select only an exact Auth ID with no profile and no recovery credential.
5. Obtain destructive-action authorization, hard-delete that exact ID, and verify targeted `getUserById` returns `404 / user_not_found`.
6. Resume registration and let the user retry.

- [ ] **Step 7: Run Task 2 and full verification**

```bash
npx vitest run tests/unit/auth/service.test.ts tests/unit/auth/response.test.ts
npm run lint
npm run typecheck
npm run test:unit
npm run supabase:test
npm run test:integration
npm run test:e2e
npm run test:rendered
npm run build
git diff --check
```

Expected: all commands pass; final local Auth, profile, check-in, image, and E2E registry aggregates are zero.

- [ ] **Step 8: Commit**

```bash
git add server/auth/service.ts server/auth/response.ts \
  tests/unit/auth/service.test.ts tests/unit/auth/response.test.ts \
  docs/operations/supabase-runbook.md
git commit -m "fix: surface registration cleanup failures"
```

---

### Task 3: Release And Compensation Safety

**Files:**
- Create: `supabase/migrations/202607280002_reset_display_name_sequence.sql`
- Modify: `supabase/tests/database/account-functions.test.sql`
- Modify: `server/auth/supabase-adapter.ts`
- Modify: `tests/unit/auth/supabase-adapter.test.ts`
- Modify: `docs/operations/supabase-runbook.md`

**Interfaces:**
- Produces: one-time guarded reset of `private.attention_display_name_seq` to `(last_value = 1, is_called = false)`
- Strengthens: `AuthPorts.deleteAuthUser(userId)` to return only after a strict targeted Auth absence proof
- Replaces: incompatible web-only rollback guidance with schema-compatible forward-fix/restore rules
- Documents: `RECOVERY_ROLLBACK_FAILED` containment and reconciliation

- [ ] **Step 1: Write failing sequence expectations**

At the beginning of the account-function pgTAP file, before any registration consumes the sequence, require:

```sql
select results_eq(
  $$ select last_value, is_called
     from private.attention_display_name_seq $$,
  $$ values (1::bigint, false) $$,
  'clean-slate email migration resets the display-name sequence'
);
```

Also retain the existing assertion that the first registration receives `Attention_001`.

- [ ] **Step 2: Run database tests and verify RED**

Advance the local sequence using one rolled-back registration attempt or `nextval`, then run:

```bash
npm run supabase:test
```

Expected: FAIL because the existing migration set preserves the already-called sequence.

- [ ] **Step 3: Add the guarded one-time sequence migration**

Create `202607280002_reset_display_name_sequence.sql` with one `DO` block. It must fail unless all of these production-clean-slate conditions hold:

```sql
not exists (select 1 from auth.users)
and not exists (select 1 from public.profiles)
and not exists (select 1 from private.account_recovery_credentials)
and not exists (select 1 from public.check_ins)
and not exists (
  select 1 from storage.objects where bucket_id = 'checkin-images'
)
```

After the guard, execute:

```sql
perform pg_catalog.setval(
  'private.attention_display_name_seq'::regclass,
  1,
  false
);
```

This migration is a one-time clean-slate cutover operation. Future releases must preserve the sequence and must not rerun or copy this reset.

- [ ] **Step 4: Reset local Supabase and verify database GREEN**

```bash
npm run supabase:reset
npm run supabase:test
```

Expected: all migrations apply, the initial sequence assertion passes, and the first generated name remains `Attention_001`.

- [ ] **Step 5: Write failing Auth compensation deletion tests**

Require `deleteAuthUser(userId)` to:

1. accept GoTrue's empty successful delete body only when the result has an own `error: null`;
2. perform a fresh targeted `getUserById(userId)`;
3. accept absence only for own `data.user: null`, `error.status: 404`, and `error.code: "user_not_found"`;
4. reject a returned user, malformed delete/read envelopes, thrown reads, wrong status, and wrong code.

The tests must verify response identity data is ignored and no global `listUsers` call is used.

- [ ] **Step 6: Run adapter tests and verify RED**

```bash
npx vitest run tests/unit/auth/supabase-adapter.test.ts
```

Expected: FAIL because `deleteAuthUser` currently checks only a truthy delete error and performs no absence proof.

- [ ] **Step 7: Implement strict production compensation deletion**

Add small local `isRecord`, `hasOwn`, `isSuccessfulDeleteResult`, and `isMissingUserResult` helpers in `server/auth/supabase-adapter.ts`. Keep delete response identity non-authoritative:

```ts
const deleted = await admin.auth.admin.deleteUser(userId);
if (!isSuccessfulDeleteResult(deleted)) {
  throw new Error("Auth user deletion could not be verified");
}
const absent = await admin.auth.admin.getUserById(userId);
if (!isMissingUserResult(absent)) {
  throw new Error("Auth user deletion could not be verified");
}
```

The error message must contain no user ID or response body. Any throw is caught by `registerAccount` and becomes the existing `REGISTRATION_COMPENSATION_FAILED` alert.

- [ ] **Step 8: Correct release and recovery operations**

Update the runbook with all of the following:

1. Before legacy reset, query and record only `last_value` and `is_called` for `private.attention_display_name_seq`.
2. After applying email migrations, require `last_value = 1` and `is_called = false` before the first registration.
3. State that `202607280002_reset_display_name_sequence.sql` is one-time and must never reset a live sequence after new registrations begin.
4. Remove the instruction to redeploy the phone-era web build after the email migration. During the first cutover, keep writers stopped and use a schema-compatible forward fix; returning to the phone build requires a coordinated full database/Auth/Storage restore to the pre-cutover state, never a web-only rollback.
5. For later releases, roll back only to an artifact explicitly verified compatible with the current schema.
6. Add `RECOVERY_ROLLBACK_FAILED` containment: pause recovery and rotation routes, correlate by request ID/time, never request the user's password or recovery code, identify the exact account only in a secure Admin session, invalidate active sessions, and choose only a reviewed forward repair or verified full restore. Do not guess which password/digest committed and do not directly overwrite either value.

- [ ] **Step 9: Run focused and full verification**

```bash
npx vitest run tests/unit/auth/supabase-adapter.test.ts
npm run lint
npm run typecheck
npm run test:unit
npm run supabase:test
npm run test:integration
npm run test:e2e
npm run test:rendered
npm run build
git diff --check
```

Expected: all commands pass; local Auth, profiles, recovery credentials, check-ins, images, and E2E registry aggregates are zero.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/202607280002_reset_display_name_sequence.sql \
  supabase/tests/database/account-functions.test.sql \
  server/auth/supabase-adapter.ts tests/unit/auth/supabase-adapter.test.ts \
  docs/operations/supabase-runbook.md
git commit -m "fix: close email auth release gaps"
```
