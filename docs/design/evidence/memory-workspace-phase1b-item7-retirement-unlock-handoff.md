# Phase 1B Item 7 Retirement Unlock

**Request:** Item 7 Retirement Unlock Decision Review

This package submits the independent **Item 7 Retirement unlock** decision after W1-W5 shadow proofs and #584 `w5CallSiteShadowComplete`. It does not issue Item 7 Retirement unlock, does not delete productionWriteWatchIndex call-sites, and does not request Item 7 met. signedBy=null.

| Field                       | Value                                                         |
| --------------------------- | ------------------------------------------------------------- |
| operationId                 | `phase1b-item7-retirement-unlock-e0d5c37501-20260821T170300Z` |
| origin/main baseline        | `e0d5c3750166692bbcdd324854ee65e4a358a9f1`                    |
| W5 shadow PR                | <https://github.com/gmood2008/openbot/pull/578>               |
| batch-9 PR                  | <https://github.com/gmood2008/openbot/pull/584>               |
| requestedUnlock             | item7-retirement                                              |
| unlock                      | **not-issued**                                                |
| signedBy                    | null                                                          |
| Item 7                      | **not-met**                                                   |
| item7ImplementationUnlocked | true                                                          |
| item7RetirementUnlocked     | false                                                         |
| retirement                  | forbidden                                                     |
| productionWriteWatchIndex   | 38                                                            |
| liveWriteWatchIndex         | 37                                                            |
| retiredThisChange           | 0                                                             |
| phase1bUnlock               | not-issued                                                    |
| phase1bExecutionBlocked     | true                                                          |
| productionCatalogWrite      | none                                                          |
| schemaV2Write               | disabled                                                      |
| deployAuthorized            | false                                                         |
| live                        | forbidden                                                     |

If later independently issued, that means **allow Item 7 Retirement execute in a later apply** (delete the 37 live call-sites). It does **not** mean this packet deletes sites, Item 7 met, LIVE, or Phase 1B full unlock.

## Not requested / still forbidden after a later issued receipt

- score item 7 met while `liveWriteWatchIndex` is not 0
- rewrite liveWriteWatchIndex 37 to 0 without deleting sites
- rewrite Freeze 38 to 0
- Catalog miss=deny
- schema v2 production write
- Catalog write
- LIVE cutover
- Phase 1B full unlock

## Files

- `docs/design/evidence/memory-workspace-phase1b-item7-retirement-unlock-request.json`
- `docs/design/evidence/memory-workspace-phase1b-item7-retirement-unlock-proposed-receipt.json`
- `docs/design/evidence/memory-workspace-phase1b-item7-retirement-unlock.test.mjs`
- `docs/design/evidence/memory-workspace-phase1b-item7-retirement-unlock-handoff.md`

## Tests

```bash
node --test docs/design/evidence/memory-workspace-phase1b-item7-retirement-unlock.test.mjs
```

Canonical unlock receipt stays `not-issued`. Proposed receipt is not effective.
