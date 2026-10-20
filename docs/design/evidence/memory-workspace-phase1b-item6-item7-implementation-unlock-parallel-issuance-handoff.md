# Phase 1B Item 6 + Item 7 Implementation Unlock Parallel Issuance

**Request:** Phase 1B Item 6 + Item 7 Implementation Unlock Parallel Issuance Review

Applied after independent Approve of #569. `signedBy=independent-review` (`flykingvip-cloud`). Item 6/7 implementation unlock is **issued**. Item 6/7 stay **not-met**. Retirement, call-site deletion, production writes, and LIVE stay forbidden.

| Field                       | Value                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| operationId                 | `phase1b-item6-item7-implementation-unlock-parallel-issuance-d99569f370-20260821T014600Z` |
| issuance review PR          | <https://github.com/gmood2008/openbot/pull/569>                                           |
| issuance review merge       | `d3fd0f62cd9d979a07e0a64366127d62088485a2`                                                |
| Item 6 unlock request PR    | <https://github.com/gmood2008/openbot/pull/567>                                           |
| Item 7 unlock request PR    | <https://github.com/gmood2008/openbot/pull/561>                                           |
| signedBy                    | independent-review                                                                        |
| item6ImplementationUnlocked | true                                                                                      |
| item7ImplementationUnlocked | true                                                                                      |
| Item 6 / Item 7             | **not-met**                                                                               |
| liveWriteWatchIndex         | 37                                                                                        |
| frozenWriteWatchIndex       | 38                                                                                        |
| retirement                  | forbidden                                                                                 |
| phase1bUnlock               | not-issued                                                                                |
| fullUnlock                  | not-issued                                                                                |
| phase1bExecutionBlocked     | true                                                                                      |
| deployAuthorized            | false                                                                                     |
| live                        | forbidden                                                                                 |

## If issued means

- **Item 6:** allow implementation start on operator-issued `OPENBOT_AUTHORIZED_SQLITE_PATH` only (fail-closed identity; no host search).
- **Item 7:** allow W0 implementation per #562 replacement plan (dual-read / dark tombstone).

## Still forbidden after issuance

- Item 6 met / Item 7 met
- production sqlite write
- delete `productionWriteWatchIndex` call-sites
- Item 7 Retirement execute
- rewrite `liveWriteWatchIndex` 37 to 0
- production Catalog write / schema v2 production write / Resolver production write
- Phase 1B full unlock
- `deployAuthorized=true` / LIVE cutover

## Files

- `docs/design/evidence/memory-workspace-phase1b-item6-item7-implementation-unlock-parallel-issuance.json`
- `docs/design/evidence/memory-workspace-phase1b-item6-implementation-unlock-issued-receipt.json`
- `docs/design/evidence/memory-workspace-phase1b-item7-implementation-unlock-issued-receipt.json`
- `docs/design/evidence/memory-workspace-phase1b-unlock-current.json`
- `docs/design/evidence/memory-workspace-phase1b-item6-item7-implementation-unlock-parallel-issuance.test.mjs`
- `docs/design/evidence/memory-workspace-phase1b-item6-item7-implementation-unlock-parallel-issuance-handoff.md`

## Tests

```bash
node docs/design/evidence/memory-workspace-phase1b-item6-item7-implementation-unlock-parallel-issuance.test.mjs
node docs/design/evidence/memory-workspace-phase1b-unlock-minima-issued.test.mjs
```

Canonical full unlock receipt stays `not-issued`.
