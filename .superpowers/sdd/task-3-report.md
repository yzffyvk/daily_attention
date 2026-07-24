# Task 3 Report: RLS, Storage Ownership, And Service-Only Account Functions

## Status

Completed on branch `codex/supabase-web-v1`. The work was performed only in `/Users/yanzifeng/Documents/今天你Ai了吗？/.worktrees/supabase-web-v1`.

## Implementation Summary

- Added `202607230002_rls_and_account_functions.sql` with RLS on `public.profiles` and `public.check_ins`.
- Granted authenticated users only the required public-table operations and restricted every row policy to `auth.uid()` ownership.
- Added authenticated-only Storage policies for select, insert, and delete in the private `checkin-images` bucket, requiring the first path segment to equal the caller UUID.
- Added the five required account RPCs as `SECURITY DEFINER` functions with `search_path = ''` and fully-qualified object names.
- Revoked RPC execution from `public`, `anon`, and `authenticated`; granted execution only to `service_role`.
- Added pgTAP coverage for RLS isolation, private schema access, function execution privileges, and private table privileges.
- Regenerated `lib/supabase/database.types.ts` for the five RPC interfaces.

## TDD Evidence

### RED

Command:

```bash
NPM_CONFIG_UPDATE_NOTIFIER=false npx supabase test db
```

Result: exit 1, as expected before the migration.

- `account-functions.test.sql` failed 5 of 7 tests because all five RPCs did not exist.
- `rls.test.sql` failed on the first authenticated profile read with `permission denied for table profiles`, because the required authenticated grant and RLS policy did not exist.
- Existing `schema.test.sql` passed.

### GREEN

Commands:

```bash
NPM_CONFIG_UPDATE_NOTIFIER=false npx supabase db reset
NPM_CONFIG_UPDATE_NOTIFIER=false npx supabase test db
```

Results:

- Reset exited 0 and applied `202607230001_accounts_and_checkins.sql` followed by `202607230002_rls_and_account_functions.sql`.
- Database tests exited 0: all 3 files passed, 32 tests total.

## Commands And Results

```bash
NPM_CONFIG_UPDATE_NOTIFIER=false npm run supabase:types
```

Exit 0. Generated local Supabase TypeScript types for all five RPCs.

```bash
npm test
```

Exit 0. `vinext build` completed, then the rendered HTML suite passed 7 of 7 tests.

```bash
git diff --check
```

Exit 0 after removing one mechanically generated blank final line from `lib/supabase/database.types.ts`.

The host does not have `psql`, so direct catalog verification used the running local container:

```bash
docker exec supabase_db_supabase-web-v1 psql -U postgres -d postgres -X -At -F '|' -c "... pg_proc ..."
docker exec supabase_db_supabase-web-v1 psql -U postgres -d postgres -X -At -F '|' -c "... pg_policies ..."
docker exec supabase_db_supabase-web-v1 psql -U postgres -d postgres -X -At -F '|' -c "... private privileges ..."
```

All five functions reported `prosecdef = true`, `search_path=\"\"`, no `authenticated` execute privilege, and `service_role` execute privilege. The catalog reported the five public-table policies and three Storage policies, all assigned to `authenticated`. It also reported no `authenticated` `USAGE` on schema `private` and no `SELECT` on either private table.

## Files Changed

- `supabase/migrations/202607230002_rls_and_account_functions.sql`
- `supabase/tests/database/rls.test.sql`
- `supabase/tests/database/account-functions.test.sql`
- `lib/supabase/database.types.ts`
- `.superpowers/sdd/task-3-report.md`

## Security Self-Review

- Public row reads and mutations are bounded by `auth.uid()` through RLS policies; inserts and updates use `WITH CHECK` to prevent ownership reassignment.
- Storage object access is restricted to the private bucket and a UUID-prefixed object path owned by the current user.
- Private aliases and rate-limit tables remain inaccessible to `authenticated`, with schema `USAGE` revoked.
- Every privileged account RPC uses `SECURITY DEFINER`, an empty `search_path`, and schema-qualified references, preventing caller-controlled search-path resolution.
- Function execution is service-only. The privileged RPC parameters therefore cannot be supplied by `anon` or `authenticated` callers.
- The function-privilege and RLS tests validate behavior under the `authenticated` role rather than merely asserting migration text.

## Concerns

No implementation or security concerns found within the specified scope. The local host lacks a `psql` binary, so catalog review used the already-running Supabase database container; this did not affect migration or test execution.
