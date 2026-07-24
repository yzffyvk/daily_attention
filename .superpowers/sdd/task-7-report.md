# Task 7 Implementation Report

## Status

DONE_WITH_CONCERN

## Commit Range

- Base: `e05d6f7`
- Implementation commit: `HEAD` after this report is committed
- Final range: `e05d6f7..HEAD`

## Files Changed

- Added `server/storage/service.ts`.
- Added `app/api/uploads/checkin-image/route.ts`.
- Updated `app/api/checkins/[date]/route.ts`.
- Deleted `app/api/checkins/[date]/image/route.ts`.
- Added `tests/unit/storage/service.test.ts`.
- Added `tests/unit/checkins/date-route.test.ts`.
- Added `tests/integration/storage.test.ts`.

The progress ledger and workspace `.dev.vars` were not modified.

## Requirements Mapping

| Requirement | Implementation and coverage |
| --- | --- |
| Private Storage, SSR client only | `server/storage/service.ts` receives the request-scoped authenticated SSR client from `createCheckInRequestContext`; it uses `checkin-images` for signing and deletion and does not use an admin client. The existing private bucket and Task 3 RLS policies remain unchanged. |
| Path format and ownership | `buildImagePath` emits `<userId>/<date>/<uuid>.<extension>` for JPEG, PNG, and WebP. `assertOwnedImagePath` compares only the first path segment with the immutable authenticated user UUID. Unit tests cover generated paths, foreign rejection, and unsupported MIME rejection. |
| Signed uploads | `POST /api/uploads/checkin-image` validates authenticated session, calendar date, MIME type, and non-negative integer size. It permits exactly 10 MiB and rejects larger payload metadata with `413`; signing uses `upsert: false` and returns only `{ path, token }`. |
| Signed reads | `createCheckInImageUrl` calls `createSignedUrl(path, 600)`. The single-date check-in GET replaces `imageUrl: null` with a private signed URL where an image path exists. Unit coverage asserts the exact 600-second expiry; integration coverage fetches the returned URL successfully. |
| Safe cleanup endpoint | `DELETE /api/uploads/checkin-image` validates the body, verifies the first segment before deletion, returns `403 FORBIDDEN_IMAGE_PATH` for foreign paths, and deletes only the authenticated owner's requested object. |
| Replace cleanup and concurrency | Successful PUTs compare the previously stored and saved `imagePath` and delete only a distinct prior path. New candidate images are not deleted on `409` conflicts. Route unit coverage tests replacement, unchanged paths, and conflicts. |
| Task 6 compatibility | Task 6 request context, response envelopes, optimistic concurrency, record isolation, and `Cache-Control: private, no-store` helpers are retained. The upload route also uses the existing no-store check-in response helpers. |
| Old image route | Deleted `app/api/checkins/[date]/image/route.ts`. |
| Integration cleanup | `tests/integration/storage.test.ts` tracks only created users/rate-limit buckets and uses the existing targeted cleanup helper. It does not reset the database or alter workspace `.dev.vars`. |

## TDD And Verification

1. `npm run test:unit -- tests/unit/storage/service.test.ts`
   - Initial expected RED: failed to resolve `@/server/storage/service` because the file did not exist. Existing unrelated unit files passed (40 tests); the new suite failed before running tests.
2. `npm run test:unit -- tests/unit/storage/service.test.ts`
   - PASS after service implementation: 14 files, 42 tests.
3. `npm run test:integration`
   - First attempt reached the signing route but the test timed out while JSDOM marshalled a `Blob` to Storage. The test-only upload payload was changed to raw PNG bytes with explicit `image/png` content type; application code was unchanged.
4. `npm run test:integration`
   - PASS after the harness correction: 3 files, 9 tests. Covers owner signed upload/read/delete, cross-user delete rejection, unauthenticated signing, invalid calendar date, invalid MIME type, and over-limit size.
5. `npm run test:unit -- tests/unit/storage/service.test.ts tests/unit/checkins/date-route.test.ts`
   - PASS: 15 files, 49 tests. Covers path ownership, MIME rejection, `upsert: false`, exact 600-second signing, owner delete, replacement cleanup, unchanged paths, and 409 behavior.
6. `npx supabase test db`
   - PASS: 4 files, 92 assertions. Existing Task 3 bucket/RLS policies continue to pass.
7. `npm run lint`
   - PASS.
8. `npm run typecheck`
   - Expected repository-wide FAIL only in unchanged legacy Cloudflare paths: missing `cloudflare:workers` in the two legacy WeChat routes and `db/index.ts`, plus ambient `Fetcher`, `D1Database`, and `R2Bucket` in `worker/index.ts`. No Task 7 file appears in the output.
9. `git diff --check`
   - PASS.

## Self-Review

- Every normal server-side Storage operation receives the authenticated request-scoped SSR client. No service-role or admin client was introduced.
- The bucket identifier is fixed to the existing private `checkin-images` bucket; no public URL is generated.
- Read signing is exactly 600 seconds, upload signing refuses overwrite, and MIME-to-extension mapping is closed to JPEG/PNG/WebP.
- Ownership uses the required exact first segment comparison before deletion; Storage RLS independently enforces the same boundary.
- A PUT does not enter cleanup until `saveCheckIn` has returned success, so a `409` cannot delete the proposed new path. On success it deletes only a non-null prior path different from the saved path.
- The original Task 6 response and no-store helpers are reused rather than replaced. The obsolete R2 image endpoint is deleted.
- Integration fixtures use the established targeted user/rate-bucket cleanup and do not reset local Supabase.

## Concerns

- Repository-wide typechecking remains blocked by the known legacy Cloudflare ambient declarations scheduled for Task 11; Task 7 files are type-clean.
- If deletion of an old object fails after the database update has committed, the route returns the established sanitized `503`; this can leave a private orphaned old object. The task does not define a retry/reconciliation mechanism, so no unrelated background cleanup was added.

## Review Fixes

Status: RESOLVED

- `PUT /api/checkins/[date]` now validates each non-null `imagePath` with exact first-segment ownership before repository lookup/save. A foreign path returns `403 FORBIDDEN_IMAGE_PATH` with `Cache-Control: private, no-store` and does not call `saveCheckIn`.
- Old-image cleanup now catches a Storage deletion rejection after a committed save, logs `requestId`, user/path context, and the server error, then returns the saved record. No background cleanup mechanism was added.
- `createCheckInImageUrl` now receives `userId` and asserts ownership before asking Supabase Storage for a signed read URL.
- The prior cleanup `503` concern above is resolved for successful database saves; a failed cleanup may still leave a private orphaned object, by design, while the successful record is returned.

## Review Fix Verification

1. `npm run test:unit -- tests/unit/storage/service.test.ts tests/unit/checkins/date-route.test.ts`
   - RED before implementation: 15 files, 52 tests; 4 failures covering signed-read ownership, best-effort cleanup, and foreign PUT rejection.
2. `npm run test:unit -- tests/unit/storage/service.test.ts tests/unit/checkins/date-route.test.ts`
   - PASS after implementation: 15 files, 52 tests.
3. `npm run test:integration`
   - PASS: 3 files, 9 tests. Includes user two attempting to persist user one's uploaded image path, receiving `403 FORBIDDEN_IMAGE_PATH`, and subsequently receiving an image-free check-in GET response.
4. `npm run lint`
   - PASS.
5. `git diff --check`
   - PASS.
6. `npx supabase test db`
   - Not run: this review fix changes no database schema, migration, query, or Storage RLS policy.

## Focused Task 7 Fix Verification

- Added domain and route regression coverage for `imagePath: ""`. The route test asserts `422 VALIDATION_ERROR` with `imagePath` as the field and verifies `saveCheckIn` is not called.
- Changed `checkInInputSchema.imagePath` to `z.string().min(1).max(1024).nullable()`. Valid signed paths and `null` remain accepted.
- Changed PUT ownership validation to run for every non-null `imagePath` with an explicit `!== null` check.
- TDD RED: `npm run test:unit -- tests/unit/domain/checkin.test.ts tests/unit/checkins/date-route.test.ts`
  - 2 failed files, 13 passed files; 2 failed tests, 52 passed tests. The domain test received `true` instead of `false`; the route test received status `200` instead of `422`.
- TDD GREEN and covering unit tests: `npm run test:unit -- tests/unit/domain/checkin.test.ts tests/unit/checkins/date-route.test.ts tests/unit/storage/service.test.ts`
  - PASS: 15 test files, 54 tests.
- `npm run lint`
  - PASS: exit code 0, no diagnostics.
- `git diff --check`
  - PASS: exit code 0, no output.
- Integration tests were not run because this fix changes only domain validation and route branching; no database, Storage API, migration, or integration contract changed.

## Focused Task 7 Database Integrity Fix

### Status

COMPLETE

### Changes

- Added forward-only migration `supabase/migrations/202607240001_checkin_image_path_constraint.sql`.
- Replaced `check_ins_image_path_check` so `image_path` accepts `NULL` or a non-blank trimmed path, while retaining the 1024-character maximum.
- Added an exact `pg_constraint` definition assertion and behavioral pgTAP coverage for empty, whitespace-only, `NULL`, valid owner-style, and overlong image paths.
- The progress ledger was not modified.

### TDD And Verification

- RED: `NPM_CONFIG_UPDATE_NOTIFIER=false npx supabase test db` against the pre-migration local schema failed only the new catalog assertion and empty/whitespace behavior cases; existing assertions passed.
- `NPM_CONFIG_UPDATE_NOTIFIER=false npx supabase migration up --local`: PASS; applied `202607240001_checkin_image_path_constraint.sql` without resetting fixtures.
- `NPM_CONFIG_UPDATE_NOTIFIER=false npx supabase test db`: PASS; 4 files, 97 assertions.
- `NPM_CONFIG_UPDATE_NOTIFIER=false npm run test:unit -- tests/unit/domain/checkin.test.ts tests/unit/checkins/date-route.test.ts`: PASS; 15 files, 54 tests.
- `NPM_CONFIG_UPDATE_NOTIFIER=false npm run test:integration`: PASS; 3 files, 9 tests.
- `NPM_CONFIG_UPDATE_NOTIFIER=false npm run lint`: PASS.
- `git diff --check`: PASS.

### Concerns

None identified. The migration applied cleanly to the current local database, and all new database behavior tests run inside the existing rollback transaction.

## Focused Task 7 Robustness Fix

### Status

COMPLETE

### Changes

- Added forward-only migration `supabase/migrations/202607240002_checkin_image_path_whitespace.sql`; the applied `202607240001` migration was not rewritten.
- Replaced the named check constraint expression with a POSIX-space-aware requirement: `NULL` remains valid, non-`NULL` paths must contain at least one character outside `[:space:]`, and paths remain limited to 1024 characters.
- Extended the API/domain schema with Unicode-aware whitespace rejection and regression cases for tab and newline image paths.
- Extended the live Storage integration test to fetch the prior signed URL after owner deletion and assert it is no longer readable.
- The progress ledger was not modified.

### TDD And Verification

1. RED: domain tests failed for tab/newline-only paths; pgTAP failed the new catalog assertion and both tab/newline behavior cases against the pre-migration local schema.
2. `NPM_CONFIG_UPDATE_NOTIFIER=false npx supabase migration up --local`: PASS; applied `202607240002_checkin_image_path_whitespace.sql` without reset.
3. `NPM_CONFIG_UPDATE_NOTIFIER=false npx supabase test db`: PASS; 4 files, 99 assertions.
4. `NPM_CONFIG_UPDATE_NOTIFIER=false npm run test:unit -- tests/unit/domain/checkin.test.ts tests/unit/checkins/date-route.test.ts tests/unit/storage/service.test.ts`: PASS; 15 files, 56 tests.
5. `NPM_CONFIG_UPDATE_NOTIFIER=false npm run test:integration`: PASS; 3 files, 9 tests, including post-delete signed URL unreadability.
6. `NPM_CONFIG_UPDATE_NOTIFIER=false npm run lint`: PASS.
7. `git diff --check`: PASS.

### Concerns

None identified for this focused fix. Repository-wide typechecking was not part of this verification pass; the prior report records its unrelated legacy Cloudflare ambient-type failures.
