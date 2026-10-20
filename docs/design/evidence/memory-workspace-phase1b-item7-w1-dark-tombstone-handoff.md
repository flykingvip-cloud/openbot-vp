# Phase 1B Item 7 W1 Dark Dual-Read and Tombstone

W1 dark dual-read and tombstone after #570 W0 unlock. Legacy 37 write sites stay. Catalog miss=deny stays off. Item 7 stays **not-met**.

| Field                       | Value                                           |
| --------------------------- | ----------------------------------------------- |
| wave                        | W1                                              |
| W0 unlock PR                | <https://github.com/gmood2008/openbot/pull/570> |
| W0 unlock merge             | `1bd3fe7633866b60ab7d8eb4a4af8fdb3e435690`      |
| replacement plan            | <https://github.com/gmood2008/openbot/pull/562> |
| item7ImplementationUnlocked | true                                            |
| Item 7                      | **not-met**                                     |
| liveWriteWatchIndex         | 37                                              |
| frozenWriteWatchIndex       | 38                                              |
| catalogMissDeny             | false                                           |
| productionWrite             | legacy-only                                     |
| replacement new writes      | tombstone-quarantine                            |
| phase1bUnlock               | not-issued                                      |
| deployAuthorized            | false                                           |
| live                        | forbidden                                       |

## Allowed now

- Dark dual-read of legacy locator vs replacement resource id
- Tombstone/quarantine replacement-path **new** writes
- Keep legacy `productionWriteWatchIndex` sites running

## Still forbidden

- Item 7 met (`liveWriteWatchIndex` is 37)
- Delete any productionWriteWatchIndex call-site
- Item 7 Retirement execute
- Catalog miss=deny
- schema v2 / Catalog / resolver production write
- LIVE cutover

## Files

- `src/memory/item7-w1-dark-tombstone.ts`
- `src/memory/item7-w1-dark-tombstone.test.ts`
- `docs/design/evidence/memory-workspace-phase1b-item7-w1-dark-tombstone.json`
- `docs/design/evidence/memory-workspace-phase1b-item7-w1-dark-tombstone.test.mjs`
- `docs/design/evidence/memory-workspace-phase1b-item7-w1-dark-tombstone-handoff.md`

## Tests

```bash
pnpm exec vitest run src/memory/item7-w1-dark-tombstone.test.ts
node --test docs/design/evidence/memory-workspace-phase1b-item7-w1-dark-tombstone.test.mjs
```
