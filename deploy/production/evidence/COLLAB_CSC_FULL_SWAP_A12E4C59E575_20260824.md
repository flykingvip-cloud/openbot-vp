# Collaboration CSC full-swap a12e4c59e575

Date: 2026-08-24

Status: **LIVE full-swap accepted** · flags unchanged · official seq 41

#656 was merged, then `origin/main` moved to #658 `a12e4c59e575`. The post-#656 pack `b8cbf0b3ad` expired and was **not** cut over.

## Identities

| Record                              | SHA                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Frozen `origin/main` at build+swap  | `a12e4c59e5754e0c280b423c68c989c6973ac9b0`                                                                                      |
| LIVE `build-info.commit` after swap | `a12e4c59e5754e0c280b423c68c989c6973ac9b0`                                                                                      |
| Image                               | `localhost/openbot:rc-amd64-provenance-a12e4c59e575` `ImageID=f2fcc345923017749ef03a46cc41bb4cd49bbc12758d7cb3ba74710966a25f74` |
| Previous observed LIVE overlay      | `47d6934c34dced654652f027f2c66fedea35a67f` on `5c221b9ec3` (unledgered)                                                         |
| Previous ledger Latest / seq 40     | `33993e52e5540f76e57d66ab75d8955420437d3a`                                                                                      |

## Gates

| Gate                                     | Verdict                    |
| ---------------------------------------- | -------------------------- |
| Shadow-3                                 | PASS 5/5                   |
| Ledger audit                             | 0 errors                   |
| Forward-only vs actual LIVE `47d6934c34` | ALLOW                      |
| Delivery alignment                       | PASS=8 WARN=2 FAIL=0       |
| Isolated smoke `:18889`                  | PASS · `touchedLive=false` |
| Rollback drill `:18890`                  | PASS on `5c221b9ec3`       |
| verify-live                              | PASS                       |

## Non-actions

No inbound / CSC / CONTEXT_SCOPE enablement. No force-push of `main`. Expired `7ca242` / `b8cbf0` images were not treated as LIVE.
