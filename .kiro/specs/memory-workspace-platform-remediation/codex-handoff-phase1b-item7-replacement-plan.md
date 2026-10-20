# Phase 1B Item 7 Replacement Plan Handoff

**Request:** Item 7 Replacement Plan Review only

This handoff submits an **Item 7 replacement-plan package** for the remaining 37 production old-write call-sites. It is not Item 7 evidence-preparation, not the Item 7 call-site ledger, not Item 6/7 implementation-review, not an existing SQLite review, and not Retirement inventory.

It does not request Item 7 implementation unlock, does not request Item 7 met, does not execute Item 7 Retirement, does not delete production old-write call-sites, does not rewrite liveWriteWatchIndex 37 to 0, and does not set item6ImplementationUnlocked=true.

| Field                     | Value                                                        |
| ------------------------- | ------------------------------------------------------------ |
| operationId               | `phase1b-item7-replacement-plan-5480cefe12-20260820T141800Z` |
| origin/main baseline      | `5480cefe122f38fdf1064c1672b860e10060a32c`                   |
| citedUserBaseline         | `7aaa532f6b5a17e39343d7ab03811801fbcf8faa` (#557)            |
| cited ledger merge        | `c925b54ed9e48848a782a66064157cd085059367` (#555)            |
| minima receipt tip        | `ce6cf5e1702c7f2de20b58f062fd100562b6ee01`                   |
| Item 5 review tip         | `85f55ee2fa76f88dc538180b481a5823631af649`                   |
| status                    | replacement-plan-submitted                                   |
| Item 7                    | **not-met**                                                  |
| implementationUnlocked    | false                                                        |
| item6 unlocked            | false                                                        |
| retirement                | forbidden                                                    |
| liveWriteWatchIndex       | 37                                                           |
| frozenWriteWatchIndex     | 38                                                           |
| retiredThisChange         | 0                                                            |
| phase1bUnlock             | not-issued                                                   |
| phase1bExecutionBlocked   | true                                                         |
| deployAuthorized          | false                                                        |
| wiredToProductionResolver | false                                                        |
| liveCutover               | false                                                        |
| live                      | forbidden                                                    |

Accepting this review does not set `item7ImplementationUnlocked=true`, does not set `item6ImplementationUnlocked=true`, and does not authorize Retirement.

Independent retirement review is **requested** and fail-closed: accepting the request does not authorize deletion, count rewrite, met, or `deployAuthorized=true`.

## Replacement symbols (design only, not wired)

- `resolveWorkspaceResource` — P1/P3/P5 directory resolvers
- `WorkspaceResourceCatalog.getResource` — P4 empty-catalog / builders
- `resolveMemoryWorkspaceHandle` — P8 memory index / `syncMemoryFiles`

`resolveTrustedAgentLocator` is not a replacement; it still wraps `resolveAgentWorkspaceDirForClient`.

## Not the same as

- Item 6/7 evidence-preparation
- Item 7 call-site ledger (#555)
- Item 6 implementation-review (#557)
- Item 7 implementation-review (#558)
- existing SQLite / production-equivalent review
- Retirement inventory
- stale `memory-workspace-phase1b-item7-retirement-plan.json`

## Not requested

- Item 7 implementation start
- Item 6 implementationUnlocked=true
- Item 7 met
- Item 7 Retirement execution
- rewriting liveWriteWatchIndex 37 to 0
- deleting any productionWriteWatchIndex call-site
- retiring old memory engines
- enabling schema v2
- Resolver production write switch
- production Catalog write
- database migration
- Phase 1B full unlock
- LIVE cutover
- deployAuthorized=true

## Files

- `docs/design/evidence/memory-workspace-phase1b-item7-replacement-plan.json`
- `docs/design/evidence/memory-workspace-phase1b-item7-replacement-plan.md`
- `docs/design/evidence/memory-workspace-phase1b-item7-replacement-plan.test.mjs`
- `.kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-item7-replacement-plan.md`

## Tests

```bash
node --test docs/design/evidence/memory-workspace-phase1b-item7-replacement-plan.test.mjs
node --test docs/design/evidence/memory-workspace-phase1b-unlock-minima-issued.test.mjs
```

## SHA256

| Path                                                                            | SHA256                                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `docs/design/evidence/memory-workspace-phase1b-item7-replacement-plan.json`     | `70cd85f36028c7db30e2d4ef37d62a3070bd1ac6b0d7079a8b0e8248b0f5a51f` |
| `docs/design/evidence/memory-workspace-phase1b-item7-replacement-plan.md`       | `716c9258dac6c42c9457b0237cc0726b1d8b3ed0f517bd2006c97235b7222ed8` |
| `docs/design/evidence/memory-workspace-phase1b-item7-replacement-plan.test.mjs` | `ea28e0ba1f56cfd54d196ee484dc219a99131ec17a5f6d7d5f17706f57ce3a9a` |

## Review surface

Independent Item 7 replacement-plan PR. Not the I4 / kiro-loom dirty tree. Not PR #538 / #542 / #544 frozen files. Canonical unlock receipt stays `not-issued`.
