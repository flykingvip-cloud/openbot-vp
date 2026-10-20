# Phase 1B Item 7 retirement batch 16 (S17) evidence correction

这是 **evidence correction only**。不改业务实现，不新增 retirement 调用点，不启动下一 retirement batch。

#651 已将 S17 实现合入 `main`。Batch 15/S09 **已 Accepted**。本包把 Batch 16 证据基线从错误的 29 纠正为：

`previousAcceptedBaseline=19` → `retiredThisChange=1` → `remaining=18` / `liveWriteWatchIndex=18`。

`git fetch origin` 后 `origin/main` = `candidateSha` = `6524a8428da62c79ddc4bad5ee1a99927ff4bdea`（#651 merge）。`git merge-base --is-ancestor` holds.

| Field                           | Value                                      |
| ------------------------------- | ------------------------------------------ |
| status                          | retirement-batch-16-evidence-correction    |
| evidenceCorrectionOnly          | true                                       |
| sites retired                   | S17                                        |
| previousAcceptedBaseline        | 19                                         |
| lastAcceptedRetirementBaseline  | 19                                         |
| remaining / liveWriteWatchIndex | 18 / 18                                    |
| retiredThisChange               | 1                                          |
| absorbsUnacceptedBatches        | false                                      |
| batch15Accepted                 | true                                       |
| item7                           | not-met                                    |
| phase1bExecutionBlocked         | true                                       |
| phase1bUnlock                   | not-issued                                 |
| deployAuthorized                | false                                      |
| live                            | forbidden                                  |
| productionCatalogWrite          | none                                       |
| schemaV2ProductionWrite         | false                                      |
| rollbackProof                   | true                                       |
| quarantineProof                 | true                                       |
| origin/main                     | `6524a8428da62c79ddc4bad5ee1a99927ff4bdea` |
| candidateSha                    | `6524a8428da62c79ddc4bad5ee1a99927ff4bdea` |
| landMergeSha                    | `6524a8428da62c79ddc4bad5ee1a99927ff4bdea` |

Replacement remains the existing-shape `InMemoryWorkspaceResourceCatalog` read view already on `main`. Group workspace root still comes from `resolveTrustedGroupLocator` after membership check. Host/steward fallback is **not** retained at this site.

Do not call `createEmptyWorkspaceCatalog`. Do not mint a production Catalog row. Catalog miss=deny stays off. Incomplete tenant/resource, agentId-only, userId-only, cross-tenant, and ambiguous queries fail closed. Deny paths perform zero read/write/mkdir/trash/config mutation.

`item7RetirementUnlocked=true` remains controlled-retirement execute authorization only. Canonical `memory-workspace-phase1b-unlock-decision.json` still blocks full unlock.

Rollback: restore `group-workspace-file.ts` and the live scan from git. Quarantine: this packet does not delete old data or run physical migration.

## Forbidden this round

- changing business implementation or retiring another call site
- starting the next retirement batch before Codex accepts S17
- writing `liveWriteWatchIndex=0`
- Item 7 met, Phase 1B unlock, LIVE, schema v2 production write, production Catalog write, I3
- absorbing any still-unaccepted batch (`absorbsUnacceptedBatches` stays false)

## Requested review

**Item 7 Retirement Batch 16 / S17 evidence correction only.**
