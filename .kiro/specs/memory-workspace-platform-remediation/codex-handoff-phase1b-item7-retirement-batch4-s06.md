# Phase 1B Item 7 retirement batch 4 (S06)

This round retires **one** live ledger site: `src/gateway/checkpoint-store.ts` steward `resolveEmployeeBuiltinStewardWorkspaceDir` (S06), after #607 already retired S07. It does **not** mark Item 7 met.

| Field                           | Value              |
| ------------------------------- | ------------------ |
| status                          | retirement-batch-4 |
| sites retired                   | S06                |
| remaining / liveWriteWatchIndex | 33 / 33            |
| item7                           | not-met            |
| phase1bExecutionBlocked         | true               |
| live                            | forbidden          |
| rollbackProof                   | true               |
| quarantineProof                 | true               |

Replacement is `resolveWorkspaceLocator` with identity `(tenantId, userId, agentAssetId=steward:builtin)`. Incomplete queries fail closed. No `createEmptyWorkspaceCatalog` production synthesis.

## Forbidden this round

- retiring the remaining 33 sites in this packet
- writing `liveWriteWatchIndex=0`
- Item 7 met, LIVE, schema v2 production write, production Catalog write

## Requested review

**Item 7 Retirement Batch 4 (S06) Review only.**
