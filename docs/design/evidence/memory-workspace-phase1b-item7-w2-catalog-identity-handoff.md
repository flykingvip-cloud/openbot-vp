# Phase 1B Item 7 W2 Catalog Identity

W2 Catalog identity shadow proof after #572. Sixteen P1/P3 write callers stay on legacy symbols. Caller switch, Catalog miss=deny, and Item 7 stay **not-met**.

| Field                       | Value                                           |
| --------------------------- | ----------------------------------------------- |
| wave                        | W2                                              |
| W1 PR                       | <https://github.com/gmood2008/openbot/pull/572> |
| W1 merge                    | `8211c0e82f8c748283a30ad3365cb8061db39c2f`      |
| sites                       | 16 (P1=9, P3=7)                                 |
| item7ImplementationUnlocked | true                                            |
| Item 7                      | **not-met**                                     |
| liveWriteWatchIndex         | 37                                              |
| frozenWriteWatchIndex       | 38                                              |
| catalogMissDeny             | false                                           |
| callerSwitch                | denied                                          |
| wiredToProductionResolver   | false                                           |
| productionWrite             | legacy-only                                     |
| phase1bUnlock               | not-issued                                      |
| deployAuthorized            | false                                           |
| live                        | forbidden                                       |

## Allowed now

- Shadow dual-read of legacy locator vs Catalog resource id for P1/P3 sites
- Keep W1 tombstone on replacement-path new writes
- Keep the 16 legacy `productionWriteWatchIndex` sites

## Still forbidden

- Item 7 met (`liveWriteWatchIndex` is 37)
- Production caller switch onto `resolveWorkspaceResource`
- Delete any productionWriteWatchIndex call-site
- Catalog miss=deny
- schema v2 / Catalog / resolver production write
- LIVE cutover

## Files

- `src/memory/item7-w2-catalog-identity.ts`
- `src/memory/item7-w2-catalog-identity.test.ts`
- `docs/design/evidence/memory-workspace-phase1b-item7-w2-catalog-identity.json`
- `docs/design/evidence/memory-workspace-phase1b-item7-w2-catalog-identity.test.mjs`
- `docs/design/evidence/memory-workspace-phase1b-item7-w2-catalog-identity-handoff.md`

## Tests

```bash
pnpm exec vitest run src/memory/item7-w2-catalog-identity.test.ts
node --test docs/design/evidence/memory-workspace-phase1b-item7-w2-catalog-identity.test.mjs
```
