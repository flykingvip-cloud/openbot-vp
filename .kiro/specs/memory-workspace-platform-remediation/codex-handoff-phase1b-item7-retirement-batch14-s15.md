# Phase 1B Item 7 retirement batch 14 (S15)

This round retires **one** live ledger site: `src/gateway/server-methods/agents.ts:1160` host write (`resolveAgentWorkspaceDir`). It does **not** mark Item 7 met.

| Field                           | Value               |
| ------------------------------- | ------------------- |
| status                          | retirement-batch-14 |
| sites retired                   | S15                 |
| remaining / liveWriteWatchIndex | 20 / 20             |
| item7                           | not-met             |
| phase1bExecutionBlocked         | true                |
| live                            | forbidden           |
| rollbackProof                   | true                |
| quarantineProof                 | true                |

Replacement is `resolveAgentsHandlerWorkspaceLocatorOrRespond` (complete trusted query after #638). Fail-closed `respond` + return. Do not use cfg-only `resolveWorkspaceLocator` or an empty-string / cwd fallback.

`item7RetirementUnlocked=true` remains controlled-retirement execute authorization only. Canonical `memory-workspace-phase1b-unlock-decision.json` still blocks full unlock.

## Forbidden this round

- retiring the remaining 20 sites in this packet
- writing `liveWriteWatchIndex=0`
- Item 7 met, LIVE, schema v2 production write, production Catalog write, I3

## Requested review

**Item 7 Retirement Batch 14 Review only.**
