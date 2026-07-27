# Email Password Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace phone authentication with email and password authentication without sending verification email, while preserving default names, recovery codes, profiles, check-ins, and Supabase RLS.

**Architecture:** The browser submits normalized email-oriented payloads only to application API routes. The server uses Supabase Admin Auth to create an immediately confirmed email user, completes the profile and recovery transaction, and signs in through the server Supabase client. A forward-only database migration replaces `profiles.phone` and phone RPC contracts with lowercase unique email equivalents.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Supabase Auth/Postgres/RLS, Zod 4, Vitest, pgTAP, Playwright, vinext/Cloudflare.

## Global Constraints

- Registration, login, and recovery use email plus password; no SMS, email verification, Magic Link, email OTP, or SMTP.
- Supabase Auth users are created only by the server Admin API with `email_confirm: true`.
- Public Supabase `signUp` remains disabled.
- `profiles.email` is lowercase, unique, read-only to the user, and no longer stores a phone number.
- Default display names remain `Attention_001` through `Attention_999`.
- Existing recovery-code, rate-limit, session, RLS, check-in, and image behavior must remain intact.
- Do not print email addresses, passwords, recovery codes, digests, publishable keys, secret keys, or pepper values in logs or test evidence.
- The production project is `jhiybzdvxvlkbqvamynp`; production mutation requires an explicit project check and uses `.env.production.local`.

---

### Task 1: Email Domain and Database Contract

**Files:**
- Modify: `lib/domain/user.ts`
- Modify: `tests/unit/domain/user.test.ts`
- Create: `supabase/migrations/202607270001_email_password_auth.sql`
- Modify: `supabase/tests/database/schema.test.sql`
- Modify: `supabase/tests/database/account-functions.test.sql`
- Modify: `supabase/tests/database/rls.test.sql`
- Regenerate: `lib/supabase/database.types.ts`

**Interfaces:**
- Produces: `normalizeEmail(value: string): string`
- Produces: `registerInputSchema` output `{ email: string; password: string; avatarKey: number }`
- Produces: `loginInputSchema` output `{ email: string; password: string }`
- Produces: `recoverInputSchema` output `{ email: string; recoveryCode: string; newPassword: string }`
- Produces: `public.complete_registration(target_user_id, target_email, target_avatar_key, target_recovery_digest)`
- Produces: `public.resolve_email(target_email) -> table(user_id uuid)`
- Produces: `profiles.email varchar(254)`

- [ ] **Step 1: Write failing email domain tests**

Replace phone assertions with tests that require:

```ts
expect(normalizeEmail(" User@Example.COM ")).toBe("user@example.com");
expect(registerInputSchema.parse({
  email: " User@Example.COM ",
  password: "password123",
  avatarKey: 3,
})).toEqual({
  email: "user@example.com",
  password: "password123",
  avatarKey: 3,
});
expect(registerInputSchema.safeParse({
  email: "not-an-email",
  password: "password123",
  avatarKey: 3,
}).success).toBe(false);
expect(profilePatchSchema.safeParse({ email: "other@example.com" }).success).toBe(false);
```

- [ ] **Step 2: Run the domain test and verify RED**

Run:

```bash
npx vitest run tests/unit/domain/user.test.ts
```

Expected: FAIL because `normalizeEmail` and email-oriented schemas do not exist.

- [ ] **Step 3: Implement the email domain**

In `lib/domain/user.ts`, replace phone normalization with:

```ts
export function normalizeEmail(value: string) {
  return value.normalize("NFKC").trim().toLowerCase();
}

const emailSchema = z
  .string()
  .transform(normalizeEmail)
  .pipe(
    z.string()
      .min(3, "请输入正确的邮箱")
      .max(254, "邮箱最多 254 个字符")
      .email("请输入正确的邮箱"),
  );
```

Use `emailSchema` in register, login, and recover inputs. Remove `normalizePhone` and `toE164Phone`.

- [ ] **Step 4: Run the domain test and verify GREEN**

Run:

```bash
npx vitest run tests/unit/domain/user.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing pgTAP expectations**

Update database tests to require:

- `profiles.email` exists, is required, is unique, and `profiles.phone` does not exist.
- registration lowercases are already supplied by the API but database constraints reject uppercase, malformed, over-254-character, and duplicate emails.
- `complete_registration` writes email and the next `Attention_NNN` name atomically.
- `resolve_email` is executable only by service role.
- authenticated users can read only their own email/profile and cannot modify email.
- `resolve_phone` no longer exists.

- [ ] **Step 6: Run database tests and verify RED**

Run:

```bash
npm run supabase:test
```

Expected: FAIL because the email column and RPCs do not exist.

- [ ] **Step 7: Add the forward-only email migration**

Create `202607270001_email_password_auth.sql` that:

1. Drops `profiles_phone_check` and `profiles_phone_key`.
2. Renames `public.profiles.phone` to `email` and changes it to `varchar(254)`.
3. Adds `profiles_email_key` and a check requiring:

```sql
email = pg_catalog.lower(email)
and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
```

4. Drops `public.resolve_phone(text)`.
5. Replaces `complete_registration` with `target_email text`, validating length, lowercase, and format before inserting.
6. Creates `resolve_email(target_email text)` returning at most one `user_id`.
7. Updates `read_profile` and `update_profile` return shapes through the renamed column.
8. Revokes all sensitive RPC execution from `PUBLIC`, `anon`, and `authenticated`, then grants only required service-role functions.
9. Preserves empty `search_path`, recovery digest concurrency rules, default-name sequence behavior, and existing table/RLS ownership.

- [ ] **Step 8: Reset local database, regenerate types, and verify database GREEN**

Run:

```bash
npm run supabase:reset
npm run supabase:types
npm run supabase:test
```

Expected: reset succeeds, generated `profiles` types contain `email` and not `phone`, and all pgTAP tests pass.

- [ ] **Step 9: Run focused domain/type checks**

Run:

```bash
npx vitest run tests/unit/domain/user.test.ts
npm run typecheck
```

Expected: domain tests pass; typecheck may still fail only in downstream phone call sites scheduled for Tasks 2 and 3. Record those exact call sites before continuing.

- [ ] **Step 10: Commit Task 1**

```bash
git add lib/domain/user.ts lib/supabase/database.types.ts tests/unit/domain/user.test.ts \
  supabase/migrations/202607270001_email_password_auth.sql \
  supabase/tests/database/schema.test.sql \
  supabase/tests/database/account-functions.test.sql \
  supabase/tests/database/rls.test.sql
git commit -m "feat: migrate account identity to email"
```

---

### Task 2: Email Authentication Service and HTTP API

**Files:**
- Modify: `server/auth/ports.ts`
- Modify: `server/auth/service.ts`
- Modify: `server/auth/supabase-adapter.ts`
- Modify: `server/auth/request.ts`
- Modify: `server/auth/response.ts`
- Modify: `app/api/auth/register/route.ts`
- Modify: `app/api/auth/login/route.ts`
- Modify: `app/api/auth/recover/route.ts`
- Modify: `app/api/auth/recovery-code/rotate/route.ts`
- Modify: `app/(app)/page.tsx`
- Modify: `tests/unit/auth/service.test.ts`
- Modify: `tests/unit/auth/supabase-adapter.test.ts`
- Modify: `tests/unit/auth/request.test.ts`
- Modify: `tests/unit/auth/response.test.ts`
- Modify: `tests/unit/auth/login-route.test.ts`
- Modify: `tests/unit/auth/recover-route.test.ts`
- Modify: `tests/unit/auth/me-route.test.ts`
- Modify: `tests/unit/checkins/api.test.ts`

**Interfaces:**
- Consumes: Task 1 email schemas and RPCs.
- Produces: `AccountProfile { id, email, displayName, avatarKey }`
- Produces: `AuthPorts.createAuthUser({ email, password })`
- Produces: `AuthPorts.resolveEmail(email)`
- Produces: `AuthPorts.signIn(email, password)`
- Produces: `emailRateBucket(request, email)`

- [ ] **Step 1: Write failing service and adapter tests**

Require registration and login to call:

```ts
expect(ports.createAuthUser).toHaveBeenCalledWith({
  email: "user@example.com",
  password: "password123",
});
expect(ports.signIn).toHaveBeenCalledWith("user@example.com", "password123");
expect(createUser).toHaveBeenCalledWith({
  email: "user@example.com",
  password: "password123",
  email_confirm: true,
});
expect(signInWithPassword).toHaveBeenCalledWith({
  email: "user@example.com",
  password: "password123",
});
```

Require recovery to resolve `user@example.com`, validate the returned profile email, update the password, rotate the digest conditionally, and sign in with email. Require profile mapping to reject old `phone` response shapes.

- [ ] **Step 2: Run focused service tests and verify RED**

Run:

```bash
npx vitest run tests/unit/auth/service.test.ts tests/unit/auth/supabase-adapter.test.ts
```

Expected: FAIL on phone-shaped ports and Auth calls.

- [ ] **Step 3: Implement email-oriented ports, service, and adapter**

Change all authentication identities to email:

```ts
createAuthUser(input: { email: string; password: string }): Promise<{ id: string }>;
resolveEmail(email: string): Promise<{ userId: string } | null>;
signIn(email: string, password: string): Promise<void>;
```

Use `admin.auth.admin.createUser({ email, password, email_confirm: true })`,
`server.auth.signInWithPassword({ email, password })`, `resolve_email`, and
`profiles.email`. Keep compensation deletion, recovery rollback, invalid credential mapping, and current-user checks unchanged.

- [ ] **Step 4: Run focused service tests and verify GREEN**

Run:

```bash
npx vitest run tests/unit/auth/service.test.ts tests/unit/auth/supabase-adapter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing route/request/response tests**

Require:

- `emailRateBucket(request, " User@Example.com ")` to use `user@example.com`.
- register/login/recover payloads to use `email`.
- duplicate `email_exists`, `profiles_email_key`, and Postgres unique errors to map to
  `{ code: "EMAIL_TAKEN", message: "该邮箱已注册", field: "email" }`.
- invalid login to say “邮箱或密码不正确”.
- invalid recovery to say “邮箱或恢复码不正确”.
- recovery-code rotation to use `currentProfile.email`.
- application page/current profile query to select and expose `email`.

- [ ] **Step 6: Run route/request/response tests and verify RED**

Run:

```bash
npx vitest run tests/unit/auth tests/unit/checkins/api.test.ts
```

Expected: FAIL on phone payloads and messages.

- [ ] **Step 7: Implement email HTTP contracts**

Update routes to pass `parsed.data.email`, rename `phoneRateBucket` to `emailRateBucket`,
map duplicate email errors without account enumeration, and select
`id, email, display_name, avatar_key` for the application profile. Do not include auth email or secret fields in API responses.

- [ ] **Step 8: Run Task 2 tests and typecheck**

Run:

```bash
npx vitest run tests/unit/auth tests/unit/checkins/api.test.ts
npm run typecheck
```

Expected: focused tests pass; remaining type failures, if any, are restricted to Task 3 UI and test fixtures.

- [ ] **Step 9: Commit Task 2**

```bash
git add server/auth app/api/auth 'app/(app)/page.tsx' \
  tests/unit/auth tests/unit/checkins/api.test.ts
git commit -m "feat: authenticate accounts with email"
```

---

### Task 3: Email Authentication UI and Profile Experience

**Files:**
- Modify: `app/(auth)/login/page.tsx`
- Modify: `app/(auth)/register/page.tsx`
- Modify: `app/(auth)/recover/page.tsx`
- Modify: `features/auth/login-form.tsx`
- Modify: `features/auth/register-form.tsx`
- Modify: `features/auth/recover-form.tsx`
- Modify: `features/profile/app-header.tsx`
- Modify: `tests/unit/auth/forms.test.tsx`
- Modify: `tests/unit/profile/app-header.test.tsx`
- Modify: `tests/unit/checkins/workspace.test.tsx`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: Task 2 email API payloads and `AccountProfile.email`.
- Produces: accessible email-oriented registration, login, recovery, and read-only profile UI.

- [ ] **Step 1: Write failing form and profile tests**

Require each auth page to render an input labelled `邮箱` with:

```ts
expect(email).toHaveAttribute("type", "email");
expect(email).toHaveAttribute("autocomplete", "username");
```

Require submitted payloads to contain `email` and no `phone`. Require profile settings to show
the full read-only email, say “邮箱不可修改”, and continue allowing display-name/avatar updates.
Require visible page copy and rendered-source checks to use email instead of phone.

- [ ] **Step 2: Run UI tests and verify RED**

Run:

```bash
npx vitest run tests/unit/auth/forms.test.tsx \
  tests/unit/profile/app-header.test.tsx \
  tests/unit/checkins/workspace.test.tsx
node --test tests/rendered-html.test.mjs
```

Expected: FAIL on phone labels, attributes, payloads, profile fields, and copy.

- [ ] **Step 3: Implement email forms and profile display**

Replace phone state with email state, use `type="email"`, `autoComplete="username"`, and pass raw input to the server for authoritative normalization. Update registration, login, recovery, and profile copy. Remove numeric filtering, `inputMode="numeric"`, `maxLength={11}`, and phone masking. Render `profile.email` as a read-only value.

- [ ] **Step 4: Run UI tests and verify GREEN**

Run:

```bash
npx vitest run tests/unit/auth/forms.test.tsx \
  tests/unit/profile/app-header.test.tsx \
  tests/unit/checkins/workspace.test.tsx
node --test tests/rendered-html.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run all unit tests, lint, and typecheck**

Run:

```bash
npm run test:unit
npm run lint
npm run typecheck
```

Expected: PASS with no runtime phone references outside historical migration/spec files and the still-pending Task 4 harness.

- [ ] **Step 6: Commit Task 3**

```bash
git add 'app/(auth)' features/auth features/profile \
  tests/unit/auth/forms.test.tsx tests/unit/profile/app-header.test.tsx \
  tests/unit/checkins/workspace.test.tsx tests/rendered-html.test.mjs
git commit -m "feat: switch account screens to email"
```

---

### Task 4: Test Harness, Operations, and Release Verification

**Files:**
- Modify: `tests/helpers/integration-fixtures.ts`
- Modify: `tests/integration/auth-routes.test.ts`
- Modify: `tests/integration/checkins-api.test.ts`
- Modify: `tests/integration/storage.test.ts`
- Modify: `tests/e2e/helpers.ts`
- Modify: `tests/e2e/auth.spec.ts`
- Modify: `scripts/run-e2e-tests.mjs`
- Modify: `tests/unit/e2e/helpers.test.ts`
- Modify: `tests/unit/e2e/runner.test.ts`
- Modify: `README.md`
- Modify: `docs/operations/supabase-runbook.md`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: Tasks 1-3 complete email account flow.
- Produces: collision-safe email fixtures, safe cleanup ownership registry, updated operations guidance, and release evidence.

- [ ] **Step 1: Write failing integration and E2E fixture tests**

Replace numeric phones with reserved test emails under `e2e.daily-attention.invalid` and
`integration.daily-attention.invalid`. Require deterministic uniqueness across project, worker,
retry, invocation, and run scope. Registry records must be exactly:

```json
{"userId":"<uuid>","email":"<reserved-test-email>"}
```

Cleanup must delete only users whose current Auth email exactly matches the owned registry email.
It must fail closed on malformed registries, symlinks, duplicate ownership, unconfirmed collisions,
or any non-reserved email.

- [ ] **Step 2: Run harness tests and verify RED**

Run:

```bash
npx vitest run tests/unit/e2e
```

Expected: FAIL because the harness still allocates and records phones.

- [ ] **Step 3: Implement email-safe fixtures and cleanup**

Use reserved domains, for example:

```ts
email-${projectId}-${runScope}-${workerIndex}-${retry}-${invocation}@e2e.daily-attention.invalid
```

Rename registry paths and environment variables from phone to email semantics. Preserve file
descriptor, `O_NOFOLLOW`, ownership, collision, and cleanup hardening. Update integration helpers,
Auth flows, check-in/storage fixtures, and Playwright fields to use email.

- [ ] **Step 4: Update operations and local Supabase config**

- Disable local phone signup/provider configuration.
- Keep local email confirmations disabled for tests, while application Admin creation still sets
  `email_confirm: true`.
- Document Email Provider ON, Phone Provider OFF, public signup OFF, and no SMTP requirement.
- Replace production phone-provider preflight with checks that public settings report email enabled,
  phone disabled, and signup disabled.
- Remove instructions requiring Twilio or any SMS provider.

- [ ] **Step 5: Run integration, rendered, and E2E suites**

Run:

```bash
npm run test:integration
npm run test:rendered
npm run test:e2e
```

Expected: 12 integration tests, rendered checks, and all Playwright projects pass with email registration.

- [ ] **Step 6: Run the full local release gate**

Run:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run supabase:test
npm run test:integration
npm run test:rendered
npm run test:e2e
npm run build
```

Then scan runtime code:

```bash
rg -n "phone|Phone|手机号|SMS|Twilio" app features lib server scripts tests README.md docs/operations \
  --glob '!**/*.snap'
```

Expected: all commands pass. Remaining matches must be limited to explicit negative assertions,
historical cleanup compatibility, or documentation stating that phone/SMS are not used.

- [ ] **Step 7: Commit Task 4**

```bash
git add tests scripts/run-e2e-tests.mjs README.md docs/operations/supabase-runbook.md supabase/config.toml
git commit -m "test: verify email account release flow"
```

- [ ] **Step 8: Review and integrate the branch**

Run a specification review and a code-quality review. Address findings, repeat affected tests, then
merge `codex/email-password-auth` into `main` without rewriting unrelated user changes.

- [ ] **Step 9: Apply the production migration**

Confirm production remains empty without printing identities:

```text
auth_users=0
profiles=0
check_ins=0
images=0
```

Apply `202607270001_email_password_auth.sql` to project
`jhiybzdvxvlkbqvamynp`. Verify migrations, schema types, security advisors, and production Auth
settings. Do not enable Phone Provider or configure an SMS provider.

- [ ] **Step 10: Complete user-assisted production smoke**

Run the application against production Supabase. The user personally enters the intended first
email, password, and recovery code. Verify:

1. registration succeeds and creates `Attention_001`;
2. logout and email/password login succeed;
3. profile name/avatar update succeeds while email remains unchanged;
4. a check-in persists and reloads;
5. recovery code rotates and old code fails;
6. recovery with the current code changes the password and issues a new code;
7. no SMS or email is sent.

Record only statuses and aggregate counts, never the user's email, password, or recovery codes.
