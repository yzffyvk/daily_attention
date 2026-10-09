# Guided Structure Reader Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement the approved design in this session. Keep changes uncommitted for user review.

**Goal:** Combine a stable structure diagram, a guided reading route, and source-grounded details in the AI summary reader.

**Architecture:** Project the existing `KnowledgeStructure` into reading chapters and deterministic diagram coordinates. Keep reading position separate from free exploration. Consume the existing editable summary without changing generation, storage, or database schemas.

**Tech Stack:** React, TypeScript, existing Aura tokens and Lucide icons, SVG data visualization, Vitest, Playwright acceptance.

**Spec:** User-approved combined reference: `/Users/yanzifeng/.codex/generated_images/01a0cdd9-9c5f-77c0-8ba8-d4f6cfcb3c0b/exec-6e3faebd-a21c-456f-b06d-62a1e03b9238.png` and the conversation approval.

## Global Constraints

- Render only existing nodes, relationships, explanations, conditions, and evidence; do not invent article-specific grouping nodes or causal links.
- Reading chapters organize navigation; their order does not assert execution or causality.
- Preserve the editable Markdown summary as the single source of truth and retain legacy summaries.
- Preserve Aura dark/light themes, keyboard navigation, and mobile readability.
- No database migration, model call, commit, push, or deployment is needed for this UI iteration.

## Review Focus

- Partial or empty reading orders must still expose every node once.
- Disconnected nodes, feedback cycles, and multiple structural parents must remain navigable.
- Switching documents must clear stale exploration and reading state.
- Small containers and long names must not cause page overflow or unreadable scaled text.
- Fullscreen must trap focus, restore the trigger, and retain the reading position.

### Task 1: Truthful reading and layout projection

**Files:** Create `features/checkins/structure-reader-model.ts`; test `tests/unit/checkins/structure-reader-model.test.ts`.

**Interfaces:** `buildReadingChapters(structure)` returns chapter IDs, titles, and existing node names. `layoutKnowledgeStructure(structure)` returns stable node coordinates and existing relation paths, independent of selection.

- [x] Write failing tests for complete unique coverage, order within chapters, generic content, finite feedback paths, and multiple parents.
- [x] Run `npx vitest run tests/unit/checkins/structure-reader-model.test.ts`; expect missing implementation failure.
- [x] Implement projections with role/relation based navigation groups and containment-only hierarchy.
- [x] Repeat the same command; expect all tests passing.

### Task 2: Linked reader and responsive diagram

**Files:** Replace `features/checkins/knowledge-structure-view.tsx`; create `knowledge-structure-map.tsx`, `knowledge-structure-detail.tsx`, and `structure-reader-dialog.tsx`; update `app/knowledge-structure.css`, `knowledge-summary-view.tsx`, and reader tests.

**Interfaces:** Consume Task 1 projections; one controlled reader owns route position and exploration. Diagram selection never changes layout. Detail consumes an existing node or relationship.

- [x] Write failing interaction tests for route navigation, node/edge exploration and return, evidence, source notice, document reset, and fullscreen focus restoration.
- [x] Run `npx vitest run tests/unit/checkins/knowledge-structure-view.test.tsx`; expect the new reader contract to fail.
- [x] Implement the three coordinated regions, typed edge styling, accessible detail links, mobile map disclosure, and fullscreen reading.
- [x] Run both new test files plus `tests/unit/checkins/knowledge-summary-view.test.tsx`; expect all tests passing.

### Task 3: Product acceptance and review

**Files:** Reusable browser acceptance under `tests/visual/`; root `design-qa.md` records visual evidence.

- [x] Use the saved real Chapter 2 result to verify the implemented app at desktop, narrow desktop, mobile, and both themes. Verify reading/exploration return, relation evidence, fullscreen/Escape, no overflow or page errors.
- [x] Compare the approved image and actual screenshot in one input; resolve actionable visual issues and capture again.
- [x] Run unit tests, typecheck, lint, rendered checks, and production build; expect success.
- [x] Obtain one scoped independent review, fix significant issues, and document verification.
