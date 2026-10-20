# P4 Later-Wave Design — Post First-Wave Adapters (Planning Skeleton)

**Status:** L-a/b/c/d **Accepted** 2026-08-18. Umbrella **Accepted**. Production enablement gates **submitted** (not LIVE cutover).  
**Depends on:** P4 first-wave Accepted (`4dd0da593f`); `design-p4.md` D1–D19 frozen  
**Architecture:** §12, §16 P4 later adapters

## 1. Relationship to first wave

All P4 first-wave contracts in `../data-governance-v2-p4/design-p4.md` remain in force. This document **adds** later-wave resolver rows, adapter kinds, key refs, and export manifest fields. It **retires** specific deny codes **per slice** only after that slice is Accepted.

## 2. Resolver extensions (TBD)

For each slice, Codex must freeze before coding:

- Allowed `PlacementResolverOutput.mode` / `canonicalHome` / `projection` values
- New or extended `keyRef.kind` union members
- Region / replication selection rules
- Deny codes that remain vs retire

### 2.1 Draft sync map additions (not frozen)

| Slice  | `syncClassification`      | Draft outcome                                                                                                                                                     |
| ------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P4-L-a | `tenant-cloud`            | `mode: tenant-cloud`, `canonicalHome: tenant_managed_cloud`, `projection: none` (**Accepted** 2026-08-18)                                                         |
| P4-L-b | dedicated profile + flags | `mode: dedicated`, `canonicalHome: dedicated_regional`, `projection: none`; `replicationClass: regional` allowed; `multi-region` denied (**Accepted** 2026-08-18) |
| P4-L-c | `byos-only`               | `mode: byos`, `canonicalHome: byos`, `projection: none`; custodian `byos`; `storageKind: byos` (**Accepted** 2026-08-18)                                          |
| P4-L-d | `archive-only`            | `mode: cold-archive`, `canonicalHome: cold_archive`, `projection: none`; custodian `openbot`; live recall `archive_recall_denied` (**Accepted** 2026-08-18)       |

## 3. Adapter kinds (TBD)

Extend `LaterWaveAdapterKind` implementations in `cognitive-promotion-adapters.ts` **only after** slice unlock. Each adapter must:

- Respect tenant binding on every read/write
- Fail closed on missing grant / wrong grant kind
- Never create a second writable canonical

## 4. Export / restore (TBD)

Extend `p4_placement_export_receipt` payload or add slice-specific receipt kinds **only** if Codex requires distinct audit surfaces. Binding-only identity rule (D17) is non-negotiable.

## 5. Test matrix (planning names)

1. First-wave deny tests remain green without modification.
2. Unaccepted slice: later adapter kind still fails closed.
3. Accepted slice: directed allow matrix for that adapter only.
4. Cross-tenant false allow = 0 for slice matrix.
5. Tombstone order unchanged from first-wave §6.5.

Detail per slice in handoffs `codex-handoff-p4la.md` … `codex-handoff-p4ld.md`.

## 6. Production enablement gates (I4)

Later-wave **slice Accept ≠ production LIVE**. Enablement command `runLaterWaveProductionEnablement` fail-closes unless all four operator gates pass:

| Gate     | Check                                                                                                                                                                                  | Deny                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 独立部署 | Dedicated execution boundary (`assertMigrationProductionBoundary`); dedicated adapter requires `deploymentProfile === "dedicated"`; tenant-cloud / BYOS / archive refuse dedicated mix | `independent_deployment_denied` |
| 密钥     | `OPENBOT_PROMOTION_KEY_HMAC_KEY` present; `keyRef.kind` matches adapter (`platform_tenant` / `dedicated_tenant` / `byos_customer` / `archive_tenant`)                                  | `key_gate_denied`               |
| 区域     | Trusted branded region receipt bound to `auth.tenantId`                                                                                                                                | `region_gate_denied`            |
| 运维     | C19 summary `verifyC19ProbeEvidence` (ops tracking; **not** “audit baseline signed”)                                                                                                   | `ops_gate_denied`               |

`productionReady: true` only when every finding passes. Host evaluator `evaluateLaterWaveEnablementAtHost` and RPC `dataGovernance.laterWave.evaluateEnablement` derive profile / key kind / C19 from env, verify a signed region receipt, and always record `liveCutover: false`. This does **not** cut over a LIVE container or write Catalog.

## 7. LIVE cutover decision (fail closed)

`decideLaterWaveCutover` / `scripts/ops/evaluate-later-wave-cutover.ts`:

| Check                                   | Fail closed                           |
| --------------------------------------- | ------------------------------------- |
| I4 enablement receipt `productionReady` | `enablement_not_ready`                |
| Clean worktree + `HEAD === origin/main` | `trunk_dirty` / `not_origin_main_tip` |
| `--cutover` / `--live`                  | `live_cutover_forbidden`              |

`cutoverAllowed` is **always false** in this drop. A green I4 receipt is not a production switch.
