# Item 7 Stage D — Memory Sync Technical Slice (handoff)

- Task: `kiro-data-governance-phase1b-item7-stage-d-memory-sync`
- Agent / owner: `kiro-data-governance` (IDE: kiro)
- Branch: `kiro-data-governance/item7-stage-d-memory-sync`
- Worktree: `/Users/daniel/AI项目/openbot-item7-stage-d-memory-sync`
- originMainSha: `f647ae71f46a249578843049f4d2b4febdf109c1` (initial slice, landed as #689)
- implementationSha: see PR head
- reviewTipSha: see PR head
- Review requested: **Item 7 Stage D Technical Slice CR1 Review**

## CR1 (Changes Required, round 1)

The initial slice landed to `main` (#689) but was NOT accepted. Two P1 issues are
fixed here; the three production call sites remain un-retired and the canonical
canonical baseline moved 12->10 during CR1 (two non-P8 sites retired by other
landed Item 7 work); this slice changes it by nothing (`retiredThisChange=0`,
`remaining=10` mirroring the current scan, Item 7 `not-met`). The three P8
`syncMemoryFiles` sites remain listed in the scan.

- **P1-1 — non-local sync could execute and was mislabeled local-only.** Removed
  the `cloudSyncApproved` / `byosApproved` escape hatch entirely. Every
  non-local-only destination (`encrypted-cloud`, `tenant-cloud`, `dedicated`,
  `byos`, `cold-archive`) is now **unconditionally** fail-closed before any
  adapter is consulted, so a non-local copy can never execute. The success result
  inherits `destinationMode` from the plan (only `local-only` can ever reach
  success), so a `synced` receipt can never falsely claim `local-only`. Cloud/BYOS
  sync (its receipt shape + adapter contract) must be redesigned in a dedicated
  future stage.
- **P1-2 — operationId idempotency was not resource-bound.** The completion record
  is now structured (`operationId` + `tenantId` + `sourceResourceId` +
  `destinationMode` + `manifestSha256` + `classification`). A reused `operationId`
  replays **only** when every field matches; any divergence (different tenant /
  resource / manifest / classification) returns `operation_id_conflict` — never a
  cross-resource replay.
- **Persistence caveat.** The default in-memory fencing store and recovery sink are
  valid **only** for this dark slice (no real production copy). Before any real
  sync is enabled, both must be replaced with persistent, cross-process stores so
  idempotency, single-flight, and recovery breadcrumbs survive restarts and hold
  across workers.

New/added tests: cloud/BYOS rejected even with a supporting adapter injected (and
`copy` is never called); same `operationId` across a different
tenant/resource/manifest/classification returns `operation_id_conflict`; only a
fully-identical operation replays; `sameStageDCompletion` over all six fields; a
`synced` receipt is genuinely `local-only`, and no non-local destination ever
yields a synced/local-only receipt.

## Scope

Refactor the three high-risk `syncMemoryFiles` sync call-sites in
`src/memory/manager-sync-ops.ts` (ledger S33/S34/S35, canonical-scan lines
1062/1252/1343, `pathId: P8`, `op: index`) onto a controlled sync command,
and prove the controlled semantics — while keeping production **legacy-only**
and **fail-closed** (Item 7 is a dark identity-proof wave, not a cutover).

Out of scope (untouched): Stage B, Stage C's five locators, the canonical
retirement scan, other memory migrations, cloud placement / BYOS expansion.

## What changed

- New controlled command + shadow: `src/memory/item7-stage-d-memory-sync.ts`.
- Tests: `src/memory/item7-stage-d-memory-sync.test.ts` (39 cases).
- Wiring: the three sites now dynamic-import the Stage D shadow instead of the
  W5 index shadow directly; the W5 index identity proof is preserved inside the
  Stage D shadow (it still calls `proveItem7W5IndexIdentity` /
  `scheduleItem7W5IndexShadow`). The comma-operator shape (`this.dirty = (…, false)`)
  and the legacy `await this.syncMemoryFiles(...)` production call are unchanged.
- Evidence: `docs/design/evidence/memory-workspace-phase1b-item7-stage-d-memory-sync-proposal.json` (+ `.test.mjs`).

The command is **hermetic**: it imports only `node:crypto` and the
self-contained handle/tombstone/W5 modules at runtime; the governance
placement/classification/receipt types are type-only (erased). The
authorize-before-resolve producer `resolveMemoryWorkspaceHandle` is **injected**
as a closure, never statically imported — the low-level memory manager stays
decoupled from the gateway/data-governance graph (this is also why W5 left
`handleResourceId: null`). The resolver is exercised via injected fakes in tests.

## The three sites are NOT identical (per-point semantics)

| Point | Ledger          | Enclosing fn                               | Business phase                                                               | Trigger                                                       | Authorization                                                   | Rollback posture                                                 |
| ----- | --------------- | ------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------- |
| D1    | S33 (line 1062) | `runSync` incremental (`shouldSyncMemory`) | admission-import (steady-state ingest of new/changed memory files)           | dirty/force/needsFullReindex during a normal sync             | V1 root-guard op `sync` (`assertV1OperationAuthorized("sync")`) | convergent retry (per-file hash compare; no explicit snapshot)   |
| D2    | S34 (line 1252) | `runSafeReindexInternal`                   | rebuild-reindex-safe (full reindex into a temp DB, atomic swap)              | full reindex required (meta/model/source change)              | V1 root-guard op `rebuild`                                      | atomic temp-db swap + `restoreOriginalState()` on error (strong) |
| D3    | S35 (line 1343) | `runUnsafeReindexInternal`                 | rebuild-reindex-unsafe / in-place (reset + reindex, no swap; test-fast path) | full reindex under `OPENCLAW_TEST_FAST` + unsafe-reindex flag | V1 root-guard op `rebuild`                                      | in-place `resetIndex()` (weaker; no atomic swap)                 |

For each point the controlled command / shadow proves: **who triggers** (above),
**what authorization** (V1 op + authorize-before-resolve tenant/actor/grant),
**source/destination** (below), **success receipt**, **retry/rollback** (idempotent
replay + halt-on-failure), and **revoke/tombstone** behavior (refuse retired source).

## Semantic audit (source / destination / policy)

- **Source**: the agent's local memory workspace files (`this.workspaceDir` +
  `settings.extraPaths`, listed by `listMemoryFiles`). Owned by the agent/user
  (personal) or, in governed mode, by the tenant via the Memory Asset canonical
  binding in the Data Governance Catalog.
- **Destination**: the **local** SQLite search index (`files`, `chunks`,
  `chunks_vec`, `chunks_fts`). This is local file → local index materialization
  under the **device** custodian. There is **no real cloud/BYOS destination**
  wired at these sites today.
- **Tenant / resourceId binding**: not bound at the sites (the local manager only
  has `agentId` / `workspaceDir`). Governance identity is resolved read-only via
  `resolveMemoryWorkspaceHandle`; on catalog miss (personal / no tenant) it denies,
  so `handleResourceId` stays `null` and the index identity proof is `miss` /
  quarantined — the safe fail-closed default.
- **Sync / placement policy**: comes from `resolvePlacement` +
  `PlacementPolicy.allowedCustodians` (device | openbot | tenant | byos). The
  command maps a placement `mode` → required custodian and refuses any custodian
  the policy does not allow.
- **Classification**: `DataClassification` (default `confidential`). `restricted`
  may only be `local-only`; every off-device mode is refused.
- **local-only vs encrypted-cloud vs tenant-cloud**: distinguished by
  `PlacementResolverOutput.mode`. Only `local-only` can execute (with an injected
  local adapter, in tests). Cloud / tenant-cloud / dedicated / cold-archive → fail
  closed (`cloud_sync_not_approved`); byos → `byos_not_approved`.
- **Real cloud/BYOS connectivity today**: **none**. This is exactly why Stage D
  uses a fail-closed cloud/BYOS adapter stub and does not enable any production /
  cloud / BYOS sync. No Semantic Gate escalation is required because Stage D does
  not attempt to enable an unapproved capability — it stays fail-closed.

## Controlled command (`syncMemoryAssets`) — semantics proven

1. authorize-before-resolve: tenant + actor + grant validated first.
2. source is a branded `MemoryWorkspaceHandle` (a raw path / non-branded object is refused).
3. destination decided by placement mode + `syncPolicy.allowedCustodians` (no arbitrary path arg).
4. receipt carries `tenantId` + `sourceResourceId` + `memoryAssetResourceId` + `classification`.
5. `operationId` idempotency is resource-bound (`operationId` + `tenantId` + `sourceResourceId` + `destinationMode` + `manifestSha256` + `classification`): an identical op replays (`idempotent-replay`, no re-copy); any field divergence returns `operation_id_conflict` (never a cross-resource replay).
6. exclusive per-resource fencing: concurrent (`concurrent_fencing_conflict`) and stale token (`stale_fencing_token`) are refused.
7. manifest + sha256 computed **before** copy, verified **after** copy.
8. partial failure and hash mismatch → `recovery-required` + halt (`GovernanceRecoveryReceipt.haltCompensation = true`); no double-write.
9. no host-path fallback (`sideEffects.hostPathFallback` always false).
10. tombstone / revoke propagation: a tombstoned/revoked source, or a retired/purged handle lifecycle, is refused.
11. legal hold forbids physical delete; sync never deletes (`sideEffects.deleted` always false).
12. every non-local-only destination (encrypted-cloud/tenant-cloud/dedicated/byos/cold-archive) is UNCONDITIONALLY fail-closed with no approval escape hatch; only `local-only` can plan or sync, and the success receipt inherits `local-only` from the plan (never fabricated). The default in-memory fencing + recovery sink are dark-slice-only and must become persistent, cross-process stores before any real sync.
13. never fabricates a `synced` status — `synced` requires an adapter-confirmed copy AND a verified hash.
14. every reject path is side-effect free: `copied/uploaded/deleted/catalogWrite/hostPathFallback` all false.

## Fail-closed / rollback / quarantine / recovery proofs

- rollbackProof: reject and fail paths halt without side effects; a completed op
  is replayed rather than re-executed.
- quarantineProof: on catalog miss the index identity proof is `miss` +
  `quarantine: true`, and `indexSwitch.allow = false` (`keep-legacy-index`).
- recoveryRequiredProof: partial copy failure and post-copy hash mismatch both
  return `recovery-required` with a halting recovery receipt.

All three are covered by `src/memory/item7-stage-d-memory-sync.test.ts`.

## Counts (proposal, not canonical)

- observedAcceptedBaseline = 10 (mirrors the canonical scan `remaining`; moved 12->10 during CR1 as other Item 7 work retired two non-P8 sites, not this slice).
- siteCount = 3, proposedRetiredThisSlice = 3, projectedRemainingIfAppliedDirectly = 7 (10 − 3).
- `projectedRemainingIfAppliedDirectly` is **not** an accepted baseline; the
  integration owner recomputes the accepted count from the real Stage B/C/D accept order.
- canonicalLedgerUpdated = false, canonicalCountClaimed = false. The canonical
  retirement scan (`memory-workspace-phase1b-item7-retirement-scan.json`) is unchanged.

## Governance posture (unchanged by this slice)

`item7 = not-met`, `phase1bExecutionBlocked = true`, `phase1bUnlock = not-issued`,
`deployAuthorized = false`, `live = forbidden`, `productionCatalogWrite = none`,
`schemaV2ProductionWrite = false`, `cloudSyncEnabled = false`, `byosEnabled = false`,
`stageBDependencyState = blocked`, production write stays `legacy-only`,
`indexSwitch = denied`.

## Tests + attribution

- `src/memory/item7-stage-d-memory-sync.test.ts` — 39 cases (authorize/deny,
  fail-closed cloud/BYOS, adapter/idempotency/fencing, copy integrity + recovery,
  tombstone/revoke/legal-hold, reject-path zero side effects, manifest hashing,
  three distinct sites, dark shadow env-gating, aggregate).
- `docs/design/evidence/memory-workspace-phase1b-item7-stage-d-memory-sync-proposal.test.mjs`
  — asserts the proposal fields, internal arithmetic, alignment with the
  (unmodified) canonical scan + unlock decision, and a git-diff check that the
  canonical scan / preflight gate / schema-v2 / W5 files are untouched.
- Loom: task `kiro-data-governance-phase1b-item7-stage-d-memory-sync`, owner
  `kiro-data-governance`, session `1FAE481D-C877-4FB5-A5E6-EA48B1EB54D2`, paths
  scoped to the six Stage D files. `manager-sync-ops.ts` is a shared hot file also
  claimed by the W5 wave (which introduced the S33/S34/S35 lines, now landed on
  origin/main) and by `cursor-memory-wsc` (v1-root-guard concern); Stage D only
  edits the three shadow lines it builds on, in an isolated worktree, so there is
  no cross-agent uncommitted WIP.

## Not requested / not claimed

Not requesting: canonical count update, a Stage D accepted baseline, Item 7 met,
Phase 1B unlock, LIVE, or cloud/BYOS/production deployment. Technical slice review only.
