# Phase 1B Item 7 retirement batch 1 (S04)

This round retires **one** live ledger site: `src/commands/status-all/agents.ts` `resolveAgentWorkspaceDir`. The twin in `src/commands/status.agent-local.ts` is also rewired. It does **not** mark Item 7 met.

| Field                           | Value              |
| ------------------------------- | ------------------ |
| status                          | retirement-batch-1 |
| sites retired                   | S04                |
| remaining / liveWriteWatchIndex | 36 / 36            |
| item7                           | not-met            |
| phase1bExecutionBlocked         | true               |
| live                            | forbidden          |
| rollbackProof                   | true               |

Replacement is `resolveWorkspaceLocator`. Incomplete queries fail closed. `openbot status --all` without TenantContext shows `workspaceDir=null`.

## Forbidden this round

- retiring the remaining 36 sites in this packet
- writing `liveWriteWatchIndex=0`
- Item 7 met, LIVE, schema v2 production write

## Requested review

**Item 7 Retirement Batch 1 Review only.**
