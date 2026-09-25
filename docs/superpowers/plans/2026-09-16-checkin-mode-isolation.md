# Separate manual and AI check-ins

User requirement: manual recording and AI extraction must have independent data and functions; generated AI content must never overwrite manual content.

## Contract and decisions

- `CheckInEntryMode = "manual" | "ai"`; default missing mode to manual for legacy records and clients.
- One saved record per account/date/mode with independent version and image. Old rows retain their IDs and content under manual. Do not infer legacy authorship or duplicate content.
- GET `/api/checkins/:date?mode=ai|manual`; PUT body includes `entryMode`. Monthly list includes mode; calendar and stats count distinct dates.
- Browser IndexedDB draft key becomes account/date/mode, migrating old drafts to manual without changing content. Active AI job metadata belongs to AI; late AI results always target AI draft.
- Workspace owns selected mode and flushes the outgoing draft before switching. Cached reads/writes and hydration are mode scoped. Save/reset/conflict operate only on current mode. Mode switches preserve each side’s unsaved draft.
- AI generation and polishing are available only in AI mode. Manual fields, reflections and images cannot be mutated by those operations. Reuse existing UI.
- No deployment, commit, remote database change, unrelated cleanup or rollback of existing edits.

## Tasks

- [x] Backend/domain/schema: mode contract, mode-specific repository and HTTP read/write, migration with distinct-date stats, database/API/service tests; inspect knowledge narrative references for same-day collisions.
- [x] Client/drafts/workspace: mode-scoped API/cache and draft store, controlled mode switch with durable flush, late AI result isolation, scoped images/conflicts/reset; regression tests.
- [x] Integration and preview: unit/typecheck/lint/build, local database checks if available, desktop/mobile switching and save/reload checks, independent scoped review, preserve running demo.

Final verification and migration notes: `docs/checkin-mode-isolation-qa.md`.
