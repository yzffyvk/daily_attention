# Question-led Distillation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. User approved the design and requested implementation on 2026-09-27.

**Goal:** Generate, persist and read question-specific answers and diagrams, with shared concepts and cross-question navigation.

**Architecture:** Add a versioned question structure alongside the legacy relation format. Persist it as reversible Markdown, validate generation before saving, and project each local view into the existing graph/detail components. Preserve old records and the current unfinished reader work.

**Tech Stack:** TypeScript, Zod, React, Vitest, Supabase/Postgres, existing DeepSeek provider.

**Spec:** `docs/superpowers/specs/2026-09-27-question-led-ai-distillation-design.md`

## Global Constraints

- schemaVersion 2; prompt version knowledge-questions-v1; summary maximum 12000 characters.
- At most 6 questions, 3 views per question, 32 shared nodes, 48 relations; prefer 3–7 nodes per view.
- Stable identifiers; source evidence; local endpoints visible; source/user requirements remain untrusted data.
- Old Markdown remains readable. Invalid structured edits retain all original text.
- Real acceptance uses chapter2.md with empty user requirements; no hardcoded questions or cached old result.
- Continue in the existing feature checkout because it contains the accepted, uncommitted reader implementation. Do not reset, stash, or commit unrelated changes.

## Review Focus

- Shared concepts renamed or referenced outside their owning question: references remain stable and navigation returns to its exact origin (Tasks 1, 3).
- User-added prose or broken Markdown tables: preserve complete edited text, never silently omit it (Task 1).
- Single-question and relationship-free materials: useful direct answers without invented links (Tasks 1, 3).
- Truncated source or output at length limits: no structural slicing; bounded repair or clear failure (Tasks 2, 4).
- Restored old jobs and records: use immutable versions, and distinguish a fresh run from a resumed job (Tasks 2, 4, 5).

## Task 1: Versioned question contract and editable document

Files: create `lib/domain/knowledge-questions.ts`, `lib/domain/summary-limits.ts`, question fixtures and domain tests; modify `lib/domain/knowledge-summary.ts`.

Interfaces: export `questionStructureSchema`, `questionSummarySchema`, `QuestionStructure`, `QuestionSummary`, `serializeQuestionSummary`, `parseQuestionSummary`, `projectQuestionView`. Legacy `KnowledgeStructure` remains unchanged.

- [x] Write and run failing tests for roundtrip, stable rename, invalid local edges, missing ownership, unsupported references, added prose, single-question and no-edge data.
- [x] Implement strict schemas, graph validation, readable escaped tables, conservative parser, and local projection.
- [x] Run `npx vitest run tests/unit/domain/knowledge-questions.test.ts tests/unit/domain/knowledge-summary.test.ts tests/unit/domain/knowledge-structure.test.ts` (expect PASS).

## Task 2: Question generation

Files: add question prompt; modify provider/contracts/runner and provider tests.

Interfaces: consume Task 1 schemas/serializer/parser and shared limits; add `AI_QUESTION_PROMPT_VERSION`; keep existing version routing.

- [x] Write and run failing tests for fresh version, source evidence including question evidence, repair, length handling and empty requirements.
- [x] Implement generic question generation, one bounded repair, roundtrip/evidence checks and safe truncation notices.
- [x] Run `npx vitest run tests/unit/ai-generation` (expect PASS).

## Task 3: Question reader

Files: create `question-structure-view.tsx`; extend summary view, graph layout and CSS; add reader tests.

Interfaces: consume `QuestionStructure` and `projectQuestionView`; preserve legacy reader interface.

- [x] Write and run failing tests for initial direct answer, local graph boundaries, question/view switching, scoped relation details, cross-question return, fullscreen and invalid-text fallback.
- [x] Implement question navigation, local diagram variants, answer/detail states and accessible mobile disclosure.
- [x] Run `npx vitest run tests/unit/checkins tests/unit/domain` (expect PASS).

## Task 4: Save boundaries and database

Files: editor, domain and repository summary schemas, new Supabase migration and database tests.

Interfaces: consume `SUMMARY_MAX_LENGTH = 12000`; retain RPC signatures and permissions; only fresh jobs receive new version.

- [x] Write and run boundary tests for 12000 acceptance / 12001 rejection and downstream narrative compatibility.
- [x] Expand all summary boundaries; generate a new migration using CLI for constraints, RPC checks and job version default.
- [x] Verify migration on configured test environment, using rollback-only checks for boundary probes. Do not reset user data.

## Task 5: Verification and real acceptance

- [x] Run unit, typecheck, lint, rendered HTML and build checks.
- [x] Review complete change with one independent reviewer and resolve important findings.
- [ ] Freshly fetch chapter2.md, create a new job with empty requirements, record source hash/version/call count, save and reopen.
- [ ] Inspect desktop/mobile light/dark rendering and local navigation against real generated data.
- [x] Record actual verification and remaining limitations in the QA document. Leave code ready for the user's commit/push workflow.

## Execution ledger

2026-09-27: User's “开始迭代” authorizes executing the reviewed design. Existing feature checkout retains previous reader changes; implementation remains here. No additional plan approval round. Task 1 begins.

2026-09-27: Tasks 1–4 implemented. New domain/provider/reader tests and 12000-character boundaries passed. Supabase migration applied (hosted version 20260927035322); completion RPC, unchanged grants, immutable old jobs and boundary tests passed in rollback transaction. Local Docker unavailable, so database tests target connected project with rollback-only fixtures. All 92 unit files / 894 tests passed with loopback permissions; sandbox attempt failed on forbidden test ports. Typecheck, lint and rendered tests passed. Independent review found keyboard evidence access; regression RED→GREEN fixed with explicit summary tabindex. Real acceptance uses a single explicitly verified task, no queue polling, after automatic approval rejected a broad production-connected worker.

2026-09-27: Final regression: 92 files / 896 tests passed; typecheck, lint, production build and diff check passed. Synthetic browser checks passed at 1487/1024/390 in both themes, including visible cross-question markers. QA report: docs/ai-question-reader-qa-2026-09-27.md. Real model acceptance remains pending the user’s explicit choice on persistent test-account creation versus a no-account run; no new account or task exists. No polling Worker or online application was deployed.

2026-09-27: User chose their own existing account. Fixed colliding demo dependency cache, isolated runtime database bindings, then enabled AI only for localhost:3001. The new scoped Chapter 2 task 288a409a-a5f8-43ed-8bbe-c56f37bd407c ran one real model call; all 16384 completion tokens were reasoning with no answer. Added RED→GREEN coverage and bounded recovery for empty length-limited responses. Subsequent attempts failed while fetching GitHub; task stopped at its existing three-attempt limit, with one quota slot consumed and no saved result. Final regression after this fix: 92 files / 899 tests, typecheck, lint, build and diff check passed. Real generated-content acceptance remains incomplete pending stable source connectivity; no new test account, queue polling or online deployment.
