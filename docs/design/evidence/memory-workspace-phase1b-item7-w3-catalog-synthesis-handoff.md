# Phase 1B Item 7 W3 Catalog Synthesis

W3 catalog synthesis shadow proof after #573. Seven P4 empty-catalog / builder sites stay. Synthesis switch, Catalog miss=deny, and Item 7 stay **not-met**.

| Field                       | Value                                           |
| --------------------------- | ----------------------------------------------- |
| wave                        | W3                                              |
| W2 PR                       | <https://github.com/gmood2008/openbot/pull/573> |
| W2 merge                    | `3e19d8f642f1c976f3c58a65bede26741321710f`      |
| sites                       | 7 P4 (empty-catalog=4, builder=3)               |
| item7ImplementationUnlocked | true                                            |
| Item 7                      | **not-met**                                     |
| liveWriteWatchIndex         | 37                                              |
| frozenWriteWatchIndex       | 38                                              |
| catalogMissDeny             | false                                           |
| synthesisSwitch             | denied                                          |
| productionCatalogWrite      | none                                            |
| productionWrite             | legacy-only                                     |
| phase1bUnlock               | not-issued                                      |
| deployAuthorized            | false                                           |
| live                        | forbidden                                       |

## Allowed now

- Shadow read of existing Catalog entries via `WorkspaceResourceCatalog.getResource`
- Keep W1 tombstone on replacement-path new writes
- Keep the 7 P4 synthesis sites

## Still forbidden

- Item 7 met (`liveWriteWatchIndex` is 37)
- Switching production callers off empty catalog / builders
- Delete any productionWriteWatchIndex call-site
- Catalog miss=deny
- production Catalog write
- schema v2 / resolver production write
- LIVE cutover

## Files

- `src/memory/item7-w3-catalog-synthesis.ts`
- `src/memory/item7-w3-catalog-synthesis.test.ts`
- `docs/design/evidence/memory-workspace-phase1b-item7-w3-catalog-synthesis.json`
- `docs/design/evidence/memory-workspace-phase1b-item7-w3-catalog-synthesis.test.mjs`
- `docs/design/evidence/memory-workspace-phase1b-item7-w3-catalog-synthesis-handoff.md`

## Tests

```bash
pnpm exec vitest run src/memory/item7-w3-catalog-synthesis.test.ts
node --test docs/design/evidence/memory-workspace-phase1b-item7-w3-catalog-synthesis.test.mjs
```
