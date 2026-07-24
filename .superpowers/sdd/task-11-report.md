# Task 11 Report: Remove Dormant Local And WeChat Backends

## Scope Completed

- Removed the tracked WeChat auth routes and helper, legacy `app/attention-app.tsx`,
  local `db/` implementation, Drizzle configuration, and Drizzle migration files.
- Uninstalled `drizzle-orm` and `drizzle-kit`, including the obsolete
  `db:generate` script.
- Preserved the Sites project identity as the sole field in
  `.openai/hosting.json`.
- Removed Vite D1/R2 bindings while preserving vinext, Sites, the Cloudflare
  plugin, integration environment bindings, local Wrangler paths, and polling.
- Replaced Cloudflare ambient worker types with local TypeScript-safe interfaces
  for `ASSETS` and `IMAGES`; image optimization remains enabled.
- Updated the README for the Supabase-only local workflow, open registration,
  one-time recovery codes, local drafts/offline behavior, and excluded
  invite/admin/legacy-import scope.
- Removed the obsolete tracked `examples/d1` starter example and restored
  repository typechecking across all tracked TypeScript sources.

## TDD

1. Added the rendered repository guard for Supabase-only runtime paths.
2. RED: `npm run test:rendered` failed because `package.json` still contained
   Drizzle dependencies and the obsolete generation script.
3. GREEN: after the tracked removals, dependency uninstall, and config cleanup,
   `npm run test:rendered` passed all 5 tests.

## Verification

- `npm run test:unit`: 24 files, 156 tests passed.
- `npm run test:rendered`: 5 tests passed.
- `npm run test:integration`: 3 files, 10 tests passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `git diff --check` and `git diff --cached --check`: passed.
- Targeted formal-runtime scans found no `D1Database`, `R2Bucket`, `wechat`,
  `drizzle`, or `attention-current-user` references.
- The Sites project identity was validated exactly.
- A fresh `* 2` duplicate scan found no files in this worktree.
- Restored the generated tracked `tsconfig.tsbuildinfo`; ignored generated
  folders were left untouched.

## Review Follow-Up

- Strengthened the repository guard to parse the exact Sites identity, reject
  every tracked obsolete backend path and the Drizzle packaging branch, and
  preserve positive vinext, Sites, Cloudflare, integration-binding, asset, and
  image-optimization contracts.
- RED 1: the rendered guard reported both tracked `examples/d1` files.
- RED 2: after deleting those files and restoring full TypeScript coverage, the
  rendered guard reported the remaining Drizzle branch in the Sites helper.
- GREEN: `npm run test:rendered` passed all 5 tests after the helper cleanup.
- `npm run typecheck` and `npm run build` passed with all tracked TypeScript
  sources covered.
- The built `dist/.openai/hosting.json` exactly matched the configured Sites
  project identity, and no `dist/.openai/drizzle` payload was produced.

## Concerns

- The prior retained-example/typecheck-exclusion concern is resolved.
- `npm uninstall` reported 14 dependency audit advisories (2 low, 12 high).
  They were not changed because they are outside this removal task.
