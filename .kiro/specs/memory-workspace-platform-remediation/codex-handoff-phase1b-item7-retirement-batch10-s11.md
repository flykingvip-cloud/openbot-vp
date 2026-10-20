# Phase 1B Item 7 retirement batch 10 (S11)

This round retires **one** live ledger site: `src/gateway/server-methods/agents.ts:146` host `resolveAgentWorkspaceDir`. Host writes stay on lines 1001, 1075, and 1160. The S14 Trusted wrapper stays on line 1159. It does **not** mark Item 7 met.

| Field                           | Value               |
| ------------------------------- | ------------------- |
| status                          | retirement-batch-10 |
| sites retired                   | S11                 |
| remaining / liveWriteWatchIndex | 27 / 27             |
| item7                           | not-met             |
| phase1bExecutionBlocked         | true                |
| live                            | forbidden           |
| rollbackProof                   | true                |
| quarantineProof                 | true                |

Replacement is `resolveWorkspaceLocator`. Incomplete queries fail closed. Do not pass `agentId` (that is `agent_id_slug_query_forbidden`). Locator result is narrowed before reading `handle`. Fail-closed fallback is `""` so `workspaceDir` stays `string`.

`item7RetirementUnlocked=true` remains controlled-retirement execute authorization only. Canonical `memory-workspace-phase1b-unlock-decision.json` still blocks full unlock.

## Forbidden this round

- retiring the remaining 27 sites in this packet
- writing `liveWriteWatchIndex=0`
- Item 7 met, LIVE, schema v2 production write, production Catalog write, I3

## Requested review

**Item 7 Retirement Batch 10 Review only.**
