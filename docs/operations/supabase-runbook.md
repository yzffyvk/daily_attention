# Supabase Operations Runbook

This service uses Supabase for authentication, PostgreSQL records, and private Storage images. The web application is deployed by the release owner; this runbook does not deploy it.

## Local Release Gate

From the repository root, after any `supabase/config.toml` Auth change, stop and
start the local stack so Auth does not retain stale provider settings:

```sh
npx supabase stop --no-backup
npm run supabase:start
npm run supabase:reset
npm run supabase:types
git diff --exit-code -- lib/supabase/database.types.ts
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

`supabase:reset` reapplies every migration and `supabase/seed.sql`, but does not reload Auth provider configuration. `supabase:types` must produce a deterministic update; inspect and commit a changed `lib/supabase/database.types.ts` only when the migration schema requires it. The integration suite directly proves that the configured Send Email Hook blocks passwordless OTP/magic-link, password-reset email, and authenticated email-change requests while preserving the account email, profile email, and original password login. Before Playwright starts, `npm run test:e2e` makes a sanitized local `/auth/v1/settings` assertion using the locally sourced publishable key: Email ON, Phone OFF, and public signup OFF. It prints neither the key nor the response body. The E2E runner starts its own application server on `127.0.0.1:3200`, and stops that server when finished. It never reuses or stops a process on port 3000.

A retained local E2E or integration ownership registry can contain exact runner-owned entries after a partial cleanup. Resume cleanup only by running the corresponding standard `npm run test:e2e` or `npm run test:integration` command again after resolving the original failure. Do not edit or discard either registry manually: each runner removes an entry only after it proves the exact owned Auth user, and for E2E the owned Storage objects, are absent. Both runners prevent concurrent standard runs, reject symlinks and malformed or conflicting ownership, and keep private registry permissions. The integration runner holds an exclusive listener on `127.0.0.1:47653`; the OS releases it when the runner exits, and any bind conflict fails closed before registry cleanup. GoTrue hard-delete success bodies are non-authoritative and may be empty; cleanup requires a valid SDK result object with its own `error` field exactly `null`, then a fresh targeted Admin `getUserById` for the deleted ID. Absence is proven only by a structurally valid result with an own `data.user` equal to `null` and own error fields `status: 404` and `code: "user_not_found"`. A returned user, any other error, or any malformed result fails closed; cleanup never infers target absence from a global Auth list or from identity fields in the delete response.

Recovery uses one fixed-shape service-role `resolve_recovery_challenge` RPC. It always returns one row containing either the account ID and stored recovery digest or a null account ID with a 32-byte sentinel digest. The sentinel digest is an internal comparison value only: never log it or return it to the browser. Keep `resolve_email` and `read_recovery_digest` limited to authenticated recovery-code rotation.

## Registration Compensation Failure

For a `REGISTRATION_COMPENSATION_FAILED` alert:

1. Correlate the alert by request ID and timestamp without recording request bodies.
2. Pause the Admin registration route.
3. Read Auth users created in the narrow incident window and compare only their IDs with `profiles.id`; do not export or log emails.
4. Select only an exact Auth ID with no profile and no recovery credential.
5. Obtain destructive-action authorization, hard-delete that exact ID, and verify targeted `getUserById` returns `404 / user_not_found`.
6. Resume registration and let the user retry.

## Registration Sign-in Failure

For a `REGISTRATION_SIGNIN_FAILED` alert, `complete_registration` has already committed a valid profile and recovery credential. Do not delete the account from this alert alone. Correlate only the request ID and timestamp, direct the user to the login page, and have the user rotate the recovery code after login because the original recovery code was not delivered by the failed registration response.

## Recovery Rollback Failure

For a `RECOVERY_ROLLBACK_FAILED` alert:

1. Pause the recovery and recovery-code rotation routes.
2. Correlate the incident by request ID and time without recording request bodies.
3. Never request the user's password or recovery code.
4. Identify the exact account only in a secure Admin session, then invalidate its active sessions.
5. Choose only a reviewed forward repair or a verified full restore.
6. Do not guess which password or recovery digest committed, and do not directly overwrite either value.

To stop only a Supabase stack started for this repository:

```sh
npm run supabase:stop
```

## Production Project Preparation

Set the project reference in the shell, not in source control:

```sh
export SUPABASE_PROJECT_REF="your-project-ref"
npx supabase login
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"
```

Linking selects the target but does not authorize a release. Never include environment files, secret keys, or raw linked-project output in release evidence.

## Later Schema-Compatible Production Database Change

This generic database-push path is only for later releases that are explicitly verified schema-compatible with the running application. It is prohibited for the first phone-to-email cutover; that release must use the continuously quiesced sequence under **Guarded Legacy Account Reset**.

```sh
npx supabase migration list --linked
npx supabase db push --dry-run
npx supabase db push --linked
npx supabase migration list --linked
```

Read the dry-run output before applying it. Apply only the ordered migrations in `supabase/migrations`; do not modify an already-applied migration or use destructive reset commands against production. Follow a database change with the RLS checks below before directing traffic to the web release.

Before a hosted email-password release, verify the target project's Auth configuration:

1. Enable the Email provider and disable the Phone provider. Phone and SMS are not used by this application; do not configure an SMS provider.
2. Disable public project sign-ups, set the minimum password length to at least 8, and disable anonymous sign-ins.
3. Enable the Postgres Send Email Hook at `pg-functions://postgres/private/block_unsupported_auth_emails`. The database migration must exist before this Auth configuration is pushed. The hook rejects access-granting and identity-changing Auth emails and silently consumes only notification actions; do not configure SMTP.
4. Do not expose an email-confirmation, magic-link, or password-reset-email path in the application. Registration remains exclusively on the server-side Admin API, which creates the email user with `email_confirm: true` before completing the profile and recovery-code transaction.
5. Inspect `GET <NEXT_PUBLIC_SUPABASE_URL>/auth/v1/settings` with the publishable API key as appropriate for the hosted project. Confirm that the public settings report Email ON, Phone OFF, and public signup OFF; do not place the secret key in this request or its evidence.
6. Verify in Auth Hooks that the Send Email Hook is enabled. Using one synthetic application-registered account, directly prove that passwordless OTP/magic-link, reset-password email, and authenticated email-change APIs fail. Then prove the original Auth email and `profiles.email` are unchanged and the original password still signs in.
7. Repeat the dashboard, settings, hook, and direct negative checks after project cloning, restore, or any Auth configuration change.

The public settings response does not prove every dashboard-only password or anonymous-user control. Record those values from the Auth dashboard separately, retaining no keys or other credentials.

## Guarded Legacy Account Reset

This one-time reset is locked to project `jhiybzdvxvlkbqvamynp`. Its project ref must be passed explicitly, and the raw `NEXT_PUBLIC_SUPABASE_URL` value must be exactly `https://jhiybzdvxvlkbqvamynp.supabase.co`, with no trailing slash, port, whitespace, credentials, path, query, or fragment. The command reads that value and `SUPABASE_SECRET_KEY` from `.env.production.local`; keep the file outside source control.

Run the default dry-run first:

```sh
npm run reset:legacy-accounts -- --project-ref=jhiybzdvxvlkbqvamynp
```

The script prints only aggregate `users`, `profiles`, `check_ins`, and `images` counts. It does not empty Storage or delete Auth users without `--apply`.

Apply is irreversible and non-transactional. A failure can leave Storage empty and only some Auth users deleted; the script cannot roll those changes back. Before deletion, complete this preflight:

1. Confirm a current database backup and an independent `checkin-images` Storage export can be restored.
2. Confirm `202607230001_accounts_and_checkins.sql` is applied to the linked target. That migration defines `public.profiles.id references auth.users(id) on delete cascade` at lines 6-8 and `public.check_ins.user_id references auth.users(id) on delete cascade` at lines 24-27.
3. In the target SQL editor, verify the live constraints before relying on cascade deletion:

```sql
select
  conrelid::regclass::text as table_name,
  conname,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in ('public.profiles'::regclass, 'public.check_ins'::regclass)
  and conname in ('profiles_id_fkey', 'check_ins_user_id_fkey')
order by table_name;
```

The result must contain both `profiles_id_fkey` with `FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE` and `check_ins_user_id_fkey` with `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`. Stop if either row or `ON DELETE CASCADE` is absent.

4. Quiesce every application writer before apply: block check-in writes and image uploads, stop background writers, and disable the server-side Admin registration path as well as any other process that can create Auth users. This begins one continuous cutover window; keep every writer stopped through reset, migration, exact-release deployment, schema verification, and production smoke testing.
5. Re-run the dry-run while writers are quiesced, review the four aggregate counts, and independently reconfirm the target and authorization.

Before the legacy reset, query and record only the sequence state:

```sql
select last_value, is_called
from private.attention_display_name_seq;
```

Only then use the destructive form:

```sh
npm run reset:legacy-accounts -- --project-ref=jhiybzdvxvlkbqvamynp --apply
```

Apply freezes a deduplicated paginated Auth user snapshot, empties the private `checkin-images` bucket, and only then attempts every user deletion in that snapshot. Auth deletion relies on the preflighted cascades to remove `profiles` and `check_ins`. Success requires two consecutive recount snapshots in which all four aggregate counts are zero. Those snapshots authorize the next cutover step only; do not resume writers.

Do not execute any pending email-password migration before every writer and the Admin registration route are quiesced and the legacy reset has produced the required two consecutive all-zero aggregate snapshots.

While writers remain quiesced, complete the cutover in this order:

1. Review linked migration history and the exact dry-run while no writer can recreate legacy data:

   ```sh
   npx supabase migration list --linked
   npx supabase db push --dry-run
   ```

2. Apply only the reviewed pending migrations, then verify linked migration history:

   ```sh
   npx supabase db push --linked
   npx supabase migration list --linked
   ```

3. Verify the expected email/profile/recovery schema, RPC grants, RLS policies, and `private.block_unsupported_auth_emails(jsonb)` function. Immediately after the email migrations and before the first registration, require `private.attention_display_name_seq` to report `last_value = 1` and `is_called = false`. `202607280002_reset_display_name_sequence.sql` is a one-time clean-slate cutover migration; never rerun or copy it to reset a live sequence after registrations begin.
4. Only after the hook function exists, push the reviewed Auth configuration:

   ```sh
   npx supabase config push --project-ref "$SUPABASE_PROJECT_REF"
   ```

5. Verify Email ON, Phone OFF, public signup OFF, anonymous sign-ins OFF, minimum password length at least 8, and the Send Email Hook enabled. Confirm that all five Sites runtime variables below are present and non-empty.
6. Build, save, and deploy the exact reviewed release commit. Do not deploy a different source revision into this cutover.
7. Register one synthetic account through the deployed Admin registration route. Directly prove that native passwordless OTP/magic-link, reset-password email, and authenticated email-change APIs fail; prove the original Auth email and `profiles.email` remain unchanged and the original password still signs in. Complete the profile, check-in, recovery-code rotation, and recovery smoke test with synthetic data.
8. Resume writers and public traffic only after reset, database migration, Auth config push, exact-release deployment, schema verification, direct negative Auth checks, and smoke testing have all succeeded and their sanitized evidence has been reviewed.

If apply exits with `RESET_INCOMPLETE` or `RESET_FAILED`, assume partial mutation:

1. Keep all writers and Admin registration quiesced. Do not treat the operation as rolled back and do not resume traffic.
2. Preserve only the aggregate output and fixed error code; never collect IDs, object paths, credentials, or raw API errors.
3. Restore API availability or credentials as needed, re-run the dry-run to measure the remaining aggregate state, and repeat the live cascade-constraint preflight above.
4. If any `profiles` or `check_ins` rows remain after their Auth users were deleted, stop and investigate the cascade mismatch before any retry.
5. After the failure cause is resolved and a fresh destructive-action authorization is recorded, re-run apply against the remaining data. If recovery rather than completion is required, restore from the verified backups; the script provides no rollback.

If migration, deployment, schema verification, or smoke testing fails after a successful reset, keep every writer and the Admin registration path stopped. Preserve sanitized evidence, diagnose the failing stage, and use a schema-compatible reviewed forward fix. Returning to the phone-era web build requires a coordinated full database, Auth, and Storage restore to the pre-cutover state; never use a web-only rollback. Never resume traffic against a partially migrated schema or an unverified web release.

Never record command output together with environment files or secret values.

## Sites Runtime Variables

Set these runtime variables in the managed Sites project for the exact release environment:

```text
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<Supabase publishable key>
SUPABASE_SECRET_KEY=<Supabase secret key>
AUTH_RATE_LIMIT_PEPPER=<at least 32 random bytes>
APP_ORIGIN=https://<your-public-hostname>
```

The first two are intentionally public browser configuration. `SUPABASE_SECRET_KEY` and `AUTH_RATE_LIMIT_PEPPER` are server-only secrets: mark them secret, scope them to the target environment, and do not place them in `NEXT_PUBLIC_*` variables, source files, build arguments, browser logs, or screenshots. `APP_ORIGIN` is the exact trusted HTTPS origin used for canonical social-image metadata; it must not contain a path. After setting values, the release owner must build, save, and deploy the exact source commit through the managed Sites workflow.

Treat all five variables as a single release gate. Before any production smoke test or build/save/deploy action, verify in the target Sites environment that every variable is present and non-empty and that the two public values identify the intended Supabase project. Stop the cutover with writers still quiesced if any value is missing, malformed, or scoped to a different environment.

## Post-Deploy RLS Verification

Use two newly registered test accounts and non-sensitive synthetic content. Verify all of the following through the deployed application and Supabase logs:

1. Account A can create, read, update, and remove only its own check-in image.
2. Account B cannot read, update, delete, or attach Account A's check-in or Storage path. Confirm the request is rejected rather than returning an empty success.
3. An unauthenticated request to check-in and upload endpoints is rejected.
4. Direct API requests cannot assign a different user UUID or an image path outside the current user's prefix.
5. The database policies still pass locally with `npm run supabase:test` after the applied migration set.

Keep only request IDs, status codes, and synthetic account identifiers in the verification record.

## Backups And Restore Drill

Schedule a daily managed PostgreSQL backup with a retention period approved by the data owner. Independently export the private Storage bucket because database backups do not include image objects. Store database backups and Storage exports in separate encrypted locations with access limited to operations staff.

Once per quarter, perform a restore drill into an isolated Supabase project:

1. Restore the latest database backup into the isolated project.
2. Import the corresponding Storage export into the private `checkin-images` bucket, preserving object names and metadata.
3. Create two synthetic users, confirm RLS isolation, signed image reads, and recovery-code rotation.
4. Record restore duration, backup timestamp, object-count comparison, and any discrepancies.
5. Delete the isolated project or its test data after the review.

## Forward-Only Incident Rollback

For a later web release incident, stop writes at the managed ingress and roll back only to an artifact explicitly verified compatible with the current schema. Database rollback is forward-only: create a new reviewed migration that compensates for the fault; never edit or reverse an applied production migration in place. Preserve backups and incident evidence until the corrective migration and restore plan have been reviewed.

## Redaction Rules

Never write passwords, recovery codes, session cookies, bearer tokens, Supabase secret keys, rate-limit pepper values, learning text content, private image URLs, or signed URLs to logs, analytics, screenshots, test artifacts, tickets, or chat. Redact request and response bodies by default. For diagnostics, retain only request IDs, route names, timestamps, status codes, stable synthetic fixture IDs, and truncated error classes.

## Managed Ingress And Client IP Verification

`CF-Connecting-IP` is trusted by the rate-limit path only when all public traffic reaches the application through the managed Cloudflare/Sites ingress. Before production traffic is enabled:

1. Bind the public hostname to the managed Sites deployment and make that hostname the only supported origin.
2. Disable, restrict, or protect direct Worker/dev-origin access so it cannot reach the same application routes without the managed ingress policy. Do not expose a bypass hostname for `/api/auth/*`.
3. From an external network, request a direct-origin URL with a forged `CF-Connecting-IP` header. It must be denied before application routing or return no application response.
4. Request the managed hostname with the same forged header. Confirm managed ingress overwrites it with the real edge-provided header and the application receives only the managed value.
5. Save only HTTP status, hostname, timestamp, and request ID as evidence; do not save client IP addresses or headers.

Repeat this verification after any custom-domain, Cloudflare rule, Sites project, or origin-routing change.
