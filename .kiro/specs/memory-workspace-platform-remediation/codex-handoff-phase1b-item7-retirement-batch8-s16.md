# Phase 1B Item 7 retirement batch 8 (S16)

This round retires **one** live ledger site: `src/gateway/server-methods/chat.ts` `resolveAgentWorkspaceDirForClient`. Host/steward reads stay on lines 1001, 1005, and 1819. It does **not** mark Item 7 met.

| Field                           | Value              |
| ------------------------------- | ------------------ |
| status                          | retirement-batch-8 |
| sites retired                   | S16                |
| remaining / liveWriteWatchIndex | 29 / 29            |
| item7                           | not-met            |
| phase1bExecutionBlocked         | true               |
| live                            | forbidden          |
| rollbackProof                   | true               |
| quarantineProof                 | true               |

Replacement is `resolveWorkspaceLocator`. Incomplete queries fail closed. Do not pass `agentId` (that is `agent_id_slug_query_forbidden`). Locator result is narrowed before reading `handle`. Fail-closed `null` still falls through `??` to the host read on line 1819.

`item7RetirementUnlocked=true` remains controlled-retirement execute authorization only. Canonical `memory-workspace-phase1b-unlock-decision.json` still blocks full unlock.

## Forbidden this round

- retiring the remaining 29 sites in this packet
- writing `liveWriteWatchIndex=0`
- Item 7 met, LIVE, schema v2 production write, production Catalog write, I3

## Requested review

**Item 7 Retirement Batch 8 Review only.**
