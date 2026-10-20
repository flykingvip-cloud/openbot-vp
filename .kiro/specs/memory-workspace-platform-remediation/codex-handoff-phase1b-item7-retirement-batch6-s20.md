# Phase 1B Item 7 retirement batch 6 (S20)

This round retires **one** live ledger site: `src/gateway/server-methods/tools-catalog.ts` `resolveAgentWorkspaceDirForClient`. Host read stays on line 153. It does **not** mark Item 7 met.

| Field                           | Value              |
| ------------------------------- | ------------------ |
| status                          | retirement-batch-6 |
| sites retired                   | S20                |
| remaining / liveWriteWatchIndex | 31 / 31            |
| item7                           | not-met            |
| phase1bExecutionBlocked         | true               |
| live                            | forbidden          |
| rollbackProof                   | true               |

Replacement is `resolveWorkspaceLocator`. Incomplete queries fail closed. Do not pass `agentId` (that is `agent_id_slug_query_forbidden`). Locator result is narrowed before reading `handle`.

`item7RetirementUnlocked=true` remains controlled-retirement execute authorization only. Canonical `memory-workspace-phase1b-unlock-decision.json` still blocks full unlock.

## Forbidden this round

- retiring the remaining 31 sites in this packet
- writing `liveWriteWatchIndex=0`
- Item 7 met, LIVE, schema v2 production write, production Catalog write

## Requested review

**Item 7 Retirement Batch 6 Review only.**
