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

## Review Follow-up

Independent review races were fixed on top of `d59aee7`:

- Confirmed cloud saves now synchronously cancel a pending debounce, abort and
  settle all active draft writes, and only then delete the local draft.
- Delayed local reads capture a dirty-edit generation and cannot restore over
  online post-hydration edits or immediate offline edits.
- Draft writes now use an abortable explicit IndexedDB readwrite transaction,
  with abort checks before opening, after opening, and during the transaction.
  Date changes, user changes, unmounts, and confirmed cloud saves abort active
  writes; `AbortError` remains a normal cancellation state.

Follow-up verification on 2026-07-25:

- Focused draft/workspace tests: 3 files, 69 tests passed in 6.89 s.
- Full unit suite: 24 files, 154 tests passed in 10.18 s.
- Lint: passed without errors or warnings.
- Production build: passed after the implementation change.
- Rendered-output tests were not rerun because no markup changed.
- Typecheck reported only the same six accepted legacy Cloudflare declaration
  errors and no Task 9 errors.

## Re-review Follow-up

The remaining commit-phase windows were fixed on top of `12eb753`:

- Dirty-edit tokens now advance during render from semantic draft changes and
  are synchronized in layout, so clean cloud hydration does not count as an
  edit while a committed dirty edit immediately invalidates a pending restore.
- Date changes, user changes, and unmounts now cancel timers and active writes
  in layout cleanup, before later layout work or IndexedDB task completion.
- `saveDraft` now reports `AbortError` only when `tx.abort()` was accepted.
  If abort is too late because the transaction already settled, the actual
  committed or failed transaction outcome is preserved.

Re-review verification on 2026-07-25:

- Focused draft/workspace tests: 3 files, 71 tests passed in 6.93 s.
- Full unit suite: 24 files, 156 tests passed in 9.31 s.
- Lint: passed without errors or warnings.
- Production build: passed after the runtime changes.
- Typecheck reported only the same six accepted legacy Cloudflare declaration
  errors and no Task 9 errors.
- `git diff --check`: passed.
