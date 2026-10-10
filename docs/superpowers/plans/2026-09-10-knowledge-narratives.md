# Knowledge Narratives Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with one frontend implementer; root implements the database and worker contracts. User has approved execution; no further design approval is needed.

**Goal:** Deliver 知序 branding, multi-date knowledge flow, durable AI generation, and saved source-linked narratives.

**Architecture:** A new RLS-protected narrative table doubles as a durable leased job queue. Authenticated API routes create owned source snapshots and expose saved results. The existing dedicated worker processes both single-day and narrative jobs independently.

**Tech Stack:** Existing React, TanStack Query, Zod, Supabase Postgres, dedicated Node AI worker; no new dependencies.

**Spec:** docs/superpowers/specs/2026-09-10-knowledge-narratives-design.md

## Global Constraints

- Date selection: 2–14 distinct ISO dates; optional question <= 300 characters.
- Preserve source snapshots, check-in versions, ownership, idempotency, and existing five-per-day shared AI quota.
- Narrative title <= 120 characters; status queued | generating | succeeded | failed.
- Never trust model citations outside the submitted dates; treat model text as plain text.
- Work in the current requested project checkout; preserve existing tsconfig.tsbuildinfo changes. Do not commit, deploy, or alter production data during implementation.
- Brand: 让每一次学习，连成自己的知识地图。 / 以点成线，以线成面。在记录中积累，在关联中理解。

## Shared Type and API Contract

`lib/domain/knowledge-narrative.ts` exports:

```ts
type NarrativeSource = { date: string; attention: string; summary: string; inspiration: string; version: number; sourceUrl: string; hasImage: boolean };
type NarrativeResult = {
  title: string; overview: string;
  nodes: { date: string; label: string; takeaway: string }[];
  connections: { fromDate: string; toDate: string; relation: '递进'|'补充'|'对照'|'应用'|'弱关联'; explanation: string }[];
  sections: { title: string; body: string; sourceDates: string[] }[];
  framework: { title: string; body: string; sourceDates: string[] }[];
  gaps: string[]; nextSteps: string[];
};
type NarrativeStatus = 'queued'|'generating'|'succeeded'|'failed';
type NarrativeSummary = { id: string; title: string; dates: string[]; question: string; status: NarrativeStatus; createdAt: string; updatedAt: string; error: string|null };
type KnowledgeNarrative = NarrativeSummary & { sources: NarrativeSource[]; result: NarrativeResult|null; changedDates: string[] };
```

- `GET /api/knowledge-narratives` returns data `NarrativeSummary[]` (latest 50).
- `POST /api/knowledge-narratives` accepts `{dates: string[], question: string, idempotencyKey: string}`; returns data `KnowledgeNarrative`, HTTP 202. Same request key reused after uncertain network error.
- `GET /api/knowledge-narratives/:id` returns data `KnowledgeNarrative`.
- `PATCH /api/knowledge-narratives/:id` accepts `{title: string}` and returns data `KnowledgeNarrative`.
- Existing `features/checkins/api.ts` exports `requestApi<T>(path, options)` and `ApiError`; use that envelope handling.

### Task 1: Durable storage, contracts, and API (root)

Create lib/domain/knowledge-narrative.ts, server/knowledge-narratives/{repository,http}.ts, app/api/knowledge-narratives/route.ts and [id]/route.ts; CLI-created migration and database tests; generated database.types.ts.

- [x] First tests reject duplicate/invalid/oversized dates and out-of-source model references; verify red.
- [x] Implement shared Zod schemas, exact source coverage and connections validation.
- [x] Create table/RPCs with atomic owned snapshots, shared quota reservation, idempotency conflict detection, leased claims and bounded retry.
- [x] Add authenticated routes, owner filtering, status-aware rename, changedDates based on current versions. Test missing sessions, malformed JSON and resource ownership.
- [x] Apply only to local test database and verify SQL lifecycle/privileges with pgTAP; generate types.

### Task 2: Frontend and branding (single delegated implementer)

Create features/knowledge-narratives/{knowledge-workspace,narrative-reader,api}.tsx/ts as appropriate and app/knowledge-theme.css; modify features/checkins/checkin-workspace.tsx, features/calendar/month-calendar.tsx, app/layout.tsx, features/profile/app-header.tsx, features/auth/auth-card.tsx, features/checkins/checkin-editor.tsx and associated tests.

Consumes the Shared Type and API Contract above. Expose `KnowledgeWorkspace({today,userId,onClose})`. Root domain file will exist shortly; do not edit it. UI may reuse MonthCalendar optional multiselect props without changing default behavior. Keep daily CheckInWorkspace mounted and hide its existing workspace-grid while the new view is open, so draft and image lifetimes remain intact. Provide visible saved-only note.

- [x] First meaningful tests cover empty-date disabled, multi-month selection retained, remove selection, generation and citations; run red.
- [x] Add nav/entry, 2–14 selection, question, selected date list, explicit generate, error recovery (same idempotency key for uncertain creation), polling and refresh discovery through persisted list.
- [x] Implement saved list, status, retry by new generation, rename and source-change prompt. Read result as text with line breaks, never innerHTML. Handle errors and loading without fake progress.
- [x] Knowledge flow uses ordered nodes, meaningful connection labels/explanations and terminal narrative. Clickable citations reveal source snapshot; scrolling respects reduced motion. Desktop and 320px mobile usable.
- [x] Update exact approved branding across header, auth, metadata and visible field text; adapt old tests only for changed copy. Preserve avatar/AI/check-in interactions.
- [x] Run targeted tests, typecheck where backend files permit. Write result to /tmp/knowledge-frontend-report.md. No commits or further delegation.

### Task 3: AI provider and dedicated worker (root)

Create supabase/functions/_shared/knowledge-narratives/provider.ts and services/ai-worker/knowledge-narratives.ts. Modify services/ai-worker/index.ts.

- [x] Provider tests reject invalid citations/partial source coverage and flag unrelated sources without fabrication.
- [x] Use existing DeepSeek transport conventions, dedicated prompt, timeout and structured result validation. Only hashed account identifier goes upstream; no source image download or external fetch.
- [x] Claim one durable job per loop, generate with 120s timeout, complete with claim token, safely retry transient provider errors up to three claims, recover crashed jobs after lease. Poll narrative independently from single-day jobs.
- [x] Verify worker failure persistence and stale-claim fencing. Update local runner integration harness to process this queue.

### Task 4: Integration, visual QA and review (root)

- [x] Exercise lifecycle with isolated accounts/local database and fake provider; no production writes.
- [x] Capture selection and completed flow at desktop and 390/320px; keyboard, reduced-motion, no overflow or console errors; verify screenshots visually.
- [x] Run unit suite, typecheck, lint, rendered tests, build, and appropriate integration/database tests.
- [x] Independent final code review and resolve actionable findings; record actual deployment prerequisites and validation limits.

## Completion record

All implementation tasks completed on 2026-09-10. See [the verification record](../../knowledge-narratives-qa.md) for actual test results, local preview, and deployment boundaries. No production deployment or git commit was performed.
