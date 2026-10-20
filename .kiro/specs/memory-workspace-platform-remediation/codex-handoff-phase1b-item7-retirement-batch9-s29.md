# Phase 1B Item 7 retirement batch 9 (S29)

This round retires **one** live ledger site:

| Field    | Value                                     |
| -------- | ----------------------------------------- |
| ledgerId | S29                                       |
| file     | `src/gateway/workspace/handler-bridge.ts` |
| symbol   | `resolveAgentWorkspaceDirForClient`       |
| line     | 592                                       |
| caller   | `resolveTrustedAgentLocator`              |

It does **not** mark Item 7 met.

| Field                           | Value                                      |
| ------------------------------- | ------------------------------------------ |
| status                          | retirement-batch-9                         |
| sites retired                   | S29                                        |
| remaining / liveWriteWatchIndex | 23 / 23                                    |
| item7                           | not-met                                    |
| phase1bExecutionBlocked         | true                                       |
| phase1bUnlock                   | not-issued                                 |
| deployAuthorized                | false                                      |
| live                            | forbidden                                  |
| productionWrite                 | false                                      |
| productionCatalogWrite          | none                                       |
| schemaV2ProductionWrite         | false                                      |
| rollbackProof                   | true                                       |
| quarantineProof                 | true                                       |
| origin/main                     | `da8cccb3f3faadb1960118c53c1223a1a0fb9de0` |

## Why this site

Authoritative live-write ledger:
`docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json`
(24 rows after #612 S08, remaining claimed 25). Replacement plan:
`docs/design/evidence/memory-workspace-phase1b-item7-replacement-plan.json`.

Next unretired row that (1) still matches source file/symbol/line and (2) can
honestly use `resolveWorkspaceLocator`:

- S01 / S06 / S24-S27: W4 steward helpers. Replacement family is steward Catalog
  identity, not locator.
- S02: cited line drifted; host now sits inside a steward callback.
- S08: already retired on `origin/main` by #612.
- S09 / S17 / S21 / S22 / S23 / S28: W3 catalog synthesis. Replacement is
  `WorkspaceResourceCatalog.getResource`.
- S10: already retired on `origin/main` by #626.
- S11: already retired on `origin/main` by #629.
- S12: already retired on `origin/main` by #633.
- S13: already retired on `origin/main` by #636.
- S14: scan still lists ForClient at `agents.ts:1159`, but source is
  `resolveTrustedAgentLocator`.

S29 is the remaining production `resolveAgentWorkspaceDirForClient` call.

## Replacement

`resolveWorkspaceLocator({ cfg: params.cfg })`. Incomplete queries fail closed
(`missing_tenant_context`). Do not pass `agentId`
(`agent_id_slug_query_forbidden`), userId-only, or `client`. Locator results are
narrowed with `r.ok` before reading `handle.locator`. Fail-closed rejects so
existing `.catch(() => null)` / try/catch callers stay fail-closed. Complete
tenant/user/resource queries pass after Catalog + grant checks. Cross-tenant
resource access is `tenant_mismatch`.

## Retained host / steward fallbacks

No host fallback is added inside `resolveTrustedAgentLocator` (that would create
a new freeze-watched production call). Callers keep:

- `src/gateway/server-methods/agents.ts:1160` `resolveAgentWorkspaceDir` (S15)
- `handler-bridge.ts:910` trusted-locator call + catch to `null` (line kept)

Rollback restores `handler-bridge.ts` + the live scan from git without rewriting
Freeze 38.

`item7RetirementUnlocked=true` remains controlled-retirement execute
authorization only. Canonical
`memory-workspace-phase1b-unlock-decision.json` is unchanged.

## Directed tests

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/workspace/handler-bridge-item7-s29.test.ts
node --test \
  docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch9-s29.test.mjs \
  docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch4-s08.test.mjs \
  docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch12-s13.test.mjs \
  docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch11-s12.test.mjs \
  docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch10-s11.test.mjs \
  docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch9-s10.test.mjs \
  docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch8-s16.test.mjs
```

## Forbidden this round

- retiring the remaining 23 sites in this packet
- writing `liveWriteWatchIndex=0`
- Item 7 met, Phase 1B unlock, LIVE, schema v2 production write, production
  Catalog write, I3

## Requested review

**Item 7 Retirement Batch 9 (S29) Review only.**
