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
