# Phase 1B Item 7 retirement batch 21 (S24)

This round retires **one** live ledger site: `src/gateway/workspace-resolver/steward-write.ts` `resolveEmployeeStewardSourceWorkspaceDir` at the writable-dir call site. It does **not** mark Item 7 met.

| Field                           | Value               |
| ------------------------------- | ------------------- |
| status                          | retirement-batch-21 |
| sites retired                   | S24                 |
| remaining / liveWriteWatchIndex | 13 / 13             |
| previousAcceptedBaseline        | 14 (S23 / #664)     |
| item7                           | not-met             |
| phase1bExecutionBlocked         | true                |
| live                            | forbidden           |
| rollbackProof                   | true                |
| quarantineProof                 | true                |

Replacement is `resolveWorkspaceLocator` on an existing Catalog SoT source locator (`agentAssetId=steward:builtin`). Do not call `resolveEmployeeStewardSourceWorkspaceDir` at this site. Do not mint a production Catalog row. Catalog miss=deny stays off. Missing grant / tenant mismatch fail-closed. S25 / S26 / S27 stay at lines 153 / 279 / 280.

Do not start S25.

`item7RetirementUnlocked=true` remains controlled-retirement execute authorization only. Canonical `memory-workspace-phase1b-unlock-decision.json` still blocks full unlock.

## Forbidden this round

- retiring the remaining 13 sites in this packet
- shifting S25–S27 watched line numbers
- writing `liveWriteWatchIndex=0`
- rewriting Phase 0 freeze baseline
- Item 7 met, LIVE, schema v2 production write, production Catalog write, I3

## Requested review

**Item 7 Retirement Batch 21 Review only.**
