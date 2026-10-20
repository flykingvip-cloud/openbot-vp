# Data Governance v2 — P4-L-a Codex Handoff (tenant-cloud)

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Prerequisite:** M0–M4 migration **Accepted** (`14a4f22d1d`); P4 first-wave **Accepted** (`4dd0da593f`)  
**This document records P4-L-a Codex Accept (2026-08-18). It does not claim P4-L-d or later-wave umbrella Accepted.**

---

## Scope

P4-L-a only: **tenant-cloud** resolver row + tenant-managed-cloud adapter path.

| In                                                                                         | Out                                    |
| ------------------------------------------------------------------------------------------ | -------------------------------------- |
| `syncClassification: tenant-cloud` allow path in `placement-resolve.ts`                    | BYOS / dedicated / cold-archive unlock |
| Tenant-managed-cloud object store under `{stateDir}/data-governance/tenant-managed-cloud/` | Migration inventory quarantine change  |
| Prepare + apply for `canonicalHome: tenant_managed_cloud`                                  | P4-L-b/c/d                             |

## Frozen contracts (this slice)

| Field           | Value                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`          | `tenant-cloud`                                                                                                                               |
| `canonicalHome` | `tenant_managed_cloud`                                                                                                                       |
| `projection`    | `none`                                                                                                                                       |
| Custodian       | `tenant` required in `tenantContract.allowedCustodians`                                                                                      |
| Region          | Branded platform deployment-region receipt (same as first-wave cloud)                                                                        |
| Object kind     | `tenant_managed_cloud_object`                                                                                                                |
| Later-wave stub | `laterWaveAdapterAvailability("tenant-cloud")` → `{ ok: true, adapter: "tenant-cloud" }`; byos / cold-archive / dedicated remain fail-closed |

## Deny codes retired for tenant-cloud only

- `sync_class_not_first_wave` no longer applies to `syncClassification === "tenant-cloud"` when tenant custodian + trusted region satisfy policy.

All other deny codes unchanged. BYOS / archive / dedicated / replication / dedicated-key paths unchanged.

## Tests

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/data-governance/placement-resolve.test.ts \
  src/gateway/data-governance/cognitive-promotion-apply.test.ts \
  src/gateway/data-governance/cognitive-promotion.test.ts
```

Directed matrix highlights:

- tenant-cloud allow: tenant custodian + trusted region → `mode: tenant-cloud`, `canonicalHome: tenant_managed_cloud`, `projection: none`
- tenant-cloud deny: missing tenant custodian, missing trusted region, legal hold
- apply e2e: prepare + apply writes `tenant_managed_cloud_object` under `tenant-managed-cloud/`
- byos / cold-archive / dedicated adapter stub still fail-closed

## Non-goals (unchanged)

- `laterWaveLocked()` migration quarantine still treats all `laterWaveAdapter` sources as blocked during legacy migration
- No second writable canonical; tombstone order unchanged from P4 first-wave

---

## Submit checklist

- [ ] Codex review resolver + adapter + receipt union extensions
- [ ] Cross-tenant false allow = 0 on directed matrix
- [ ] First-wave tests remain green without weakening exit bars

## Changes Required follow-up (2026-08-18)

Codex returned **Changes Required** (not Accept). Path containment + encrypt `keyRef.kind` runtime checks:

- Shared resolver: `cognitive-promotion-adapter-path.ts` (`assertSafeAdapterPathSegment` + `path.resolve`/`path.relative` under adapter root **and** tenant prefix)
- Write and unlink of tenant-cloud objects both call `tenantManagedCloudObjectPath` → that resolver
- `encryptTenantManagedCloudObject` requires `keyRef.kind === "platform_tenant"` at runtime
- Directed negatives: `cognitive-promotion-adapters.test.ts` (`../escape`, absolute path, cross-tenant segment)

## Codex Accept (2026-08-18)

**P4-L-a Accepted.** Later-wave umbrella remains **not claimable** until P4-L-d is Accepted.
