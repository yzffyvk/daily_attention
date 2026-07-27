# Resumable Auth Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local integration and E2E Auth cleanup verify deletion through fresh Auth absence checks and resume safely after any partial multi-user failure.

**Architecture:** E2E ownership registry entries begin in an implicit `pending` state. After exact Auth ownership verification and Storage cleanup, the runner atomically checkpoints one entry as `deleting`, performs an error-free Auth deletion, proves the user is absent through a fresh Admin read, and atomically removes only that completed entry. GoTrue's successful hard-delete response is an empty JSON object, so response identity fields are neither required nor trusted. A retry may finish a `deleting` entry only after proving both Auth and owned Storage are absent; an unverified missing `pending` owner remains a hard failure.

**Tech Stack:** Node.js 22, Supabase Admin Auth, local Supabase CLI, Vitest, Playwright.

## Global Constraints

- Cleanup must never delete or print an unverified user, email, Storage object, password, recovery code, token, or key.
- Initial registry writes remain exactly `{ userId, email }`; only the runner may add `state: "deleting"` after exact ownership verification.
- Registry rewrites must be atomic, remain inside the validated runner-owned directory, reject symlinks, and preserve mode `0600`.
- Storage for an owner must be verified empty before Auth deletion.
- A successful Auth delete requires `error === null` and a fresh Admin read proving the user ID is absent. The delete response body is not authoritative and must not be used to establish identity.
- Missing `pending` owners fail closed. Missing `deleting` owners may be checkpointed complete only when the fresh absence check succeeds and owned Storage is empty.
- A failure never removes the remaining registry entries.
- No production Supabase operation or `main` merge occurs in this task.

---

### Task 1: Exact and Resumable Auth Cleanup

**Files:**
- Modify: `scripts/run-e2e-tests.mjs`
- Modify: `tests/unit/e2e/runner.test.ts`
- Modify: `tests/helpers/integration-fixtures.ts`
- Modify: `tests/unit/integration-fixtures.test.ts`
- Modify: `docs/operations/supabase-runbook.md`

**Interfaces:**
- Produces: E2E registry parser accepting pending `{ userId, email }` and runner-owned deleting `{ userId, email, state: "deleting" }` entries.
- Produces: atomic registry checkpoint after each completed user.
- Produces: Auth delete error validation and post-delete absence verification in E2E and integration cleanup.

- [ ] **Step 1: Write failing E2E cleanup regressions**

Add tests for:

1. `deleteUser` returning GoTrue's empty success body while a fresh Admin read proves the target absent.
2. `deleteUser` returning null, malformed, or unrelated body data while a fresh Admin read proves the target absent.
3. `deleteUser` returning without error while a fresh Admin read still finds that user.
4. Two owned users where the first fully deletes and the second fails; the registry must contain only the second entry and a later run must complete.
5. Interruption after checkpointing `state: "deleting"` but before delete; retry must reverify and finish.
6. Interruption after Auth deletion but before removing the deleting entry; retry may remove it only after proving Auth and Storage absence.
7. A fabricated missing pending entry remains a hard failure.

- [ ] **Step 2: Run E2E runner tests and verify RED**

```bash
npx vitest run tests/unit/e2e/runner.test.ts
```

Expected: the new response-body-independent and partial-retry tests fail against the current exact-response/all-or-nothing behavior.

- [ ] **Step 3: Implement atomic E2E registry states**

Implement helpers that:

- parse only the two approved entry shapes;
- serialize entries without logging them;
- write a unique mode-`0600` temporary file in the validated registry directory;
- reject symlink/non-file registry metadata before replacement;
- atomically `renameSync` the temporary file over the registry;
- remove the registry only when no entries remain.

For each pending owner:

1. verify exact current Auth email;
2. remove and recheck exact owned Storage;
3. atomically checkpoint that entry as `deleting`;
4. call `deleteUser`;
5. require the delete call to return no error without trusting its response body;
6. freshly list/read Auth and require the ID to be absent;
7. atomically remove only that entry.

For a deleting owner, reverify Storage first. If Auth exists, its email must still match before retrying delete. If Auth is absent, remove only the deleting entry.

- [ ] **Step 4: Run E2E runner tests and verify GREEN**

```bash
npx vitest run tests/unit/e2e/runner.test.ts
```

Expected: all runner tests pass, including partial retry and successful empty/malformed delete bodies.

- [ ] **Step 5: Add integration delete confirmation tests**

Require integration cleanup to accept null, empty, malformed, or unrelated successful delete bodies only when a fresh Admin read proves the target user is absent. It must reject any delete error and reject a post-delete Admin read that still returns the user.

- [ ] **Step 6: Implement integration delete confirmation**

Keep the narrow test-only Admin port compatible with GoTrue's empty success body. Require no delete error, then perform a fresh Admin read/list and require the deleted ID to be absent. Keep the existing exact pre-delete `(userId, email)` verification.

- [ ] **Step 7: Update runbook**

Document that a retained E2E registry may contain runner-owned `deleting` checkpoints, retries must use the standard runner, and operators must not manually discard the registry after a partial cleanup.

- [ ] **Step 8: Run focused and full verification**

```bash
npx vitest run tests/unit/e2e/runner.test.ts tests/unit/integration-fixtures.test.ts
npm run lint
npm run typecheck
npm run test:unit
npm run supabase:test
npm run test:integration
npm run test:e2e
npm run test:rendered
npm run build
git diff --check
```

Expected: all commands pass; final local aggregate counts for Auth users, profiles, check-ins, and test images are zero.

- [ ] **Step 9: Commit**

```bash
git add scripts/run-e2e-tests.mjs tests/unit/e2e/runner.test.ts \
  tests/helpers/integration-fixtures.ts tests/unit/integration-fixtures.test.ts \
  docs/operations/supabase-runbook.md
git commit -m "fix: make auth cleanup resumable"
```
