# Requirements Document

## Introduction

This spec covers the next phase of the gateway/plugins monolith decomposition. Previous phases reduced
`src/gateway/server.impl.ts` from 1073 → 943 lines and `src/plugins/registry.ts` from 624 → 132 lines, and
introduced two architecture guards (`scripts/check-core-composition-root-loc.ts` and
`scripts/check-architecture-manifest.ts` against `scripts/architecture/manifest.json`).

Four monolith files remain that are too large to refactor without explicit requirements:

1. `src/gateway/platform-auth.ts` — 4439 lines (highest risk: any regression breaks login).
2. `src/gateway/collaboration-learning.ts` — 3019 lines.
3. `src/plugins/loader.ts` — 828 lines.
4. `src/plugins/hooks.ts` — 762 lines.

This is a **pure structural refactor**. No behavioral changes are allowed in login flows, secret
resolution, plugin loading order, hook firing semantics, or collaboration-learning state transitions.
All public exports of the four target modules MUST remain stable across the workspace (downstream
packages and channel plugins import them).

The spec also covers cross-cutting deliverables: per-target regression baselines, new
`scripts/architecture/manifest.json` rules to lock in the new internal boundaries, updates to the
`scripts/check-core-composition-root-loc.ts` budget table, and an optional (P2) per-domain
import-graph snapshot artifact emitter.

A scoping decision is required (see Requirement 1) to choose between three previously offered
options: (a) all four targets in this spec, (b) only `plugins/loader.ts` + `plugins/hooks.ts` here
and defer `platform-auth.ts` to a separate spec, or (c) skip `platform-auth.ts` entirely and rely on
guards to freeze it.

**Scope decision (locked):** **Option A** — all four Target_Modules are in-scope: `src/gateway/platform-auth.ts`,
`src/gateway/collaboration-learning.ts`, `src/plugins/loader.ts`, and `src/plugins/hooks.ts`. No Target_Modules
are deferred. The deferral-LOC-freeze gate in Requirement 1.3 is moot under this choice.

**Architecture_Snapshot decision (locked):** **Out-of-scope** for this spec. Per-domain import-graph
artifacts under `.artifacts/architecture/` are deferred. The deferral rationale and follow-up spec
name are recorded in Requirement 11.

## Glossary

- **Decomposition_Spec**: This spec, covering the four-target monolith decomposition.
- **Target_Module**: One of the four files in scope: `src/gateway/platform-auth.ts`,
  `src/gateway/collaboration-learning.ts`, `src/plugins/loader.ts`, `src/plugins/hooks.ts`.
- **Facade_File**: The original file path of a Target_Module after the split, retained as a thin
  re-export surface so external import paths keep working.
- **Sub_Module**: A new file extracted from a Target_Module, owning a single sub-domain.
- **Public_Export_Surface**: The set of named exports reachable from a Target_Module's original path
  before the refactor, including types, classes, functions, and constants imported by any file
  outside the Target_Module's own directory or by any workspace package outside `src/`.
- **LOC_Budget_Table**: The `BUDGETS` array in `scripts/check-core-composition-root-loc.ts`.
- **Architecture_Manifest**: The file `scripts/architecture/manifest.json` consumed by
  `scripts/check-architecture-manifest.ts`.
- **Architecture_Guard_Script**: Either `scripts/check-core-composition-root-loc.ts` or
  `scripts/check-architecture-manifest.ts`.
- **Regression_Baseline**: A documented set of unit test files and at least one end-to-end test
  file per Target_Module that MUST pass before and after the split.
- **Pre_Existing_Failure_Allowlist**: The four known environmental failures explicitly out of
  scope: the Discord crash-loop counter test, the control-ui static-asset SPA test, the vault
  security ownership check on `/usr/local/bin/node`, and `client-callsites.guard.test.ts` allowlist
  drift.
- **Fallback_Holder_Pattern**: The explicit-DI pattern introduced in the previous phase
  (`FallbackGatewayContextHolder` in `src/gateway/server.impl.ts`); the prohibited alternative is
  any new `globalThis` Symbol singleton.
- **Rollback_Plan**: A documented procedure (revert SHAs, feature-flag toggle, or facade-restore
  steps) that returns a Target_Module to its pre-split behavior without manual code editing.
- **Architecture_Snapshot**: The optional (P2) per-domain import-graph summary artifact emitted to
  `.artifacts/architecture/` by the proposed `pnpm check:architecture:snapshot`.
- **Plugin_Registry_Shape**: The structural type of the `PluginRegistry` produced by the plugin
  loader, including registered resource kinds, their counts, and the identity (id + version) of each
  registered plugin entry.
- **Hook_Firing_Trace**: An ordered record `(hookName, pluginId, phase, payloadHash)` for every hook
  invocation observed during a deterministic test scenario.

## Requirements

### Requirement 1: Decomposition Scope Decision

**User Story:** As a maintainer landing this refactor, I want the in-scope target list to be
explicit, so that this spec's PR can be sized and reviewed without scope-creep arguments.

**Decision:** **Option A — all four Target_Modules in-scope.** Locked at requirements review.

#### Acceptance Criteria

1. THE Decomposition_Spec SHALL operate under Option A (all four Target_Modules in-scope:
   `src/gateway/platform-auth.ts`, `src/gateway/collaboration-learning.ts`, `src/plugins/loader.ts`,
   and `src/plugins/hooks.ts`).
2. THE Decomposition_Spec SHALL list the four in-scope Target_Modules by absolute path in the
   design document and SHALL NOT defer any Target_Module under this scope.
3. THE Decomposition_Spec SHALL not require any deferral LOC-freeze entry, because no
   Target_Module is deferred under Option A; this acceptance criterion is satisfied vacuously.
4. THE Decomposition_Spec SHALL not record any deferral rationale, because no Target_Module is
   deferred under Option A; this acceptance criterion is satisfied vacuously.
5. IF a Target_Module proves infeasible to land within this spec during implementation, THEN THE
   Decomposition_Spec SHALL pause for a scope amendment (per Requirement 13.4) rather than
   silently dropping the Target_Module.

### Requirement 2: Public Export Stability

**User Story:** As a downstream extension or channel plugin author, I want every import I currently
have against the four Target_Modules to keep resolving with the same shape, so that my package does
not need a coordinated release.

#### Acceptance Criteria

1. FOR EACH in-scope Target_Module, THE Decomposition_Spec SHALL preserve the Public_Export_Surface
   at the original file path by retaining a Facade_File at that path that re-exports every name
   present in the Public_Export_Surface before the refactor.
2. FOR EACH in-scope Target_Module, THE Decomposition_Spec SHALL produce a snapshot of the
   pre-refactor Public_Export_Surface (one file listing exported names and their TypeScript types)
   committed under `.kiro/specs/gateway-plugins-monolith-decomposition/baseline/` before any code is
   moved.
3. FOR EACH in-scope Target_Module, the post-refactor Public_Export_Surface SHALL be a superset of
   the pre-refactor snapshot (round-trip property suitable for property-based testing: for any
   exported name `n` present in the pre-refactor snapshot, the post-refactor module SHALL export
   `n` with a structurally compatible TypeScript type).
4. THE Decomposition_Spec SHALL forbid renaming any name in the Public_Export_Surface; renames are
   out of scope and MUST be deferred to a separate spec.
5. IF a Sub_Module needs to expose a new internal-only symbol, THEN THE Decomposition_Spec SHALL
   require that symbol be exported only from the Sub_Module path and not re-exported from the
   Facade_File.

### Requirement 3: Behavioral Equivalence

**User Story:** As an operator running OpenClaw in production, I want this refactor to produce
identical runtime behavior to the pre-refactor code, so that I can land it without coordinating with
end users.

#### Acceptance Criteria

1. WHERE `src/gateway/platform-auth.ts` is in-scope, THE Decomposition_Spec SHALL forbid any change
   to login request handling, password verification, OAuth-style flow ordering, token issuance,
   token refresh, token revocation, email helper output, or rate-limit thresholds and windows.
2. WHERE `src/gateway/collaboration-learning.ts` is in-scope, THE Decomposition_Spec SHALL forbid
   any change to event entry semantics, state machine transitions, evaluation aggregation results,
   or snapshot storage layout.
3. WHERE `src/plugins/loader.ts` is in-scope, FOR ANY plugin set loaded under the pre-refactor
   loader, THE post-refactor loader SHALL produce an identical Plugin_Registry_Shape (round-trip
   property: plugin id set, version per id, and registered resource counts per kind SHALL all
   match).
4. WHERE `src/plugins/loader.ts` is in-scope, THE Decomposition_Spec SHALL preserve the existing
   plugin discovery order and the existing build-time alias setup performed by
   `scripts/copy-plugin-sdk-root-alias.mjs` and the `jiti` alias machinery.
5. WHERE `src/plugins/hooks.ts` is in-scope, FOR ANY deterministic test scenario that produces a
   Hook_Firing_Trace under the pre-refactor hooks module, the post-refactor hooks module SHALL
   produce an equal Hook_Firing_Trace.
6. WHERE `src/plugins/hooks.ts` is in-scope, THE Decomposition_Spec SHALL preserve the relationship
   with `src/plugins/hook-runner-global.ts` such that no new circular import is introduced between
   `src/plugins/hooks*` and `src/plugins/hook-runner-global*`.
7. THE Decomposition_Spec SHALL forbid introducing any new `globalThis` Symbol singleton; new DI
   wiring SHALL follow the Fallback_Holder_Pattern.

### Requirement 4: Per-Target Sub-Module Layout

**User Story:** As a reviewer of the decomposition PRs, I want each Target_Module's split layout to
be predeclared, so that I can review the moves without negotiating boundaries during code review.

#### Acceptance Criteria

1. WHERE `src/gateway/platform-auth.ts` is in-scope, THE Decomposition_Spec SHALL split the file
   into Sub_Modules covering at least the following sub-domains: password login, OAuth-style
   flows, token operations, email helpers, and rate limiting.
2. WHERE `src/gateway/platform-auth.ts` is in-scope, THE Decomposition_Spec SHALL require a
   dependency probe over the file's closure-level state (rate limiters, in-memory caches) to be
   committed under `.kiro/specs/gateway-plugins-monolith-decomposition/baseline/` before the final
   cut lines are chosen, so shared state is not silently duplicated across Sub_Modules.
3. WHERE `src/gateway/collaboration-learning.ts` is in-scope, THE Decomposition_Spec SHALL split
   the file into Sub_Modules covering at least: event entry, state machine, evaluation aggregation,
   and snapshot storage.
4. WHERE `src/gateway/collaboration-learning.ts` is in-scope, THE Decomposition_Spec SHALL verify
   whether any file under `src/gateway/server-methods/` imports `collaboration-learning` internals
   directly; IF such direct imports exist, THEN the Facade_File SHALL be retained at
   `src/gateway/collaboration-learning.ts`.
5. WHERE `src/plugins/loader.ts` is in-scope, THE Decomposition_Spec SHALL split the file into
   Sub_Modules covering at least: discovery, validation, runtime resolve, and load orchestration.
6. WHERE `src/plugins/hooks.ts` is in-scope, THE Decomposition_Spec SHALL split the file into
   Sub_Modules covering at least: runner, context, typed events, and legacy bridge.
7. FOR EACH Sub_Module, THE Decomposition_Spec SHALL require the file to be ≤ 500 LOC at landing.
8. THE Decomposition_Spec SHALL forbid creating Sub_Modules that simply move code into a single new
   file of comparable size; each Target_Module SHALL produce at least three Sub_Modules.

### Requirement 5: Regression Baselines

**User Story:** As the engineer landing each split, I want a documented regression baseline per
Target_Module, so that "tests pass" has a precise meaning.

#### Acceptance Criteria

1. FOR EACH in-scope Target_Module, THE Decomposition_Spec SHALL define a Regression_Baseline that
   names every existing unit test file that exercises the Target_Module and at least one
   end-to-end test file that exercises it (e.g. `*.e2e.test.ts`).
2. FOR EACH in-scope Target_Module, THE Regression_Baseline SHALL be recorded under
   `.kiro/specs/gateway-plugins-monolith-decomposition/baseline/<target>.md` before any code is
   moved.
3. WHEN the split for a Target_Module lands, THE Decomposition_Spec SHALL require every test in
   that Target_Module's Regression_Baseline to pass under `pnpm test` on the post-refactor commit.
4. THE Decomposition_Spec SHALL exempt the Pre_Existing_Failure_Allowlist (Discord crash-loop
   counter test, control-ui static-asset SPA test, vault security ownership check on
   `/usr/local/bin/node`, `client-callsites.guard.test.ts` allowlist drift) from the
   pass-requirement, but SHALL forbid adding any new test to that allowlist as part of this spec.
5. IF a Regression_Baseline test starts failing as a direct result of the refactor, THEN THE
   Decomposition_Spec SHALL require the refactor to be reverted or fixed before merge; bypassing
   via skip/xfail is not permitted.

### Requirement 6: Architecture Manifest Lockdown

**User Story:** As a future contributor, I want the new internal boundaries to be enforced by the
existing architecture guard, so that the freshly split modules cannot regrow into the old monolith.

#### Acceptance Criteria

1. WHEN a Target_Module is split, THE Decomposition_Spec SHALL add at least one new rule to the
   Architecture_Manifest that forbids cross-Sub_Module imports the split is intended to prevent
   (e.g. token-operations Sub_Modules SHALL NOT import the password-login Sub_Module's internals).
2. THE Decomposition_Spec SHALL ensure every new Architecture_Manifest rule has a non-empty
   `description` field naming the Target_Module the rule defends.
3. THE Decomposition_Spec SHALL require `pnpm check` to pass on the post-refactor commit, including
   `scripts/check-architecture-manifest.ts`.
4. THE Decomposition_Spec SHALL forbid adding any path to a rule's `exemptFiles` field as part of
   the landing commit; exemptions, if needed, SHALL be a separate commit with the offending file
   listed by name and a TODO message in the commit body.
5. IF an existing rule's `denyImportsFrom` glob would block a legitimate post-split import, THEN
   THE Decomposition_Spec SHALL require the rule to be tightened to a more specific glob rather
   than weakened.

### Requirement 7: LOC Budget Updates

**User Story:** As a reviewer, I want each Target_Module's Facade_File to land with a tighter LOC
ceiling, so that the gains of the split are locked in by the guard.

#### Acceptance Criteria

1. WHEN a Target_Module is split, THE Decomposition_Spec SHALL add an entry to the LOC_Budget_Table
   for the Facade_File at a `maxLines` value no greater than the Facade_File's actual line count at
   landing.
2. THE Decomposition_Spec SHALL forbid raising any existing entry in the LOC_Budget_Table.
3. FOR EACH new Sub_Module that exceeds 400 LOC at landing, THE Decomposition_Spec SHALL add an
   entry to the LOC_Budget_Table for that Sub_Module at a `maxLines` value no greater than its
   actual line count at landing.
4. THE Decomposition_Spec SHALL require every entry added to the LOC_Budget_Table to include a
   non-empty `why` string naming the architectural rationale (not just the line count).
5. WHEN running `pnpm check`, the LOC_Budget_Table SHALL pass against the post-refactor working
   tree.

### Requirement 8: Per-Target Rollback Plan

**User Story:** As an on-call engineer, I want a documented rollback path for every Target_Module
split, so that I can revert a regression in production without a code archaeology session.

#### Acceptance Criteria

1. FOR EACH in-scope Target_Module, THE Decomposition_Spec SHALL produce a Rollback_Plan recorded
   under `.kiro/specs/gateway-plugins-monolith-decomposition/rollback/<target>.md`.
2. EACH Rollback_Plan SHALL specify: the merge SHA of the split, the revert command, the names of
   any feature flags introduced, the expected runtime impact during rollback, and the verification
   steps to confirm rollback success.
3. WHERE `src/gateway/platform-auth.ts` is in-scope, THE Rollback_Plan SHALL additionally specify
   a same-day revert procedure (under 30 minutes from incident detection to deploy) and the
   on-call signal that should trigger it (e.g. login failure rate threshold).
4. THE Decomposition_Spec SHALL forbid landing a Target_Module's split commit before the
   corresponding Rollback_Plan is committed.
5. IF a Target_Module's split is implemented in multiple commits, THEN EACH commit SHALL be
   independently revertible without leaving the Facade_File in a broken state.

### Requirement 9: Plugin Loader Round-Trip Property

**User Story:** As a developer, I want the plugin loader split to be backed by a property-based
test, so that we can assert behavioral equivalence over many plugin sets, not just the ones in
existing fixtures.

#### Acceptance Criteria

1. WHERE `src/plugins/loader.ts` is in-scope, THE Decomposition_Spec SHALL include a property-based
   test that, for any plugin set drawn from the existing fixture corpus, asserts the
   Plugin_Registry_Shape produced by the post-refactor loader equals the Plugin_Registry_Shape
   produced by a snapshot recorded from the pre-refactor loader.
2. THE property-based test SHALL run with at least 50 generated plugin sets and SHALL pass
   deterministically (no flakes) under `pnpm test` on the post-refactor commit.
3. THE property-based test SHALL be marked as a regression test (not deletable as part of routine
   cleanup) by being listed in the loader Regression_Baseline file.
4. IF generating arbitrary plugin sets is infeasible because the on-disk plugin layout cannot be
   easily mocked, THEN THE Decomposition_Spec SHALL fall back to a parameterized example-based
   test covering at least every shipped first-party plugin and at least three representative
   `extensions/*` plugins, and SHALL document the fallback rationale in the loader
   Regression_Baseline file.
5. THE property-based test SHALL be excluded from any coverage of external services (no AWS, no
   network) so it remains a pure-code property test.

### Requirement 10: Hook Firing Trace Property

**User Story:** As a developer, I want the hooks split to be backed by a property over hook firing
order and payloads, so that subtle re-ordering bugs are caught before merge.

#### Acceptance Criteria

1. WHERE `src/plugins/hooks.ts` is in-scope, THE Decomposition_Spec SHALL include a property-based
   test that, for any deterministic test scenario from the existing hooks unit suite, asserts the
   Hook_Firing_Trace produced by the post-refactor hooks module equals the Hook_Firing_Trace
   produced by a snapshot recorded from the pre-refactor module.
2. THE property-based test SHALL cover registration of legacy-bridge consumers as well as
   typed-event consumers.
3. WHEN the property-based test detects a mismatch, THE test SHALL print the first differing
   `(hookName, pluginId, phase)` triple in its failure message.
4. THE property-based test SHALL be added to the hooks Regression_Baseline file.

### Requirement 11: Architecture Snapshot (Optional, P2)

**User Story:** As a maintainer reviewing future PRs, I want optional per-domain import-graph
summaries committed under `.artifacts/architecture/`, so that drift is visible in PR diffs.

**Decision:** **Out-of-scope** for this spec. Locked at requirements review. Per-domain
import-graph artifacts are deferred to a follow-up spec.

**Deferral rationale:** The existing `scripts/check-architecture-manifest.ts` already enforces the
boundaries this spec adds (per-Target_Module deny rules per Requirement 6). A separate
visualization/snapshot deliverable would meaningfully widen the surface area of the decomposition
PR without adding correctness coverage. The four Target_Modules' refactors carry enough risk on
their own that bundling an advisory P2 tooling change into the same merge gate is unwarranted.

**Follow-up spec:** `architecture-snapshot-tooling` (TBD; to be opened after this decomposition
lands and the new boundaries have stabilized for at least one release cycle).

#### Acceptance Criteria

1. THE Decomposition_Spec SHALL declare the Architecture_Snapshot deliverable explicitly out of
   scope; no `pnpm check:architecture:snapshot` script, no `.artifacts/architecture/` emitter, and
   no domain-summary artifacts SHALL be added to the workspace as part of this spec.
2. THIS acceptance criterion is intentionally left blank because the in-scope path is not taken;
   acceptance criteria 2–4 of the original requirement do not apply under the locked decision.
3. THIS acceptance criterion is intentionally left blank because the in-scope path is not taken.
4. THIS acceptance criterion is intentionally left blank because the in-scope path is not taken.
5. THE Decomposition_Spec SHALL record the deferral rationale (above) and SHALL name the proposed
   follow-up spec (`architecture-snapshot-tooling`, TBD) in the Introduction.

### Requirement 12: Verification Matrix

**User Story:** As the engineer running the pre-merge checks, I want a single matrix of commands
to run per Target_Module, so that the merge gate is unambiguous.

#### Acceptance Criteria

1. FOR EACH in-scope Target_Module, THE Decomposition_Spec SHALL define a Verification_Matrix
   listing: the unit test command (typically scoped `pnpm test <pattern>`), the end-to-end test
   command, the lint/format command (`pnpm check`), and the typecheck command (`pnpm tsgo`).
2. THE Verification_Matrix SHALL include `pnpm build` for any Target_Module that participates in
   build-time alias setup, namely `src/plugins/loader.ts`.
3. THE Verification_Matrix SHALL include a check that no `[INEFFECTIVE_DYNAMIC_IMPORT]` warning is
   emitted by `pnpm build` after any Target_Module's split.
4. THE Verification_Matrix SHALL be recorded under
   `.kiro/specs/gateway-plugins-monolith-decomposition/verification/<target>.md`.
5. WHEN every command in a Target_Module's Verification_Matrix passes, THE Decomposition_Spec
   SHALL consider that Target_Module's split ready to merge, conditional on the Rollback_Plan and
   Architecture_Manifest updates being committed.

### Requirement 13: Out-of-Scope Boundaries

**User Story:** As a reviewer, I want the spec's exclusions to be explicit, so that follow-up work
is not accidentally bundled into this PR.

#### Acceptance Criteria

1. THE Decomposition_Spec SHALL declare the following items out of scope: behavioral changes
   (logic, ordering, thresholds, error messages), public-export renames, dependency upgrades,
   docs-only edits unrelated to the refactor, and changes to the Pre_Existing_Failure_Allowlist
   tests.
2. THE Decomposition_Spec SHALL declare the following Target_Modules' deferrals (if any), naming
   the follow-up spec or "TBD" per Requirement 1.
3. THE Decomposition_Spec SHALL forbid raising any existing LOC budget, opening any new exempt
   path in the Architecture_Manifest, or weakening any existing `denyImportsFrom` glob.
4. IF a follow-up need is discovered during implementation (e.g. a Target_Module's closure state
   cannot be cleanly split), THEN THE Decomposition_Spec SHALL require recording the discovery in
   the spec's design document and either narrowing the in-scope set or pausing for a scope
   amendment, rather than expanding silently.
