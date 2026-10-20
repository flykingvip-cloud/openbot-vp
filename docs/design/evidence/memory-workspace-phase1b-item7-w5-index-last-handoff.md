# Phase 1B Item 7 W5 Memory Index

W5 memory index shadow proof after #577. Eight memory dir/index sites stay so rollback can still locate. Index switch, Catalog miss=deny, and Item 7 stay **not-met**.

| Field                       | Value                                           |
| --------------------------- | ----------------------------------------------- |
| wave                        | W5                                              |
| W4 PR                       | <https://github.com/gmood2008/openbot/pull/577> |
| W4 merge                    | `931d1287e97096d64da7d9852962953346e63446`      |
| sites                       | 8 (P1 dir=5, P8 sync=3)                         |
| item7ImplementationUnlocked | true                                            |
| Item 7                      | **not-met**                                     |
| liveWriteWatchIndex         | 37                                              |
| frozenWriteWatchIndex       | 38                                              |
| catalogMissDeny             | false                                           |
| indexSwitch                 | denied                                          |
| productionWrite             | legacy-only                                     |
| phase1bUnlock               | not-issued                                      |
| deployAuthorized            | false                                           |
| live                        | forbidden                                       |

## Allowed now

- Shadow Handle identity for memory dir/index sites
- Keep W1 tombstone on replacement-path new writes
- Keep the 8 legacy index/dir sites

## Still forbidden

- Item 7 met (`liveWriteWatchIndex` is 37)
- Switching production onto `resolveMemoryWorkspaceHandle`
- Delete any productionWriteWatchIndex call-site
- Catalog miss=deny
- schema v2 / Catalog / resolver production write
- LIVE cutover

## After W5

Replacement waves W1–W5 are proven in shadow. Item 7 met still requires remaining=0 plus independent Retirement review, rollback, and quarantine proofs.

## Files

- `src/memory/item7-w5-index-last.ts`
- `src/memory/item7-w5-index-last.test.ts`
- `docs/design/evidence/memory-workspace-phase1b-item7-w5-index-last.json`
- `docs/design/evidence/memory-workspace-phase1b-item7-w5-index-last.test.mjs`
- `docs/design/evidence/memory-workspace-phase1b-item7-w5-index-last-handoff.md`

## Tests

```bash
pnpm exec vitest run src/memory/item7-w5-index-last.test.ts
node --test docs/design/evidence/memory-workspace-phase1b-item7-w5-index-last.test.mjs
```
