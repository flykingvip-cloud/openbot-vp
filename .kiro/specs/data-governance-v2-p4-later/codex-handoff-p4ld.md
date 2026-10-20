# Data Governance v2 — P4-L-d Codex Handoff (cold archive)

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Prerequisite:** M0–M4 migration **Accepted** (`14a4f22d1d`); P4 first-wave **Accepted** (`4dd0da593f`); P4-L-a/b/c **Accepted** (2026-08-18)  
**This document records P4-L-d Codex/operator Accept (2026-08-18). Later-wave umbrella is Accepted separately; this does not claim LIVE cutover.**

---

## Scope

P4-L-d only: **cold archive** resolver row + archive object adapter + live recall deny.

| In                                                                         | Out                                                  |
| -------------------------------------------------------------------------- | ---------------------------------------------------- |
| `syncClassification: archive-only` allow path in `placement-resolve.ts`    | `tenant-only` unlock                                 |
| Cold-archive object store under `{stateDir}/data-governance/cold-archive/` | Mixing dedicated profile with `archive-only`         |
| Binding `storageKind: object-store` + `keyRef.kind: archive_tenant`        | `role=archive` as writable canonical                 |
| `serveCloudProjection` explicit `archive_recall_denied`                    | `costObjective: archive_preferred` unlocking archive |
| Placement export/restore detects `/data-governance/cold-archive/` locators | Migration inventory quarantine change                |

## Frozen contracts (this slice)

| Field              | Value                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `mode`             | `cold-archive`                                                                                                            |
| `canonicalHome`    | `cold_archive`                                                                                                            |
| `projection`       | `none`                                                                                                                    |
| Custodian          | `openbot` required in `tenantContract.allowedCustodians`                                                                  |
| Region             | Branded platform deployment-region receipt                                                                                |
| Object kind        | `cold_archive_object`                                                                                                     |
| Binding storage    | `storageKind: object-store`                                                                                               |
| Key wrap           | `wrap:archive_tenant:<tenantId>` / `archive-keyref:<tenantId>`                                                            |
| Later-wave stub    | `laterWaveAdapterAvailability("cold-archive")` → `{ ok: true, adapter: "cold-archive" }`                                  |
| Live recall        | `serveCloudProjection` → `archive_recall_denied` when writable canonical locator is under `data-governance/cold-archive/` |
| Apply binding role | `role: canonical` + `canonicalHome: cold_archive` (never `role=archive`)                                                  |

## Deny codes retired for archive-only only

- `sync_class_not_first_wave` no longer applies to `syncClassification === "archive-only"` when openbot custodian + trusted region satisfy policy.

Remaining later-wave sync deny: **`tenant-only` only**.

Dedicated + `archive-only` stays `first_wave_adapter_unavailable` (isolation models do not mix).

Offline + `archive-only` stays `offline_requires_local_canonical` (cannot keep archive-only and a local writable canonical without dual writable).

`costObjective: archive_preferred` does not unlock archive.

`archive_recall_denied` is an apply/recall code only. It is **not** added to resolver `PLACEMENT_DENY_REASONS` (deny-matrix “exactly once” stays intact).

## Tests

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/data-governance/placement-resolve.test.ts \
  src/gateway/data-governance/cognitive-promotion-apply.test.ts \
  src/gateway/data-governance/cognitive-promotion.test.ts \
  src/gateway/data-governance/placement-export.test.ts \
  src/gateway/data-governance/cognitive-promotion-adapters.test.ts
```

Directed matrix highlights:

- archive allow: openbot + trusted region → `mode: cold-archive`, `canonicalHome: cold_archive`, `projection: none`
- archive deny: missing openbot, missing trusted region, legal hold, offline, dedicated profile mix
- `costObjective: archive_preferred` on `local-only` stays local
- apply e2e: prepare + apply writes `cold_archive_object`; `serveCloudProjection` → `archive_recall_denied`
- export + restore archive locator → `canonicalHome: cold_archive` / `mode: cold-archive`; `resourceId` unchanged
- `encryptColdArchiveObject` requires `keyRef.kind === "archive_tenant"` at runtime
- path containment: `coldArchiveObjectPath` write/unlink share `cognitive-promotion-adapter-path.ts` (`../escape`, absolute, cross-tenant)
- `tenant-only` remains `sync_class_not_first_wave`

## Non-goals (unchanged)

- `laterWaveLocked()` still quarantines all `laterWaveAdapter` / `storageKind === "byos"` migration sources
- No second writable canonical; tombstone order unchanged
- `decideShadowPromotion` not forked
- `role=archive` still never becomes the writable canonical
- P4-L-a/b/c/d are **Accepted** (2026-08-18). Later-wave umbrella **Accepted** (does not claim LIVE). `coldArchiveObjectPath` uses the same contained resolver as L-a/b/c.

---

## Accept checklist

- [x] Operator verdict 2026-08-18: L-a/L-b/L-c/L-d four slices passed
- [x] Cross-tenant false allow = 0 on directed matrix
- [x] First-wave tests remain green without weakening exit bars
