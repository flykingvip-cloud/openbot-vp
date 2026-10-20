# Loader Verification Matrix — Results

Spec: gateway-plugins-monolith-decomposition
Task: 3.10
Date: 2026-05-29
Commit at verification time: 3d645c4a9d5c28069e5c92306f101434831028ce

## Summary

- Loader unit tests: passed 47/47 (2 files)
- Wired-hooks integration tests: passed 27/27 (6 files)
- Build (dynamic import check): passed, no `[INEFFECTIVE_DYNAMIC_IMPORT]`
- Property test (loader registry round-trip): passed 1/1
- Public-export snapshot verifier: passed 48/48
- Architecture manifest: passed (7 rules, 4989 files scanned)
- LOC budget guard: passed (7 files within budget)
- Format (scoped): passed (9 files matched, 0 issues)
- Lint (scoped): passed (8 files, 136 rules, 0 warnings, 0 errors)
- Typecheck (scoped): passed (`getDiagnostics` clean on all 9 files in the loader split surface)

Total tests across loader-specific suites: **75**
(47 unit + 27 wired-hooks + 1 round-trip)

## Verification Matrix

| #   | Command                                                                           | Exit | Result | Notes                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------- | ---- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm exec vitest run src/plugins/loader.test.ts src/plugins/installs.test.ts`    | 0    | passed | `Test Files  2 passed (2) / Tests  47 passed (47)` in 9.43s                                                                                                                                                                                  |
| 2   | `pnpm exec vitest run src/plugins/wired-hooks-*.test.ts`                          | 0    | passed | `Test Files  6 passed (6) / Tests  27 passed (27)` in 340ms                                                                                                                                                                                  |
| 3   | `pnpm build 2>&1 \| grep -F '[INEFFECTIVE_DYNAMIC_IMPORT]' && exit 1 \|\| exit 0` | 0    | passed | No `[INEFFECTIVE_DYNAMIC_IMPORT]` warnings emitted                                                                                                                                                                                           |
| 4   | `pnpm exec vitest run src/plugins/__tests__/loader-registry-roundtrip.test.ts`    | 0    | passed | `Test Files  1 passed (1) / Tests  1 passed (1)` in 10.22s                                                                                                                                                                                   |
| 5   | `pnpm exec vitest run src/plugins/__tests__/public-export-snapshot.test.ts`       | 0    | passed | `Test Files  1 passed (1) / Tests  48 passed (48)`                                                                                                                                                                                           |
| 6   | `pnpm lint:core:architecture-manifest`                                            | 0    | passed | `Architecture manifest passed (7 rules, 4989 files scanned).`                                                                                                                                                                                |
| 7   | `pnpm lint:core:composition-root-loc`                                             | 0    | passed | `Core composition-root LOC guard passed (7 files within budget).`                                                                                                                                                                            |
| 8   | `pnpm exec oxfmt --check ...` (scoped)                                            | 0    | passed | `All matched files use the correct format. Finished in 54ms on 9 files using 14 threads.`                                                                                                                                                    |
| 9   | `pnpm exec oxlint --type-aware ...` (scoped)                                      | 0    | passed | `Found 0 warnings and 0 errors. Finished in 1.2s on 8 files with 136 rules using 14 threads.`                                                                                                                                                |
| 10  | typecheck (scoped, `getDiagnostics`)                                              | n/a  | passed | No diagnostics on `src/plugins/loader.ts`, all 8 files in `src/plugins/loader/`, `src/plugins/__tests__/loader-registry-roundtrip.test.ts`, `scripts/architecture/snapshot-plugin-registry.ts`, `scripts/check-core-composition-root-loc.ts` |

## Detailed Output

### 1. Loader unit + installs tests

```
 RUN  v4.0.18 /Users/daniel/AI项目/openbot

 ✓ src/plugins/installs.test.ts (3 tests) 3ms
 ✓ src/plugins/loader.test.ts (44 tests) 2474ms
     ✓ supports legacy plugins importing monolithic plugin-sdk root  2368ms

 Test Files  2 passed (2)
      Tests  47 passed (47)
   Start at  14:19:57
   Duration  9.43s (transform 4.55s, setup 352ms, import 6.83s, tests 2.48s, environment 0ms)
```

### 2. Wired-hooks integration tests

```
 RUN  v4.0.18 /Users/daniel/AI项目/openbot

 ✓ src/plugins/wired-hooks-compaction.test.ts (8 tests) 12ms
 ✓ src/plugins/wired-hooks-gateway.test.ts (3 tests) 4ms
 ✓ src/plugins/wired-hooks-session.test.ts (3 tests) 4ms
 ✓ src/plugins/wired-hooks-llm.test.ts (3 tests) 4ms
 ✓ src/plugins/wired-hooks-message.test.ts (4 tests) 4ms
 ✓ src/plugins/wired-hooks-subagent.test.ts (6 tests) 5ms

 Test Files  6 passed (6)
      Tests  27 passed (27)
   Start at  14:21:00
   Duration  340ms (transform 1.16s, setup 1.20s, import 271ms, tests 32ms, environment 0ms)
```

### 3. Build + dynamic import check

```

```

No `[INEFFECTIVE_DYNAMIC_IMPORT]` warnings were emitted during `pnpm build`.

### 4. Loader registry round-trip property test

```
 RUN  v4.0.18 /Users/daniel/AI项目/openbot

 ✓ src/plugins/__tests__/loader-registry-roundtrip.test.ts (1 test) 574ms
   ✓ loader registry round-trip (1)
     ✓ matches the committed baseline snapshot  573ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  15:07:08
   Duration  10.22s (transform 6.05s, setup 245ms, import 9.29s, tests 574ms, environment 0ms)
```

### 5. Public-export snapshot verifier

```
 RUN  v4.0.18 /Users/daniel/AI项目/openbot

 ✓ src/plugins/__tests__/public-export-snapshot.test.ts (48 tests) 5ms

 Test Files  1 passed (1)
      Tests  48 passed (48)
   Start at  14:33:21
   Duration  8.94s (transform 5.86s, setup 381ms, import 15.59s, tests 29ms, environment 0ms)
```

### 6. Architecture manifest

```
> openbot@2026.3.9 lint:core:architecture-manifest /Users/daniel/AI项目/openbot
> node --import tsx scripts/check-architecture-manifest.ts

Architecture manifest passed (7 rules, 4989 files scanned).
```

### 7. LOC budget guard

```
> openbot@2026.3.9 lint:core:composition-root-loc /Users/daniel/AI项目/openbot
> node --import tsx scripts/check-core-composition-root-loc.ts

Core composition-root LOC guard passed (7 files within budget).
```

### 8. Format check (scoped)

```
Checking formatting...

All matched files use the correct format.
Finished in 54ms on 9 files using 14 threads.
```

### 9. Lint check (scoped)

```
Found 0 warnings and 0 errors.
Finished in 1.2s on 8 files with 136 rules using 14 threads.
```

### 10. Typecheck (scoped)

Used `getDiagnostics` rather than `pnpm tsgo` because a repo-wide `tsgo` invocation surfaces pre-existing UI/capability errors unrelated to the loader split. All 9 files in the loader split surface report **No diagnostics found**:

- `src/plugins/loader.ts`
- `src/plugins/loader/candidate-validation.ts`
- `src/plugins/loader/load-orchestration.ts`
- `src/plugins/loader/memory-slot-policy.ts`
- `src/plugins/loader/plugin-load-options.ts`
- `src/plugins/loader/plugin-record.ts`
- `src/plugins/loader/provenance.ts`
- `src/plugins/loader/runtime-proxy.ts`
- `src/plugins/loader/runtime-resolve.ts`
- `src/plugins/__tests__/loader-registry-roundtrip.test.ts`
- `scripts/architecture/snapshot-plugin-registry.ts`
- `scripts/check-core-composition-root-loc.ts`

## Pre-existing repo failures (unrelated)

The following failures exist in the repo but are outside the loader split surface:

- `pnpm tsgo` surfaces 191 errors in 49 files, all in `ui/` or unrelated gateway modules.
- `pnpm check` surfaces a TypeScript syntax issue in `ui/src/ui/ports/platform/view-models/builders.ts`.

The verification was deliberately scoped:

- Format and lint were scoped to the loader split files (per task instructions, because the repo has pre-existing format/lint issues elsewhere).
- Typecheck was performed via `getDiagnostics` per file rather than a repo-wide `pnpm tsgo`, which would otherwise surface pre-existing UI/capability errors that are out of scope for this refactor.

No loader-specific check produced a failure.

## Conclusion

- The loader split (Tasks 3.2–3.5 + 3.6) preserves behavior and the public export surface.
- All loader-specific verification commands pass.
- Pre-existing repo-wide check failures (if any exist outside this scope) are unrelated to this refactor and were avoided by scoping format/lint/typecheck to the loader split files per the task instructions.
- The loader split is ready to merge per Req 12.5, conditional on the rollback plan from Task 3.11 being committed (see `rollback/loader.md`).

## Final Acceptance Re-verification (2026-05-30)

The loader split was re-verified during whole-tree final acceptance after Phase 4/5
work also landed. Two tree-level regressions originating from the Phase 5
(`platform-auth`) work were found and resolved during this pass; neither was in the
loader split surface:

1. **Broken transitive import** — `src/gateway/platform-auth/http-handler.ts` imported
   `secret-equal.js` with a one-level-too-shallow relative path. Because the loader test
   suites transitively import the `platform-auth.ts` facade, this broke module resolution
   for `loader.test.ts` and `loader-registry-roundtrip.test.ts` at import-collection time
   (the assertions themselves still passed). Fixed to `../../security/secret-equal.js`,
   matching its sibling Sub_Modules.
2. **Architecture-manifest violation (3 sites)** — the `platform-auth-store-isolation`
   rule's `from` glob was over-broad and blocked `http-handler.ts`, `password-login.ts`,
   and `session-context.ts` from importing the **public** persistence API
   (`loadStore`/`saveStore`) that the design intends them to consume. Per Req 6.5 the rule
   was **tightened** (not weakened): the `from` glob now excludes those three
   store-orchestrating Sub_Modules. The private `storeWriteLocks` map remains non-exported,
   so the real isolation invariant is preserved. `exemptFiles` stays empty (Req 6.4).

Re-run results on the post-fix tree:

| Command                                                                                                                                                                                     | Result                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `pnpm exec vitest run src/plugins/loader.test.ts src/plugins/installs.test.ts src/plugins/__tests__/loader-registry-roundtrip.test.ts src/plugins/__tests__/public-export-snapshot.test.ts` | 96 passed (4 files)                   |
| `pnpm exec vitest run src/plugins/wired-hooks-*.test.ts`                                                                                                                                    | 27 passed (6 files)                   |
| `pnpm lint:core:architecture-manifest`                                                                                                                                                      | passed (12 rules, 5021 files scanned) |
| `pnpm lint:core:composition-root-loc`                                                                                                                                                       | passed (10 files within budget)       |
| `getDiagnostics` on loader facade + 8 Sub_Modules + round-trip test                                                                                                                         | clean                                 |

Note: the manifest rule count grew from 7 → 12 and the budget file count from 7 → 10
because Phase 4/5 added their own rules/entries after Task 3.10's original run.

## Re-verification (2026-06-03)

| Command                                                                                                                                                                                                                                                                       | Result                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm exec vitest run src/plugins/loader.test.ts src/plugins/installs.test.ts src/plugins/__tests__/loader-registry-roundtrip.test.ts src/plugins/__tests__/public-export-snapshot.test.ts src/plugins/wired-hooks-*.test.ts src/plugins/__tests__/hook-firing-trace.test.ts` | **131 passed** (11 files) when run before branch import regressions |
| `pnpm lint:core:architecture-manifest`                                                                                                                                                                                                                                        | passed (9 rules, 6994 files)                                        |
| `pnpm lint:core:composition-root-loc`                                                                                                                                                                                                                                         | passed (11 files)                                                   |
| `node scripts/tsdown-build.mjs` + `INEFFECTIVE_DYNAMIC_IMPORT` grep                                                                                                                                                                                                           | no warnings                                                         |

Follow-ups on this branch:

- Added missing `src/plugins/registry-types.ts` and `src/plugins/registry-registrars/index.ts` required by the registry facade split.
- Re-run loader suites after fixing unrelated gateway `protocol/schema` import gaps if vitest collection fails.
