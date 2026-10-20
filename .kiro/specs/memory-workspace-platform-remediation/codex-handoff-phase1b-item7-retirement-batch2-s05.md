# Phase 1B Item 7 retirement batch 2 (S05)

This round retires **one** live ledger site: `src/gateway/checkpoint-store.ts` host `resolveAgentWorkspaceDir`. Steward (line 127) and `resolveAgentWorkspaceDirForClient` (line 158) stay. It does **not** mark Item 7 met.

| Field                           | Value              |
| ------------------------------- | ------------------ |
| status                          | retirement-batch-2 |
| sites retired                   | S05                |
| remaining / liveWriteWatchIndex | 35 / 35            |
| item7                           | not-met            |
| phase1bExecutionBlocked         | true               |
| live                            | forbidden          |
| rollbackProof                   | true               |

Replacement is `resolveWorkspaceLocator`. Incomplete queries fail closed. Host workspace is omitted unless the complete locator query is provided.

## Forbidden this round

- retiring the remaining 35 sites in this packet
- writing `liveWriteWatchIndex=0`
- Item 7 met, LIVE, schema v2 production write

## Requested review

**Item 7 Retirement Batch 2 Review only.**
