# Data Governance v2 — P4-L-c Codex Handoff (BYOS)

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Prerequisite:** M0–M4 migration **Accepted** (`14a4f22d1d`); P4 first-wave **Accepted** (`4dd0da593f`); P4-L-a/b **Accepted** (2026-08-18)  
**This document records P4-L-c Codex Accept (2026-08-18). It does not claim P4-L-d or later-wave umbrella Accepted.**

---

## Scope

P4-L-c only: **BYOS** resolver row + customer-controlled storage adapter.

| In                                                                   | Out                                       |
| -------------------------------------------------------------------- | ----------------------------------------- |
| `syncClassification: byos-only` allow path in `placement-resolve.ts` | cold-archive unlock                       |
| BYOS object store under `{stateDir}/data-governance/byos/`           | Mixing dedicated profile with `byos-only` |
| Binding `storageKind: byos` + `keyRef.kind: byos_customer`           | Migration inventory quarantine change     |
| Placement export/restore accepts genuine BYOS bindings               | P2 purge BYOS success path                |

## Frozen contracts (this slice)

| Field           | Value                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| `mode`          | `byos`                                                                                                     |
| `canonicalHome` | `byos`                                                                                                     |
| `projection`    | `none`                                                                                                     |
| Custodian       | `byos` required in `tenantContract.allowedCustodians`                                                      |
| Region          | Branded platform deployment-region receipt                                                                 |
| Object kind     | `byos_object`                                                                                              |
| Binding storage | `storageKind: byos`                                                                                        |
| Key wrap        | `wrap:byos_customer:<tenantId>` / `byos-keyref:<tenantId>`                                                 |
| Later-wave stub | `laterWaveAdapterAvailability("byos")` → `{ ok: true, adapter: "byos" }`; cold-archive remains fail-closed |

## Deny codes retired for byos-only only

- `sync_class_not_first_wave` no longer applies to `syncClassification === "byos-only"` when byos custodian + trusted region satisfy policy.

Dedicated + `byos-only` stays `first_wave_adapter_unavailable` (isolation models do not mix).

`archive-only` and `tenant-only` remain later-wave denied.

## Tests

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/data-governance/placement-resolve.test.ts \
  src/gateway/data-governance/cognitive-promotion-apply.test.ts \
  src/gateway/data-governance/cognitive-promotion.test.ts \
  src/gateway/data-governance/placement-export.test.ts
```

Directed matrix highlights:

- byos allow: byos custodian + trusted region → `mode: byos`, `canonicalHome: byos`, `projection: none`
- byos deny: missing byos custodian, missing trusted region, legal hold, dedicated profile mix
- apply e2e: prepare + apply writes `byos_object` with `storageKind: byos`
- tampered first-wave bundle that flips `storageKind` to `byos` still fails integrity
- cold-archive adapter stub still fail-closed

## Non-goals (unchanged)

- `laterWaveLocked()` still quarantines `storageKind === "byos"` and `laterWaveAdapter` sources during legacy migration
- P2 purge still fail-closes BYOS (separate adapter)
- No second writable canonical; tombstone order unchanged

---

## Submit checklist

- [ ] Codex review resolver + `storageKind: byos` + `byos_customer` keyRef
- [ ] Cross-tenant false allow = 0 on directed matrix
- [ ] First-wave tests remain green without weakening exit bars

## Changes Required follow-up (2026-08-18)

Codex returned **Changes Required** (not Accept). Path containment + encrypt `keyRef.kind` runtime checks:

- Shared resolver: `cognitive-promotion-adapter-path.ts`; `byosObjectPath` used by both write and unlink
- `encryptByosObject` requires `keyRef.kind === "byos_customer"` at runtime (dedicated / platform keyRef rejected)
- Directed negatives: `cognitive-promotion-adapters.test.ts` (`../escape`, absolute path, cross-tenant segment)

## Codex Accept (2026-08-18)

**P4-L-c Accepted.** Later-wave umbrella remains **not claimable** until P4-L-d is Accepted.
