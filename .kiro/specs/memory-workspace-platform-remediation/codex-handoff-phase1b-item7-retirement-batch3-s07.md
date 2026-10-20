# Phase 1B Item 7 retirement batch 3 (S07)

This round retires **one** live ledger site: `src/gateway/checkpoint-store.ts` `resolveAgentWorkspaceDirForClient`. Steward (line 127) stays. It does **not** mark Item 7 met.

| Field                           | Value              |
| ------------------------------- | ------------------ |
| status                          | retirement-batch-3 |
| sites retired                   | S07                |
| remaining / liveWriteWatchIndex | 34 / 34            |
| item7                           | not-met            |
| phase1bExecutionBlocked         | true               |
| live                            | forbidden          |
| rollbackProof                   | true               |

Replacement is `resolveWorkspaceLocator`. Incomplete queries fail closed. Do not pass `agentId` (that is `agent_id_slug_query_forbidden`). Client tenant workspace is omitted unless the complete locator query is provided.

`item7RetirementUnlocked=true` remains controlled-retirement execute authorization only. Canonical `memory-workspace-phase1b-unlock-decision.json` still blocks full unlock.

## Forbidden this round

- retiring the remaining 34 sites in this packet
- writing `liveWriteWatchIndex=0`
- Item 7 met, LIVE, schema v2 production write, production Catalog write

## Requested review

**Item 7 Retirement Batch 3 Review only.**
