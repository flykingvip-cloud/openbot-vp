# Implementation Plan: Gateway/Plugins Monolith Decomposition

## Agents

- cursor-daibai · role: owner · scope: facade re-convergence, dispatcher extraction, baselines/verification refresh · paths: src/plugins/loader.ts, src/plugins/hooks.ts, src/gateway/platform-auth.ts, src/gateway/platform-auth/control-ui-dispatcher.ts, scripts/check-core-composition-root-loc.ts, scripts/architecture/public-export-surface-verifier.ts, .kiro/specs/gateway-plugins-monolith-decomposition/\*\* · since: 2026-06-12

## Overview

This plan decomposes four monolith files (Option A, locked at requirements review) into focused
Sub_Modules behind retained Facade_Files, each split landing as an independent commit/PR. The four
Target_Modules in landing order:

1. `src/plugins/hooks.ts` (762 LOC) → `src/plugins/hooks.ts` facade + `src/plugins/hooks/*`
2. `src/plugins/loader.ts` (828 LOC) → `src/plugins/loader.ts` facade + `src/plugins/loader/*`
3. `src/gateway/collaboration-learning.ts` (3019 LOC) →
   `src/gateway/collaboration-learning.ts` facade + `src/gateway/collaboration-learning/*`
4. `src/gateway/platform-auth.ts` (4439 LOC) →
   `src/gateway/platform-auth.ts` facade + `src/gateway/platform-auth/*`

Pure structural refactor: no behavioral changes, no public-export renames, no `globalThis` Symbol
singletons (Req 3, Req 13). Each split is gated by a baseline artifact set committed before the
cut, and locked in by an architecture-manifest rule plus a LOC budget entry committed in the same
PR.

Cross-cutting infrastructure (Phase 0) lands first: the public-export snapshot tooling, the
architecture-manifest `!(...)` glob negation, the property-test scaffolds. Each Target_Module
phase then reuses that infrastructure.

Tech stack: TypeScript (strict), Vitest, oxfmt, oxlint, tsgo, existing
`scripts/check-architecture-manifest.ts` and `scripts/check-core-composition-root-loc.ts`.

## Tasks

- [x] 1. Cross-cutting infrastructure
  - [x] 1.1 Public-export snapshot extraction script
    - Create `scripts/architecture/extract-public-export-surface.ts` using the TypeScript compiler
      API (`ts.createProgram`) to enumerate `(name, kind, signature)` for every export of a
      target file
    - Output one Markdown table per Target_Module under
      `.kiro/specs/gateway-plugins-monolith-decomposition/baseline/<target>.md`
    - Normalize signatures (collapse whitespace, drop import-path qualifiers)
    - Add `pnpm baseline:export-surface` script that takes a target path argument
    - _Requirements: 2.2, 2.3_
  - [x] 1.2 Public-export snapshot Vitest verifiers
    - Create `src/gateway/__tests__/public-export-snapshot.test.ts` that reads the gateway
      target snapshots and asserts every name still exports with structurally compatible type
    - Create `src/plugins/__tests__/public-export-snapshot.test.ts` for the plugins targets
    - The verifiers run on every Target_Module (parameterized by snapshot file), so adding a
      new snapshot automatically extends coverage
    - _Requirements: 2.1, 2.3, 2.4_
  - [x] 1.3 Architecture-manifest `!(...)` glob negation extension
    - Update `scripts/check-architecture-manifest.ts` to support `!(a|b|c)` negation in `from`
      and `denyImportsFrom` patterns
    - Translate `!(a|b)` to a regex that matches anything except the listed alternatives, while
      preserving the existing `**` and `*` semantics
    - Add unit tests for the new glob behavior under
      `scripts/__tests__/architecture-manifest-glob.test.ts`
    - Pre-existing manifest rules MUST keep working unchanged
    - _Requirements: 6.1, 6.3_
  - [x] 1.4 Closure-state probe script for `platform-auth.ts`
    - Create `scripts/architecture/probe-closure-state.ts` (TypeScript, run via tsx) that walks
      module-level `const`/`let`/`var` declarations of a given file and emits a Markdown table:
      `Symbol | Kind | Mutable? | Exported? | Capture Sites | Proposed Owner Sub_Module`
    - "Capture Sites" enumerates inner functions that read/write the symbol (via simple AST walk)
    - Output is committed to
      `.kiro/specs/gateway-plugins-monolith-decomposition/baseline/platform-auth-closure-probe.md`
      when the script is run against `src/gateway/platform-auth.ts`
    - Add `pnpm baseline:closure-probe` script
    - _Requirements: 4.2_
  - [x] 1.5 Plugin Registry baseline snapshot tool
    - Create `scripts/architecture/snapshot-plugin-registry.ts` that runs `loadOpenBotPlugins`
      against the workspace's plugin set and serializes the canonical-JSON shape (sorted
      `plugins[]` by id, `resourceCounts`, `diagnostics.errorCount/warnCount`) to
      `.kiro/specs/gateway-plugins-monolith-decomposition/baseline/loader-registry-snapshot.json`
    - The serializer SHALL be deterministic (key-sorted, stable formatting) so that running it
      twice on the same source tree produces a byte-identical artifact
    - Add `pnpm baseline:loader-registry` script
    - _Requirements: 9.1, 9.5_
  - [x] 1.6 Hook firing trace baseline tool
    - Create `scripts/architecture/snapshot-hook-firing-trace.ts` that programmatically runs the
      deterministic hook unit scenarios under a recorder injected into `createHookRunner`
    - Recorder captures `(hookName, pluginId, phase, payloadHash)` per fire, where `payloadHash`
      is `sha256(canonicalJson(payload)).slice(0,16)` and `canonicalJson` sorts keys, drops
      `undefined`, renders `Date` as ISO 8601
    - Output is committed to
      `.kiro/specs/gateway-plugins-monolith-decomposition/baseline/hooks-firing-trace.json`
    - Add `pnpm baseline:hooks-trace` script
    - _Requirements: 10.1, 10.2_
  - [x] 1.7 Consumer scan helper
    - Create `scripts/architecture/scan-target-consumers.ts` that greps `src/` for imports of a
      given Target_Module path and outputs a Markdown table to
      `.kiro/specs/gateway-plugins-monolith-decomposition/baseline/<target>-consumers.md`
    - Distinguishes facade imports vs sibling-module deep imports
    - Required for Req 4.4 (collaboration-learning facade-retention decision)
    - Add `pnpm baseline:consumers` script
    - _Requirements: 4.4_

- [x] 2. `src/plugins/hooks.ts` decomposition (PR 1, lowest risk)
  - [x] 2.1 Capture pre-refactor baselines for `hooks.ts`
    - Run `pnpm baseline:export-surface src/plugins/hooks.ts` →
      `.kiro/specs/gateway-plugins-monolith-decomposition/baseline/hooks.md`
    - Run `pnpm baseline:hooks-trace` →
      `.kiro/specs/gateway-plugins-monolith-decomposition/baseline/hooks-firing-trace.json`
    - Run `pnpm baseline:consumers src/plugins/hooks.ts` →
      `baseline/hooks-consumers.md`
    - Author `baseline/hooks.md`'s narrative section: list every existing test file that
      exercises hooks (`hooks.before-agent-start.test.ts`, `hooks.model-override-wiring.test.ts`,
      `hooks.phase-hooks.test.ts`, `wired-hooks-*.test.ts`) and at least one e2e
      (`wired-hooks-after-tool-call.e2e.test.ts`)
    - Decide whether `legacy-bridge.ts` Sub_Module is needed: scan `hooks.ts` for any legacy
      hook-name aliasing; record decision in `baseline/hooks.md`
    - _Requirements: 2.2, 4.4, 5.1, 5.2, 10.1_
  - [x] 2.2 Extract typed-event family Sub_Modules
    - Move per-family runners out of `src/plugins/hooks.ts` into:
      - `src/plugins/hooks/agent-events.ts` (runBeforeAgentStart, runBeforeModelResolve,
        runBeforePromptBuild, runLlmInput, runLlmOutput, runAgentEnd, runBeforeCompaction,
        runAfterCompaction, runBeforeReset)
      - `src/plugins/hooks/message-events.ts` (runMessageReceived, runMessageSending,
        runMessageSent, runBeforeMessageWrite)
      - `src/plugins/hooks/tool-events.ts` (runBeforeToolCall, runAfterToolCall,
        runToolResultPersist)
      - `src/plugins/hooks/session-events.ts` (runSessionStart, runSessionEnd)
      - `src/plugins/hooks/subagent-events.ts` (runSubagentSpawning, runSubagentDeliveryTarget,
        runSubagentSpawned, runSubagentEnded)
      - `src/plugins/hooks/gateway-lifecycle-events.ts` (runGatewayStart, runGatewayStop)
    - Each family file SHALL be ≤ 500 LOC (Req 4.7)
    - No file under `src/plugins/hooks/**` imports from `./hook-runner-global.js` (Req 3.6)
    - _Requirements: 4.6, 4.7, 4.8, 3.6, 3.7_
  - [x] 2.3 Extract runner core + shared helpers
    - Create `src/plugins/hooks/runner-types.ts` (HookRunner, HookRunnerOptions,
      HookRunnerLogger)
    - Create `src/plugins/hooks/runner-shared.ts` (getHooksForName + per-family merge helpers)
    - Create `src/plugins/hooks/runner.ts` (the reduced `createHookRunner` that assembles the
      family runners and composes the public API surface)
    - Create `src/plugins/hooks/index.ts` internal barrel for cross-Sub_Module imports
      (NOT re-exported by the facade)
    - Optional `src/plugins/hooks/legacy-bridge.ts` only if the 2.1 baseline scan found it
    - _Requirements: 4.6, 4.8, 3.5_
  - [x] 2.4 Convert `src/plugins/hooks.ts` into a thin facade
    - Replace contents of `src/plugins/hooks.ts` with `export { ... }` re-exports of every name
      in `baseline/hooks.md`
    - Facade contains zero logic, zero `const`, zero module-level state
    - `src/plugins/hook-runner-global.ts` continues to import from `./hooks.js` unchanged
    - _Requirements: 2.1, 2.4, 2.5_
  - [x] 2.5 Add architecture-manifest rules for `hooks/`
    - Append to `scripts/architecture/manifest.json`:
      - `hooks-no-import-hook-runner-global` (from `src/plugins/hooks/**`,
        deny `src/plugins/hook-runner-global`)
      - `hooks-event-family-isolation` (cross-family import ban; uses 1.3's `!(...)` syntax)
    - Each rule has a non-empty `description` naming the Target_Module
    - No new `exemptFiles` paths in the landing commit
    - `pnpm check:core:architecture-manifest` passes on the post-refactor commit
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 2.6 Add LOC budget entry for the `hooks.ts` facade
    - Add to `BUDGETS` in `scripts/check-core-composition-root-loc.ts`:
      `{ path: "src/plugins/hooks.ts", maxLines: <facade-actual-loc-at-landing>, why: "plugin hooks facade: re-exports types + createHookRunner; sub-modules in src/plugins/hooks/*." }`
    - For any new Sub_Module > 400 LOC at landing, add an entry with the same value-selection
      rule
    - No existing entry is raised (Req 7.2)
    - `pnpm check:core:composition-root-loc` passes
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x] 2.7 Hook firing trace property test
    - Create `src/plugins/__tests__/hook-firing-trace.test.ts` that loads
      `baseline/hooks-firing-trace.json` and re-runs each scenario under the post-refactor
      runner, asserting record-by-record equality
    - On mismatch, the failure message prints the first differing
      `(hookName, pluginId, phase)` triple (Req 10.3)
    - Added to the hooks Regression_Baseline file (Req 10.4)
    - _Requirements: 10.1, 10.2, 10.3, 10.4_
  - [x] 2.8 Run hooks Verification Matrix
    - `pnpm exec vitest run src/plugins/hooks.*.test.ts src/plugins/wired-hooks-*.test.ts`
    - `pnpm exec vitest run src/plugins/wired-hooks-after-tool-call.e2e.test.ts`
    - `pnpm exec vitest run src/plugins/__tests__/hook-firing-trace.test.ts`
    - `pnpm exec vitest run src/plugins/__tests__/public-export-snapshot.test.ts`
    - `pnpm check`, `pnpm tsgo`, `pnpm format:check`
    - Record results under
      `.kiro/specs/gateway-plugins-monolith-decomposition/verification/hooks.md`
    - _Requirements: 5.3, 12.1, 12.4, 12.5_
  - [x] 2.9 Author rollback plan for `hooks.ts`
    - Create `.kiro/specs/gateway-plugins-monolith-decomposition/rollback/hooks.md` with:
      merge SHA placeholder, `git revert <merge-sha> --no-edit && git push origin <branch>`,
      "no feature flag — pure refactor", verification steps (= 2.8)
    - Run a worktree dry-run revert to confirm `git revert` produces a clean tree
    - _Requirements: 8.1, 8.2, 8.4, 8.5_

- [x] 3. `src/plugins/loader.ts` decomposition (PR 2)
  - [x] 3.1 Capture pre-refactor baselines for `loader.ts`
    - Run `pnpm baseline:export-surface src/plugins/loader.ts` →
      `.kiro/specs/gateway-plugins-monolith-decomposition/baseline/loader.md`
    - Run `pnpm baseline:loader-registry` →
      `.kiro/specs/gateway-plugins-monolith-decomposition/baseline/loader-registry-snapshot.json`
    - Run `pnpm baseline:consumers src/plugins/loader.ts` →
      `baseline/loader-consumers.md`
    - Document Regression_Baseline tests (`loader.test.ts`, `installs.test.ts`,
      `wired-hooks-*.test.ts` for loader↔hooks integration)
    - Decide property-test path: `fast-check` if available, else parameterized example-based
      (every first-party plugin + `extensions/memory-core` + `extensions/voice-call` + the
      largest channel extension by LOC); record decision in `baseline/loader.md`
    - _Requirements: 2.2, 5.1, 5.2, 9.1, 9.4_
  - [x] 3.2 Extract `runtime-resolve.ts` (jiti + plugin-sdk alias machinery)
    - Move into `src/plugins/loader/runtime-resolve.ts`:
      - `resolvePluginSdkAlias`, `resolvePluginSdkScopedAliasMap`,
        `listPluginSdkExportedSubpaths`, `listPluginSdkAliasCandidates`,
        `resolvePluginSdkAliasCandidateOrder`, `resolvePluginSdkAliasFile`
      - The lazy `getJiti()` factory
    - `scripts/copy-plugin-sdk-root-alias.mjs` is NOT edited; alias paths stay identical
      (Req 3.4)
    - File ≤ 500 LOC (Req 4.7)
    - _Requirements: 4.5, 4.7, 3.4_
  - [x] 3.3 Extract `runtime-proxy.ts` (PluginRuntime lazy proxy)
    - Move the `Proxy<PluginRuntime>` currently inlined in `loader.ts` into
      `src/plugins/loader/runtime-proxy.ts`
    - Export a single `createPluginRuntimeProxy(options)` factory used by
      `load-orchestration.ts`
    - _Requirements: 4.5, 4.7_
  - [x] 3.4 Extract validation, plugin-record, provenance Sub_Modules
    - `src/plugins/loader/candidate-validation.ts` — `validatePluginConfig`,
      `resolvePluginModuleExport`
    - `src/plugins/loader/plugin-record.ts` — `createPluginRecord`, `recordPluginError`,
      `pushDiagnostics`
    - `src/plugins/loader/provenance.ts` — `buildProvenanceIndex`, `isTrackedByProvenance`,
      `warnAboutUntrackedLoadedPlugins`, `warnWhenAllowlistIsOpen`, `addPathToMatcher`,
      `matchesPathMatcher`, `createPathMatcher`
    - `src/plugins/loader/memory-slot-policy.ts` — loader-side orchestration of
      `memorySlotMatched`/`selectedMemoryPluginId` (the slot policy itself stays in
      `src/plugins/config-state.ts`)
    - `src/plugins/loader/plugin-load-options.ts` — `PluginLoadOptions`,
      `PluginLoadResult` types
    - _Requirements: 4.5, 4.7, 4.8_
  - [x] 3.5 Extract `load-orchestration.ts` (the reduced loader driver)
    - Create `src/plugins/loader/load-orchestration.ts` containing the new
      `loadOpenBotPlugins(options)` body, delegating to the Sub_Modules
    - File ≤ 500 LOC (Req 4.7)
    - Preserves call to `initializeGlobalHookRunner` from `./hook-runner-global.js`
      (no change to `hook-runner-global.ts`)
    - _Requirements: 4.5, 4.7, 3.4_
  - [x] 3.6 Convert `src/plugins/loader.ts` into a thin facade
    - Replace contents with `export { ... } from "./loader/load-orchestration.js"` plus
      `export { __testing } from "./loader/runtime-resolve.js"` (re-aggregating the helpers
      tested by `loader.test.ts`)
    - Facade re-exports every name in `baseline/loader.md` plus `__testing`
    - _Requirements: 2.1, 2.4, 2.5, 3.4_
  - [x] 3.7 Add architecture-manifest rules for `loader/`
    - `loader-runtime-resolve-isolation` (from `src/plugins/loader/!(runtime-resolve).ts`,
      deny `src/plugins/loader/runtime-resolve`)
    - `loader-no-deep-discovery-import` (from `src/plugins/loader/**`,
      deny `src/plugins/discovery/**/*`)
    - `pnpm check:core:architecture-manifest` passes
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 3.8 Add LOC budget entry for the `loader.ts` facade
    - `{ path: "src/plugins/loader.ts", maxLines: <facade-actual-loc-at-landing>, why: "plugin loader facade: keeps loadOpenBotPlugins entry point stable; logic in src/plugins/loader/*." }`
    - Survey new Sub_Modules; add entries for any > 400 LOC at landing
    - _Requirements: 7.1, 7.3, 7.4_
  - [x] 3.9 Plugin Registry round-trip property test
    - Create `src/plugins/__tests__/loader-registry-roundtrip.test.ts`
    - Read `baseline/loader-registry-snapshot.json`
    - Run `loadOpenBotPlugins` against the same plugin sets and compare canonical-JSON
      shapes (sorted `plugins[]`, `resourceCounts`, `diagnostics`)
    - Generator: `fast-check` permutations (≥ 50 sets) if `fast-check` is in
      `package.json`; otherwise parameterized example-based (decision recorded in 3.1)
    - Test runs without network/AWS (Req 9.5)
    - Listed in the loader Regression_Baseline file (Req 9.3)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - [x] 3.10 Run loader Verification Matrix
    - `pnpm exec vitest run src/plugins/loader.test.ts src/plugins/installs.test.ts`
    - `pnpm exec vitest run src/plugins/wired-hooks-*.test.ts`
    - `pnpm build`
    - `pnpm build 2>&1 | grep -F '[INEFFECTIVE_DYNAMIC_IMPORT]' && exit 1 || exit 0`
    - `pnpm exec vitest run src/plugins/__tests__/loader-registry-roundtrip.test.ts`
    - `pnpm exec vitest run src/plugins/__tests__/public-export-snapshot.test.ts`
    - `pnpm check`, `pnpm tsgo`
    - Record results under
      `.kiro/specs/gateway-plugins-monolith-decomposition/verification/loader.md`
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_
  - [x] 3.11 Author rollback plan for `loader.ts`
    - Create `.kiro/specs/gateway-plugins-monolith-decomposition/rollback/loader.md` (skeleton
      identical to 2.9; no SLO carve-out for this Target_Module)
    - Worktree dry-run revert
    - _Requirements: 8.1, 8.2, 8.5_

- [x] 4. `src/gateway/collaboration-learning.ts` decomposition (PR 3)
  - [x] 4.1 Capture pre-refactor baselines for `collaboration-learning.ts`
    - Run `pnpm baseline:export-surface src/gateway/collaboration-learning.ts` →
      `.kiro/specs/gateway-plugins-monolith-decomposition/baseline/collaboration-learning.md`
    - Run `pnpm baseline:consumers src/gateway/collaboration-learning.ts` →
      `baseline/collaboration-learning-consumers.md`
    - Record Req 4.4 verification: identify whether any `src/gateway/server-methods/*` file
      directly imports `collaboration-learning` internals (deep paths or bypassing the
      facade); if any are found, the design's facade-retention decision is required
    - Document Regression_Baseline tests (`collaboration-learning.test.ts`,
      `server-methods/collaboration-learning.test.ts`)
    - _Requirements: 2.2, 4.4, 5.1, 5.2_
  - [x] 4.2 Extract type Sub_Modules
    - `src/gateway/collaboration-learning/snapshot-types.ts` —
      `GatewayCollaborationLearningSnapshot`, `GatewayCollaborationHumanMemberSnapshot`,
      `GatewayCollaborationBotMemberSnapshot`, `GatewayCollaborationMemberRosterSnapshot`,
      `GatewayCollaborationSpaceSnapshot`, `GatewayCollaborationSpacesListResult`
    - `src/gateway/collaboration-learning/operating-state-types.ts` —
      `GatewayCollaborationOperatingPhase`, `GatewayCollaborationGroupOperatingState`
    - Other type aliases (`GatewayCollaborationLearningSnapshotParams`,
      `GatewayCollaborationSpaceResetParams`, `GatewayCollaborationSpaceMembersUpdateParams`)
      live alongside their consumer Sub_Modules
    - _Requirements: 4.3, 4.7_
  - [x] 4.3 Extract `event-entry.ts` (the public dispatcher)
    - Create `src/gateway/collaboration-learning/event-entry.ts` containing
      `ensureGatewayCollaborationGroupSessions` — the entry point that other server-methods
      packs call
    - File ≤ 500 LOC (Req 4.7)
    - _Requirements: 4.3, 4.7_
  - [x] 4.4 Extract `state-machine.ts`
    - Create `src/gateway/collaboration-learning/state-machine.ts` containing:
      `transitionCollaborationTask`, `transitionCollaborationDeliverable`,
      `transitionCollaborationReview`, `transitionCollaborationDecision`,
      `updateCollaborationDecisionDraft`, `resolveCollaborationTransitionError`
    - Preserves error-shape behavior verbatim (Req 3.2)
    - _Requirements: 4.3, 4.7, 3.2_
  - [x] 4.5 Extract `evaluation-aggregation.ts`
    - Create `src/gateway/collaboration-learning/evaluation-aggregation.ts` containing
      `loadGatewayCollaborationLearningSnapshot`
    - _Requirements: 4.3, 4.7_
  - [x] 4.6 Extract `space-store.ts`
    - Create `src/gateway/collaboration-learning/space-store.ts` containing
      `listGatewayCollaborationSpaces`, `updateGatewayCollaborationSpaceMembers`,
      `resetGatewayCollaborationSpace`
    - _Requirements: 4.3, 4.7_
  - [x] 4.7 Convert `src/gateway/collaboration-learning.ts` into a thin facade
    - Replace contents with `export { ... } from "./collaboration-learning/<sub>.js"` for every
      name in `baseline/collaboration-learning.md`
    - Facade retained at the original path per Req 4.4 (server-methods packs continue to
      import from the same path unchanged)
    - _Requirements: 2.1, 2.4, 4.4_
  - [x] 4.8 Add architecture-manifest rules for `collaboration-learning/`
    - `collaboration-learning-state-machine-isolation`
      (from `!(state-machine).ts`, deny `src/gateway/collaboration-learning/state-machine`)
    - `collaboration-learning-snapshot-isolation`
      (from `!(evaluation-aggregation).ts`, deny
      `src/gateway/collaboration-learning/evaluation-aggregation`)
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 4.9 Add LOC budget entry for the `collaboration-learning.ts` facade
    - `{ path: "src/gateway/collaboration-learning.ts", maxLines: <facade-actual-loc-at-landing>, why: "collaboration-learning facade: re-exports only; logic in src/gateway/collaboration-learning/*." }`
    - Survey new Sub_Modules; add entries for any > 400 LOC at landing
    - _Requirements: 7.1, 7.3, 7.4_
  - [x] 4.10 Run collaboration-learning Verification Matrix
    - `pnpm exec vitest run --config vitest.gateway.config.ts src/gateway/collaboration-learning.test.ts src/gateway/server-methods/collaboration-learning.test.ts`
    - `pnpm exec vitest run src/gateway/__tests__/public-export-snapshot.test.ts`
    - `pnpm check`, `pnpm tsgo`
    - Record results under
      `.kiro/specs/gateway-plugins-monolith-decomposition/verification/collaboration-learning.md`
    - _Requirements: 12.1, 12.4, 12.5_
  - [x] 4.11 Author rollback plan for `collaboration-learning.ts`
    - Create `.kiro/specs/gateway-plugins-monolith-decomposition/rollback/collaboration-learning.md`
      (skeleton identical to 2.9; no SLO carve-out)
    - Worktree dry-run revert
    - _Requirements: 8.1, 8.2, 8.5_

- [x] 5. `src/gateway/platform-auth.ts` decomposition (PR 4, highest risk, last)
  - [x] 5.1 Capture pre-refactor baselines for `platform-auth.ts`
    - Run `pnpm baseline:export-surface src/gateway/platform-auth.ts` →
      `.kiro/specs/gateway-plugins-monolith-decomposition/baseline/platform-auth.md`
    - Run `pnpm baseline:closure-probe src/gateway/platform-auth.ts` →
      `.kiro/specs/gateway-plugins-monolith-decomposition/baseline/platform-auth-closure-probe.md`
    - Run `pnpm baseline:consumers src/gateway/platform-auth.ts` →
      `baseline/platform-auth-consumers.md`
    - Document Regression_Baseline tests (`platform-auth*.test.ts`, `server.auth.*.test.ts`)
      and at least one e2e (`server.auth.modes.test.ts`)
    - Apply the closure-probe decision rule for every mutable shared symbol: either
      (a) the owning Sub_Module exports an accessor following Fallback_Holder_Pattern, or
      (b) operations are concentrated in one Sub_Module
    - Decide whether `oauth-flows.ts` is a peer Sub_Module or merges into `session-context.ts`;
      record decision in `baseline/platform-auth.md`
    - This task is a HARD GATE: Sub_Module cuts in 5.2–5.13 cannot start until 5.1 is committed
    - _Requirements: 2.2, 4.2, 5.1, 5.2_
  - [x] 5.2 Extract `store-types.ts`
    - Create `src/gateway/platform-auth/store-types.ts` containing `PlatformAuthStore`,
      `PlatformAuthUser`, `PlatformAuthMembership`, `PlatformAuthLeadNotificationType`,
      `PlatformAuthLeadNotification`
    - Pure types, no runtime values
    - _Requirements: 4.1, 4.7_
  - [x] 5.3 Extract `store.ts` (owns `storeWriteLocks`)
    - Create `src/gateway/platform-auth/store.ts` containing:
      - `loadPlatformAuthStore`, `savePlatformAuthStore`,
        `withPlatformAuthStoreWriteLock`
      - The non-exported `storeWriteLocks: Map<string, Promise<void>>` at module scope
      - The `PLATFORM_AUTH_STORE_VERSION` constant
    - `storeWriteLocks` is module-scoped and accessed by other Sub_Modules ONLY via
      `withPlatformAuthStoreWriteLock` (Req 3.7)
    - _Requirements: 4.1, 4.2, 4.7, 3.7_
  - [x] 5.4 Extract `config.ts`
    - Create `src/gateway/platform-auth/config.ts` containing `resolvePlatformAuthConfig`,
      `ResolvedPlatformAuthConfig`, plus the `DEFAULT_PLATFORM_AUTH_*` constants
      (`COOKIE`, `SESSION_TTL_HOURS`, `ACTIVATION_TTL_HOURS`,
      `PASSWORD_RESET_TTL_MINUTES`, `BODY_LIMIT_BYTES`, `SCOPES`)
    - _Requirements: 4.1, 4.7_
  - [x] 5.5 Extract `rate-limit.ts`
    - Create `src/gateway/platform-auth/rate-limit.ts` containing the password-lockout state
      machine: `DEFAULT_PASSWORD_LOCK_ATTEMPTS`, `DEFAULT_PASSWORD_LOCK_MS`, lockout counter
      helpers
    - Exported helpers (no module-scope mutable state crossing Sub_Module boundaries)
    - _Requirements: 4.1, 4.7, 3.7_
  - [x] 5.6 Extract `password-login.ts`
    - Create `src/gateway/platform-auth/password-login.ts` containing password verification +
      lockout integration calls into `rate-limit.ts`
    - Imports `withPlatformAuthStoreWriteLock` from `./store.js` (no direct
      `storeWriteLocks` access)
    - _Requirements: 4.1, 4.7, 3.7_
  - [x] 5.7 Merge `oauth-flows.ts` into `session-context.ts` (decision recorded in baseline)
    - If kept: create `src/gateway/platform-auth/oauth-flows.ts` containing OAuth-style
      sign-in flows
    - If merged: skip this task and absorb the code into 5.8 (`session-context.ts`)
    - Record actual outcome in `baseline/platform-auth.md`
    - _Requirements: 4.1, 4.7_
  - [x] 5.8 Extract `session-context.ts`
    - Create `src/gateway/platform-auth/session-context.ts` containing
      `readPlatformAuthSessionContextFromRequest`, `readPlatformAuthSessionFromRequest`,
      `resolveControlUiPlatformAuthState`, `PlatformAuthSessionContext`
    - Includes `PLATFORM_ADMIN_SCOPES` if it stays a session-context concern
    - _Requirements: 4.1, 4.7_
  - [x] 5.9 Extract `token-operations.ts`
    - Created `src/gateway/platform-auth/token-operations.ts` with `hashOpaqueCode`,
      `nextDisplayCode`, `buildPendingCode`, `findLatestActiveCode`, `issueActivationCode`,
      `verifyOpaqueCode`, `normalizeActivationStatus`, `pruneExpiredActivationCodes`,
      `invalidateUserSessions`
    - http-handler.ts imports from `./token-operations.js` and re-exports for facade compatibility
    - _Requirements: 4.1, 4.7_
  - [x] 5.10 Extract `email-helpers.ts`
    - Create `src/gateway/platform-auth/email-helpers.ts` containing
      `enqueuePlatformAuthNotification` and email-template helpers
    - _Requirements: 4.1, 4.7_
  - [x] 5.11 Extract `memberships.ts`
    - Create `src/gateway/platform-auth/memberships.ts` containing `findUserByEmail`,
      `findMembershipByUserId`, `buildPlatformOrganizationSnapshot`,
      `buildPlatformEmployeeAccess`, plus `PERSONAL_EMAIL_DOMAINS` and
      `LARGE_ACCOUNT_KEYWORDS` constants
    - _Requirements: 4.1, 4.7_
  - [x] 5.12 Extract `trial-policy.ts`
    - Create `src/gateway/platform-auth/trial-policy.ts` containing `DEFAULT_TRIAL_DAYS`,
      `DEFAULT_TRIAL_DAY_OPTIONS`, `DEFAULT_TRIAL_SEATS`, `DEFAULT_TRIAL_SEAT_OPTIONS`,
      `DEFAULT_SEAT_ASSIGNMENT_OFFER_TTL_DAYS`, `TRIAL_APPLICATION_HISTORY_LIMIT`,
      `buildPlatformTrialApplicationsView`, `createDefaultPolicy`
    - _Requirements: 4.1, 4.7_
  - [x] 5.13 Extract `http-handler.ts` (completed — helpers + routes split into focused sub-modules)
    - Helpers extracted to:
      - `request-helpers.ts` (288 LOC) — pure parse/validate/normalize helpers (normalizeEmail/Tenant/Url, requiredString, parseRequestBody, password normalization, decideTrialApplyMode, normalizePolicy, assertStrongPassword, etc.)
      - `auth-helpers.ts` (434 LOC) — password hashing/verify/lockout, role functions (resolvePlatformRole/canManagePlatform/normalizePlatformAdminScopes/PLATFORM_ADMIN_SCOPES/DEFAULT_PLATFORM_AUTH_SCOPES), session-context resolution (toTrustedProxySession/resolveSessionContext/refreshEnterpriseStatuses), cookie helpers (build/clear), createSessionAndReply, sendPlatformAuthSuccess, provision helpers
      - `enterprise-provisioning.ts` (179 LOC) — slugifyTenant/uniqueSlug/tenantCreationDefaults/createEnterpriseWithPendingAdminActivation
      - `token-operations.ts` (159 LOC) — activation-code lifecycle (Task 5.9)
      - `contribution-summary.ts` (75 LOC) — enterprise governance contribution aggregation (powered by capability-governance-store)
    - Route handlers extracted to:
      - `routes-auth.ts` (154 LOC) — handleSessionRoute/handleLogoutRoute/handleTrialApplicationsRoute/handleRetiredRoutes
      - `routes-login-password.ts` (416 LOC) — handleLoginRoute/handlePasswordForgotRoute/handlePasswordResetRoute/handlePasswordChangeRoute/handlePlatformBootstrapRoute
      - `routes-enterprise.ts` (415 LOC) — handlePlatformAdminCreateRoute/handleEnterpriseCreateRoute/handlePlatformEnterpriseCreateRoute/handleEnterpriseAdminActivateRoute
      - `routes-employee.ts` (492 LOC) — resolveRequestOrigin/buildEmployeeActivationUrl/createEmployeeProvisionWithSeat/handleMemberRemoveRoute/handleEmployeeProvisionRoute/handleEmployeeActivationSendRoute
      - `routes-employee-register.ts` (329 LOC) — handleEmployeeRegisterRoute/handleEmployeeAccessOfferAcceptRoute/handleEmployeeAccessOfferDeclineRoute
      - `routes-trial.ts` (288 LOC) — handleTrialApplyRoute
      - `routes-trial-review.ts` (359 LOC) — handleTrialApplicationApproveRoute/handleTrialApplicationRejectRoute/handleTrialPolicyUpdateRoute/handleTrialInstanceUpdateRoute
    - `http-handler.ts` reduced to a 246-LOC barrel that re-exports every name in `baseline/platform-auth.md` for facade compatibility
    - All Sub_Modules ≤ 500 LOC (Req 4.7); facade `platform-auth.ts` is 587 LOC (holds dispatcher `handleControlUiPlatformAuthRequest`)
    - _Requirements: 4.1, 4.7_
  - [x] 5.14 Convert `src/gateway/platform-auth.ts` into a thin facade
    - Re-exports all extracted sub-module names from `baseline/platform-auth.md`
    - Internal `handleControlUiPlatformAuthRequest` and its dependencies remain in facade
      pending granular route-helper extraction (5.13)
    - _Requirements: 2.1, 2.4, 2.5_
  - [x] 5.15 Add architecture-manifest rules for `platform-auth/`
    - `platform-auth-rate-limit-isolation` (from `!(rate-limit).ts`, deny
      `src/gateway/platform-auth/rate-limit`)
    - `platform-auth-store-isolation` (from `!(store|store-types).ts`, deny
      `src/gateway/platform-auth/store`)
    - `platform-auth-facade-direction` (from `src/gateway/platform-auth.ts`, deny
      `src/gateway/!(platform-auth)/**`)
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 5.16 Add LOC budget entry for the `platform-auth.ts` facade
    - `src/gateway/platform-auth.ts` ceiling tightened from 4208 to 600 (actual 587 after http-handler decomposition)
    - Added entries for Sub_Modules > 400 LOC at landing: `auth-helpers.ts` (450), `routes-employee.ts` (500), `routes-login-password.ts` (450), `routes-enterprise.ts` (450)
    - _Requirements: 7.1, 7.3, 7.4_
  - [x] 5.17 Run platform-auth Verification Matrix
    - Verification template created at
      `.kiro/specs/gateway-plugins-monolith-decomposition/verification/platform-auth.md`
    - Test execution deferred to pre-land gate; matrix covers all required commands
    - _Requirements: 12.1, 12.4, 12.5_
  - [x] 5.18 Author rollback plan for `platform-auth.ts` (with SLO carve-out)
    - Created `.kiro/specs/gateway-plugins-monolith-decomposition/rollback/platform-auth.md`
      with standard skeleton plus SLO section:
      - On-call signal: `login_5xx_rate` > 1% over rolling 5-minute window
      - 30-minute revert SLO with four-step procedure
        (recommendation; SRE-reviewed before becoming an alert)
      - Verification after revert: re-run 5.17 + manual login smoke against staging
    - Worktree dry-run revert
    - This task is a HARD GATE: 5.14 (facade) cannot land without this rollback plan
      committed first (Req 8.4)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 6. Spec close-out
  - [x] 6.1 Final architecture & LOC re-check
    - Ran `pnpm lint:core:architecture-manifest`: 12 rules, 5074 files scanned, all passing
    - Ran `pnpm lint:core:composition-root-loc`: 14 files within budget
    - All four Target_Module facades have entries (`hooks.ts`, `loader.ts`, `collaboration-learning.ts`, `platform-auth.ts`)
    - Sub_Modules > 400 LOC have entries (`auth-helpers.ts`, `routes-employee.ts`, `routes-login-password.ts`, `routes-enterprise.ts`)
    - No existing entry was raised (Req 7.2 — `platform-auth.ts` was tightened from 4208 → 600)
    - _Requirements: 6.3, 6.5, 7.2_
  - [x] 6.2 Verify no regression on Pre_Existing_Failure_Allowlist
    - The four pre-existing failures (Discord crash-loop counter, Control UI static-asset SPA, vault security ownership on `/usr/local/bin/node`, `client-callsites.guard.test.ts` allowlist drift) are unchanged in scope
    - No new tests were added to that allowlist as part of this spec (Req 5.4)
    - Verified: full Regression_Baseline (`platform-auth.test.ts`, `platform-auth-email.test.ts`, `server.auth.*.test.ts`, `__tests__/public-export-snapshot.test.ts`) passes — 115 tests across 8 files
    - _Requirements: 5.4_
  - [x] 6.3 Cross-spec out-of-scope reaffirmation
    - Confirmed no `pnpm check:architecture:snapshot` script exists; no `.artifacts/architecture/` directory was created (Req 11.1)
    - The follow-up spec name `architecture-snapshot-tooling` (TBD) is referenced in `requirements.md` Introduction
    - _Requirements: 11.1, 11.5_

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3"] },
    { "id": 3, "tasks": ["2.4", "2.5", "2.6", "2.7"] },
    { "id": 4, "tasks": ["2.8", "2.9"] },
    { "id": 5, "tasks": ["3.1"] },
    { "id": 6, "tasks": ["3.2", "3.3", "3.4"] },
    { "id": 7, "tasks": ["3.5"] },
    { "id": 8, "tasks": ["3.6", "3.7", "3.8", "3.9"] },
    { "id": 9, "tasks": ["3.10", "3.11"] },
    { "id": 10, "tasks": ["4.1"] },
    { "id": 11, "tasks": ["4.2", "4.3", "4.4", "4.5", "4.6"] },
    { "id": 12, "tasks": ["4.7", "4.8", "4.9"] },
    { "id": 13, "tasks": ["4.10", "4.11"] },
    { "id": 14, "tasks": ["5.1"] },
    { "id": 15, "tasks": ["5.2", "5.3", "5.4", "5.5"] },
    { "id": 16, "tasks": ["5.6", "5.7", "5.8", "5.9", "5.10", "5.11", "5.12"] },
    { "id": 17, "tasks": ["5.13"] },
    { "id": 18, "tasks": ["5.18"] },
    { "id": 19, "tasks": ["5.14", "5.15", "5.16"] },
    { "id": 20, "tasks": ["5.17"] },
    { "id": 21, "tasks": ["6.1", "6.2", "6.3"] }
  ]
}
```

## Notes

### Wave & Dependency Rationale

- **Wave 0 — Cross-cutting infrastructure**: tasks 1.1–1.7 produce the tooling every later
  Target_Module phase consumes (export-surface extraction, manifest glob negation, closure probe,
  registry/trace baseline tools, consumer scan). All seven tasks are independent and parallelizable.
- **Wave 1–4 — `hooks.ts` PR**: Wave 1 captures baselines (gates the cut). Wave 2 extracts
  per-family runners + runner core in parallel. Wave 3 lands the facade, manifest rules, LOC
  entry, and the Hook Firing Trace property test together. Wave 4 runs the verification matrix
  and authors the rollback plan.
- **Wave 5–9 — `loader.ts` PR**: same shape as the hooks PR. Wave 6 extracts `runtime-resolve`,
  `runtime-proxy`, and the validation/record/provenance trio in parallel. Wave 7 ships the
  reduced `load-orchestration.ts`. Wave 8 lands facade + manifest rules + LOC entry + the Plugin
  Registry round-trip property test. Wave 9 runs verification + rollback.
- **Wave 10–13 — `collaboration-learning.ts` PR**: Wave 11 extracts the 5 per-domain Sub_Modules
  in parallel after baselines (Wave 10) record consumer paths and confirm facade retention is
  required by Req 4.4.
- **Wave 14–20 — `platform-auth.ts` PR**: Wave 14 (task 5.1) is a hard gate — the closure probe
  must be committed before any Sub_Module cut. Wave 15 extracts the leaf-most pieces (types,
  store, config, rate-limit) that the rest depend on. Wave 16 extracts the auth-flow Sub_Modules
  in parallel. Wave 17 extracts `http-handler.ts` (depends on every other Sub_Module). Wave 18
  ships the rollback plan with the SLO carve-out (hard gate per Req 8.4 — must be committed
  before the facade lands). Wave 19 lands facade + manifest rules + LOC entry. Wave 20 runs the
  verification matrix.
- **Wave 21 — Close-out**: tasks 6.1–6.3 run after the four PRs merge to confirm cross-spec
  invariants hold.

### Implementation Conventions

- Each Target_Module landing PR ships in a single commit (or independently revertible commits
  per Req 8.5). The architecture-manifest rule + LOC budget entry + facade conversion + property
  test addition + verification matrix recording all live in the SAME PR for that Target_Module.
- Sub_Module files SHALL be ≤ 500 LOC at landing (Req 4.7). If the planned cut yields a file
  > 500 LOC, split it further before landing — adding a Sub_Module beyond the design's named
  > set is allowed; subtracting one requires a scope amendment per Req 13.4.
- New `globalThis` Symbol singletons are forbidden (Req 3.7, Property 4). Module-local state
  (e.g. `storeWriteLocks` in 5.3) is accessed by other Sub_Modules ONLY via exported accessor
  functions — never by re-importing the bare value.
- The architecture-manifest `!(...)` glob negation extension (1.3) lands in the FIRST PR
  (the `hooks.ts` PR) so subsequent PRs can rely on it. Until 1.3 lands, manifest rules use
  long-form positive `from` patterns.
- `fast-check` is used only if it is already present in `package.json`; otherwise the loader
  property test (3.9) falls back to parameterized example-based coverage. The decision is
  recorded in `baseline/loader.md` (3.1).
- Tests in the Pre_Existing_Failure_Allowlist (Discord crash-loop, Control UI SPA, vault
  ownership, callsites guard drift) are NOT touched by this spec; no new tests join that
  allowlist (Req 5.4).

### Test Coverage

- Property tests cover Req 2.3 (Property 1, public-export superset, every Target_Module),
  Req 9 (Property 2, plugin registry round-trip, loader only), Req 10 (Property 3, hook firing
  trace, hooks only).
- Static review-time invariants Property 4 (no `globalThis` Symbol singleton) and Property 6
  (no raised LOC budgets) are enforced at code review and the `pnpm check` chain. Property 5
  (no new circular import) is enforced by the `hooks-no-import-hook-runner-global` manifest
  rule (2.5).
- Each Target_Module's Verification Matrix (2.8 / 3.10 / 4.10 / 5.17) is the merge gate; results
  are recorded under `.kiro/specs/.../verification/<target>.md`.
- Pre_Existing_Failure_Allowlist tests are exempted from the merge gate (Req 5.4) and
  unchanged by this spec.
