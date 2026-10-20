# Phase 1B Item 7 retirement batch 13 (S14)

This round retires **one** live ledger site: `src/gateway/server-methods/agents.ts:1159` Trusted wrapper (`resolveTrustedAgentLocator`, inventoried as `resolveAgentWorkspaceDirForClient`). Host write stays on line 1160. It does **not** mark Item 7 met.

| Field                           | Value               |
| ------------------------------- | ------------------- |
| status                          | retirement-batch-13 |
| sites retired                   | S14                 |
| remaining / liveWriteWatchIndex | 21 / 21             |
| item7                           | not-met             |
| phase1bExecutionBlocked         | true                |
| live                            | forbidden           |
| rollbackProof                   | true                |
| quarantineProof                 | true                |

Replacement is `resolveAgentsHandlerWorkspaceLocator` (complete trusted query after #638). Do not use cfg-only `resolveWorkspaceLocator`. Locator result is narrowed before reading `handle`. Fail-closed fallback is `null` so `??` still reaches the S15 host.

`item7RetirementUnlocked=true` remains controlled-retirement execute authorization only. Canonical `memory-workspace-phase1b-unlock-decision.json` still blocks full unlock.

## Forbidden this round

- retiring the remaining 21 sites in this packet
- writing `liveWriteWatchIndex=0`
- Item 7 met, LIVE, schema v2 production write, production Catalog write, I3

## Requested review

**Item 7 Retirement Batch 13 Review only.**
