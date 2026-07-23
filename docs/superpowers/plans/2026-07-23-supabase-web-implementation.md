# Supabase Web Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace browser-only name profiles and IndexedDB records with an open-registration, name-and-password Supabase account system and a cloud-backed personal AI learning journal for about 100 web users.

**Architecture:** Keep the current Next.js/vinext application as a modular monolith on Cloudflare. Next.js Route Handlers own trusted authentication and validation, Supabase Auth owns passwords and sessions, Postgres with RLS owns records, Private Storage owns images, and IndexedDB retains only drafts plus the legacy import source.

**Tech Stack:** Node.js >=22.13.0, Next.js 16.2.6, React 19.2.6, vinext 0.0.50, TypeScript 5.9.3, Supabase Auth/Postgres/Storage, `@supabase/ssr`, TanStack Query, Zod, IndexedDB, Vitest, Testing Library, Playwright, Cloudflare Sites hosting.

## Global Constraints

- Work from the approved design at `docs/superpowers/specs/2026-07-23-supabase-web-architecture-design.md`.
- Before implementation, reconcile the existing dirty worktree without discarding user changes; create an isolated worktree only after the current UI changes have a deliberate baseline commit.
- Do not stage, delete, or modify untracked duplicate files whose names contain ` 2` unless the user explicitly requests it.
- Preserve the current visual direction, the calendar-above-editor workflow, five bundled avatars, confetti, sound preference, reduced-motion behavior, and responsive breakpoints.
- Formal records require an online Supabase write; offline behavior stores only an unsent draft and never auto-submits on reconnect.
- Use immutable Supabase Auth UUIDs for all ownership. Login names are unique mutable aliases, never foreign keys.
- First release has open registration, no invite codes, no admin UI, no administrator role, and no manual password reset.
- Password recovery uses a 26-character Crockford Base32 recovery code; the plaintext is shown once and is never logged or persisted in browser storage.
- A user has at most one check-in per date and one image per check-in.
- Browser code must never receive the Supabase secret/service-role key or the rate-limit HMAC pepper.
- Authenticated and auth-refresh responses are dynamic and use `Cache-Control: private, no-store`.
- Production database changes go through committed Supabase SQL migrations only.
- The final deployment must reuse the opaque Sites `project_id` from `.openai/hosting.json` and use the Sites hosting workflow.

---

## Planned File Structure

```text
app/
  (app)/page.tsx
  (auth)/layout.tsx
  (auth)/login/page.tsx
  (auth)/recover/page.tsx
  (auth)/register/page.tsx
  api/auth/{login,logout,recover,recovery-code/rotate,register}/route.ts
  api/checkins/[date]/route.ts
  api/checkins/route.ts
  api/me/route.ts
  api/uploads/checkin-image/route.ts
  providers.tsx
features/
  auth/{auth-card,login-form,recover-form,recovery-code-dialog,register-form}.tsx
  calendar/month-calendar.tsx
  checkins/{api,checkin-editor,checkin-workspace,dirty-switch-dialog,image-note-uploader,queries,types}.ts(x)
  drafts/use-checkin-draft.ts
  migration/{legacy-import-dialog,use-legacy-import}.ts(x)
  profile/app-header.tsx
lib/
  api/result.ts
  domain/{checkin,user}.ts
  indexed-db/{drafts,legacy}.ts
  supabase/{admin,browser,server}.ts
server/
  auth/{ports,service,supabase-adapter}.ts
  checkins/{repository,service}.ts
  rate-limit/service.ts
  storage/service.ts
supabase/
  config.toml
  migrations/*.sql
  seed.sql
  tests/database/*.sql
tests/
  integration/*.test.ts
  unit/**/*.test.ts(x)
  e2e/*.spec.ts
  helpers/*.ts
  setup.ts
playwright.config.ts
proxy.ts
vitest.config.ts
```

---

### Task 1: Test Harness And Shared Domain Contracts

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `lib/api/result.ts`
- Create: `lib/domain/user.ts`
- Create: `lib/domain/checkin.ts`
- Create: `tests/unit/domain/user.test.ts`
- Create: `tests/unit/domain/checkin.test.ts`

**Interfaces:**
- Produces: `normalizeLoginName(value: string): string`
- Produces: `registerInputSchema`, `loginInputSchema`, `recoverInputSchema`, `profilePatchSchema`
- Produces: `checkInInputSchema`, `monthQuerySchema`, `dateKeySchema`
- Produces: `ApiSuccess<T>`, `ApiFailure`, `apiSuccess()`, `apiFailure()`
- Consumes: none

- [ ] **Step 1: Install the runtime and test dependencies**

Run:

```bash
npm install @supabase/supabase-js @supabase/ssr @tanstack/react-query zod idb
npm install --save-dev vitest jsdom fake-indexeddb @testing-library/react @testing-library/user-event @testing-library/jest-dom @playwright/test supabase start-server-and-test
```

Expected: `package.json` and `package-lock.json` include the new dependencies without changing the existing Next.js, React, vinext, confetti, or lucide versions.

- [ ] **Step 2: Add deterministic test scripts and Vitest setup**

Add these scripts to `package.json`:

```json
{
  "scripts": {
    "test:unit": "vitest run tests/unit",
    "test:integration": "start-server-and-test 'npm run dev -- --port 3100' http://127.0.0.1:3100 'vitest run tests/integration'",
    "test:e2e": "playwright test",
    "test:rendered": "node --test tests/rendered-html.test.mjs",
    "typecheck": "tsc --noEmit",
    "supabase:start": "supabase start",
    "supabase:stop": "supabase stop",
    "supabase:reset": "supabase db reset",
    "supabase:test": "supabase test db",
    "supabase:types": "supabase gen types typescript --local > lib/supabase/database.types.ts"
  }
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": new URL("./", import.meta.url).pathname } },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    restoreMocks: true,
  },
});
```

Create `tests/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
```

- [ ] **Step 3: Write failing domain tests**

Create `tests/unit/domain/user.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  normalizeLoginName,
  recoverInputSchema,
  registerInputSchema,
} from "@/lib/domain/user";

describe("user contracts", () => {
  it("normalizes names without changing passwords", () => {
    expect(normalizeLoginName("  ＡＩ   小白  ")).toBe("AI 小白");
    const parsed = registerInputSchema.parse({
      name: "  ＡＩ   小白  ",
      password: "  Keep Spaces  ",
      avatarKey: 3,
    });
    expect(parsed.name).toBe("AI 小白");
    expect(parsed.password).toBe("  Keep Spaces  ");
  });

  it("requires the complete recovery payload", () => {
    expect(
      recoverInputSchema.safeParse({
        name: "学习者",
        recoveryCode: "AAAAA-BBBBB-CCCCC-DDDDD-EEEEEE",
        newPassword: "new password",
      }).success,
    ).toBe(true);
  });
});
```

Create `tests/unit/domain/checkin.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkInInputSchema, dateKeySchema } from "@/lib/domain/checkin";

describe("check-in contracts", () => {
  it("accepts a complete dated entry", () => {
    expect(
      checkInInputSchema.parse({
        attention: "理解了 attention 的作用",
        sourceUrl: "https://example.com/lesson",
        summary: "Query、Key、Value 共同计算相关性。",
        inspiration: "尝试把会议纪要按主题聚类。",
        imagePath: null,
        imageName: "",
        version: null,
      }).attention,
    ).toBe("理解了 attention 的作用");
  });

  it("rejects impossible dates and non-http sources", () => {
    expect(dateKeySchema.safeParse("2026-02-30").success).toBe(false);
    expect(
      checkInInputSchema.safeParse({
        attention: "x",
        sourceUrl: "javascript:alert(1)",
        summary: "",
        inspiration: "",
        imagePath: null,
        imageName: "",
        version: null,
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 4: Run the tests and verify the imports fail**

Run:

```bash
npm run test:unit -- tests/unit/domain/user.test.ts tests/unit/domain/checkin.test.ts
```

Expected: FAIL because `lib/domain/user.ts` and `lib/domain/checkin.ts` do not exist.

- [ ] **Step 5: Implement the shared contracts**

Create `lib/domain/user.ts`:

```ts
import { z } from "zod";

export function normalizeLoginName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

const normalizedNameSchema = z
  .string()
  .transform(normalizeLoginName)
  .pipe(
    z
      .string()
      .min(1, "名称需要填写 1-20 个字符")
      .max(20, "名称需要填写 1-20 个字符")
      .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), "名称不能包含控制字符"),
  );

const passwordSchema = z.string().min(8, "密码至少 8 个字符").max(72, "密码最多 72 个字符");
const recoveryCodeSchema = z
  .string()
  .transform((value) => value.replace(/-/g, "").toUpperCase())
  .pipe(z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/u, "恢复码格式不正确"));

export const registerInputSchema = z.object({
  name: normalizedNameSchema,
  password: passwordSchema,
  avatarKey: z.number().int().min(1).max(5),
});

export const loginInputSchema = z.object({
  name: normalizedNameSchema,
  password: z.string(),
});

export const recoverInputSchema = z.object({
  name: normalizedNameSchema,
  recoveryCode: recoveryCodeSchema,
  newPassword: passwordSchema,
});

export const profilePatchSchema = z.object({
  avatarKey: z.number().int().min(1).max(5).optional(),
  name: normalizedNameSchema.optional(),
  currentPassword: z.string().optional(),
}).superRefine((value, context) => {
  if (value.name && !value.currentPassword) {
    context.addIssue({
      code: "custom",
      path: ["currentPassword"],
      message: "修改名称需要输入当前密码",
    });
  }
});
```

Create `lib/domain/checkin.ts`:

```ts
import { z } from "zod";

export const dateKeySchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, "日期格式不正确");

const sourceUrlSchema = z.union([
  z.literal(""),
  z.string().url().max(2048).refine((value) => /^https?:\/\//u.test(value), "仅支持 HTTP/HTTPS 链接"),
]);

export const checkInInputSchema = z.object({
  attention: z.string().trim().min(1, "请填写 attention").max(120),
  sourceUrl: sourceUrlSchema,
  summary: z.string().max(5000),
  inspiration: z.string().max(2000),
  imagePath: z.string().max(1024).nullable(),
  imageName: z.string().max(255),
  version: z.number().int().positive().nullable(),
});

export const monthQuerySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u, "月份格式不正确");
export type CheckInInput = z.infer<typeof checkInInputSchema>;
```

Create `lib/api/result.ts`:

```ts
export type ApiSuccess<T> = { ok: true; data: T; requestId: string };
export type ApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    field?: string;
    retryAfterSeconds?: number;
  };
  requestId: string;
};

export const apiSuccess = <T>(data: T, requestId = crypto.randomUUID()): ApiSuccess<T> => ({
  ok: true,
  data,
  requestId,
});

export const apiFailure = (
  code: string,
  message: string,
  requestId = crypto.randomUUID(),
  details: Pick<ApiFailure["error"], "field" | "retryAfterSeconds"> = {},
): ApiFailure => ({ ok: false, error: { code, message, ...details }, requestId });
```

- [ ] **Step 6: Run unit, type, and lint checks**

Run:

```bash
npm run test:unit -- tests/unit/domain/user.test.ts tests/unit/domain/checkin.test.ts
npm run typecheck
npm run lint
```

Expected: all commands PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/setup.ts lib/api/result.ts lib/domain tests/unit/domain
git commit -m "test: add Supabase domain contract harness"
```

---

### Task 2: Supabase Tables, Private Schema, And Generated Types

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/seed.sql`
- Create: `supabase/migrations/202607230001_accounts_and_checkins.sql`
- Create: `lib/supabase/database.types.ts`
- Modify: `.dev.vars.example`
- Test: `supabase/tests/database/schema.test.sql`

**Interfaces:**
- Produces: `public.profiles`, `public.check_ins`, `private.login_aliases`, `private.auth_rate_limits`
- Produces: private bucket `checkin-images`
- Produces: generated `Database` TypeScript type
- Consumes: field limits from Task 1

- [ ] **Step 1: Initialize the local Supabase project**

Run:

```bash
npx supabase init
```

Expected: `supabase/config.toml` is created. Keep Auth email confirmation disabled locally because internal emails are confirmed by the admin registration path.

- [ ] **Step 2: Write the failing schema assertions**

Create `supabase/tests/database/schema.test.sql`:

```sql
begin;
select plan(12);

select has_schema('private', 'private schema exists');
select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'check_ins', 'check_ins exists');
select has_table('private', 'login_aliases', 'login aliases exists');
select has_table('private', 'auth_rate_limits', 'rate-limit buckets exist');
select col_is_pk('public', 'profiles', 'id', 'profiles.id is the primary key');
select col_is_pk('private', 'login_aliases', 'user_id', 'login_aliases.user_id is the primary key');
select has_column('public', 'check_ins', 'version', 'check-ins have a version');
select has_index('public', 'check_ins', 'check_ins_user_date_key', 'one record per user and date');
select has_check('public', 'profiles', 'profiles_avatar_key_check', 'avatar is constrained');
select has_check('public', 'check_ins', 'check_ins_attention_check', 'attention is not blank');
select has_check('public', 'check_ins', 'check_ins_source_url_check', 'source URL is constrained');

select * from finish();
rollback;
```

- [ ] **Step 3: Run the database test and verify it fails**

Run:

```bash
npx supabase start
npx supabase test db
```

Expected: FAIL because the four application tables and `private` schema do not exist.

- [ ] **Step 4: Create the schema migration**

Create `supabase/migrations/202607230001_accounts_and_checkins.sql`:

```sql
create extension if not exists citext with schema extensions;
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name varchar(20) not null,
  avatar_key smallint not null constraint profiles_avatar_key_check check (avatar_key between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.login_aliases (
  user_id uuid primary key references auth.users(id) on delete cascade,
  login_name extensions.citext not null unique,
  auth_email text not null unique,
  recovery_code_digest bytea not null,
  recovery_rotated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  checkin_date date not null,
  attention varchar(120) not null
    constraint check_ins_attention_check check (length(trim(attention)) > 0),
  source_url text
    constraint check_ins_source_url_check
    check (
      source_url is null
      or (
        length(source_url) <= 2048
        and source_url ~ '^https?://'
      )
    ),
  summary text not null default '' constraint check_ins_summary_check check (length(summary) <= 5000),
  inspiration text not null default '' constraint check_ins_inspiration_check check (length(inspiration) <= 2000),
  image_path text,
  image_name varchar(255) not null default '',
  version integer not null default 1 constraint check_ins_version_check check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint check_ins_user_date_key unique (user_id, checkin_date)
);

create index check_ins_user_date_desc_idx
  on public.check_ins (user_id, checkin_date desc);

create table private.auth_rate_limits (
  bucket_digest bytea not null,
  action text not null,
  window_started_at timestamptz not null,
  attempt_count integer not null default 0,
  blocked_until timestamptz,
  primary key (bucket_digest, action)
);

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function private.touch_updated_at();

create trigger login_aliases_touch_updated_at
before update on private.login_aliases
for each row execute function private.touch_updated_at();

create trigger check_ins_touch_updated_at
before update on public.check_ins
for each row execute function private.touch_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'checkin-images',
  'checkin-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
```

- [ ] **Step 5: Reset, test, and generate TypeScript types**

Run:

```bash
npx supabase db reset
npx supabase test db
npm run supabase:types
```

Expected: schema tests PASS and `lib/supabase/database.types.ts` contains `profiles` and `check_ins`.

- [ ] **Step 6: Document local environment keys**

Set `.dev.vars.example` to contain names only:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=replace-with-local-anon-key
SUPABASE_SECRET_KEY=replace-with-local-service-role-key
AUTH_RATE_LIMIT_PEPPER=replace-with-at-least-32-random-bytes
```

Do not place real keys in the example.

- [ ] **Step 7: Commit**

```bash
git add supabase .dev.vars.example lib/supabase/database.types.ts
git commit -m "feat: add Supabase journal schema"
```

---

### Task 3: RLS, Storage Ownership, And Service-Only Account Functions

**Files:**
- Create: `supabase/migrations/202607230002_rls_and_account_functions.sql`
- Create: `supabase/tests/database/rls.test.sql`
- Create: `supabase/tests/database/account-functions.test.sql`

**Interfaces:**
- Produces RPC: `complete_registration(uuid, text, text, smallint, bytea)`
- Produces RPC: `resolve_login_name(text)`
- Produces RPC: `read_recovery_digest(uuid)`
- Produces RPC: `replace_recovery_digest(uuid, bytea, bytea)`
- Produces RPC: `update_profile_identity(uuid, text, smallint)`
- Produces RLS policies for profiles, check-ins, and Storage
- Consumes: Task 2 tables

- [ ] **Step 1: Write failing RLS tests**

Create `supabase/tests/database/rls.test.sql`:

```sql
begin;
select plan(8);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'one@internal.invalid', '', now(), now(), now()),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'two@internal.invalid', '', now(), now(), now());

insert into public.profiles (id, display_name, avatar_key)
values
  ('00000000-0000-4000-8000-000000000001', '用户一', 1),
  ('00000000-0000-4000-8000-000000000002', '用户二', 2);

insert into public.check_ins (user_id, checkin_date, attention)
values
  ('00000000-0000-4000-8000-000000000001', '2026-07-23', 'one'),
  ('00000000-0000-4000-8000-000000000002', '2026-07-23', 'two');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$select display_name from public.profiles order by display_name$$,
  $$values ('用户一'::varchar)$$,
  'user sees only their profile'
);
select results_eq(
  $$select attention from public.check_ins$$,
  $$values ('one'::varchar)$$,
  'user sees only their check-in'
);
select throws_ok(
  $$insert into public.check_ins (user_id, checkin_date, attention)
    values ('00000000-0000-4000-8000-000000000002', '2026-07-24', 'forged')$$,
  '42501',
  null,
  'user cannot insert for another user'
);
select is_empty(
  $$update public.check_ins set attention = 'forged'
    where user_id = '00000000-0000-4000-8000-000000000002'
    returning id$$,
  'user cannot update another user'
);
select lives_ok(
  $$insert into public.check_ins (user_id, checkin_date, attention)
    values ('00000000-0000-4000-8000-000000000001', '2026-07-24', 'mine')$$,
  'user can insert their own record'
);
select is(
  (select count(*)::integer from storage.objects where bucket_id = 'checkin-images'),
  0,
  'storage starts empty'
);
select has_table('private', 'login_aliases', 'private mapping exists');
select schema_privs_are('private', 'authenticated', array[]::text[], 'authenticated has no private schema privileges');

select * from finish();
rollback;
```

- [ ] **Step 2: Verify RLS tests fail before policies exist**

Run:

```bash
npx supabase test db
```

Expected: FAIL because the authenticated role can see or mutate rows without policies.

- [ ] **Step 3: Add RLS, grants, and service-only functions**

Create `supabase/migrations/202607230002_rls_and_account_functions.sql`:

```sql
alter table public.profiles enable row level security;
alter table public.check_ins enable row level security;

revoke all on public.profiles from anon;
revoke all on public.check_ins from anon;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.check_ins to authenticated;

create policy profiles_select_own
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create policy check_ins_select_own
on public.check_ins for select to authenticated
using ((select auth.uid()) = user_id);

create policy check_ins_insert_own
on public.check_ins for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy check_ins_update_own
on public.check_ins for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy check_ins_delete_own
on public.check_ins for delete to authenticated
using ((select auth.uid()) = user_id);

create policy checkin_images_select_own
on storage.objects for select to authenticated
using (
  bucket_id = 'checkin-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy checkin_images_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'checkin-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy checkin_images_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'checkin-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create or replace function public.complete_registration(
  target_user_id uuid,
  target_login_name text,
  target_auth_email text,
  target_avatar_key smallint,
  target_recovery_digest bytea
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_profile public.profiles;
begin
  insert into public.profiles (id, display_name, avatar_key)
  values (target_user_id, target_login_name, target_avatar_key)
  returning * into created_profile;

  insert into private.login_aliases (
    user_id,
    login_name,
    auth_email,
    recovery_code_digest
  )
  values (
    target_user_id,
    target_login_name,
    target_auth_email,
    target_recovery_digest
  );

  return created_profile;
end;
$$;

create or replace function public.resolve_login_name(target_login_name text)
returns table (user_id uuid, auth_email text)
language sql
security definer
stable
set search_path = ''
as $$
  select aliases.user_id, aliases.auth_email
  from private.login_aliases aliases
  where aliases.login_name = target_login_name::extensions.citext;
$$;

create or replace function public.replace_recovery_digest(
  target_user_id uuid,
  expected_digest bytea,
  next_digest bytea
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.login_aliases
  set recovery_code_digest = next_digest,
      recovery_rotated_at = now()
  where user_id = target_user_id
    and recovery_code_digest = expected_digest;
  return found;
end;
$$;

create or replace function public.read_recovery_digest(target_user_id uuid)
returns bytea
language sql
security definer
stable
set search_path = ''
as $$
  select aliases.recovery_code_digest
  from private.login_aliases aliases
  where aliases.user_id = target_user_id;
$$;

create or replace function public.update_profile_identity(
  target_user_id uuid,
  target_login_name text,
  target_avatar_key smallint
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_profile public.profiles;
begin
  update private.login_aliases
  set login_name = target_login_name::extensions.citext
  where user_id = target_user_id;

  update public.profiles
  set display_name = target_login_name,
      avatar_key = target_avatar_key
  where id = target_user_id
  returning * into updated_profile;

  if updated_profile.id is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  return updated_profile;
end;
$$;

revoke all on function public.complete_registration(uuid, text, text, smallint, bytea) from public, anon, authenticated;
revoke all on function public.resolve_login_name(text) from public, anon, authenticated;
revoke all on function public.read_recovery_digest(uuid) from public, anon, authenticated;
revoke all on function public.replace_recovery_digest(uuid, bytea, bytea) from public, anon, authenticated;
revoke all on function public.update_profile_identity(uuid, text, smallint) from public, anon, authenticated;
grant execute on function public.complete_registration(uuid, text, text, smallint, bytea) to service_role;
grant execute on function public.resolve_login_name(text) to service_role;
grant execute on function public.read_recovery_digest(uuid) to service_role;
grant execute on function public.replace_recovery_digest(uuid, bytea, bytea) to service_role;
grant execute on function public.update_profile_identity(uuid, text, smallint) to service_role;
```

- [ ] **Step 4: Add account function tests**

Create `supabase/tests/database/account-functions.test.sql`:

```sql
begin;
select plan(7);

select function_privs_are(
  'public',
  'complete_registration',
  array['uuid', 'text', 'text', 'smallint', 'bytea'],
  'authenticated',
  array[]::text[],
  'authenticated cannot complete registration'
);
select function_privs_are(
  'public',
  'resolve_login_name',
  array['text'],
  'authenticated',
  array[]::text[],
  'authenticated cannot resolve private emails'
);
select function_privs_are(
  'public',
  'read_recovery_digest',
  array['uuid'],
  'authenticated',
  array[]::text[],
  'authenticated cannot read private recovery digests'
);
select function_privs_are(
  'public',
  'update_profile_identity',
  array['uuid', 'text', 'smallint'],
  'authenticated',
  array[]::text[],
  'authenticated cannot directly mutate private aliases'
);
select function_privs_are(
  'public',
  'replace_recovery_digest',
  array['uuid', 'bytea', 'bytea'],
  'authenticated',
  array[]::text[],
  'authenticated cannot rotate private digests directly'
);
select table_privs_are('private', 'login_aliases', 'authenticated', array[]::text[], 'private aliases stay private');
select table_privs_are('private', 'auth_rate_limits', 'authenticated', array[]::text[], 'rate limits stay private');

select * from finish();
rollback;
```

- [ ] **Step 5: Reset and run all database tests**

Run:

```bash
npx supabase db reset
npx supabase test db
npm run supabase:types
```

Expected: all schema, RLS, and function tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/202607230002_rls_and_account_functions.sql supabase/tests lib/supabase/database.types.ts
git commit -m "feat: enforce Supabase data isolation"
```

---

### Task 4: Supabase Clients, Session Refresh, And Auth Core

**Files:**
- Create: `lib/supabase/browser.ts`
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/admin.ts`
- Create: `proxy.ts`
- Create: `server/auth/ports.ts`
- Create: `server/auth/service.ts`
- Create: `server/rate-limit/service.ts`
- Create: `tests/unit/auth/service.test.ts`
- Create: `tests/unit/rate-limit/service.test.ts`

**Interfaces:**
- Produces: `createBrowserSupabase()`, `createServerSupabase()`, `createAdminSupabase()`
- Produces: `registerAccount()`, `loginAccount()`, `recoverAccount()`, `rotateRecoveryCode()`
- Produces: `RecoveryCodeResult`
- Consumes: Task 1 schemas and Task 3 service-only RPCs

- [ ] **Step 1: Write failing auth service tests with explicit ports**

Create `server/auth/ports.ts`:

```ts
export type AccountProfile = { id: string; displayName: string; avatarKey: number };

export type AuthPorts = {
  rateLimit(input: { action: "register" | "login" | "recover" | "rotate"; bucket: string }): Promise<void>;
  createAuthUser(input: { email: string; password: string }): Promise<{ id: string }>;
  deleteAuthUser(userId: string): Promise<void>;
  completeRegistration(input: {
    userId: string;
    loginName: string;
    authEmail: string;
    avatarKey: number;
    recoveryDigest: Uint8Array;
  }): Promise<AccountProfile>;
  resolveLoginName(name: string): Promise<{ userId: string; authEmail: string } | null>;
  readRecoveryDigest(userId: string): Promise<Uint8Array>;
  replaceRecoveryDigest(userId: string, expected: Uint8Array, next: Uint8Array): Promise<boolean>;
  updateProfileIdentity(input: {
    userId: string;
    loginName: string;
    avatarKey: number;
  }): Promise<AccountProfile>;
  updatePassword(userId: string, password: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
};
```

Create `tests/unit/auth/service.test.ts` with fakes:

```ts
import { describe, expect, it, vi } from "vitest";
import { recoverAccount, registerAccount } from "@/server/auth/service";
import type { AuthPorts } from "@/server/auth/ports";

function ports(): AuthPorts {
  return {
    rateLimit: vi.fn().mockResolvedValue(undefined),
    createAuthUser: vi.fn().mockResolvedValue({ id: "user-1" }),
    deleteAuthUser: vi.fn().mockResolvedValue(undefined),
    completeRegistration: vi.fn().mockResolvedValue({ id: "user-1", displayName: "学习者", avatarKey: 2 }),
    resolveLoginName: vi.fn().mockResolvedValue({ userId: "user-1", authEmail: "internal@internal.invalid" }),
    readRecoveryDigest: vi.fn(),
    replaceRecoveryDigest: vi.fn().mockResolvedValue(true),
    updateProfileIdentity: vi.fn().mockResolvedValue({ id: "user-1", displayName: "学习者", avatarKey: 2 }),
    updatePassword: vi.fn().mockResolvedValue(undefined),
    signIn: vi.fn().mockResolvedValue(undefined),
  };
}

describe("auth service", () => {
  it("compensates when profile completion fails", async () => {
    const adapter = ports();
    vi.mocked(adapter.completeRegistration).mockRejectedValue(new Error("duplicate"));
    await expect(
      registerAccount(
        { name: "学习者", password: "password123", avatarKey: 2, bucket: "register-key" },
        adapter,
      ),
    ).rejects.toThrow("duplicate");
    expect(adapter.deleteAuthUser).toHaveBeenCalledWith("user-1");
  });

  it("rotates the recovery digest after changing the password", async () => {
    const adapter = ports();
    vi.mocked(adapter.readRecoveryDigest).mockResolvedValue(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("0123456789ABCDEFGHJKMNPQRS"))));
    const result = await recoverAccount(
      {
        name: "学习者",
        recoveryCode: "01234-56789-ABCDE-FGHJK-MNPQRS",
        newPassword: "newpassword123",
        bucket: "recover-key",
      },
      adapter,
    );
    expect(adapter.updatePassword).toHaveBeenCalledWith("user-1", "newpassword123");
    expect(adapter.replaceRecoveryDigest).toHaveBeenCalledOnce();
    expect(result.recoveryCode.replace(/-/g, "")).toHaveLength(26);
  });
});
```

- [ ] **Step 2: Run the auth tests and verify service imports fail**

Run:

```bash
npm run test:unit -- tests/unit/auth/service.test.ts
```

Expected: FAIL because `server/auth/service.ts` does not exist.

- [ ] **Step 3: Implement recovery code and auth orchestration**

Create `server/auth/service.ts`:

```ts
import { timingSafeEqual } from "node:crypto";
import type { AuthPorts } from "./ports";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(26));
  const raw = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
  return [
    raw.slice(0, 5),
    raw.slice(5, 10),
    raw.slice(10, 15),
    raw.slice(15, 20),
    raw.slice(20),
  ].join("-");
}

async function digest(value: string) {
  const raw = value.replace(/-/g, "").toUpperCase();
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
}

function sameDigest(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

export async function registerAccount(
  input: { name: string; password: string; avatarKey: number; bucket: string },
  ports: AuthPorts,
) {
  await ports.rateLimit({ action: "register", bucket: input.bucket });
  const authEmail = `${crypto.randomUUID()}@internal.invalid`;
  const recoveryCode = randomRecoveryCode();
  const authUser = await ports.createAuthUser({ email: authEmail, password: input.password });

  try {
    const profile = await ports.completeRegistration({
      userId: authUser.id,
      loginName: input.name,
      authEmail,
      avatarKey: input.avatarKey,
      recoveryDigest: await digest(recoveryCode),
    });
    await ports.signIn(authEmail, input.password);
    return { profile, recoveryCode };
  } catch (error) {
    await ports.deleteAuthUser(authUser.id);
    throw error;
  }
}

export async function loginAccount(
  input: { name: string; password: string; bucket: string },
  ports: AuthPorts,
) {
  await ports.rateLimit({ action: "login", bucket: input.bucket });
  const account = await ports.resolveLoginName(input.name);
  if (!account) throw new Error("INVALID_CREDENTIALS");
  await ports.signIn(account.authEmail, input.password);
}

export async function recoverAccount(
  input: { name: string; recoveryCode: string; newPassword: string; bucket: string },
  ports: AuthPorts,
) {
  await ports.rateLimit({ action: "recover", bucket: input.bucket });
  const account = await ports.resolveLoginName(input.name);
  if (!account) throw new Error("INVALID_RECOVERY");
  const expected = await ports.readRecoveryDigest(account.userId);
  const supplied = await digest(input.recoveryCode);
  if (!sameDigest(expected, supplied)) throw new Error("INVALID_RECOVERY");

  const recoveryCode = randomRecoveryCode();
  await ports.updatePassword(account.userId, input.newPassword);
  const replaced = await ports.replaceRecoveryDigest(account.userId, expected, await digest(recoveryCode));
  if (!replaced) throw new Error("RECOVERY_ALREADY_USED");
  await ports.signIn(account.authEmail, input.newPassword);
  return { recoveryCode };
}

export async function updateProfile(
  input: {
    userId: string;
    currentName: string;
    nextName: string;
    nextAvatarKey: number;
    currentPassword: string;
  },
  ports: AuthPorts,
) {
  const account = await ports.resolveLoginName(input.currentName);
  if (!account || account.userId !== input.userId) throw new Error("INVALID_CREDENTIALS");
  await ports.signIn(account.authEmail, input.currentPassword);
  return ports.updateProfileIdentity({
    userId: input.userId,
    loginName: input.nextName,
    avatarKey: input.nextAvatarKey,
  });
}

export async function rotateRecoveryCode(
  input: {
    userId: string;
    currentName: string;
    currentPassword: string;
    bucket: string;
  },
  ports: AuthPorts,
) {
  await ports.rateLimit({ action: "rotate", bucket: input.bucket });
  const account = await ports.resolveLoginName(input.currentName);
  if (!account || account.userId !== input.userId) throw new Error("INVALID_CREDENTIALS");
  await ports.signIn(account.authEmail, input.currentPassword);
  const expected = await ports.readRecoveryDigest(input.userId);
  const recoveryCode = randomRecoveryCode();
  const replaced = await ports.replaceRecoveryDigest(
    input.userId,
    expected,
    await digest(recoveryCode),
  );
  if (!replaced) throw new Error("RECOVERY_ALREADY_USED");
  return { recoveryCode };
}
```

- [ ] **Step 4: Implement browser, server, and admin Supabase clients**

Create `lib/supabase/browser.ts`:

```ts
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

export function createBrowserSupabase() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
```

Create `lib/supabase/server.ts` with `cookies()` and `setAll`, and create `lib/supabase/admin.ts` with a fresh `@supabase/supabase-js` client configured with `persistSession: false`, `autoRefreshToken: false`, and `detectSessionInUrl: false`. Throw during construction if required server environment variables are absent.

Create `proxy.ts` using the official `@supabase/ssr` Next.js `setAll` pattern. Match all routes except static assets and images. Apply every cookie option supplied by Supabase, and propagate the cache headers supplied to `setAll`.

- [ ] **Step 5: Implement the database-backed rate-limit port**

Create `tests/unit/rate-limit/service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { consumeRateLimit } from "@/server/rate-limit/service";

describe("consumeRateLimit", () => {
  it("uses the action-specific limit and a digested bucket", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ allowed: false, retry_after_seconds: 37 }],
      error: null,
    });
    await expect(
      consumeRateLimit("login", "203.0.113.1:学习者", { rpc }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 37 });
    expect(rpc).toHaveBeenCalledWith(
      "consume_auth_rate_limit",
      expect.objectContaining({
        target_action: "login",
        target_max_attempts: 10,
        target_window_seconds: 900,
      }),
    );
  });
});
```

Create `server/rate-limit/service.ts` with:

```ts
export const RATE_LIMITS = {
  register: { attempts: 5, windowSeconds: 3600 },
  login: { attempts: 10, windowSeconds: 900 },
  recover: { attempts: 5, windowSeconds: 1800 },
  rotate: { attempts: 5, windowSeconds: 3600 },
} as const;

export async function bucketDigest(action: string, rawBucket: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(process.env.AUTH_RATE_LIMIT_PEPPER!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${action}:${rawBucket}`)),
  );
}

export async function consumeRateLimit(
  action: keyof typeof RATE_LIMITS,
  rawBucket: string,
  admin: { rpc: (name: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
) {
  const limit = RATE_LIMITS[action];
  const digest = await bucketDigest(action, rawBucket);
  const { data, error } = await admin.rpc("consume_auth_rate_limit", {
    target_bucket: `\\x${Buffer.from(digest).toString("hex")}`,
    target_action: action,
    target_max_attempts: limit.attempts,
    target_window_seconds: limit.windowSeconds,
  });
  if (error) throw error;
  const result = (data as Array<{ allowed: boolean; retry_after_seconds: number }>)[0];
  if (!result.allowed) {
    throw Object.assign(new Error("RATE_LIMITED"), {
      code: "RATE_LIMITED",
      retryAfterSeconds: result.retry_after_seconds,
    });
  }
}
```

Create `supabase/migrations/202607230003_rate_limit_function.sql`:

```sql
create or replace function public.consume_auth_rate_limit(
  target_bucket bytea,
  target_action text,
  target_max_attempts integer,
  target_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row private.auth_rate_limits%rowtype;
  current_time timestamptz := now();
  window_end timestamptz;
begin
  select *
  into current_row
  from private.auth_rate_limits
  where bucket_digest = target_bucket and action = target_action
  for update;

  if not found then
    insert into private.auth_rate_limits (
      bucket_digest, action, window_started_at, attempt_count
    )
    values (target_bucket, target_action, current_time, 1);
    return query select true, 0;
    return;
  end if;

  window_end := current_row.window_started_at
    + make_interval(secs => target_window_seconds);

  if current_time >= window_end then
    update private.auth_rate_limits
    set window_started_at = current_time,
        attempt_count = 1,
        blocked_until = null
    where bucket_digest = target_bucket and action = target_action;
    return query select true, 0;
    return;
  end if;

  if current_row.attempt_count >= target_max_attempts then
    update private.auth_rate_limits
    set blocked_until = window_end
    where bucket_digest = target_bucket and action = target_action;
    return query
      select false, greatest(1, ceil(extract(epoch from (window_end - current_time)))::integer);
    return;
  end if;

  update private.auth_rate_limits
  set attempt_count = attempt_count + 1
  where bucket_digest = target_bucket and action = target_action;
  return query select true, 0;
end;
$$;

revoke all on function public.consume_auth_rate_limit(bytea, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_auth_rate_limit(bytea, text, integer, integer)
  to service_role;
```

- [ ] **Step 6: Run auth, rate-limit, type, and database tests**

Run:

```bash
npm run test:unit -- tests/unit/auth tests/unit/rate-limit
npx supabase db reset
npx supabase test db
npm run typecheck
```

Expected: all commands PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/supabase proxy.ts server/auth server/rate-limit tests/unit/auth tests/unit/rate-limit supabase/migrations/202607230003_rate_limit_function.sql
git commit -m "feat: add Supabase authentication core"
```

---

### Task 5: Authentication API Routes And UI

**Files:**
- Create: `server/auth/supabase-adapter.ts`
- Create: `app/api/auth/register/route.ts`
- Create: `app/api/auth/login/route.ts`
- Create: `app/api/auth/logout/route.ts`
- Create: `app/api/auth/recover/route.ts`
- Create: `app/api/auth/recovery-code/rotate/route.ts`
- Create: `app/api/me/route.ts`
- Create: `app/(auth)/layout.tsx`
- Create: `app/(auth)/login/page.tsx`
- Create: `app/(auth)/register/page.tsx`
- Create: `app/(auth)/recover/page.tsx`
- Create: `features/auth/auth-card.tsx`
- Create: `features/auth/login-form.tsx`
- Create: `features/auth/register-form.tsx`
- Create: `features/auth/recover-form.tsx`
- Create: `features/auth/recovery-code-dialog.tsx`
- Create: `tests/unit/auth/forms.test.tsx`
- Create: `tests/integration/auth-routes.test.ts`
- Create: `tests/helpers/api-session.ts`

**Interfaces:**
- Produces JSON routes described in the approved spec
- Produces reusable recovery-code dialog
- Consumes: Task 4 auth services and Supabase clients

- [ ] **Step 1: Write failing form tests**

Create `tests/unit/auth/forms.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RegisterForm } from "@/features/auth/register-form";
import { RecoveryCodeDialog } from "@/features/auth/recovery-code-dialog";

describe("registration UI", () => {
  it("requires a name, avatar, and matching password", async () => {
    render(<RegisterForm onRegistered={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "注册并进入" }));
    expect(await screen.findByText("名称需要填写 1-20 个字符")).toBeVisible();
    expect(screen.getAllByRole("radio", { name: /头像/ })).toHaveLength(5);
  });

  it("labels recovery code as one-time information", () => {
    render(
      <RecoveryCodeDialog
        open
        recoveryCode="01234-56789-ABCDE-FGHJK-MNPQRS"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("恢复码只显示这一次")).toBeVisible();
    expect(screen.getByRole("button", { name: "复制恢复码" })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run form tests and verify imports fail**

Run:

```bash
npm run test:unit -- tests/unit/auth/forms.test.tsx
```

Expected: FAIL because the auth feature components do not exist.

- [ ] **Step 3: Implement route handlers with one response mapper**

Create `server/auth/supabase-adapter.ts` to construct `AuthPorts` from:

- `createAdminSupabase()` for `auth.admin.createUser`, `deleteUser`, `updateUserById`, private RPCs, and rate limits.
- `createServerSupabase()` for `signInWithPassword` and `signOut`.

Each handler must:

```ts
const requestId = crypto.randomUUID();
const parsed = registerInputSchema.safeParse(await request.json());
if (!parsed.success) {
  return Response.json(
    apiFailure("VALIDATION_ERROR", parsed.error.issues[0].message, requestId, {
      field: parsed.error.issues[0].path[0]?.toString(),
    }),
    { status: 422, headers: { "Cache-Control": "private, no-store" } },
  );
}
```

Map duplicate `login_name` to `409 NAME_TAKEN`, unknown login to `401 INVALID_CREDENTIALS`, recovery mismatch to `401 INVALID_RECOVERY`, and limit errors to `429 RATE_LIMITED`. Never return internal email or recovery digest.

- [ ] **Step 4: Implement auth pages and forms**

Implement all forms as client components that:

- use semantic labels and native password inputs;
- show field errors without clearing values;
- expose five avatar radio options from `/public/avatars`;
- redirect successful login to `/`;
- show `RecoveryCodeDialog` after registration or recovery;
- provide copy and download actions without using localStorage or IndexedDB;
- link login, register, and recover screens to one another.

The recovery download must create a Blob only after user action:

```ts
const blob = new Blob(
  [`今天你attention了吗？\n名称：${name}\n恢复码：${recoveryCode}\n`],
  { type: "text/plain;charset=utf-8" },
);
const url = URL.createObjectURL(blob);
```

Revoke the object URL after the click.

- [ ] **Step 5: Add route integration tests against local Supabase**

Create `tests/helpers/api-session.ts`:

```ts
export class ApiSession {
  private cookie = "";

  constructor(private readonly baseUrl = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100") {}

  async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...init.headers,
      },
    });
    const nextCookies = response.headers.getSetCookie();
    if (nextCookies.length > 0) {
      this.cookie = nextCookies.map((value) => value.split(";", 1)[0]).join("; ");
    }
    return { status: response.status, body: await response.json() };
  }

  post(path: string, body: unknown) {
    return this.request(path, { method: "POST", body: JSON.stringify(body) });
  }
}
```

`tests/integration/auth-routes.test.ts` must cover:

```ts
it("registers, logs out, logs in, and rotates recovery credentials", async () => {
  const session = new ApiSession();
  const name = `测试用户-${crypto.randomUUID()}`;
  const registered = await session.post("/api/auth/register", {
    name,
    password: "password123",
    avatarKey: 4,
  });
  expect(registered.status).toBe(201);
  expect(registered.body.data.recoveryCode.replace(/-/g, "")).toHaveLength(26);

  expect((await session.post("/api/auth/logout", {})).status).toBe(200);
  expect((await session.post("/api/auth/login", { name, password: "password123" })).status).toBe(200);
});
```

Add a profile mutation case:

```ts
const renamed = `${name}-新`;
expect(
  (
    await session.request("/api/me", {
      method: "PATCH",
      body: JSON.stringify({
        name: renamed,
        avatarKey: 5,
        currentPassword: "password123",
      }),
    })
  ).status,
).toBe(200);
await session.post("/api/auth/logout", {});
expect((await session.post("/api/auth/login", { name, password: "password123" })).status).toBe(401);
expect((await session.post("/api/auth/login", { name: renamed, password: "password123" })).status).toBe(200);
```

`PATCH /api/me` must revalidate the current Supabase user, call `updateProfile()`, map a duplicate alias to `409 NAME_TAKEN`, and never update the UUID.

Use the `test:integration` script to start a real dev server on port 3100 against local Supabase; do not mock Auth for this integration suite:

```bash
npm run test:integration
```

- [ ] **Step 6: Run auth tests and build**

Run:

```bash
npm run test:unit -- tests/unit/auth
npm run test:integration
npm run typecheck
npm run build
```

Expected: all commands PASS; client bundle search does not contain `SUPABASE_SECRET_KEY`.

- [ ] **Step 7: Commit**

```bash
git add app/api/auth app/api/me 'app/(auth)' features/auth server/auth tests/unit/auth tests/integration/auth-routes.test.ts
git commit -m "feat: add open registration and recovery"
```

---

### Task 6: Versioned Check-In Repository And API

**Files:**
- Create: `features/checkins/types.ts`
- Create: `server/checkins/repository.ts`
- Create: `server/checkins/service.ts`
- Replace: `app/api/checkins/route.ts`
- Replace: `app/api/checkins/[date]/route.ts`
- Create: `tests/unit/checkins/service.test.ts`
- Create: `tests/integration/checkins-api.test.ts`

**Interfaces:**
- Produces: `CheckInRecord`, `CheckInSummary`, `VersionConflict`
- Produces: `GET /api/checkins?month=YYYY-MM`
- Produces: `GET /api/checkins/:date`
- Produces: `PUT /api/checkins/:date`
- Consumes: Task 1 check-in schema, Task 3 RLS, Task 4 user-scoped server client

- [ ] **Step 1: Define types and write failing version tests**

Create `features/checkins/types.ts`:

```ts
export type CheckInRecord = {
  id: string;
  date: string;
  attention: string;
  sourceUrl: string;
  summary: string;
  inspiration: string;
  imagePath: string | null;
  imageName: string;
  imageUrl: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CheckInSummary = Pick<
  CheckInRecord,
  "date" | "attention" | "version" | "updatedAt"
> & { hasImage: boolean };
```

Create `tests/unit/checkins/service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { saveCheckIn } from "@/server/checkins/service";

describe("saveCheckIn", () => {
  it("returns the cloud record when an update version is stale", async () => {
    const repository = {
      findByDate: vi.fn().mockResolvedValue({ id: "1", version: 3, attention: "cloud" }),
      insert: vi.fn(),
      updateAtVersion: vi.fn().mockResolvedValue(null),
    };
    const result = await saveCheckIn(
      "user-1",
      "2026-07-23",
      {
        attention: "local",
        sourceUrl: "",
        summary: "",
        inspiration: "",
        imagePath: null,
        imageName: "",
        version: 2,
      },
      repository,
    );
    expect(result).toEqual({
      ok: false,
      reason: "VERSION_CONFLICT",
      current: expect.objectContaining({ version: 3 }),
    });
  });
});
```

- [ ] **Step 2: Run the service test and verify it fails**

Run:

```bash
npm run test:unit -- tests/unit/checkins/service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the repository and version-aware service**

`server/checkins/repository.ts` exports a `CheckInRepository` interface and `createCheckInRepository(supabase)`. `updateAtVersion` must use:

```ts
const { data, error } = await supabase
  .from("check_ins")
  .update({
    attention: input.attention,
    source_url: input.sourceUrl || null,
    summary: input.summary,
    inspiration: input.inspiration,
    image_path: input.imagePath,
    image_name: input.imageName,
    version: expectedVersion + 1,
  })
  .eq("user_id", userId)
  .eq("checkin_date", date)
  .eq("version", expectedVersion)
  .select()
  .maybeSingle();
```

`server/checkins/service.ts` rules:

- no existing row plus `version !== null` returns a conflict;
- no existing row plus `version === null` inserts version 1;
- existing row plus `version === null` returns a conflict;
- matched update returns incremented record;
- failed conditional update re-reads and returns `VERSION_CONFLICT`.

- [ ] **Step 4: Replace old D1 handlers with Supabase handlers**

The route handlers must:

- call `getClaims()` or validated `getUser()` before reading user data;
- return `401 SESSION_EXPIRED` when no valid user exists;
- parse date and month with Task 1 schemas;
- use the request-scoped SSR client, never the admin client;
- map a version conflict to HTTP 409 and include the current record;
- return `Cache-Control: private, no-store`.

Month query returns summaries only. Single-date query creates a signed image read URL through Task 7 storage service.

- [ ] **Step 5: Write local-Supabase integration tests**

`tests/integration/checkins-api.test.ts` must create two authenticated clients and verify:

```ts
expect((await userOne.put("/api/checkins/2026-07-23", entry(null))).status).toBe(200);
expect((await userOne.put("/api/checkins/2026-07-23", entry(1))).body.data.version).toBe(2);
expect((await userOne.put("/api/checkins/2026-07-23", entry(1))).status).toBe(409);
expect((await userTwo.get("/api/checkins/2026-07-23")).status).toBe(404);
```

- [ ] **Step 6: Run unit, integration, database, and type checks**

Run:

```bash
npm run test:unit -- tests/unit/checkins/service.test.ts
npm run test:integration
npx supabase test db
npm run typecheck
```

Expected: all commands PASS.

- [ ] **Step 7: Commit**

```bash
git add features/checkins/types.ts server/checkins app/api/checkins tests/unit/checkins tests/integration/checkins-api.test.ts
git commit -m "feat: add versioned cloud check-ins"
```

---

### Task 7: Private Image Upload, Read, Replace, And Cleanup

**Files:**
- Create: `server/storage/service.ts`
- Create: `app/api/uploads/checkin-image/route.ts`
- Modify: `app/api/checkins/[date]/route.ts`
- Delete: `app/api/checkins/[date]/image/route.ts`
- Create: `tests/unit/storage/service.test.ts`
- Create: `tests/integration/storage.test.ts`

**Interfaces:**
- Produces: `createCheckInUpload(userId, date, mimeType)`
- Produces: `createCheckInImageUrl(path)`
- Produces: `removeCheckInImage(userId, path)`
- Produces: signed-upload response `{ path, token }`
- Consumes: Task 3 Storage policy and Task 6 record ownership

- [ ] **Step 1: Write failing path ownership tests**

Create `tests/unit/storage/service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertOwnedImagePath, buildImagePath } from "@/server/storage/service";

describe("check-in image paths", () => {
  it("builds an owner/date/random path", () => {
    expect(buildImagePath("user-1", "2026-07-23", "image/jpeg")).toMatch(
      /^user-1\/2026-07-23\/[0-9a-f-]+\.jpg$/u,
    );
  });

  it("rejects another user's path", () => {
    expect(() =>
      assertOwnedImagePath("user-1", "user-2/2026-07-23/file.jpg"),
    ).toThrow("FORBIDDEN_IMAGE_PATH");
  });
});
```

- [ ] **Step 2: Run the tests and verify imports fail**

Run:

```bash
npm run test:unit -- tests/unit/storage/service.test.ts
```

Expected: FAIL because `server/storage/service.ts` does not exist.

- [ ] **Step 3: Implement path, signing, and cleanup services**

Use this MIME mapping:

```ts
const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;
```

`buildImagePath()` must reject unknown MIME types. `assertOwnedImagePath()` must compare the first path segment exactly to `userId`.

Use the authenticated user client:

```ts
const { data, error } = await supabase.storage
  .from("checkin-images")
  .createSignedUploadUrl(path, { upsert: false });
```

The browser later calls `uploadToSignedUrl(path, token, blob)`. Read URLs expire after 10 minutes.

- [ ] **Step 4: Implement the upload route**

`POST /api/uploads/checkin-image` accepts:

```ts
{ date: "2026-07-23", mimeType: "image/jpeg", size: 1536000 }
```

Reject:

- unauthenticated users with 401;
- invalid dates or MIME types with 422;
- sizes above 10 MB with 413.

`DELETE /api/uploads/checkin-image` accepts `{ path }`, verifies the first segment against `auth.uid()`, and deletes only that object.

- [ ] **Step 5: Integrate old-image cleanup into save**

After a successful check-in update:

- compare previous and next `image_path`;
- delete the previous object only when the paths differ;
- if database save fails after a new upload, the client calls the cleanup endpoint;
- do not delete a new image during a 409 until the user chooses to abandon that local version.

- [ ] **Step 6: Run Storage isolation integration tests**

`tests/integration/storage.test.ts` must verify user one can upload/read/delete their path and user two receives an error for the same path.

Run:

```bash
npm run test:unit -- tests/unit/storage/service.test.ts
npm run test:integration
npx supabase test db
```

Expected: all commands PASS.

- [ ] **Step 7: Commit**

```bash
git add server/storage app/api/uploads app/api/checkins/[date]/route.ts tests/unit/storage tests/integration/storage.test.ts
git rm app/api/checkins/[date]/image/route.ts
git commit -m "feat: add private check-in images"
```

---

### Task 8: Query Provider And Modular Journal Workspace

**Files:**
- Create: `app/providers.tsx`
- Modify: `app/layout.tsx`
- Move/Replace: `app/page.tsx` to `app/(app)/page.tsx`
- Create: `features/checkins/api.ts`
- Create: `features/checkins/queries.ts`
- Create: `features/checkins/checkin-workspace.tsx`
- Create: `features/calendar/month-calendar.tsx`
- Create: `features/checkins/checkin-editor.tsx`
- Create: `features/checkins/image-note-uploader.tsx`
- Create: `features/checkins/dirty-switch-dialog.tsx`
- Create: `features/profile/app-header.tsx`
- Modify: `app/globals.css`
- Create: `tests/unit/checkins/workspace.test.tsx`
- Create: `tests/unit/calendar/month-calendar.test.tsx`
- Create: `tests/helpers/test-query-provider.tsx`

**Interfaces:**
- Produces: `CheckInWorkspace`
- Produces hooks: `useMonthCheckIns(month)`, `useCheckIn(date)`, `useSaveCheckIn()`
- Consumes: Task 5 session/profile APIs, Task 6 check-in APIs, Task 7 upload API

- [ ] **Step 1: Write failing workspace interaction tests**

Create `tests/helpers/test-query-provider.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function TestQueryProvider({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

Create `tests/unit/checkins/workspace.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TestQueryProvider } from "@/tests/helpers/test-query-provider";
import { CheckInWorkspace } from "@/features/checkins/checkin-workspace";

describe("CheckInWorkspace", () => {
  it("opens the unsaved switch dialog before changing dates", async () => {
    render(
      <TestQueryProvider>
        <CheckInWorkspace initialDate="2026-07-23" />
      </TestQueryProvider>,
    );
    await userEvent.type(screen.getByLabelText("attention"), "今天学习了 RAG");
    await userEvent.click(screen.getByRole("button", { name: /7月24日/ }));
    expect(screen.getByRole("dialog", { name: "尚未保存" })).toBeVisible();
    expect(screen.getByRole("button", { name: "保存并切换" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "放弃修改" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeEnabled();
  });
});
```

Create calendar tests for ordinary, today, completed, and selected states. Assert each date button has a stable accessible name and completed cells show their attention summary.

- [ ] **Step 2: Run the component tests and verify imports fail**

Run:

```bash
npm run test:unit -- tests/unit/checkins/workspace.test.tsx tests/unit/calendar/month-calendar.test.tsx
```

Expected: FAIL because the modular components do not exist.

- [ ] **Step 3: Add the Query provider and typed API client**

`app/providers.tsx` creates one `QueryClient` per browser session:

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

Wrap `children` in `app/layout.tsx`.

`features/checkins/api.ts` must parse the common API envelope and throw a typed `ApiError` containing status, code, requestId, and current cloud record for 409 responses.

- [ ] **Step 4: Extract visual components without redesigning them**

Move behavior from `app/attention-app.tsx` into the planned components:

- `AppHeader`: existing title, profile avatar, statistics, sound toggle, and logout.
- `MonthCalendar`: existing seven-column month layout and icon controls.
- `CheckInEditor`: attention, source, summary, image, and inspiration fields.
- `ImageNoteUploader`: drag/drop, choose, replace, preview, and delete controls.
- `DirtySwitchDialog`: the existing three-way date-change decision.
- `CheckInWorkspace`: selected date, month, dirty state, save mutation, confetti, and toast orchestration.

Keep cards at 8 px or less. Keep mobile summary to one line and desktop summary to two lines. Keep the current coral “today”, yellow selected accent, green completed state, and warm-white background.

The `AppHeader` user menu must also expose a profile dialog. Changing the avatar alone saves through `PATCH /api/me`; changing the name additionally requires the current password. A successful name change updates the visible header and query cache without reassigning check-ins.

- [ ] **Step 5: Add server guarding to the app page**

`app/(app)/page.tsx` must call the server Supabase client and:

```ts
const { data } = await supabase.auth.getClaims();
if (!data?.claims?.sub) redirect("/login");
```

Load the current profile for the header. Render `CheckInWorkspace` with today as the initial selected date.

- [ ] **Step 6: Connect save, upload, conflict, and feedback states**

The save mutation must:

1. upload a changed image first;
2. call `PUT /api/checkins/:date`;
3. on success, update single-date and month query caches;
4. play confetti and sound only when the previous record was absent;
5. show a light toast for edits;
6. expose the 409 cloud version in a modal;
7. never clear the form on error.

- [ ] **Step 7: Run component, rendered HTML, build, and responsive screenshot checks**

Run:

```bash
npm run test:unit -- tests/unit/checkins tests/unit/calendar
npm run test:rendered
npm run typecheck
npm run build
```

Expected: all commands PASS. Start the dev server and inspect screenshots at 1440x900, 1024x768, and 390x844 before committing.

- [ ] **Step 8: Commit**

```bash
git add app/layout.tsx app/providers.tsx 'app/(app)' features app/globals.css tests/unit/checkins tests/unit/calendar tests/helpers/test-query-provider.tsx
git rm app/page.tsx
git commit -m "refactor: split the cloud journal workspace"
```

---

### Task 9: IndexedDB Drafts And Offline Protection

**Files:**
- Create: `lib/indexed-db/drafts.ts`
- Create: `features/drafts/use-checkin-draft.ts`
- Modify: `features/checkins/checkin-workspace.tsx`
- Modify: `features/checkins/checkin-editor.tsx`
- Create: `tests/unit/drafts/store.test.ts`
- Create: `tests/unit/drafts/use-checkin-draft.test.tsx`

**Interfaces:**
- Produces: `loadDraft(userId, date)`, `saveDraft(draft)`, `deleteDraft(userId, date)`
- Produces: `useCheckInDraft({ userId, date, cloudRecord })`
- Consumes: Task 8 editor state and Task 6 version

- [ ] **Step 1: Write failing draft isolation tests**

Create `tests/unit/drafts/store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { deleteAttentionDraftDatabase, loadDraft, saveDraft } from "@/lib/indexed-db/drafts";

beforeEach(() => deleteAttentionDraftDatabase());

describe("draft storage", () => {
  it("isolates drafts by immutable user id and date", async () => {
    await saveDraft({
      userId: "user-1",
      date: "2026-07-23",
      attention: "one",
      sourceUrl: "",
      summary: "",
      inspiration: "",
      imageBlob: null,
      imageName: "",
      baseVersion: 1,
      updatedAt: "2026-07-23T10:00:00.000Z",
    });
    expect(await loadDraft("user-1", "2026-07-23")).toMatchObject({ attention: "one" });
    expect(await loadDraft("user-2", "2026-07-23")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and verify the store import fails**

Run:

```bash
npm run test:unit -- tests/unit/drafts/store.test.ts
```

Expected: FAIL because the draft store does not exist.

- [ ] **Step 3: Implement the IndexedDB draft store**

Use `idb` with database `attention-cloud-drafts`, version 1, object store `drafts`, key path `[userId, date]`, and index `by-user`.

The stored draft type must contain a Blob, never a Data URL:

```ts
export type StoredDraft = {
  userId: string;
  date: string;
  attention: string;
  sourceUrl: string;
  summary: string;
  inspiration: string;
  imageBlob: Blob | null;
  imageName: string;
  baseVersion: number | null;
  updatedAt: string;
};
```

- [ ] **Step 4: Implement debounced draft restore and cleanup**

`useCheckInDraft` must:

- load after user ID and date are known;
- prefer a newer local draft over the cloud record and show “已恢复本地草稿”;
- debounce writes by 400 ms after the form becomes dirty;
- retain the draft on 401, 409, 429, offline, and 5xx;
- delete only after a successful cloud save;
- abort pending writes when the selected date changes.

- [ ] **Step 5: Add explicit offline behavior**

Listen to `online` and `offline` events. While offline:

- keep all fields editable;
- display “离线，内容已保存在此浏览器”;
- disable the cloud save button;
- do not upload images;
- do not auto-submit when `online` fires.

- [ ] **Step 6: Run draft and workspace tests**

Run:

```bash
npm run test:unit -- tests/unit/drafts tests/unit/checkins/workspace.test.tsx
npm run typecheck
```

Expected: all commands PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/indexed-db/drafts.ts features/drafts features/checkins tests/unit/drafts
git commit -m "feat: protect unsaved journal drafts"
```

---

### Task 10: One-Time Legacy IndexedDB Import

**Files:**
- Create: `lib/indexed-db/legacy.ts`
- Create: `features/migration/use-legacy-import.ts`
- Create: `features/migration/legacy-import-dialog.tsx`
- Modify: `features/checkins/checkin-workspace.tsx`
- Create: `tests/unit/migration/legacy.test.ts`
- Create: `tests/unit/migration/import-flow.test.tsx`
- Create: `tests/integration/legacy-import.test.ts`

**Interfaces:**
- Produces: `findLegacyProfile(normalizedName)`, `readLegacyRecords(name)`
- Produces: `markLegacyImportComplete(userId)`, `isLegacyImportComplete(userId)`
- Produces: `LegacyImportDialog`
- Consumes: old `attention-journal` IndexedDB v2 shape, Task 6 save API, Task 7 upload API

- [ ] **Step 1: Write failing legacy reader tests**

Create `tests/unit/migration/legacy.test.ts` that seeds:

```ts
{
  name: "AI 小白",
  avatarId: 3,
  createdAt: "2026-07-01T00:00:00.000Z"
}
```

and one `user-checkins` record keyed by `["AI 小白", "2026-07-22"]` with an image Data URL. Assert:

- NFKC-normalized name lookup finds the profile;
- record fields map to the cloud `CheckInInput`;
- Data URL becomes a Blob;
- reading does not delete or modify the old store.

- [ ] **Step 2: Run the legacy test and verify it fails**

Run:

```bash
npm run test:unit -- tests/unit/migration/legacy.test.ts
```

Expected: FAIL because the legacy reader does not exist.

- [ ] **Step 3: Implement a read-only legacy adapter**

`lib/indexed-db/legacy.ts` must open the existing database without increasing its version. Return an empty result when the database, stores, profile, or records are absent.

Map:

```ts
{
  date: stored.date,
  attention: stored.attention ?? "",
  sourceUrl: stored.sourceUrl ?? "",
  summary: stored.summary ?? stored.note ?? "",
  inspiration: stored.inspiration ?? "",
  imageName: stored.imageName ?? "",
  imageBlob: stored.imageDataUrl ? dataUrlToBlob(stored.imageDataUrl) : null,
}
```

- [ ] **Step 4: Implement the import state machine**

States:

```ts
type ImportState =
  | { status: "idle" }
  | { status: "preview"; total: number; images: number }
  | { status: "running"; completed: number; total: number }
  | { status: "complete"; imported: number; skipped: number; failed: number };
```

For each date:

1. GET cloud date.
2. If cloud record exists, increment `skipped`.
3. If image exists, upload it.
4. PUT a new record with `version: null`.
5. On error, clean up the just-uploaded image and increment `failed`.
6. Continue with the next date.

Set `attention-legacy-imported:<userId>` in localStorage only after every record has a terminal imported/skipped/failed result. A later retry processes failed dates because cloud remains empty.

- [ ] **Step 5: Build the import dialog**

Show:

- matching local profile name;
- record and image totals;
- “开始导入” and “暂不导入”;
- determinate progress;
- final imported/skipped/failed counts;
- explicit text that original browser data remains untouched.

- [ ] **Step 6: Run unit and local-Supabase import tests**

Run:

```bash
npm run test:unit -- tests/unit/migration
npm run test:integration
npm run typecheck
```

Expected: all commands PASS, including repeated import with no duplicate cloud rows.

- [ ] **Step 7: Commit**

```bash
git add lib/indexed-db/legacy.ts features/migration features/checkins/checkin-workspace.tsx tests/unit/migration tests/integration/legacy-import.test.ts
git commit -m "feat: import local journal history"
```

---

### Task 11: Remove Dormant D1, R2, Drizzle, And WeChat Paths

**Files:**
- Delete: `app/api/auth/wechat/start/route.ts`
- Delete: `app/api/auth/wechat/callback/route.ts`
- Delete: `app/api/auth/wechat/logout/route.ts`
- Delete: `app/wechat-auth.ts`
- Delete: `db/index.ts`
- Delete: `db/schema.ts`
- Delete: `drizzle.config.ts`
- Delete: `drizzle/0000_lumpy_silver_fox.sql`
- Delete: `drizzle/meta/0000_snapshot.json`
- Delete: `drizzle/meta/_journal.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.openai/hosting.json`
- Modify: `vite.config.ts`
- Modify: `worker/index.ts`
- Modify: `tests/rendered-html.test.mjs`
- Modify: `README.md`

**Interfaces:**
- Produces: one Supabase-only formal write path
- Consumes: all earlier Supabase tasks

- [ ] **Step 1: Write a failing repository guard test**

Replace the old storage assertions in `tests/rendered-html.test.mjs` with:

```js
test("uses Supabase instead of local profiles, WeChat, D1, or R2", async () => {
  const [packageJson, viteConfig, worker, home] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/(app)/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(packageJson, /@supabase\/ssr/);
  assert.doesNotMatch(packageJson, /drizzle/);
  assert.doesNotMatch(viteConfig, /d1_databases|r2_buckets/);
  assert.doesNotMatch(worker, /D1Database|R2Bucket/);
  assert.match(home, /CheckInWorkspace/);
});
```

- [ ] **Step 2: Run the rendered test and verify it fails**

Run:

```bash
npm run test:rendered
```

Expected: FAIL while Drizzle and Cloudflare D1/R2 bindings still exist.

- [ ] **Step 3: Remove tracked dormant backend files and dependencies**

Run only against tracked files:

```bash
git rm app/api/auth/wechat/start/route.ts
git rm app/api/auth/wechat/callback/route.ts
git rm app/api/auth/wechat/logout/route.ts
git rm app/wechat-auth.ts
git rm db/index.ts db/schema.ts drizzle.config.ts
git rm drizzle/0000_lumpy_silver_fox.sql drizzle/meta/0000_snapshot.json drizzle/meta/_journal.json
npm uninstall drizzle-orm drizzle-kit
```

Do not remove the untracked duplicate `db/schema 2.ts` or `drizzle/meta/* 2.json`; report them separately to the user.

- [ ] **Step 4: Remove D1/R2 runtime bindings while preserving Sites identity**

Set `.openai/hosting.json` to:

```json
{
  "project_id": "appgprj_6a61eeacc7e481919834e1f4c6bf758d"
}
```

Remove `d1_databases` and `r2_buckets` from `vite.config.ts`. Keep `vinext()`, `sites()`, Cloudflare plugin, local Wrangler paths, and HMR polling.

Remove only `DB` and `ATTENTION_IMAGES` from `worker/index.ts`'s `Env`; preserve `ASSETS`, `IMAGES`, and image optimization behavior.

- [ ] **Step 5: Replace the monolith and update documentation**

After Tasks 8-10 have parity:

```bash
git rm app/attention-app.tsx
```

Update `README.md` with:

- local Supabase prerequisites;
- `npm run supabase:start`;
- copying `.dev.vars.example` to ignored `.dev.vars`;
- migration, test, build, and local start commands;
- recovery-code behavior;
- local legacy import behavior;
- no invite/admin scope.

- [ ] **Step 6: Run repository, lint, type, and build checks**

Run:

```bash
npm run test:rendered
npm run lint
npm run typecheck
npm run build
rg -n "D1Database|R2Bucket|wechat|drizzle|attention-current-user" app server lib worker vite.config.ts package.json
```

Expected: tests and builds PASS; `rg` returns no dormant backend or local-user implementation references.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .openai/hosting.json vite.config.ts worker/index.ts tests/rendered-html.test.mjs README.md
git add -u
git commit -m "refactor: remove dormant local and WeChat backends"
```

---

### Task 12: End-To-End Verification, Backups, And Sites Release

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/auth.spec.ts`
- Create: `tests/e2e/checkins.spec.ts`
- Create: `tests/e2e/migration.spec.ts`
- Create: `tests/e2e/responsive.spec.ts`
- Create: `docs/operations/supabase-runbook.md`
- Modify: `package.json`
- Modify: `PROMPT_CHANGELOG.md`

**Interfaces:**
- Produces: repeatable release gate and operations runbook
- Consumes: the complete application from Tasks 1-11

- [ ] **Step 1: Configure Playwright for the real local stack**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 1,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 3000",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { viewport: { width: 1024, height: 768 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
  ],
});
```

- [ ] **Step 2: Write failing authentication E2E tests**

`tests/e2e/auth.spec.ts` must register a unique name, choose avatar 4, save the recovery code from the visible dialog, log out, log in, recover with the saved code, and verify the old code no longer works.

Use role-based locators:

```ts
await page.getByLabel("名称").fill(name);
await page.getByLabel("头像 4").check();
await page.getByLabel("密码", { exact: true }).fill("password123");
await page.getByRole("button", { name: "注册并进入" }).click();
await expect(page.getByText("恢复码只显示这一次")).toBeVisible();
```

- [ ] **Step 3: Write check-in and migration E2E tests**

`tests/e2e/checkins.spec.ts` covers:

- first save and celebration state;
- refresh persistence;
- click-date recall;
- edit without repeated full celebration;
- unsaved switch save/discard/cancel;
- image choose, preview, replace, and remove;
- offline draft and manual submit after reconnect.

`tests/e2e/migration.spec.ts` seeds the old IndexedDB before login, confirms the import preview, imports once, reloads, and confirms no duplicate prompt or record.

- [ ] **Step 4: Add responsive visual assertions**

`tests/e2e/responsive.spec.ts` checks every configured project:

```ts
expect(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(true);
await expect(page.getByRole("heading", { name: "今天你attention了吗？" })).toHaveCSS("white-space", "nowrap");
await expect(page.getByTestId("month-calendar")).toBeVisible();
await expect(page.getByTestId("checkin-actions")).toBeVisible();
```

Also assert the sticky action bar does not overlap the final form field using bounding boxes.

- [ ] **Step 5: Write the operations runbook**

`docs/operations/supabase-runbook.md` must contain exact procedures for:

- local start/reset/types;
- linking a production project;
- dry-running and applying migrations;
- setting Cloudflare/Sites runtime variables;
- verifying RLS after deployment;
- daily database backup requirement;
- separate Storage object export;
- quarterly restore drill;
- rollback: stop writes, redeploy prior Web version, and apply only forward database migrations;
- log redaction rules for passwords, recovery codes, cookies, tokens, text content, and signed URLs.

- [ ] **Step 6: Update the project test aggregator and prompt log**

Set `npm test` to:

```json
{
  "test": "npm run test:unit && npm run supabase:test && npm run test:integration && npm run test:rendered && npm run build"
}
```

Append one concise entry to `PROMPT_CHANGELOG.md` describing the approved Supabase architecture, the open-registration scope, recovery codes, and the implementation-plan document. Preserve all existing entries.

- [ ] **Step 7: Run the complete local release gate**

Run:

```bash
npx supabase start
npx supabase db reset
npm run supabase:types
npm test
npm run lint
npm run typecheck
npm run test:e2e
git diff --check
```

Expected: every command PASS. No required process remains running except the intentionally reused dev server.

- [ ] **Step 8: Inspect production bundles and secrets**

Run:

```bash
rg -n "SUPABASE_SECRET_KEY|AUTH_RATE_LIMIT_PEPPER|service_role" dist .vinext .next
```

Expected: no secret values and no server-only environment access in client chunks. The literal phrase `service_role` may appear only in server output or source maps that are not shipped publicly; inspect every match.

- [ ] **Step 9: Commit the release gate**

```bash
git add playwright.config.ts tests/e2e docs/operations package.json package-lock.json PROMPT_CHANGELOG.md
git commit -m "test: add Supabase release gate"
```

- [ ] **Step 10: Deploy through Sites and verify production**

Before deployment:

1. Read `.openai/hosting.json` and reuse its exact `project_id`.
2. Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `AUTH_RATE_LIMIT_PEPPER` as Sites runtime variables.
3. Push the exact source commit.
4. Save a Sites version for that commit.
5. Deploy only the saved version.
6. Inspect deployment status until terminal.

After deployment, run smoke checks for register, login, save, refresh, image read, logout, recovery, mobile layout, and cross-user isolation. Do not use production learning content in smoke-test logs.

---

## Plan Self-Review Checklist

- [x] Every first-release requirement in the approved spec maps to at least one task.
- [x] Open registration is implemented without invite or admin scope.
- [x] Name aliases remain separate from immutable UUID ownership.
- [x] Recovery plaintext is shown once and excluded from storage and logs.
- [x] RLS and Storage ownership are tested with two users.
- [x] Formal records are online-only while drafts remain editable offline.
- [x] Version conflicts, old-image cleanup, and local import retries have explicit behavior.
- [x] Existing D1/R2/WeChat removal occurs only after Supabase parity.
- [x] Current uncommitted user work and untracked duplicate files are explicitly protected.
- [x] Local, integration, E2E, visual, build, and deployment verification are included.
- [x] No implementation task uses unconditional service-role access for user check-in rows.
