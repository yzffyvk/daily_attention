# Relation-aware AI summaries Implementation Plan

> **For agentic workers:** Execute inline with superpowers:executing-plans. The user explicitly approved the preceding design and requested implementation plus real acceptance.

**Goal:** Generate faithful, typed node relationships and display the chapter's composition, mechanisms, constraints and tradeoffs explicitly.

**Architecture:** A validated structured model response is compiled into human-readable Markdown tables inside the existing summary. A shared parser reconstructs nodes and relations for the reader; the summary remains the single editable/saved source of truth. Existing text/tree records retain the legacy reader. New tasks use knowledge-relations-v2; immutable old jobs retain their old prompt.

**Tech Stack:** TypeScript, Zod, React, existing CSS tokens, Vitest/Playwright, local Supabase and real DeepSeek worker.

**Spec:** User-approved taxonomy and relationship display proposal in the current conversation. Ten content types; source-grounded relations; distinguish learning order from causal/process order; preserve conditions and tradeoffs; real chapter2 acceptance with empty custom prompt.

## Global Constraints

- Preserve all pre-existing work; no reset, production deployment or external writes.
- Retain 5000-character summary contract, five existing sections, empty generated personal reflection, optional user requirements, source/data instruction separation.
- No second metadata copy that can become stale after summary editing. Invalid edited structures fall back to complete text; never invent edges.
- Node/edge IDs validated at generation; persisted tables use readable unique labels. Evidence quotes must occur in supplied source after whitespace normalization.
- Existing prompt versions remain executable. Change only the default for future jobs.
- UI is keyboard accessible, responsive, uses existing theme tokens; node selection exposes adjacent relations and original evidence.

## Review Focus

1. Malformed references, duplicate labels, containment cycles and fabricated evidence must not produce a misleading graph.
2. Mixed composition/mechanism/constraint relationships must keep distinct semantics; temporal order must not imply causality.
3. Markdown escaping and user edits must round-trip or visibly fall back without lost text.
4. Old generation versions, stored notes, drafts and reflections remain compatible.
5. Real output, source hash and provider usage must prove a fresh generation; reload must show the saved relationships.

## Task 1: Shared structure and readable persistence

Files: lib/domain/knowledge-structure.ts; lib/domain/knowledge-summary.ts; tests/unit/domain/knowledge-structure.test.ts; tests/helpers/knowledge-structure-fixture.ts.
Interfaces: KnowledgeStructure {coreQuestion,contentTypes,nodes,relations,readingOrder}; structuredSummarySchema; serializeStructuredSummary(input); parseKnowledgeStructure(summary).
- [x] Add failing tests for typed cross-relations, round-trip with escaped punctuation, unknown references, duplicate labels, containment cycles, raw fallback and source evidence validation.
- [x] Implement schemas, referential checks, Markdown serialization/parsing. Serialize node/detail associations explicitly by unique labels; preserve all original text in the outer reader.
- [x] Run domain tests and existing knowledge-summary tests.

## Task 2: Real provider and versioning

Files: supabase/functions/_shared/ai/relation-prompt.ts; deepseek.ts; contracts.ts; new CLI-generated migration; tests/unit/ai-generation/relation-provider.test.ts.
- [x] Add failing tests for v2 structured output, missing/fabricated evidence rejection, empty/user requirements separation and legacy compatibility.
- [x] Implement content-type-aware prompt, evidence checking, summary compilation; reject overflow without truncating a graph. Keep old versions unchanged.
- [x] Migrate only local future-job default to knowledge-relations-v2 and verify via read query.
- [x] Run provider/worker tests, including native Node startup.

## Task 3: Relationship reader

Files: features/checkins/knowledge-structure-view.tsx; knowledge-summary-view.tsx; app/knowledge-structure.css; app/layout.tsx; tests/unit/checkins/knowledge-structure-view.test.tsx.
- [x] Add failing tests for explicit edge labels, selecting adjacent nodes, conditions/evidence visibility, reading-order labeling, malformed fallback and legacy rendering.
- [x] Display core question, content types, reading guidance, navigable concept nodes and labeled relationships. Group containment separately from cross-relations; show comparison/tradeoff as symmetric relations, process as directed, preserve feedback.
- [x] Use a focused selected-node view plus complete relationship overview to avoid an unreadable hairball; mobile uses the same semantic cards.
- [x] Run reader tests; inspect desktop/mobile screenshots and overflow with the actual app.

## Task 4: Verification and live acceptance

- [x] Run full unit suite, typecheck, lint, rendered tests/build and relevant local database/API checks.
- [x] Restart idle worker after provider changes; preflight source gateway/system proxy and DeepSeek.
- [x] Submit exact chapter2 URL with empty userPrompt to a dedicated local acceptance account. Capture new job, v2 context, source digest, provider usage and content quality.
- [x] Save using optimistic version, verify reload and node interactions in the real UI on desktop/mobile.
- [x] Review the scoped changes; resolve actionable findings. Record limitations truthfully.

## Progress

- Design approved in conversation; implementation authorized by latest user request.
- Continue in the existing feature checkout because it contains the integrated user-approved unfinished changes and the active local app. Do not commit unrelated changes.

- 2026-09-25: scoped review findings fixed, including RPC version default, edited-table fallback and source/boundary visibility. Live attempts exposed enum/quote errors and token truncation; added a bounded validated repair, complete usage accounting and native Node compatibility coverage.
- Final code checks: 87 unit files / 872 tests passed; typecheck, lint, rendered HTML tests and build passed. The final prompt-only coverage adjustment also passed 19 focused provider/native-worker/deadline tests. Earlier interrupted runs were rechecked after preventing idle sleep.
- Semantic acceptance rejected an otherwise valid live result because it omitted dynamic history and pointed compression at the whole context. General rules now require concrete mechanism targets and visible core components, and retain qualifiers in distinctions.
- Final live job `317834ad-ef9c-430b-b248-d0bb7e2b2c03` passed the primary semantic acceptance: 13 nodes / 18 relations, empty requirements, fresh source and two recorded model calls. Saved local AI record version 3; desktop/mobile navigation, evidence, reload and overflow checks passed. See `docs/ai-relations-qa.md` for evidence and non-blocking wording refinements.
