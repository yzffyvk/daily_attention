# Task 9 Report: IndexedDB Draft Protection

Implemented browser-local check-in drafts using IndexedDB database
`attention-cloud-drafts` version 1. Drafts are scoped by the authenticated
Supabase UUID and date, use the `[userId, date]` key with a `by-user` index,
and retain image bytes as Blobs only. No signed URLs or uploaded candidate
paths are stored.

The workspace now receives the authenticated UUID independently from profile
data, restores only drafts newer than cloud data, debounces dirty writes for
400 ms, cancels stale work on user/date changes, and removes a local draft only
after a confirmed cloud save. Offline read failures keep the editor usable;
cloud saves and image uploads remain disabled until the user manually saves
after reconnecting.

## Verification

- Focused draft/workspace tests: 59 passed in 6.95 s (2026-07-25 01:26 local).
- Full unit suite after the final lint fix: 24 files, 144 tests passed in 8.66 s
  (2026-07-25 01:27 local).
- Lint: passed.
- Production build: passed (3.5 s observed wall time).
- Rendered-output tests: 4 passed in 43.365 ms.
- `git diff --check`: passed.
- `tsc --noEmit --incremental false`: reports only the six pre-existing
  Cloudflare worker declaration errors in the WeChat auth routes, `db/index.ts`,
  and `worker/index.ts`; no Task 9 errors were reported.
- Supabase integration tests were intentionally not run because Task 9 is
  frontend-only.

Task 10 legacy import was intentionally not implemented.
