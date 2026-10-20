# Phase 1B Item 7 retirement batch 5 (S19)

This round retires **one** live ledger site: `src/gateway/server-methods/skills.ts` `skills.install` `resolveAgentWorkspaceDirForClient`. Host read fallbacks stay on lines 87 and 138. It does **not** mark Item 7 met.

| Field                           | Value              |
| ------------------------------- | ------------------ |
| status                          | retirement-batch-5 |
| sites retired                   | S19                |
| remaining / liveWriteWatchIndex | 32 / 32            |
| item7                           | not-met            |
| phase1bExecutionBlocked         | true               |
| live                            | forbidden          |
| rollbackProof                   | true               |

Replacement is `resolveWorkspaceLocator`. Incomplete queries fail closed. Do not pass `agentId` (that is `agent_id_slug_query_forbidden`).

`item7RetirementUnlocked=true` remains controlled-retirement execute authorization only. Canonical `memory-workspace-phase1b-unlock-decision.json` still blocks full unlock.

## Forbidden this round

- retiring the remaining 32 sites in this packet
- writing `liveWriteWatchIndex=0`
- Item 7 met, LIVE, schema v2 production write, production Catalog write

## Requested review

**Item 7 Retirement Batch 5 Review only.**
