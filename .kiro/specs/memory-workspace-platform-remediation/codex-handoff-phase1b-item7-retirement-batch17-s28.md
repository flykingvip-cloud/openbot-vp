# Phase 1B Item 7 retirement batch 17 (S28)

This round retires **one** live ledger site: `src/gateway/workspace-resolver/tool-cwd.ts` `buildUserOwnedWorkspaceCatalogEntry`. It does **not** mark Item 7 met.

| Field                           | Value               |
| ------------------------------- | ------------------- |
| status                          | retirement-batch-17 |
| sites retired                   | S28                 |
| remaining / liveWriteWatchIndex | 17 / 17             |
| item7                           | not-met             |
| phase1bExecutionBlocked         | true                |
| live                            | forbidden           |
| rollbackProof                   | true                |
| quarantineProof                 | true                |

Replacement is `WorkspaceResourceCatalog.getResource` on an existing Catalog SoT id. Do not call `buildUserOwnedWorkspaceCatalogEntry`. Do not mint a production Catalog row. Catalog miss=deny stays off.

`item7RetirementUnlocked=true` remains controlled-retirement execute authorization only. Canonical `memory-workspace-phase1b-unlock-decision.json` still blocks full unlock.

## Forbidden this round

- retiring the remaining 17 sites in this packet
- writing `liveWriteWatchIndex=0`
- Item 7 met, LIVE, schema v2 production write, production Catalog write, I3

## Requested review

**Item 7 Retirement Batch 17 Review only.**
