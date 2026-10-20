# Phase 1B Item 7 retirement batch 12 (S13)

This round retires **one** live ledger site: `src/gateway/server-methods/agents.ts:1075` host `resolveAgentWorkspaceDir`. Host write stays on line 1160. The S14 Trusted wrapper stays on line 1159. It does **not** mark Item 7 met.

| Field                           | Value               |
| ------------------------------- | ------------------- |
| status                          | retirement-batch-12 |
| sites retired                   | S13                 |
| remaining / liveWriteWatchIndex | 25 / 25             |
| item7                           | not-met             |
| phase1bExecutionBlocked         | true                |
| live                            | forbidden           |
| rollbackProof                   | true                |
| quarantineProof                 | true                |

Replacement is `resolveWorkspaceLocator`. Incomplete queries fail closed. Do not pass `agentId` (that is `agent_id_slug_query_forbidden`). Locator result is narrowed before reading `handle`. Fail-closed fallback is `""` so `workspaceDir` stays `string`.

`item7RetirementUnlocked=true` remains controlled-retirement execute authorization only. Canonical `memory-workspace-phase1b-unlock-decision.json` still blocks full unlock.

## Forbidden this round

- retiring the remaining 25 sites in this packet
- writing `liveWriteWatchIndex=0`
- Item 7 met, LIVE, schema v2 production write, production Catalog write, I3

## Requested review

**Item 7 Retirement Batch 12 Review only.**
