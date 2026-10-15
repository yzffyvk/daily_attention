# Multiple learning records and albums implementation plan

Goal: Implement the user-approved daily multi-record and optional single-album design in the existing application.
Architecture: Retain check_ins IDs and content. Add independent record CRUD, nullable album membership, completion state and persisted AI candidates. New learning workspace replaces the singleton editor shell while reusing readers/editors, profile, daily takeaways and knowledge narratives.
Spec: The approved product design in this chat, including all five answered choices and album follow-up. User explicitly requested implementation; continue without further process approvals.

## Global constraints
- Preserve existing uncommitted work. Work in the repository root (PROJECT_STRUCTURE.md). No reset/stash/commit of pre-existing changes. Baseline source snapshot: /tmp/aura-multi-record-baseline.tar.gz.
- Date Asia/Shanghai; only today/past writable. Yesterday's collection confirmed today still belongs to yesterday.
- Many records/day; each record belongs to zero or one personal album. Collection alone is pending; manual finish or explicit AI confirmation completes learning. Count distinct completed dates.
- AI candidates persisted independently of task expiry; never overwrite accepted content/reflection. A running job can coexist with edits/moves; stale results require rejection/re-generation, never silent overwrite. Only one active job per record; different records independent. Keep existing shared 5/day quota and cancellation policy.
- Keep source/user/version checks, account isolation, idempotency, image ownership, old summaries/narratives, old draft data. Deleting album unfiles records; deleting record cannot resurrect via worker.
- Knowledge selection uses 2–14 completed record IDs, same-day/mixed-mode allowed. New citations use record IDs; old date-based results readable.
- Incremental local implementation only; no production migration or deployment without concrete verification.

## Shared interfaces (all tasks use these)
Domain file lib/domain/learning-record.ts, owned by records task:
- LearningRecord extends CheckInRecord: albumId:string|null; status:'pending'|'completed'; completedAt:string|null; aiCandidate:LearningAiCandidate|null; activeAiJobId:string|null; aiStatus:string|null; aiError:string|null.
- LearningAiCandidate: jobId, sourceUrl, userPrompt, baseVersion:number, generationContext:AiGenerationContext|null, result:AiGenerationResult, createdAt:string.
- LearningAlbum: id,name,description,createdAt,updatedAt,recordCount,completedCount.
DB check_ins additions: album_id uuid null, learning_status text ('pending','completed', old default completed), completed_at timestamptz null (backfill), ai_candidate jsonb null, active_ai_job_id uuid null, ai_status text null, ai_error text null. albums table owned by records task.
HTTP response uses existing apiSuccess envelope:
- GET /api/records?date=YYYY-MM-DD|month=YYYY-MM&albumId=uuid&unfiled=true&pending=true&cursor=...&limit=50 -> {records:LearningRecord[],nextCursor:string|null}. Filters combine. Default cross-date view.
- POST /api/records: {id:uuid,date,entryMode,attention,sourceUrl,summary,inspiration,imagePath,imageName,userPrompt?,albumId:null|uuid,status:'pending'|'completed'} -> LearningRecord. Client-generated stable ID makes retries safe. Pending URL-only permits empty attention and derives hostname fallback.
- GET /api/records/[id] -> LearningRecord.
- PATCH /api/records/[id]: content fields + version (required), optional albumId/status; optional candidateJobId confirms matching current stored AI candidate with submitted edits and status completed; discardCandidate:true clears candidate only. Date immutable. Never broad-update by date.
- DELETE /api/records/[id]?version=N -> {id}.
- POST /api/records/move: {recordIds:string[],albumId:string|null} -> {moved:number}; atomic ownership validation; no content/version overwrite.
- GET /api/albums -> LearningAlbum[]; POST {name,description?} -> LearningAlbum; PATCH /api/albums/[id] {name,description?} -> LearningAlbum; DELETE -> {id}.
- Existing month summaries gain optional id/status/albumId/createdAt fields; old callers remain typed. Legacy date writes rejected with CLIENT_UPGRADE_REQUIRED after migration; no ambiguous reads/writes.
AI task adds optional recordId to createAiGenerationSchema and existing /api/ai/generations; new UI always sends recordId. New linked jobs validate owner, date, URL and snapshot version. Preserve legacy task recovery safely. Only AI task touches AI files and its migration.
Knowledge task changes create input to recordIds (legacy dates remains readable), uses GET /api/records to choose completed sources. New KnowledgeWorkspace optional initialRecordIds?:string[], initialAlbumId?:string|null. Frontend passes selected completed IDs or album context.
Frontend owns features/learning/** including api.ts with exports getRecords(filters), createRecord(input), updateRecord(id,input), deleteRecord(id,version), moveRecords(recordIds,albumId), getAlbums(), createAlbum(input), updateAlbum(id,input), deleteAlbum(id). API payloads follow above.

## Tasks and tests
- [x] Records/albums: schema migration, domain, repository+routes, RLS and ownership, optimistic locking/idempotency, transactional bulk move, candidate confirmation, stats. Write domain/routes/SQL tests, observe RED, implement, run targeted tests. Own lib/domain/learning-record.ts; server/learning/**; app/api/records/**; app/api/albums/**; existing checkin repo/date route/types; base migration 20261015043320_multi_records_albums.sql. Do not change database.types.ts until final consolidation by parent.
- [x] AI: record-bound generation contract, transactional job creation, terminal trigger persists candidate before task cleanup, active/failed statuses, stale completion protection, legacy task migration. Own server/ai/**, lib/domain/ai-generation.ts, features/ai-generation/**, worker AI files, separate CLI-generated migration. Tests cover candidate survival, owner checks, repeat start, deleted record, stale source and quota preservation.
- [x] Frontend: new record list/detail workspace with calendar, albums CRUD/single+bulk move, capture/new/manual completion/AI confirmation, duplicate prompt, stable drafts/images, pending inbox, cross-day navigation, responsive styling; retain takeaways/profile/reflection/cancellation and daily echo. Own features/learning/**, workspace client switch, optional calendar enhancements. Tests cover independent drafts, switching, capturing, album move, completion and async result isolation.
- [x] Knowledge (parent): 2–14 record selection, versioned record-ID citations, old result compatibility, migration/RPC/prompt/reader changes; tests same-day/mixed source and exact attribution.
- [x] Integration (parent): regenerate DB types, run unit/type/lint/build/database/integration/E2E as supported, inspect actual UI, review new diff against baseline, fix important findings and write deployment instructions.

## Review focus
Concurrent updates and moves; stale candidates; old client writes; RLS cross-owner albums; IndexedDB legacy migration and storage failures; no lost existing takeaways/profile/summary capabilities; same-day citations; bounded list pagination.

## Progress / rulings
- Current root is a non-main feature branch with substantial existing changes; retain in-place as repository guidance requests and snapshot before editing.
- User already approved product decisions and explicitly requested execution; do not impose additional spec/plan approval rounds.
- Shared contracts above are fixed before delegating independent ownership areas. Database generated types are consolidated after all migrations to avoid concurrent edits.

- Local migrations applied incrementally; no reset/deployment. Regenerated Database types. Build/typecheck passed. Full unit run passed 1089 tests except 2 album tests observed during concurrent edit; rerun stable targeted suite. Knowledge integration passed same-day mixed records with v3 citations; updating remaining legacy storage/cancel test assumptions. E2E running and independent review in progress.

- Independent review found and repaired 3 issues: stale local reflection must retain its baseVersion through candidate review/return/discard; ambiguous create response needs persisted conflict recovery; legacy date-only narrative creation now returns upgrade-required before quota. Supplemental create-replay migration compares the complete normalized payload at every version (including album/status/context), preventing successful replay from silently discarding edits.
- Full local DB 604 tests initially passed; new 10-case create replay regression awaits final run after supplemental migration. Integration 18/18 passed with existing localhost development worker briefly suspended and resumed, avoiding it consuming test jobs. Initial E2E 7/8 passed; image field mapping failed real-browser QA, fixed with component regression, final E2E rerun pending. Calendar now pages past 1000 rows using minimal fields; tests verify 1002 records including month-end.

- Final verification: full unit 121 files / 1103 tests passed; database 24 files / 614 tests passed; integration 6 files / 18 tests passed; browser 9/9 passed including 3 viewports, multiple link capture and inline album creation. Typecheck, lint, rendered guards 9/9 and production build passed. Independent reviewer verified all 3 reported issues closed. Actual screenshots inspected; compact sidebar calendar height corrected and responsive-only retest/final build performed afterward. No production changes or commit of unrelated user work.

- Final compact-calendar theme specificity correction verified at desktop/tablet/mobile (3/3 with equal-height day assertion); final production build passed. Local preview http://127.0.0.1:3000/login responds 200.
