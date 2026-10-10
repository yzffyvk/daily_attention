# Reflection Polish Implementation Plan

> Use superpowers:subagent-driven-development for the independent backend task and integration review. The user explicitly requested this feature; continue through verified implementation without additional approval gates. Preserve all existing uncommitted work.

**Goal:** In AI mode, help users polish their own explanation using the current knowledge summary, preview the suggestion, and explicitly adopt or undo it.

**Architecture:** A short, authenticated request to the existing DeepSeek service; no queue, migration or automatic record write. Suggestions remain transient. Adoption changes only the explanation in the existing reflection document; ordinary save persists it. Request snapshots are invalidated when answer/topic/summary changes.

**Interface:** POST `/api/ai/reflection-polish` accepts `{topic: string (0–120), summary: string (1–5000), answer: string (1–2000), maxLength: integer (1–2000)}`. Shared domain exports `ReflectionPolishInput`, `ReflectionPolishResult` and Zod schemas. Result: `{polishedAnswer: string, knowledgePoints: string[], improvements: string[], cautions: string[]}`. Provider preserves voice, intent and uncertainty, separates source-grounded corrections from stylistic changes, never invents user learning or experiences. It uses only supplied summary and answer, not a fetched URL.

## Constraints

- AI mode / explanation tab only. Blank answer or absent summary cannot trigger generation. Loading, error, dismissal, explicit adoption and undo states must be usable.
- Preserve both other reflection tabs. Validate the full serialized 2000-character limit before adoption and undo; no truncation.
- Never replace text when a result arrives. A changed answer, summary or date must invalidate stale output and cancel the client request.
- Reuse verified session context and the existing database `aiGenerate` throttle with per-account bucket `reflection-polish:<userId>` (10 requests / 10 minutes), independently of queued generation's daily quota. No schema change.
- Server-only API key and anonymized account ID; validate and bound request/response, 60-second upstream deadline, no sensitive logs or client provider keys. JSON same-origin requests only.
- No deployment, commit or unrelated refactor.

## Tasks

- [x] Backend: new `lib/domain/reflection-polish.ts`, `server/ai/reflection-polish.ts`, `app/api/ai/reflection-polish/route.ts`, provider/route tests. Backend agent owns these files. Provider factory `createReflectionPolishProvider({apiKey, fetchImpl?}).generate(input, {anonymousUserId, signal?})`; server service `polishReflection(input,userId,signal?)` obtains environment configuration. Returned answer must fit `maxLength`.
- [x] Frontend: new `features/ai-generation/reflection-polish.tsx` and API function, integrate into `learning-reflections.tsx` only when AI editor supplies topic/summary. Main owns UI, CSS and tests. Show suggested wording, recognized concepts, improvements/cautions, adoption/dismissal and undo. Preserve full draft and accessible status messages.
- [x] Verification: provider/auth/validation/throttle tests; component stale-response/adoption/undo/limits tests; real-model public or synthetic example; browser desktop/mobile preview; typecheck, lint, build, independent review. Preview continues with isolated check-in data and an actual provider for polishing, clearly labelled.
