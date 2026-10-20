# Phase 1B Item 7 retirement batch 4 (S18)

This round retires **one** live ledger site: `src/gateway/server-methods/skills.ts` `skills.status` `resolveAgentWorkspaceDirForClient`. S19 (`skills.install`, line 137) stays. It does **not** mark Item 7 met.

| Field                           | Value              |
| ------------------------------- | ------------------ |
| status                          | retirement-batch-4 |
| sites retired                   | S18                |
| remaining / liveWriteWatchIndex | 33 / 33            |
| item7                           | not-met            |
| phase1bExecutionBlocked         | true               |
| live                            | forbidden          |
| rollbackProof                   | true               |

Replacement is `resolveWorkspaceLocator`. Incomplete queries fail closed. Do not pass `agentId` (that is `agent_id_slug_query_forbidden`). Host `resolveAgentWorkspaceDir` read fallback on line 87 stays.

`item7RetirementUnlocked=true` remains controlled-retirement execute authorization only. Canonical `memory-workspace-phase1b-unlock-decision.json` still blocks full unlock.

## Forbidden this round

- retiring S19 or the remaining 33 sites in this packet
- writing `liveWriteWatchIndex=0`
- Item 7 met, LIVE, schema v2 production write, production Catalog write
- treating #608 S06 as this batch (S06 is W4; serial order is S18 first)

## Requested review

**Item 7 Retirement Batch 4 Review only.**
