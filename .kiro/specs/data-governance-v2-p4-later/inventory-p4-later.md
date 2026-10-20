# P4 Later-Wave Inventory — Fail-Closed Touchpoints

**Date:** 2026-08-18  
**Baseline:** P4 first-wave Accepted (`4dd0da593f`); v2 program Accepted (`0c34378b07`)  
**Purpose:** Planning inventory for Gate submission — **not** implementation acceptance

## Current fail-closed surfaces (first wave)

| Surface                  | Location                                                      | Behavior today                                                                                                        |
| ------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Later-wave adapter stub  | `src/gateway/data-governance/cognitive-promotion-adapters.ts` | L-a/b/c/d adapters return `{ ok: true }`; remaining later-wave sync deny is `tenant-only`                             |
| Resolver deny codes      | `design-p4.md` §5.3–§5.4                                      | `sync_class_not_first_wave`, `dedicated_key_unsupported`, `dedicated_database_unsupported`, `replication_unsupported` |
| Placement export/restore | `src/gateway/data-governance/placement-export.ts`             | Non-first-wave storage → `first_wave_adapter_unavailable`                                                             |
| Promotion apply          | `src/gateway/data-governance/cognitive-promotion-apply.ts`    | Routes first-wave adapters only; re-exports later-wave stub                                                           |
| Directed tests           | `cognitive-promotion-apply.test.ts`                           | Asserts L-a/b/c/d adapters available; live archive recall denied                                                      |

## Sync classifications blocked (first wave)

| `syncClassification` | Deny (first wave)           | Target slice                                    |
| -------------------- | --------------------------- | ----------------------------------------------- |
| `tenant-only`        | `sync_class_not_first_wave` | TBD — may remain blocked or map to tenant-cloud |
| `tenant-cloud`       | `sync_class_not_first_wave` | P4-L-a                                          |
| `byos-only`          | `sync_class_not_first_wave` | P4-L-c                                          |
| `archive-only`       | `sync_class_not_first_wave` | P4-L-d                                          |

## Policy flags blocked (first wave)

| Input flag                                        | Deny                             | Target slice |
| ------------------------------------------------- | -------------------------------- | ------------ |
| `requireDedicatedKey`                             | `dedicated_key_unsupported`      | P4-L-b       |
| `requireDedicatedDatabase`                        | `dedicated_database_unsupported` | P4-L-b       |
| `replicationClass` ∈ {`regional`, `multi-region`} | `replication_unsupported`        | P4-L-b       |

## Gap summary (planning)

| Adapter          | Resolver row            | Adapter impl                                                                        | Export/restore                                                    | Tests                                                        |
| ---------------- | ----------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| tenant-cloud     | **Accepted** 2026-08-18 | Implemented                                                                         | Locator detect                                                    | Directed allow + path containment                            |
| dedicated        | **Accepted** 2026-08-18 | Implemented                                                                         | Locator detect                                                    | Directed allow + first-wave flag denies                      |
| BYOS             | **Accepted** 2026-08-18 | Implemented                                                                         | `storageKind: byos` accepted                                      | Directed allow + integrity deny on tamper                    |
| cold archive     | **Accepted** 2026-08-18 | Implemented                                                                         | Locator detect + restore                                          | Directed allow + recall deny + path containment              |
| go-live gates    | **submitted**           | `later-wave-production-gate.ts` + RPC `dataGovernance.laterWave.evaluateEnablement` | Receipt `p4_later_wave_enablement_receipt` (`liveCutover: false`) | Four-gate fail-closed + host signed-region + RPC tenant bind |
| cutover decision | **submitted**           | `later-wave-cutover-gate.ts` + `scripts/ops/evaluate-later-wave-cutover.ts`         | `p4_later_wave_cutover_decision` (`cutoverAllowed: false`)        | Dirty tree / not origin/main / `--cutover` fail-closed       |

Fill `design-p4-later.md` §2–§5 at Gate CR before Accept.
