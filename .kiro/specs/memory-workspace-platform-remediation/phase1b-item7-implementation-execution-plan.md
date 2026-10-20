# Phase 1B Item 7 Implementation Execution Plan

**Status:** plan only. This file does not start Item 7 implementation and does not execute Item 7 Retirement.

| Field                     | Value                                         |
| ------------------------- | --------------------------------------------- |
| item                      | 7                                             |
| requestedScope            | item6-item7-implementation-only (Item 7 half) |
| implementationUnlock      | not-issued in the parent decision packet      |
| item7Met                  | false                                         |
| item7Retirement           | forbidden                                     |
| phase1bExecutionBlocked   | true                                          |
| deployAuthorized          | false                                         |
| wiredToProductionResolver | false                                         |
| liveCutover               | false                                         |
| liveWriteWatchIndex       | 37                                            |
| frozenWriteWatchIndex     | 38                                            |
| productionWriteWatchIndex | 37                                            |
| retiredThisChange         | 0                                             |

This plan is bound to:

- minima receipt tip `ce6cf5e1702c7f2de20b58f062fd100562b6ee01`
- Item 7 implementation-review package tip `daa00a3d7006f2b7023f2540f276bc831f538317`
- Item 7 implementation-review handoff `.kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-item7-implementation-review.md`
- Item 5 final closeout binding `85f55ee2fa76f88dc538180b481a5823631af649`
- baselineSha `e0d5c3750166692bbcdd324854ee65e4a358a9f1`
- item7OperationId `phase1b-item7-implementation-unlock-decision-e0d5c37501-20260821T164501Z`
- cited ledger `docs/design/evidence/memory-workspace-phase1b-item7-callsite-ledger.json`
- cited replacement plan `docs/design/evidence/memory-workspace-phase1b-item7-replacement-plan.json`

If the independent unlock decision is later issued, Item 7 still executes, submits, and accepts on its own branch/PR. It must not be merged with Item 6 into one production implementation.

## Allowed after a later independent issue

- implement Retirement guard, tombstone/quarantine, and receipt
- execute dry-run in an isolated environment
- prepare rollbackable changes for each retirement wave
- submit a separate Item 7 implementation PR

That allowance is not production deploy and is not Item 7 Retirement execute. `deployAuthorized=true` stays forbidden. Deleting any productionWriteWatchIndex call-site stays forbidden until a later independent Retirement review.

## 37 live call-sites → wave map

Live scan / remaining = 37. Frozen ledger rows = 38. Do not rewrite Freeze 38 to 37 or 0.

Coordinates come from `docs/design/evidence/memory-workspace-phase1b-item7-replacement-plan.json`. This table is the wave mapping, not a rewrite of Freeze.

### W2-write-callers (16)

| ledgerId | file                                          | line | symbol                              |
| -------- | --------------------------------------------- | ---- | ----------------------------------- |
| S02      | `src/auto-reply/reply/get-reply.ts`           | 165  | `resolveAgentWorkspaceDir`          |
| S03      | `src/commands/agent.ts`                       | 776  | `resolveAgentWorkspaceDirForClient` |
| S04      | `src/commands/status-all/agents.ts`           | 25   | `resolveAgentWorkspaceDir`          |
| S05      | `src/gateway/checkpoint-store.ts`             | 119  | `resolveAgentWorkspaceDir`          |
| S07      | `src/gateway/checkpoint-store.ts`             | 158  | `resolveAgentWorkspaceDirForClient` |
| S10      | `src/gateway/server-methods/agents.ts`        | 142  | `resolveAgentWorkspaceDirForClient` |
| S11      | `src/gateway/server-methods/agents.ts`        | 146  | `resolveAgentWorkspaceDir`          |
| S12      | `src/gateway/server-methods/agents.ts`        | 1001 | `resolveAgentWorkspaceDir`          |
| S13      | `src/gateway/server-methods/agents.ts`        | 1075 | `resolveAgentWorkspaceDir`          |
| S14      | `src/gateway/server-methods/agents.ts`        | 1159 | `resolveAgentWorkspaceDirForClient` |
| S15      | `src/gateway/server-methods/agents.ts`        | 1160 | `resolveAgentWorkspaceDir`          |
| S16      | `src/gateway/server-methods/chat.ts`          | 1818 | `resolveAgentWorkspaceDirForClient` |
| S18      | `src/gateway/server-methods/skills.ts`        | 86   | `resolveAgentWorkspaceDirForClient` |
| S19      | `src/gateway/server-methods/skills.ts`        | 137  | `resolveAgentWorkspaceDirForClient` |
| S20      | `src/gateway/server-methods/tools-catalog.ts` | 152  | `resolveAgentWorkspaceDirForClient` |
| S29      | `src/gateway/workspace/handler-bridge.ts`     | 592  | `resolveAgentWorkspaceDirForClient` |

### W3-catalog-synthesis (7)

| ledgerId | file                                                                         | line | symbol                                |
| -------- | ---------------------------------------------------------------------------- | ---- | ------------------------------------- |
| S08      | `src/gateway/knowledge/deliverables/maybe-auto-capture-agent-deliverable.ts` | 86   | `createEmptyWorkspaceCatalog`         |
| S09      | `src/gateway/knowledge/knowledge-document-preview.ts`                        | 178  | `createEmptyWorkspaceCatalog`         |
| S17      | `src/gateway/server-methods/group-workspace-file.ts`                         | 460  | `createEmptyWorkspaceCatalog`         |
| S21      | `src/gateway/workspace-resolver/builders.ts`                                 | 105  | `buildUserOwnedWorkspaceCatalogEntry` |
| S22      | `src/gateway/workspace-resolver/steward-read.ts`                             | 104  | `buildUserOwnedWorkspaceCatalogEntry` |
| S23      | `src/gateway/workspace-resolver/steward-write.ts`                            | 99   | `createEmptyWorkspaceCatalog`         |
| S28      | `src/gateway/workspace-resolver/tool-cwd.ts`                                 | 52   | `buildUserOwnedWorkspaceCatalogEntry` |

Replacement family: `WorkspaceResourceCatalog.getResource`. Dual-write into production Catalog is forbidden. Catalog miss=deny is forbidden.

### W4-steward-and-helpers (6)

| ledgerId | file                                              | line | symbol                                      |
| -------- | ------------------------------------------------- | ---- | ------------------------------------------- |
| S01      | `src/auto-reply/reply/get-reply.ts`               | 164  | `resolveEmployeeBuiltinStewardWorkspaceDir` |
| S06      | `src/gateway/checkpoint-store.ts`                 | 127  | `resolveEmployeeBuiltinStewardWorkspaceDir` |
| S24      | `src/gateway/workspace-resolver/steward-write.ts` | 152  | `resolveEmployeeStewardSourceWorkspaceDir`  |
| S25      | `src/gateway/workspace-resolver/steward-write.ts` | 153  | `resolveEmployeeStewardTargetWorkspaceDir`  |
| S26      | `src/gateway/workspace-resolver/steward-write.ts` | 279  | `resolveEmployeeStewardSourceWorkspaceDir`  |
| S27      | `src/gateway/workspace-resolver/steward-write.ts` | 280  | `resolveEmployeeStewardTargetWorkspaceDir`  |

Depends on W2 and W3. Replacement: steward Catalog identity `(tenantId, userId, agentAssetId=steward:builtin)`. No implicit directory create.

### W5-index-last (8)

| ledgerId | file                               | line | symbol                     |
| -------- | ---------------------------------- | ---- | -------------------------- |
| S30      | `src/memory/backend-config.ts`     | 417  | `resolveAgentWorkspaceDir` |
| S31      | `src/memory/backend-config.ts`     | 444  | `resolveAgentWorkspaceDir` |
| S32      | `src/memory/cogniweave-manager.ts` | 554  | `resolveAgentWorkspaceDir` |
| S33      | `src/memory/manager-sync-ops.ts`   | 1062 | `syncMemoryFiles`          |
| S34      | `src/memory/manager-sync-ops.ts`   | 1252 | `syncMemoryFiles`          |
| S35      | `src/memory/manager-sync-ops.ts`   | 1343 | `syncMemoryFiles`          |
| S36      | `src/memory/manager.ts`            | 152  | `resolveAgentWorkspaceDir` |
| S37      | `src/memory/qmd-manager.ts`        | 196  | `resolveAgentWorkspaceDir` |

Depends on W2–W4. Index rewrite is not production Catalog write and is not LIVE cutover.

## 38 frozen ledger rows vs live=37

| Count                      | Meaning                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| frozenWriteWatchIndex = 38 | Phase 0 freeze `docs/design/evidence/memory-workspace-phase0-20260814.call-sites.json`                                                                        |
| liveWriteWatchIndex = 37   | live scan remaining old-write sites                                                                                                                           |
| extra freeze/ledger row    | `src/gateway/workspace-resolver/tool-cwd.ts:51` `createEmptyWorkspaceCatalog` — present in ledger, absent from live scan. Already gone from live write index. |

Do not rewrite Freeze 38 to 37. Do not rewrite liveWriteWatchIndex 37 to 0 without deleting sites. Do not score Item 7 met while live index is non-zero.

## W0–W5 order

| Wave | Purpose                                   | Deletes call-sites? | Production write?                                                 |
| ---- | ----------------------------------------- | ------------------- | ----------------------------------------------------------------- |
| W0   | guard, dual-read env, receipt scaffolding | no                  | no                                                                |
| W1   | dark tombstone / quarantine markers       | no                  | no; replacement new writes = tombstone-quarantine only            |
| W2   | write-caller shadow                       | no                  | dual-write forbidden; legacy write remains until later Retirement |
| W3   | catalog synthesis shadow                  | no                  | production Catalog new write forbidden                            |
| W4   | steward helper shadow                     | no                  | no implicit dir create                                            |
| W5   | index/dir shadow last                     | no                  | no                                                                |

Dual-write is forbidden at every wave. Shadow/dark dual-read is not a second production writer.

## Tombstone / quarantine

- Tombstone: dark marker only. `enabled` for production delete = false until independent Retirement review.
- Quarantine: unknown conflict is residual, not normal. `quarantineNormalWrites=0`. Do not rewrite into normal Catalog.
- Receipt: per-wave implementation receipt may record shadow/dry-run. It must not set `item7Met=true` and must not set `retirement=executed`.

## Dual-write prohibition

- No second production writer beside the freeze-watched call-site.
- No production Catalog new write.
- No schema v2 production write.
- No `wiredToProductionResolver=true`.
- Catalog miss=deny is forbidden.
- Shadow read may observe; it may not duplicate production writes.

## Per-wave delete preconditions

Deleting any productionWriteWatchIndex call-site is forbidden in this plan and remains forbidden even after later implementation unlock. A later independent Item 7 Retirement review is required first. When that later review exists, each wave still needs:

1. prior waves' replacement proven in isolated dry-run
2. tombstone present and reversible
3. quarantine residual-only
4. rollback receipt for that wave
5. liveWriteWatchIndex still counted from remaining real sites (no rewrite-to-zero)
6. `deployAuthorized=false`, `liveCutover=false`

This packet does not satisfy those preconditions.

## Rollback / revoke

- restoreFromGit for any isolated-branch implementation
- liftTombstone
- rewriteFreezeBaselineToZero = false
- restoreDeletedCallSites = not-applicable-none-deleted
- productionWriteBack = forbidden
- revoke means: implementation unlock (if later issued) does not authorize Retirement; a separate revoke/retirement-block remains in force

Stop immediately on: attempted call-site delete, rewrite of liveWriteWatchIndex 37 to 0, Item 7 Retirement execute, `wiredToProductionResolver=true`, Catalog miss=deny, schema v2 production write, production Catalog new write, production SQLite write, `deployAuthorized=true`, LIVE cutover, cross-tenant migration, BYOS / tenant-cloud / cold archive, marking tests as Item 6/7 met, editing PR #538 / #542 / #544 or frozen evidence, editing the canonical full unlock receipt.

## Post-delete machine-checkable gate (future Retirement only)

Not authorized now. When a later Retirement review allows deletion, the gate is:

```
node --import tsx docs/design/evidence/memory-workspace-phase0-inventory.mjs \
  --mode freeze \
  --baseline-blob 583c1fc0c93da386289a276b77884d24255440c4 \
  --baseline docs/design/evidence/memory-workspace-phase0-20260814.call-sites.json
```

Freeze baseline stays 38 until remaining is actually 0 and an independent Retirement review accepts a new freeze. This plan does not change that blob.

## How to prove `productionWriteWatchIndex=0`

Item 7 met requires liveWriteWatchIndexMustBe=0 **after actual remaining old-write sites are gone**, plus independent Retirement review, rollback proof, and quarantine proof.

Proof method (future, not this packet):

1. Re-run the live scan (`memory-workspace-phase1b-item7-retirement-scan.mjs`) against HEAD.
2. Require measured `liveWriteWatchIndex === 0` and `retiredThisChange` matching real deletions.
3. Require freeze inventory still machine-checkable; do not rewrite Freeze 38 to 0 in place.
4. Independent Retirement review packet, not this unlock decision, marks remaining=0.
5. Implementation test green does not mark Item 7 met.

Until then: liveWriteWatchIndex stays 37, Item 7 Retirement stays forbidden, Item 7 met stays false.

## Forbidden even after later approval

- wiredToProductionResolver=true
- Catalog miss=deny
- schema v2 production write
- production Catalog new write
- production SQLite write
- deleting any productionWriteWatchIndex call-site
- Item 7 Retirement execute
- LIVE cutover
- deployAuthorized=true
- cross-tenant migration
- BYOS / tenant-cloud / cold archive
- marking implementation test results as Item 6/7 met
- modifying PR #538, #542, or #544 or frozen evidence
- modifying the canonical full unlock receipt

## Review trail

- cursor-data-governance · 2026-08-22 · Item 7 retirement batch 4 S08 on `origin/main` `7cd74d4c5c69e7492eb6d624531f27592d6c809a`: one live site (`createEmptyWorkspaceCatalog` in maybe-auto-capture) replaced by fail-closed `resolveWorkspaceLocator`; remaining/liveWriteWatchIndex=32; item7 **not-met**; phase1bUnlock **not-issued**. — `codex-handoff-phase1b-item7-retirement-batch4-s08.md`
- cursor-data-governance · 2026-08-23 · Item 7 retirement batch 9 S29 on `origin/main` `da8cccb3f3faadb1960118c53c1223a1a0fb9de0` after #612 S08: one live site (`resolveAgentWorkspaceDirForClient` at `src/gateway/workspace/handler-bridge.ts:592`) replaced by fail-closed `resolveWorkspaceLocator`; remaining/liveWriteWatchIndex=23; item7 **not-met**; phase1bUnlock **not-issued**. — `codex-handoff-phase1b-item7-retirement-batch9-s29.md`
- cursor-data-governance · 2026-08-23 · Item 7 Batch 9–12 CR on `origin/main` `bad5f90a1d33082d9fa6b6c6e361044ac7017f13` after #628: S10–S13 empty-path / cfg-only locator replaced by trusted complete queries; remaining/liveWriteWatchIndex=22; batch9to12Accepted=false; item7 **not-met**; phase1bUnlock **not-issued**. — `codex-handoff-phase1b-item7-batch9-12-cr.md`
- cursor-data-governance · 2026-08-23 · Item 7 Batch 9–12 CR2 on `origin/main` `697c65c905c624ec80aba2a3386a00a7d0cc818a` after #644: unique Catalog selection (tenantId+owner scope+agentAssetId; no first-match) + trusted position/group membership SoT; remaining/liveWriteWatchIndex=29; retiredThisChange=0; batch9to12Accepted=false; item7 **not-met**; phase1bUnlock **not-issued**. Does not absorb Batch 14/S15. — `codex-handoff-phase1b-item7-batch9-12-cr2.md`
- cursor-data-governance · 2026-08-23 · Item 7 Batch 9–12 CR2 evidence rebind only on `origin/main` `697c65c905c624ec80aba2a3386a00a7d0cc818a`: SHA rebound; no business implementation change; remaining/liveWriteWatchIndex=29; batch9to12Accepted=false pending Codex CR2-only review; item7 **not-met**. — `codex-handoff-phase1b-item7-batch9-12-cr2-rebind.md`
- cursor-data-governance · 2026-08-23 · Item 7 retirement batch 16 S17 on `origin/main` `dad42c3d8014bbd1a01872777fdadca6b081f182`: one live site (`createEmptyWorkspaceCatalog` in group-workspace-file list) replaced by existing-shape `InMemoryWorkspaceResourceCatalog`; packet remaining/liveWriteWatchIndex=29; retiredThisChange=1; does not absorb unaccepted Batch 15/S09; item7 **not-met**; phase1bUnlock **not-issued**. — `codex-handoff-phase1b-item7-retirement-batch16-s17.md`
- cursor-data-governance · 2026-08-23 · Item 7 Batch 16/S17 evidence correction on `origin/main` `6524a8428da62c79ddc4bad5ee1a99927ff4bdea` (#651): no business implementation change; previousAcceptedBaseline=19; remaining/liveWriteWatchIndex=18; batch15Accepted=true; absorbsUnacceptedBatches=false; item7 **not-met**; phase1bUnlock **not-issued**. Next retirement batch stays frozen until Codex accepts S17. — `codex-handoff-phase1b-item7-retirement-batch16-s17.md`
- cursor-data-governance · 2026-08-24 · Item 7 retirement batch 20 S23 on `origin/main` `1360e19acde600637183c1118f6e54af9f4b15e7` after #660 S22: one live site (`createEmptyWorkspaceCatalog` in steward-write) replaced by existing-shape `InMemoryWorkspaceResourceCatalog` plus `getResource`; remaining/liveWriteWatchIndex=14; S24–S27 lines stay 152/153/279/280; item7 **not-met**; phase1bUnlock **not-issued**. — `codex-handoff-phase1b-item7-retirement-batch20-s23.md`
- cursor-data-governance · 2026-08-24 · Item 7 retirement batch 21 S24 on `origin/main` `3447511b071f5538523704831c8d3fb09a4b0943` after #664 S23: one live site (`resolveEmployeeStewardSourceWorkspaceDir` in writable-dir) replaced by `resolveWorkspaceLocator`; remaining/liveWriteWatchIndex=13; S25–S27 lines stay 153/279/280; item7 **not-met**; phase1bUnlock **not-issued**. — `codex-handoff-phase1b-item7-retirement-batch21-s24.md`
