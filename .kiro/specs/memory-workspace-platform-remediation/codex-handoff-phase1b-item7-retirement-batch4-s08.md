# Phase 1B Item 7 retirement batch 4 (S08)

This round retires **one** live ledger site: `src/gateway/knowledge/deliverables/maybe-auto-capture-agent-deliverable.ts` `createEmptyWorkspaceCatalog` (S08). It does **not** mark Item 7 met.

| Field                           | Value                                      |
| ------------------------------- | ------------------------------------------ |
| status                          | retirement-batch-4                         |
| sites retired                   | S08                                        |
| remaining / liveWriteWatchIndex | 32 / 32                                    |
| item7                           | not-met                                    |
| phase1bExecutionBlocked         | true                                       |
| phase1bUnlock                   | not-issued                                 |
| deployAuthorized                | false                                      |
| live                            | forbidden                                  |
| productionWrite                 | false                                      |
| rollbackProof                   | true                                       |
| quarantineProof                 | true                                       |
| origin/main                     | `7cd74d4c5c69e7492eb6d624531f27592d6c809a` |

Replacement is `resolveWorkspaceLocator({ cfg })`. Incomplete queries fail closed (`missing_tenant_context`). Do not pass `agentId`. Do not synthesize an empty Catalog. Group draft upsert via empty Catalog is skipped until a complete locator query exists.

Twin P4 site `src/gateway/knowledge/knowledge-document-preview.ts:178` stays. Checkpoint-store steward at line 127 stays.

`item7RetirementUnlocked=true` remains controlled-retirement execute authorization only. Canonical `memory-workspace-phase1b-unlock-decision.json` is unchanged.

## Directed tests

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/knowledge/deliverables/maybe-auto-capture-agent-deliverable-item7-s08.test.ts \
  src/gateway/knowledge/deliverables/maybe-auto-capture-agent-deliverable.test.ts
node --test \
  docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch4-s08.test.mjs \
  docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch3-s07.test.mjs
```

Result: vitest 2 files / 11 tests passed; node:test S08/S07/S18 packets passed (S08 remaining=32). Candidate SHA is this PR HEAD.

## Forbidden this round

- retiring the remaining 32 sites in this packet
- writing `liveWriteWatchIndex=0`
- Item 7 met, Phase 1B unlock, LIVE, schema v2 production write, production Catalog write

## Requested review

**Item 7 Retirement Batch 4 (S08) Review only.**
