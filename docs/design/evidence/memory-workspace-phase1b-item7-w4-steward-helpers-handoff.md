# Phase 1B Item 7 W4 Steward Helpers

W4 steward helpers shadow proof after #575. Six P5 builtin/source/target helper sites stay. Helper switch, Catalog miss=deny, and Item 7 stay **not-met**.

| Field                       | Value                                           |
| --------------------------- | ----------------------------------------------- |
| wave                        | W4                                              |
| W3 PR                       | <https://github.com/gmood2008/openbot/pull/575> |
| W3 merge                    | `d243a625172b8d5978a7774c0a79f7785c93b82e`      |
| sites                       | 6 P5 (builtin=2, source=2, target=2)            |
| item7ImplementationUnlocked | true                                            |
| Item 7                      | **not-met**                                     |
| liveWriteWatchIndex         | 37                                              |
| frozenWriteWatchIndex       | 38                                              |
| catalogMissDeny             | false                                           |
| helperSwitch                | denied                                          |
| productionWrite             | legacy-only                                     |
| phase1bUnlock               | not-issued                                      |
| deployAuthorized            | false                                           |
| live                        | forbidden                                       |

## Allowed now

- Shadow Catalog identity for steward builtin/source/target dirs
- Keep W1 tombstone on replacement-path new writes
- Keep the 6 P5 steward helper sites

## Still forbidden

- Item 7 met (`liveWriteWatchIndex` is 37)
- Switching production off steward helper dirs
- Delete any productionWriteWatchIndex call-site
- Catalog miss=deny
- schema v2 / Catalog / resolver production write
- LIVE cutover

## Files

- `src/memory/item7-w4-steward-helpers.ts`
- `src/memory/item7-w4-steward-helpers.test.ts`
- `docs/design/evidence/memory-workspace-phase1b-item7-w4-steward-helpers.json`
- `docs/design/evidence/memory-workspace-phase1b-item7-w4-steward-helpers.test.mjs`
- `docs/design/evidence/memory-workspace-phase1b-item7-w4-steward-helpers-handoff.md`

## Tests

```bash
pnpm exec vitest run src/memory/item7-w4-steward-helpers.test.ts
node --test docs/design/evidence/memory-workspace-phase1b-item7-w4-steward-helpers.test.mjs
```
