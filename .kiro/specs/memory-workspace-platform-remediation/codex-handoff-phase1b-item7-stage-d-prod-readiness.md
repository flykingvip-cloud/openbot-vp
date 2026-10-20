# Item 7 Stage D — Production-Readiness Assessment (shadow / evidence-only) (handoff)

- Task: `kiro-data-governance-phase1b-item7-stage-d-prod-readiness`
- Agent / owner: `kiro-data-governance` (IDE: kiro)
- Branch: `kiro-data-governance/item7-stage-d-persistent-sync-prod-readiness`
- Worktree: `/Users/daniel/AI项目/openbot-item7-stage-d-prod-readiness`
- originMainSha (fork point): `278958330cd0a8036c0751eff9972bd049b989d4`
- Review requested: **Item 7 Stage D Production-Readiness Assessment (shadow/evidence-only) Review only**

## Why this exists

The Stage D shadow stack is already landed: the controlled `syncMemoryAssets`
command (#689), the CR1 non-local fail-closed + resource-bound idempotency
(#705), and the persistent O_EXCL/CAS fencing + recovery store, the local-only
staging->verify->atomic-publish adapter, and the dark shadow/canary (#721). What
was missing is an honest, auditable way to answer "are the three S33/S34/S35
sync sites ready to cut over, and if not, exactly what still blocks it?" — the
input Phase E needs before any real switch.

This CR adds **one** new read-only file, `src/memory/item7-stage-d-readiness.ts`,
a pure aggregator. It composes the already-landed pieces; it changes **no**
production behavior. It never retires S33/S34/S35, never edits
`manager-sync-ops.ts` (owned by `cursor-memory-wsc`) or
`item7-stage-d-memory-sync.ts`, never touches the canonical scan
(`retiredThisChange=0`, `remaining=10`, `liveWriteWatchIndex=10`, Item 7
`not-met`), never switches production, and never enables cloud/BYOS.

## What changed (all new)

- `src/memory/item7-stage-d-readiness.ts` — the readiness evaluator + report
  writer.
- `src/memory/item7-stage-d-readiness.test.ts` — 13 vitest tests.
- Evidence: `docs/design/evidence/memory-workspace-phase1b-item7-stage-d-prod-readiness.json`
  (+ `.test.mjs`, 7 node --test guards).

## The evaluator

`evaluateStageDProductionReadiness({ gates, canaryReceipts?, now? })` returns a
`StageDReadinessReport`:

- **Per point (S33/S34/S35)** — metadata is sourced from `STAGE_D_SITES`
  (ledgerId, D1/D2/D3, file, `syncMemoryFiles`, business phase, operationAuth,
  rollback), never fabricated. Each point carries:
  - `shadowSignal`: `match` | `mismatch` | `not-executed` | `not-exercised`
    (derived from the dark canary's `StageDCanaryReceipt` for that point; a point
    with no receipt is `not-exercised` — the production default — and is never
    ready).
  - `shadowReady`: true only when `shadowSignal === "match"`.
  - `pendingGates`: the still-open Phase E gates.
  - `verdict`: `shadow-not-ready` | `shadow-ready-pending-cutover` |
    `cutover-eligible`.
- **Phase E gates** (all must hold before any cutover; all open today):
  1. `phase1b_unlock_issued`
  2. `live_write_watch_index_zero`
  3. `site_owner_coordination` — `manager-sync-ops.ts` owner (`cursor-memory-wsc`)
     sign-off
  4. `site_retired_from_scan`
  5. `operator_cutover_authorization`
- **`cutoverAuthorized`** is **computed** (never hard-coded true): true only if
  every point is shadow-ready **and** every Phase E gate holds. In the current
  phase it is `false`. Even when it computes true, the evaluator performs **no**
  cutover — it only reports eligibility.
- The report type pins `productionWrite: "legacy-only"`,
  `stageDControlledWrite: "shadow-only"`, and `cloudSyncEnabled/byosEnabled:
false` as **literals**, so the assessment cannot express a production switch.

`writeStageDReadinessReport` persists a report durably under the governed
`resolveStateDir()/data-governance/stage-d-sync/readiness` root only (never a
production Catalog, never a caller-supplied path).

## Honest verdict logic (proven both ways)

- No canary receipts (production default) => every point `not-exercised` =>
  `shadow-not-ready`; `remainingBlockers` = all five gates; `cutoverAuthorized =
false`.
- Dark canary identity `match` for all three + gates still open =>
  `shadow-ready-pending-cutover`; `cutoverAuthorized = false`.
- Shadow `mismatch`, or a denied (cross-tenant / non-local) canary =>
  `shadow-not-ready`.
- All shadows `match` **and** all gates satisfied (hypothetical; not the current
  state) => `cutover-eligible`, `cutoverAuthorized = true` — proving the logic is
  honest in both directions without this module ever performing a cutover.

## Verification

- `pnpm tsgo`: 0 errors in the new files (pre-existing unrelated errors are the
  unbuilt-collab-package artifact in a fresh worktree, not introduced here).
- `pnpm exec oxlint` new files: 0 warnings / 0 errors. `oxfmt --check`: clean.
- No dynamic imports added (static-import-only leaf module) => no
  `[INEFFECTIVE_DYNAMIC_IMPORT]`.
- vitest: `item7-stage-d-readiness.test.ts` 13 passed; full Stage D regression
  (`src/memory/item7-stage-d*`) 100 passed (memory-sync 51, adapter 8, canary 9,
  persistent-store 16, readiness 13, crossproc 3).
- Trusted freeze: `ok=true`, `addedProductionCallSites=[]`,
  `addedProductionHelpers=[]`, `addedCatalogSynthesis=[]`, `trusted=true`.
- Canonical retirement scan: **byte-identical** to origin/main (untouched);
  `remaining=10`, `liveWriteWatchIndex=10`; the three `manager-sync-ops.ts`
  `syncMemoryFiles` sites (1062/1252/1343) still present.
- Evidence `node --test`: 7 guards (fail-closed fields, assessment-only,
  Phase E gates, retires-nothing consistency, no-contradiction vs scan/unlock,
  artifacts exist, must-not-change files unchanged).

## Governance posture (unchanged by this change)

`item7 = not-met`, `retiredThisChange = 0`, `remaining = 10`,
`liveWriteWatchIndex = 10`, `canonicalLedgerUpdated = false`,
`productionSwitch = false`, `productionWrite = legacy-only`,
`stageDControlledWrite = shadow-only`, `cutoverAuthorized = false`,
`phase1bExecutionBlocked = true`, `phase1bUnlock = not-issued`,
`deployAuthorized = false`, `live = forbidden`, `productionCatalogWrite = none`,
`schemaV2ProductionWrite = false`, `cloudSyncEnabled = false`,
`byosEnabled = false`.

## Attribution + tree

- Loom: task `kiro-data-governance-phase1b-item7-stage-d-prod-readiness`, owner
  `kiro-data-governance`, paths scoped to the new evaluator + its test + this
  evidence JSON/test.mjs + this handoff. Commits carry `Task:` / `Agent:`
  trailers.
- Isolated worktree off fresh origin/main; no other agent's uncommitted WIP is
  touched. `manager-sync-ops.ts` (cursor-memory-wsc) and the landed Stage D
  runtime are **not** edited — the evaluator is a new leaf that imports them
  type-only / read-only.

## Not requested / not claimed

Not requesting: retirement of S33/S34/S35, a canonical count update, a Stage D
accepted baseline, Item 7 met, the Phase 1B unlock, LIVE / production cutover,
cloud/BYOS, or any edit to `manager-sync-ops.ts`. **Production-readiness
assessment (shadow/evidence-only) review only.** The real S33/S34/S35 cutover is
Phase E, gated on owner coordination + unlock + `liveWriteWatchIndex=0` +
explicit operator authorization.
