# Phase 1B Item 7 retirement batch 11 (S12)

This round retires **one** live ledger site: `src/gateway/server-methods/agents.ts:1001` host `resolveAgentWorkspaceDir`. Host writes stay on lines 1075 and 1160. The S14 Trusted wrapper stays on line 1159. It does **not** mark Item 7 met.

| Field                           | Value               |
| ------------------------------- | ------------------- |
| status                          | retirement-batch-11 |
| sites retired                   | S12                 |
| remaining / liveWriteWatchIndex | 26 / 26             |
| item7                           | not-met             |
| phase1bExecutionBlocked         | true                |
| live                            | forbidden           |
| rollbackProof                   | true                |
| quarantineProof                 | true                |

Replacement is `resolveWorkspaceLocator`. Incomplete queries fail closed. Do not pass `agentId` (that is `agent_id_slug_query_forbidden`). Locator result is narrowed before reading `handle`. Fail-closed fallback is `""` so `workspace` stays `string`.

`item7RetirementUnlocked=true` remains controlled-retirement execute authorization only. Canonical `memory-workspace-phase1b-unlock-decision.json` still blocks full unlock.

## Forbidden this round

- retiring the remaining 26 sites in this packet
- writing `liveWriteWatchIndex=0`
- Item 7 met, LIVE, schema v2 production write, production Catalog write, I3

## Requested review

**Item 7 Retirement Batch 11 Review only.**
