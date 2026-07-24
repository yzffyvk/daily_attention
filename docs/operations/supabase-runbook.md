# Supabase Operations Runbook

This service uses Supabase for authentication, PostgreSQL records, and private Storage images. The web application is deployed by the release owner; this runbook does not deploy it.

## Local Release Gate

From the repository root, start the local stack when it is not already running:

```sh
npx supabase status || npm run supabase:start
npm run supabase:reset
npm run supabase:types
git diff --exit-code -- lib/supabase/database.types.ts
npm test
npm run lint
npm run typecheck
npm run test:e2e
git diff --check
```

`supabase:reset` reapplies every migration and `supabase/seed.sql`. `supabase:types` must produce a deterministic update; inspect and commit a changed `lib/supabase/database.types.ts` only when the migration schema requires it. The E2E runner reads local credentials from `supabase status -o env`, starts its own application server on `127.0.0.1:3200`, and stops that server when finished. It never reuses or stops a process on port 3000.

To stop only a Supabase stack started for this repository:

```sh
npm run supabase:stop
```

## Production Database Change

Set the project reference in the shell, not in source control:

```sh
export SUPABASE_PROJECT_REF="your-project-ref"
npx supabase login
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"
npx supabase migration list --linked
npx supabase db push --dry-run
npx supabase db push --linked
npx supabase migration list --linked
```

Read the dry-run output before applying it. Apply only the ordered migrations in `supabase/migrations`; do not modify an already-applied migration or use destructive reset commands against production. Follow a database change with the RLS checks below before directing traffic to the web release.

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

For a web release incident, stop writes at the managed ingress, redeploy the prior known-good web version, and verify it against the current schema. Database rollback is forward-only: create a new reviewed migration that compensates for the fault; never edit or reverse an applied production migration in place. Preserve backups and incident evidence until the corrective migration and restore plan have been reviewed.

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
