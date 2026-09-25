# AI Learning Reader Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement the bounded tasks below. User already approved the combined visual and calendar collapse; continue through implementation and verification.

**Goal:** Present source-faithful interactive knowledge structure, three independently editable reflections, and a collapsible calendar in the existing application.

**Architecture:** Keep the current summary and inspiration text contracts so legacy records, optimistic concurrency, local drafts, and knowledge narratives continue to work. Read summaries into a conservative view model; when structure cannot be established, display readable complete text. Reflection tabs edit one reversible, human-readable, versioned note document, with ordinary legacy text mapped unchanged to the explanation tab. No database migration or cloud deployment is required.

**Tech Stack:** Existing React, TypeScript, CSS, Lucide, Vitest and Playwright. No new dependencies.

**Spec:** User-approved combined mock at `/Users/yanzifeng/.codex/generated_images/01a09f7c-3ff6-73d0-8bed-481ce8a95415/exec-59c333cf-4b19-49fc-9f44-c629e9200dd5.png`, plus the user's instruction to collapse the left calendar for a larger knowledge area.

## Global Constraints

- Work in the current feature checkout: existing uncommitted changes include the prior summary optimization and are required input. Do not revert, commit, deploy, or edit unrelated work.
- Preserve Agent/Model/Harness containment when it is actually present; do not hardcode Agent content or invent relationships for other materials.
- Existing complete summary text must remain available, editable and persisted without loss. Malformed/flat summaries get a readable fallback.
- Reflections: 用自己的话解释 / 新的理解 / 有趣的思想点. All optional; switching, save/reload, date changes and AI completion preserve each one. AI must never author them.
- Preserve the existing 2000-character stored inspiration limit and 5000-character summary limit. Report limits; never silently truncate existing content.
- Existing theme: near black, silver text, subtle rules and soft gold selected state. Semantic HTML graph is interactive content, not decorative artwork. Keyboard navigation, mobile fit and reduced motion are required.
- Main agent owns integration, shared styling and verification. Each subagent edits only its designated files and never delegates further.

## Task 1: Source-faithful summary view model

**Files:** Create `lib/domain/knowledge-summary.ts`, `tests/unit/domain/knowledge-summary.test.ts`; modify `supabase/functions/_shared/ai/deepseek.ts` only for predictable presentation structure.

**Interface:** Export `KnowledgeNode` (`id`, `label`, `description`, `children: KnowledgeNode[]`, `details: string[]`) and `KnowledgeSummary` (`thesis: string`, `roots: KnowledgeNode[]`, `explanation: string`, `distinctions: string`, `prompts: string[]`, `unmapped: string`, `original: string`) plus `parseKnowledgeSummary(text: string): KnowledgeSummary`.

- [x] Test actual chapter-like tree, nested Markdown bullets, numbered heading variants, duplicated labels, flat prose, unrecognized section names, malicious HTML text, code fences and formulas. Do not infer peer relationships from an arrow or prose sentence. Unknown content must remain in explanation/unmapped/original.
- [x] Run the test and confirm expected failure.
- [x] Implement conservative section parsing and hierarchy parsing with bounded node count/depth. Only exact normalized node-heading matching assigns explanation details; otherwise expose full explanation instead of guessing. IDs are stable within text, unique even for repeated labels. Description is only explicit text next to a node label.
- [x] Update existing provider prompt to keep headings stable, core hierarchy in the skeleton, and explanation subheadings matching node labels. Preserve source-safety, limits, neutrality, truncation notice and empty inspiration.
- [x] Run tests and report interface, sample parse output and limitations.

## Task 2: Three persistent reflection tabs

**Files:** Create `lib/domain/learning-reflections.ts`, `features/checkins/learning-reflections.tsx`, `tests/unit/domain/learning-reflections.test.ts`, `tests/unit/checkins/learning-reflections.test.tsx`.

**Interface:** Export `ReflectionKey = 'explanation' | 'insights' | 'ideas'`, `LearningReflections` with these three string fields, `parseLearningReflections(value: string)`, `serializeLearningReflections(value: LearningReflections)`. Component `LearningReflectionsEditor({value, onChange, disabled?, prompt?, summaryVisible?, onToggleSummary?})`, where value/onChange use the existing inspiration string. Root class `learning-reflections`. Keep active textarea id `inspiration` for existing user flows. Main agent supplies final styles.

- [x] Test exact legacy text roundtrip (including whitespace), all three fields roundtrip, blank/all-empty, embedded reserved headings/markers/backslashes, malformed formatted input preserved as legacy, no mutation of supplied object.
- [x] Test switching tabs retains each text, parent value/date reset derives content from new value, disabled state, keyboard arrows/Home/End, independent optional fields and visible validation when the serialized limit would be exceeded.
- [x] Confirm expected red failures before implementation.
- [x] Use a clearly versioned human-readable section format with reversible escaping. Legacy-only explanation remains ordinary text; never misclassify arbitrary old prose by generic headings. Keep max 2000 serialized characters. No silent truncation.
- [x] Use actual ARIA tabs/panels with focus behavior, exact labels above, per-tab prompts, empty own-writing area, save handled by existing parent form, optional hide-summary action. No AI writing or completion scores. Do not write shared CSS or change existing editor/storage.
- [x] Run tests and report encoding and integration contract.

## Task 3: Integrate the approved reading layout and calendar collapse

**Files:** Create `features/checkins/knowledge-summary-view.tsx` and focused component tests; modify `features/checkins/checkin-editor.tsx`, `features/checkins/checkin-workspace.tsx`, `app/attention-theme.css`, and existing workspace/editor tests.

- [x] Test selecting a knowledge node, showing its exact explanation, full readable fallback, viewing all source summary text, editing then returning to reading, and regenerating without losing three reflections.
- [x] Add calendar collapse/expand test with unsaved content preserved, accessible state, persisted preference and working unavailable-storage fallback. Do not remount the editor on collapse.
- [x] Implement semantic nested graph and selected explanation; layout is graph/details above, reflection tabs below. Read mode is default for AI results; use existing SummaryEditor for explicit edit mode. Keep empty/loading/error states meaningful.
- [x] Scope styles under the new reader; use container queries so a narrow column stacks details and mobile uses a vertical hierarchy. When calendar is collapsed, editor uses available grid width.
- [x] Preserve existing upload/save/reset controls and date-conflict flow. Place ancillary upload after reflections.

## Task 4: Verify end-to-end and compare with visual target

- [x] Run relevant unit suites, typecheck, lint and production build.
- [x] Use local demo fixture with the real generated chapter result and a non-Agent source to verify no hardcoded source content. Demo persistence remains isolated from real accounts.
- [x] Verify calendar toggle, node details, text editing, three-tab contents, save/reload and regeneration on desktop/mobile. Check overflow, keyboard focus and console errors.
- [x] Compare rendered expanded-calendar/hidden-calendar states against selected visual. Fix material differences. Write concise design QA evidence.
- [x] Request independent final code review; fix substantive findings and rerun affected checks.
- [x] Keep a working local preview open; report local changes and that deployment has not been requested.
