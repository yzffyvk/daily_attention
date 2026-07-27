# Email/password auth final fix report

Date: 2026-07-27

Branch: `codex/email-password-auth`

Scope: the four findings in `final-review.md`. All work was local. No production
environment was touched, no branch was pushed, and `main` was not merged or
modified.

## 1. Public sign-up negative integration cleanup

### Change

- Replaced the ad hoc public sign-up probe address with the reserved integration
  generator.
- Added a runner-provided per-run scope to that generator while retaining its
  monotonic counter.
- When the public sign-up probe unexpectedly returns an Auth user, the test now
  validates a well-formed identifier and an exact returned address match before
  tracking ownership.
- Cleanup performs a fresh Admin readback of every tracked identifier/address
  pair before any deletion. Any invalid or mismatched ownership fails closed.
- The negative assertions compare only booleans and scalar error fields, so an
  unexpected success cannot expand an Auth user, session, or token-bearing error
  object into test output.

### RED/GREEN

- RED: the new ownership helper tests failed because the confirmation and
  guarded deletion helpers did not exist.
- GREEN: exact ownership confirmation, exact Admin readback deletion, and
  mismatch refusal passed.
- RED: the output-safety regression failed because the negative test still used
  object-expanding null assertions.
- GREEN: the regression passed after ownership tracking remained before
  identity-safe scalar assertions.

## 2. E2E stale Storage cleanup

### Change

- Before deleting a registry-owned Auth user, the runner queries only local
  `storage.objects` candidates in `checkin-images` that either claim the owner
  or use that owner's path prefix.
- Every returned row must satisfy both conditions, use the strict test image
  path shape, contain only the expected fields, and be unique. The broader
  candidate query is used only to detect mismatches; only rows satisfying both
  ownership conditions are removed.
- Storage removal is batched, its response is matched exactly to the requested
  paths, and an empty post-removal listing is required before Auth deletion.
- Listing errors, malformed rows, owner/path mismatches, ambiguous removals,
  missing Auth owners, and incomplete removal all fail closed. The registry and
  Auth user remain when deletion has not safely begun.
- Signal handling now stops before Storage/Auth deletion when interruption is
  observed during verification. Once the irreversible Auth deletion phase
  begins, cleanup completes before the registry is removed.
- New errors use fixed text and do not interpolate identities or upstream
  messages.

### RED/GREEN

- RED: four focused runner tests failed on stale image cleanup, both owner/path
  mismatch directions, and ambiguous removal.
- GREEN: those four tests passed, followed by the full runner suite.
- RED: a missing registry Auth owner still returned success and discarded the
  registry.
- GREEN: missing owners now fail closed and retain the object and registry.
- RED: the existing interruption test showed the Auth owner could be deleted
  after a signal arrived during verification.
- GREEN: the interruption test now proves the Auth owner and registry survive,
  the lock is released, and the next cleanup succeeds.
- Final runner unit result: 21 tests passed.

### Confirmed local orphan

- Initial aggregate inspection found exactly one test image object and no Auth,
  profile, or check-in row. Its object ownership columns were empty.
- A local audit correlation established exactly one reserved test owner for that
  exact image path. No identifier or address was emitted.
- In one local transaction, only that exact audited test identity was restored,
  only that exact object received matching owner metadata, and the standard E2E
  registry was written.
- The first runner attempt failed closed because the restored local Auth row was
  incomplete; it retained the registry and object and did not perform a broad
  delete. After completing only that exact local row's required Auth defaults,
  the standard E2E runner removed the verified Storage object before deleting
  the verified Auth user.
- Final aggregate local counts are zero for Auth users, profiles, check-ins, and
  `checkin-images` objects.

## 3. Integration run isolation

### Change

- `run-integration-tests.mjs` generates a fresh cryptographic run scope for
  every invocation and passes it to both the dev server and Vitest.
- Fixture addresses now combine the runner scope with the existing counter
  under the reserved domain.
- Scope syntax and counter input are validated before generation; exact
  ownership validation remains mandatory for cleanup.

### RED/GREEN

- RED: the same counter produced the same fixture across simulated runs, and the
  behavioral runner test observed no scope.
- GREEN: the same counter differs across scopes, and the fake runner receives a
  fresh valid scope. The focused runner/fixture suite passed.
- Two complete integration runs subsequently passed with 3 files and 12 tests
  each, confirming process wiring and cleanup.

## 4. Long address wrapping in the profile dialog

### Change

- Added a class only to the read-only profile address value.
- Added `min-width: 0` and `overflow-wrap: anywhere` in the existing profile CSS
  section.
- Added a component test using a long syntactically valid address at a narrow
  mobile viewport and a rendered-source assertion for both declarations.
- No layout, palette, business field, or dialog behavior was otherwise changed.

### RED/GREEN

- RED: the narrow component test could not find the scoped class, and the
  rendered CSS test could not find the wrapping declarations.
- GREEN: the focused component test and all 8 rendered tests passed.

## Final verification

The following commands were run from the worktree after the last implementation
change:

| Command | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test:unit` | PASS, 30 files / 259 tests |
| `npm run supabase:test` | PASS, 5 files / 165 tests |
| `npm run test:integration` | PASS, 3 files / 12 tests |
| `npm run test:e2e` | PASS, 5 tests |
| `npm run test:rendered` | PASS, 8 tests |
| `npm run build` | PASS |
| `git diff --check` | PASS |

The final read-only local aggregate query also passed and returned zero Auth
users, profiles, check-ins, and test image objects.

The local E2E settings gate passed during both complete E2E runs: address-based
authentication enabled, phone authentication disabled, and public sign-up
disabled.

## Commit

- `ebae06e` - `fix: harden auth test cleanup`
- This report is committed separately as a documentation-only follow-up; its
  hash is reported after that commit is created.

## Self-review

- Cleanup candidates are constrained by reserved generators, exact identifiers,
  exact addresses, the local environment, the single expected bucket, and the
  exact owner path prefix.
- No new cleanup path deletes an unverified user or an object with ambiguous
  ownership.
- Failure paths retain the registry and avoid Auth deletion whenever ownership
  or Storage cleanup is unresolved.
- New failure messages and negative assertions do not print identities,
  passwords, recovery material, session contents, or keys.
- Auth feature flags and business fields remain within the approved design.
- No production operation, push, PR, `main` merge, or worktree cleanup was
  performed.

## Residuals

- No known functional or safety residual remains for the four findings.
- Dependency installation reported existing audit findings. No dependency or
  lockfile change was made in this fix.
- The build's existing route-classification notice and local inspector-port
  fallback remained informational and did not affect verification.
