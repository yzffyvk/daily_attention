# Phone Password Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace name-based accounts with mainland-China phone-and-password accounts while retaining an editable display name generated as `Attention_001`.

**Architecture:** Supabase Auth stores the canonical E.164 phone and password. `public.profiles` stores the 11-digit phone, editable display name, and avatar; service-role RPCs atomically create profiles and recovery credentials. The existing server-only auth boundary remains responsible for validation, rate limits, session cookies, recovery codes, and compensating deletion.

**Tech Stack:** Node.js 22.13+, TypeScript 5.9, React 19, vinext/Next.js App Router, Zod 4, Supabase JS 2.110, Supabase Postgres 17, Vitest, pgTAP, Playwright.

## Global Constraints

- Support only mainland-China mobile numbers matching `^1[3-9][0-9]{9}$`.
- Normalize Auth phone values to E.164 `+86` format.
- Do not send SMS or enable public Supabase sign-up.
- Keep both `profiles.phone` and `profiles.display_name`.
- Generate display names from `Attention_001` through `Attention_999`; never reuse sequence values.
- Keep five selectable avatars during registration.
- Keep phone immutable in this release.
- Keep `profiles` and `check_ins` RLS-protected and owner-only.
- Never expose `SUPABASE_SECRET_KEY` to browser code.
- Clear legacy users and data only after all local checks pass and only with an explicit project-ref confirmation.
- Use TDD for every behavior change: test, observe the expected failure, implement, observe the pass, then commit.
- Do not add dependencies.

---

## File Map

- `lib/domain/user.ts`: phone normalization and request schemas.
- `server/auth/ports.ts`: phone-oriented service interfaces and `AccountProfile`.
- `server/auth/service.ts`: registration, login, recovery, profile, and recovery-code workflows.
- `server/auth/supabase-adapter.ts`: native Supabase phone Auth and profile/RPC mapping.
- `server/auth/request.ts`: phone-based HMAC rate-limit buckets.
- `server/auth/response.ts`: phone-oriented error copy and duplicate-phone mapping.
- `app/api/auth/*`, `app/api/me/route.ts`: HTTP adapters.
- `features/auth/*`, `app/(auth)/*`: phone login, registration, recovery, and navigation.
- `features/profile/app-header.tsx`: editable display name and read-only masked phone.
- `app/(app)/page.tsx`: server profile selection.
- The CLI-generated `supabase/migrations/*_phone_password_auth.sql`: schema and RPC migration; capture and reuse the exact generated filename.
- `supabase/tests/database/*`: schema, RLS, registration, recovery, and sequence tests.
- `scripts/reset-legacy-accounts.mjs`: guarded production cleanup.
- `lib/supabase/database.types.ts`: regenerated database types.
- `tests/unit`, `tests/integration`, `tests/e2e`: behavior coverage.

---

### Task 1: Phone Domain Contracts

**Files:**
- Modify: `tests/unit/domain/user.test.ts`
- Modify: `lib/domain/user.ts`
- Modify: `server/auth/request.ts`
- Modify: `tests/unit/auth/request.test.ts`

**Interfaces:**
- Produces: `normalizePhone(value: string): string`
- Produces: `toE164Phone(value: string): string`
- Produces: `phoneRateBucket(request: Request, phone: string): string`
- Produces schemas with `phone` and profile patches with `displayName`.

- [ ] **Step 1: Write failing phone-schema tests**

Replace name-oriented assertions with:

```ts
expect(normalizePhone(" 138 0013 8000 ")).toBe("13800138000");
expect(toE164Phone("13800138000")).toBe("+8613800138000");
expect(registerInputSchema.parse({
  phone: "138 0013 8000",
  password: "  Keep Spaces  ",
  avatarKey: 3,
})).toEqual({
  phone: "13800138000",
  password: "  Keep Spaces  ",
  avatarKey: 3,
});
expect(registerInputSchema.safeParse({
  phone: "12800138000",
  password: "password123",
  avatarKey: 3,
}).success).toBe(false);
expect(profilePatchSchema.safeParse({ displayName: "新的名称" }).success).toBe(true);
expect(profilePatchSchema.safeParse({ phone: "13900139000" }).success).toBe(false);
```

- [ ] **Step 2: Run tests and observe RED**

Run:

```bash
npx vitest run tests/unit/domain/user.test.ts tests/unit/auth/request.test.ts
```

Expected: FAIL because `normalizePhone`, `toE164Phone`, phone schemas, and `phoneRateBucket` do not exist.

- [ ] **Step 3: Implement the phone contracts**

Use these definitions:

```ts
export function normalizePhone(value: string) {
  return value.normalize("NFKC").replace(/[\s-]+/gu, "");
}

const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .pipe(z.string().regex(/^1[3-9][0-9]{9}$/u, "请输入正确的 11 位手机号"));

export function toE164Phone(phone: string) {
  return `+86${phone}`;
}

export const registerInputSchema = z.object({
  phone: phoneSchema,
  password: passwordSchema,
  avatarKey: z.number().int().min(1).max(5),
});

export const loginInputSchema = z.object({
  phone: phoneSchema,
  password: z.string(),
});

export const recoverInputSchema = z.object({
  phone: phoneSchema,
  recoveryCode: recoveryCodeSchema,
  newPassword: passwordSchema,
});

export const profilePatchSchema = z.object({
  avatarKey: z.number().int().min(1).max(5).optional(),
  displayName: normalizedNameSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.avatarKey === undefined && value.displayName === undefined) {
    context.addIssue({
      code: "custom",
      message: "请至少修改名称或头像",
    });
  }
});
```

Rename `nameRateBucket` to:

```ts
export function phoneRateBucket(request: Request, phone: string) {
  return `${requestIp(request)}:${normalizePhone(phone)}`;
}
```

- [ ] **Step 4: Run tests and observe GREEN**

Run:

```bash
npx vitest run tests/unit/domain/user.test.ts tests/unit/auth/request.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/user.ts server/auth/request.ts tests/unit/domain/user.test.ts tests/unit/auth/request.test.ts
git commit -m "refactor: define phone account contracts"
```

---

### Task 2: Database Phone Profile and Recovery Model

**Files:**
- Create via CLI: the exact `supabase/migrations/*_phone_password_auth.sql` path printed by `npx supabase migration new phone_password_auth`
- Modify: `supabase/tests/database/schema.test.sql`
- Modify: `supabase/tests/database/account-functions.test.sql`
- Modify: `supabase/tests/database/rls.test.sql`

**Interfaces:**
- Produces: `public.complete_registration(uuid, text, smallint, bytea) -> public.profiles`
- Produces: `public.resolve_phone(text) -> table(user_id uuid)`
- Produces: `public.update_profile(uuid, text, smallint) -> public.profiles`
- Keeps: `read_recovery_digest` and conditional `replace_recovery_digest`.

- [ ] **Step 1: Generate the migration file with the CLI**

Run:

```bash
npx supabase migration new phone_password_auth
```

Use the exact generated file for every migration edit in this task. Do not rename it or invent a timestamp.

- [ ] **Step 2: Write failing pgTAP schema and function tests**

Assert:

```sql
select has_column('public', 'profiles', 'phone');
select col_is_null('public', 'profiles', 'phone', 'phone is required');
select col_is_unique('public', 'profiles', 'phone', 'phone is unique');
select has_table('private', 'account_recovery_credentials');
select hasnt_table('private', 'login_aliases');
select function_returns(
  'public',
  'complete_registration',
  array['uuid', 'text', 'smallint', 'bytea'],
  'public.profiles'
);
```

Add service-role lifecycle assertions:

```sql
select setval('private.attention_display_name_seq', 1, false);

select results_eq(
  $$select phone, display_name, avatar_key
    from public.complete_registration(
      '00000000-0000-4000-8000-000000000003',
      '13800138000',
      3,
      decode('01020304', 'hex')
    )$$,
  $$values ('13800138000'::varchar, 'Attention_001'::varchar, 3::smallint)$$
);
```

Call registration twice in one transaction and assert the second profile receives `Attention_002`. Assert invalid and duplicate phone values fail. Assert `anon` and `authenticated` cannot call registration, phone resolution, recovery digest, or profile-update functions.

- [ ] **Step 3: Run database tests and observe RED**

Run:

```bash
npm run supabase:reset
npm run supabase:test
```

Expected: FAIL because the phone column, sequence, private recovery table, and new RPC signatures do not exist.

- [ ] **Step 4: Implement the migration**

The migration must:

```sql
alter table public.profiles
  add column phone varchar(11);

create sequence private.attention_display_name_seq
  minvalue 1
  maxvalue 999
  start 1
  no cycle;

create table private.account_recovery_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  recovery_code_digest bytea not null,
  recovery_rotated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Because legacy users are cleared before this migration reaches production, remove residual public rows defensively, then make phone required:

```sql
delete from public.check_ins;
delete from public.profiles;
drop table private.login_aliases;

alter table public.profiles
  alter column phone set not null,
  add constraint profiles_phone_key unique (phone),
  add constraint profiles_phone_check check (phone ~ '^1[3-9][0-9]{9}$');
```

`complete_registration` must obtain `nextval`, reject values over 999 by sequence bounds, format `Attention_` plus three digits, insert the profile and recovery row in one transaction, and return the profile. Rebuild `resolve_phone` and `update_profile`, preserving empty `search_path`, explicit schema qualification, revoked PUBLIC/anon/authenticated execution, and service-role-only grants.

Update `read_recovery_digest` and `replace_recovery_digest` to use
`private.account_recovery_credentials`. Keep the existing conditional replacement semantics.

- [ ] **Step 5: Reset and run pgTAP tests**

Run:

```bash
npm run supabase:reset
npm run supabase:test
```

Expected: all database suites PASS.

- [ ] **Step 6: Run local advisors**

Discover the installed command first:

```bash
npx supabase db advisors --help
npx supabase db advisors --local
```

Expected: no new security or performance errors caused by this migration.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/*_phone_password_auth.sql supabase/tests/database/schema.test.sql supabase/tests/database/account-functions.test.sql supabase/tests/database/rls.test.sql
git commit -m "feat: add phone profile schema"
```

---

### Task 3: Phone-Oriented Auth Service

**Files:**
- Modify: `server/auth/ports.ts`
- Modify: `server/auth/service.ts`
- Modify: `tests/unit/auth/service.test.ts`

**Interfaces:**
- Consumes: `toE164Phone(phone)`.
- Produces: `AccountProfile = { id, phone, displayName, avatarKey }`.
- Produces ports with phone-native Auth signatures.

- [ ] **Step 1: Write failing service tests**

Build the mock profile as:

```ts
const profile = {
  id: "user-1",
  phone: "13800138000",
  displayName: "Attention_001",
  avatarKey: 2,
};
```

Assert registration:

```ts
await registerAccount({
  phone: "13800138000",
  password: "password123",
  avatarKey: 2,
  bucket: "register-key",
}, adapter);

expect(adapter.createAuthUser).toHaveBeenCalledWith({
  phone: "+8613800138000",
  password: "password123",
});
expect(adapter.completeRegistration).toHaveBeenCalledWith(
  expect.objectContaining({ phone: "13800138000" }),
);
expect(adapter.signIn).toHaveBeenCalledWith("+8613800138000", "password123");
```

Assert login signs in directly without resolving a name. Assert recovery calls
`resolvePhone("13800138000")`. Assert `updateProfile` calls `updateProfile` without signing in or requiring a password.

- [ ] **Step 2: Run test and observe RED**

Run:

```bash
npx vitest run tests/unit/auth/service.test.ts
```

Expected: FAIL because ports and services still use name/internal-email semantics.

- [ ] **Step 3: Replace the service interfaces**

Use:

```ts
export type AccountProfile = {
  id: string;
  phone: string;
  displayName: string;
  avatarKey: number;
};

createAuthUser(input: { phone: string; password: string }): Promise<{ id: string }>;
completeRegistration(input: {
  userId: string;
  phone: string;
  avatarKey: number;
  recoveryDigest: Uint8Array;
}): Promise<AccountProfile>;
resolvePhone(phone: string): Promise<{ userId: string } | null>;
updateProfile(input: {
  userId: string;
  displayName: string;
  avatarKey: number;
}): Promise<AccountProfile>;
signIn(phone: string, password: string): Promise<void>;
```

Remove `loginName`, `authEmail`, `resolveLoginName`, `updateProfileIdentity`, and the password check from display-name updates. Preserve registration compensation and recovery-digest rollback behavior.

- [ ] **Step 4: Run test and observe GREEN**

Run:

```bash
npx vitest run tests/unit/auth/service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/auth/ports.ts server/auth/service.ts tests/unit/auth/service.test.ts
git commit -m "refactor: use phone auth services"
```

---

### Task 4: Supabase Adapter and HTTP Routes

**Files:**
- Modify: `server/auth/supabase-adapter.ts`
- Modify: `server/auth/response.ts`
- Modify: `app/api/auth/register/route.ts`
- Modify: `app/api/auth/login/route.ts`
- Modify: `app/api/auth/recover/route.ts`
- Modify: `app/api/auth/recovery-code/rotate/route.ts`
- Modify: `app/api/me/route.ts`
- Modify: `tests/unit/auth/supabase-adapter.test.ts`
- Modify: `tests/unit/auth/login-route.test.ts`
- Modify: `tests/unit/auth/me-route.test.ts`
- Modify: `tests/unit/auth/response.test.ts`

**Interfaces:**
- Consumes Task 2 RPC names and Task 3 ports.
- Produces API envelopes containing `{ profile: AccountProfile }`.

- [ ] **Step 1: Write failing adapter and route tests**

Assert Admin Auth creation:

```ts
expect(createUser).toHaveBeenCalledWith({
  phone: "+8613800138000",
  password: "password123",
  phone_confirm: true,
});
```

Assert native sign-in:

```ts
expect(signInWithPassword).toHaveBeenCalledWith({
  phone: "+8613800138000",
  password: "password123",
});
```

Assert profile mapping selects and returns `id, phone, display_name, avatar_key`. Assert login routes use `phoneRateBucket`. Assert duplicate phone maps to:

```ts
{
  code: "PHONE_TAKEN",
  message: "该手机号已注册",
  details: { field: "phone" },
}
```

Assert invalid login is “手机号或密码不正确” and invalid recovery is “手机号或恢复码不正确”.

- [ ] **Step 2: Run tests and observe RED**

Run:

```bash
npx vitest run tests/unit/auth/supabase-adapter.test.ts tests/unit/auth/login-route.test.ts tests/unit/auth/me-route.test.ts tests/unit/auth/response.test.ts
```

Expected: FAIL on old email/name calls and profile shapes.

- [ ] **Step 3: Implement native phone adapter behavior**

Create users with:

```ts
admin.auth.admin.createUser({
  phone,
  password,
  phone_confirm: true,
});
```

Sign in with:

```ts
server.auth.signInWithPassword({ phone, password });
```

Call `complete_registration`, `resolve_phone`, and `update_profile` using the Task 2 parameter names. Profile mapping must return all four `AccountProfile` fields.

Update routes to use `parsed.data.phone`, `phoneRateBucket`, and `displayName`. Recovery-code rotation must reauthenticate using the current profile phone. Profile PATCH must never accept or update phone.

- [ ] **Step 4: Run tests and observe GREEN**

Run the Task 4 test command again.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/auth/supabase-adapter.ts server/auth/response.ts app/api/auth/register/route.ts app/api/auth/login/route.ts app/api/auth/recover/route.ts app/api/auth/recovery-code/rotate/route.ts app/api/me/route.ts tests/unit/auth/supabase-adapter.test.ts tests/unit/auth/login-route.test.ts tests/unit/auth/me-route.test.ts tests/unit/auth/response.test.ts
git commit -m "feat: connect native Supabase phone auth"
```

---

### Task 5: Phone Login, Registration, and Recovery UI

**Files:**
- Modify: `features/auth/login-form.tsx`
- Modify: `features/auth/register-form.tsx`
- Modify: `features/auth/recover-form.tsx`
- Modify: `app/(auth)/login/page.tsx`
- Modify: `app/(auth)/register/page.tsx`
- Modify: `app/(auth)/recover/page.tsx`
- Modify: `tests/unit/auth/forms.test.tsx`
- Modify: `tests/rendered-html.test.mjs`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: phone-oriented API payloads from Task 4.
- Produces: accessible phone inputs and `/login` navigation from registration.

- [ ] **Step 1: Write failing form tests**

Assert:

```ts
expect(screen.getByLabelText("手机号")).toHaveAttribute("inputmode", "numeric");
expect(screen.getByLabelText("手机号")).toHaveAttribute("autocomplete", "tel");
expect(screen.queryByLabelText("名称")).not.toBeInTheDocument();
expect(screen.getAllByRole("radio", { name: /头像/ })).toHaveLength(5);
expect(screen.getByRole("link", { name: "返回登录" })).toHaveAttribute("href", "/login");
```

Submit registration and assert the body:

```ts
expect(fetch).toHaveBeenCalledWith(
  "/api/auth/register",
  expect.objectContaining({
    body: JSON.stringify({
      phone: "13800138000",
      password: "password123",
      avatarKey: 1,
    }),
  }),
);
```

Add equivalent login and recovery phone assertions. Assert invalid field errors use `phone` IDs and preserve the entered phone.

- [ ] **Step 2: Run tests and observe RED**

Run:

```bash
npx vitest run tests/unit/auth/forms.test.tsx
npm run test:rendered
```

Expected: FAIL because forms still render and submit `name`, and registration has no return link.

- [ ] **Step 3: Implement phone forms**

Use a shared input contract in each form:

```tsx
<label className="auth-field">
  <span>手机号</span>
  <input
    autoComplete="tel"
    inputMode="numeric"
    maxLength={11}
    onChange={(event) => setPhone(event.target.value.replace(/\D/gu, ""))}
    value={phone}
  />
</label>
```

Registration removes name state and validation, retains avatars and password confirmation, and adds:

```tsx
<Link className="secondary-button" href="/login">返回登录</Link>
```

Update page descriptions to phone-account language. Keep the recovery-code dialog name prop populated from `result.profile.displayName`.

- [ ] **Step 4: Run tests and observe GREEN**

Run the Task 5 test commands again.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/auth 'app/(auth)' app/globals.css tests/unit/auth/forms.test.tsx tests/rendered-html.test.mjs
git commit -m "feat: add phone authentication forms"
```

---

### Task 6: Editable Display Name and Read-Only Phone

**Files:**
- Modify: `features/profile/app-header.tsx`
- Modify: `features/checkins/api.ts`
- Modify: `app/(app)/page.tsx`
- Modify: `tests/unit/profile/app-header.test.tsx`
- Modify: `tests/unit/checkins/api.test.ts`

**Interfaces:**
- Consumes: `AccountProfile.phone` and profile PATCH `{ displayName, avatarKey }`.
- Produces: masked phone presentation and password-free display-name updates.

- [ ] **Step 1: Write failing profile tests**

Use:

```ts
const profile = {
  id: "profile-1",
  phone: "13800138000",
  avatarKey: 1,
  displayName: "Attention_001",
};
```

Open profile settings and assert:

```ts
expect(screen.getByText("138****8000")).toBeVisible();
expect(screen.getByLabelText("名称")).toHaveValue("Attention_001");
expect(screen.queryByLabelText("当前密码")).not.toBeInTheDocument();
```

Edit the name and assert PATCH body:

```ts
{
  displayName: "今天也学习",
  avatarKey: 1,
}
```

- [ ] **Step 2: Run tests and observe RED**

Run:

```bash
npx vitest run tests/unit/profile/app-header.test.tsx tests/unit/checkins/api.test.ts
```

Expected: FAIL because profile objects have no phone and rename still requests a password.

- [ ] **Step 3: Implement profile behavior**

Add:

```ts
function maskPhone(phone: string) {
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}
```

Remove current-password state, field, copy, and reauthentication from the profile dialog. Rename the request property from `name` to `displayName`. Select `phone` in `app/(app)/page.tsx`.

- [ ] **Step 4: Run tests and observe GREEN**

Run the Task 6 test command again.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/profile/app-header.tsx features/checkins/api.ts 'app/(app)/page.tsx' tests/unit/profile/app-header.test.tsx tests/unit/checkins/api.test.ts
git commit -m "feat: separate phone and display name"
```

---

### Task 7: Integration, E2E, and Generated Types

**Files:**
- Modify: `tests/integration/auth-routes.test.ts`
- Modify: `tests/integration/checkins-api.test.ts`
- Modify: `tests/integration/storage.test.ts`
- Modify: `tests/e2e/helpers.ts`
- Modify: `tests/e2e/auth.spec.ts`
- Modify: `tests/e2e/checkins.spec.ts`
- Modify: `tests/e2e/responsive.spec.ts`
- Modify: `lib/supabase/database.types.ts`

**Interfaces:**
- Verifies the complete local system built in Tasks 1-6.

- [ ] **Step 1: Convert integration fixtures to unique phones**

Use a deterministic helper:

```ts
export function uniquePhone(seed: number) {
  return `139${String(seed).padStart(8, "0").slice(-8)}`;
}
```

Registration payloads become `{ phone, password, avatarKey }`. Login and recovery use phone. Assert the first local registration returns a display name matching `/^Attention_[0-9]{3}$/`.

- [ ] **Step 2: Convert Playwright helpers and assertions**

Fill “手机号” instead of “名称”, retain avatar selection, and assert the registration page contains a “返回登录” link that navigates to `/login`.

- [ ] **Step 3: Run integration and E2E suites and observe RED**

Run:

```bash
npm run test:integration
npm run test:e2e
```

Expected: FAIL until all remaining name payloads and profile fixtures are converted.

- [ ] **Step 4: Finish fixture conversions and regenerate types**

Run:

```bash
npm run supabase:types
```

Review `lib/supabase/database.types.ts` for `profiles.phone`,
`account_recovery_credentials`, and new RPC signatures. Do not hand-edit generated types.

- [ ] **Step 5: Run integration and E2E suites and observe GREEN**

Run:

```bash
npm run test:integration
npm run test:e2e
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/auth-routes.test.ts tests/integration/checkins-api.test.ts tests/integration/storage.test.ts tests/e2e/helpers.ts tests/e2e/auth.spec.ts tests/e2e/checkins.spec.ts tests/e2e/responsive.spec.ts lib/supabase/database.types.ts
git commit -m "test: cover phone account journeys"
```

---

### Task 8: Guarded Legacy Data Reset

**Files:**
- Create: `scripts/reset-legacy-accounts.mjs`
- Modify: `package.json`
- Create: `tests/unit/reset-legacy-accounts.test.ts`
- Modify: `docs/operations/supabase-runbook.md`

**Interfaces:**
- Produces: a dry-run-by-default CLI requiring `--project-ref` and `--apply`.
- Uses: `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`.

- [ ] **Step 1: Write failing reset-script tests**

Extract pure validation/count formatting functions and assert:

```ts
expect(validateTarget({
  projectRef: "jhiybzdvxvlkbqvamynp",
  supabaseUrl: "https://jhiybzdvxvlkbqvamynp.supabase.co",
})).toBe(true);

expect(() => validateTarget({
  projectRef: "wrong-project",
  supabaseUrl: "https://jhiybzdvxvlkbqvamynp.supabase.co",
})).toThrow("PROJECT_REF_MISMATCH");
```

Assert no deletion methods are called without `--apply`, and output contains only aggregate user, profile, check-in, and image counts.

- [ ] **Step 2: Run test and observe RED**

Run:

```bash
npx vitest run tests/unit/reset-legacy-accounts.test.ts
```

Expected: FAIL because the reset module does not exist.

- [ ] **Step 3: Implement the guarded reset script**

The script must:

1. Parse `--project-ref=<ref>` and optional `--apply`.
2. Verify the URL hostname begins with the exact project ref.
3. Count profiles and check-ins using `{ count: "exact", head: true }`.
4. Count Auth users through paginated `admin.auth.admin.listUsers`.
5. Count bucket objects recursively without printing paths.
6. Print counts and exit successfully in dry-run mode.
7. With `--apply`, call `storage.emptyBucket("checkin-images")`, then delete every Auth user through the Admin API.
8. Recount and fail unless all four counts are zero.

Add:

```json
"reset:legacy-accounts": "node --env-file=.env.production.local scripts/reset-legacy-accounts.mjs"
```

Document the exact dry-run and apply commands in the runbook.

- [ ] **Step 4: Run test and observe GREEN**

Run:

```bash
npx vitest run tests/unit/reset-legacy-accounts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/reset-legacy-accounts.mjs tests/unit/reset-legacy-accounts.test.ts package.json docs/operations/supabase-runbook.md
git commit -m "feat: add guarded legacy account reset"
```

---

### Task 9: Full Local Release Gate

**Files:**
- Modify only files needed to fix regressions found by the release gate.

- [ ] **Step 1: Run all local checks**

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

Expected: every command exits 0.

- [ ] **Step 2: Inspect the three required viewports**

Use Playwright at:

```text
390×844
1024×768
1440×900
```

Verify login, registration, recovery, and profile dialogs have no overflow, clipped text, or overlapping controls.

- [ ] **Step 3: Commit release-gate fixes if any**

```bash
git status --short
git add -u
git commit -m "fix: close phone auth release gaps"
```

Run `git add -u` only after confirming every listed change is a release-gate fix. Skip this commit when the worktree remains clean.

---

### Task 10: Production Reset, Migration, and Smoke Test

**Files:**
- No new source files.
- Uses the committed reset script and CLI-generated migration.

**Preconditions:**
- Task 9 is fully green.
- `git status --short` is empty.
- `.env.production.local` has non-empty Supabase URL, publishable key, secret key, rate-limit pepper, and production origin.
- The connected project is exactly `jhiybzdvxvlkbqvamynp` (`daily_attention`).

- [ ] **Step 1: Run the destructive operation in dry-run mode**

Run:

```bash
npm run reset:legacy-accounts -- --project-ref=jhiybzdvxvlkbqvamynp
```

Record aggregate counts only.

- [ ] **Step 2: Execute the approved reset**

Run:

```bash
npm run reset:legacy-accounts -- --project-ref=jhiybzdvxvlkbqvamynp --apply
```

Expected: users, profiles, check-ins, and images all report zero.

- [ ] **Step 3: Apply the committed migration**

Discover commands before use:

```bash
npx supabase migration list --help
npx supabase db push --help
```

Then apply the pending migration to the linked production project and verify local/remote migration lists match.

- [ ] **Step 4: Run Supabase advisors**

Run security and performance advisors against `jhiybzdvxvlkbqvamynp`. Resolve all errors introduced by this migration before continuing.

- [ ] **Step 5: Smoke-test production data behavior**

Create one new phone account and verify:

1. Registration returns an `Attention_001` profile.
2. The same phone can log in after logout.
3. Display name and avatar can be changed without a password prompt.
4. Phone remains unchanged.
5. A check-in survives refresh.
6. Recovery code rotates and the new password logs in.

- [ ] **Step 6: Push the completed main branch**

```bash
git status --short
git push origin main
```

Expected: clean status and remote `main` at the same HEAD.
