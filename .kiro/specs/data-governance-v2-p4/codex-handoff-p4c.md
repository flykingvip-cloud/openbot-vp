# Data Governance v2 — P4-c Codex Handoff (first-wave adapters)

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Prior review tip:** `5a3337b56fae7a5948480a4b507c560ac0bc9563` (P4-b CR3 pin)  
**This document does not claim P4-c Accepted, P4 first-wave Accepted, or P4 Accepted.**  
**P4-d was not started. P4-d stays locked until P4-c Accept. P5 coding stays locked until P4 first-wave Accept.**

---

## Closed this round

P4-c implements design-p4.md §§4 steps 10–12, §6, §7, §9: local + OpenBot managed encrypted cloud adapters, platform_tenant keyRef at prepare, ordinary Catalog `compareAndPut` as the only irreversible commit, and §6.5 tombstone order.

| Frozen contract                                  | Implementation                                                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| First wave only: local + managed encrypted cloud | `laterWaveAdapterUnavailable` for BYOS / tenant-cloud / dedicated / cold-archive → `first_wave_adapter_unavailable`               |
| P4-a resolver stays `keyRef: null`               | Prepare attaches `platform_tenant` via key-service HMAC (`OPENBOT_PROMOTION_KEY_HMAC_KEY`); `resolvePlacement` unchanged          |
| Cloud prepare without key/region                 | still `key_ref_required`                                                                                                          |
| Adapter writes are speculative                   | Apply journal `applies.json.apply-txn`; receipt stays `prepared` until Catalog CAS                                                |
| One irreversible commit                          | ordinary Catalog `compareAndPut` (not privileged cognitive CAS)                                                                   |
| Exactly one writable canonical                   | cutover: cloud object-store `role=canonical`+`state=active`; prior local `replica`+`read_only`; projection `derived`              |
| Never rewrite `resourceId` / `agentAssetId`      | cutover updates bindings only                                                                                                     |
| Checksum = sha256 of canonical resource bytes    | filled at apply; `applied` receipts require checksum; `prepared`/`conflicted`/`aborted` omit it                                   |
| Tombstone order §6.5                             | (1) durable tombstone `N+1` (2) persist checksum (3) Catalog CAS (4) then hide body                                               |
| Tombstone wins                                   | serve refuses stale body when tombstone file exists                                                                               |
| Apply lives outside `cognitive-promotion.ts`     | `cognitive-promotion-apply.ts`; source guard: no `object-store\|encryptBytes\|uploadProjection\|tombstoneVersion` in prepare file |

---

## Implementation SHA

| Milestone                       | SHA                                        |
| ------------------------------- | ------------------------------------------ |
| Prior review tip (P4-b CR3 pin) | `5a3337b56fae7a5948480a4b507c560ac0bc9563` |
| Prior P4-b CR3 implementation   | `868de8c348e3b8538d0c960df43acdbef05405af` |
| **This P4-c implementation**    | `25970a468f7770bbd10aa0989957b1a3652feb69` |
| **This review tip**             | `b1f0ff310d25589b4c51038468e82161170d807e` |

---

## Files changed

New:

- `src/gateway/data-governance/cognitive-promotion-key.ts`
- `src/gateway/data-governance/cognitive-promotion-adapters.ts`
- `src/gateway/data-governance/cognitive-promotion-apply.ts`
- `src/gateway/data-governance/cognitive-promotion-apply.test.ts`

Modified:

- `src/gateway/data-governance/cognitive-promotion.ts` (attach platform_tenant keyRef at cloud prepare)
- `src/gateway/data-governance/cognitive-promotion-store.ts` (`ApplyTxnJournal`, `finalizePromotionReceipt` prepared→applied)
- `src/gateway/data-governance/cognitive-promotion.test-harness.ts`
- `src/gateway/data-governance/envelope.ts` (first-wave projection allowlist: checksum / consentVersion / contentVersion / policyVersion / tombstoneVersion)
- `src/gateway/data-governance/paths.ts` (`resolveManagedEncryptedCloudRoot`, `resolveCloudProjectionRoot`)
- `src/gateway/data-governance/types.ts` (`CloudProjectionEnvelope`)
- `src/gateway/data-governance/index.ts` (export apply / serve / tombstone / later-wave deny; do not export store internals)
- `.kiro/specs/data-governance-v2-p4/codex-handoff-p4c.md`
- `.kiro/specs/data-governance-v2-p4/tasks.md`

Barrel must not export `writeApplyTxnJournal` / `finalizePromotionReceipt` / `uniqueCreatePreparedPromotionReceipt`.

---

## Adapters

Stand-in roots (not production object-store):

- Local canonical bytes: Catalog locator (`<stateDir>/<resourceId>`)
- Managed encrypted cloud: `data-governance/managed-encrypted-cloud/<tenant>/<region>/<objectKey>`
- Cloud Intelligence projection: `data-governance/cloud-projections/<tenant>/<resourceId>.json|.body|.tombstone`

Encryption: AES-256-GCM content DEK, wrapped with `wrap:platform_tenant:<tenantId>`. Platform HMAC secret does not encrypt content directly. Cross-tenant `keyRef` → `key_tenant_mismatch`. Dedicated/BYOS key kinds → `dedicated_key_unsupported`.

Local-only apply (`canonicalHome=local`): local stays sole writable canonical; optional projection is `derived`.

Cloud cutover (`encrypted-cloud` without `offlineRequired` → `canonicalHome=managed_encrypted_cloud`): managed-cloud object becomes canonical; prior local demoted to replica/read_only; projection stays derived.

---

## Key / region

- Authority is the platform key-service receipt bound to `call.callerTenantId` (not a client-supplied `encryptionKeyRef`).
- First-wave `keyRef.kind` is only `platform_tenant`.
- Missing HMAC env, unauthenticated call, tenant mismatch, or missing region → `key_ref_required` at prepare (cloud) and again at apply.
- Region remains P4-a `trustedRegionDefault` after the membership test. No `deploymentDefault`. Empty intersection stays `residency_conflict` / `missing_trusted_region`.

---

## Catalog CAS

Apply journal path: `{applies.json}.apply-txn`.

1. Speculative adapter write (local and/or managed-cloud + projection).
2. One ordinary `compareAndPut` that, in one record: exactly one `canonical`+`active`; demotes prior local on cutover; attaches derived projection checksum / `tombstoneVersion` / `contentVersion`.
3. Finalize receipt `applied` with checksum of canonical bytes.
4. Unlink apply journal.

`catalogMatchesIntent` requires envelope projection checksum to equal the apply checksum, so the first apply always CAS-bumps `governanceVersion`. Adapter writes before CAS are reclaimed on crash if Catalog is unchanged.

---

## Tombstone order (§6.5)

`tombstoneCognitiveProjection`:

1. Durable tombstone `N+1` in the projection store.
2. Persist tombstone checksum.
3. Catalog CAS updates envelope projection `tombstoneVersion` / checksum.
4. Only then `markProjectionBodyUnreadable`.

Fault inject: `faultAfter: "tombstone" | "tombstone_checksum" | "catalog_cas"`. Serve refuses a body when the tombstone file exists (tombstone wins). Forbidden: CAS-clear canonical before tombstone is durable; serve a projection whose tombstoneVersion is behind Catalog.

---

## Crash matrix

Apply journal: `data-governance/cognitive-promotions/applies.json.apply-txn`  
Fault inject (test runtime only): `faultAfter: "adapter" | "catalog_cas"`

| Observed                                                                                          | Recovery                                                                                                       |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Receipt `prepared`, Catalog unchanged (crash after adapter, before CAS)                           | Reclaim orphan adapter writes; do not flip roles; local remains sole writer; retry is idempotent on `replayId` |
| Receipt `prepared`, Catalog already matches intended post-image (crash after CAS, before receipt) | Heal receipt → `applied`                                                                                       |
| Receipt `applied`                                                                                 | Never re-activate the demoted local as writable                                                                |
| Two `canonical`+`active`                                                                          | `catalog_corrupt` / `catalog_not_found`; no writes; fail closed                                                |
| Zero writable canonical                                                                           | Fail closed; do not invent a writer from a projection or replica                                               |

Tombstone crash: durable tombstone + checksum with Catalog unchanged → body not yet hidden; CAS not yet applied; retry continues from Catalog. After CAS, body is marked unreadable.

---

## Tests and commands

`cognitive-promotion-apply.test.ts` (12):

1. Local-only apply: checksum of canonical bytes + one Catalog CAS (`governanceVersion` 1→2)
2. Managed encrypted cloud cutover: exactly one writable canonical
3. `resourceId` unchanged across local → managed cloud cutover
4. Later-wave adapters deny `first_wave_adapter_unavailable`
5. Projection envelope missing checksum / consentVersion / tombstoneVersion rejected
6. Adapter-crash: Catalog unchanged → reclaim orphans, do not flip roles
7. CAS-crash: Catalog already matches → heal `prepared` → `applied`
8. Applied cutover never re-activates demoted local
9. Two writable canonicals fail closed
10. Tombstone + checksum before Catalog CAS, then hide body
11. Tombstone wins against a stale projection body
12. Barrel does not export apply internals

Scoped vitest: **146 passed / 5 files** (`cognitive-promotion-apply.test.ts` 12, `cognitive-promotion.test.ts` 42, `placement-resolve.test.ts` 81, `placement-platform-root.test.ts` 4, `cognitive-cas-boundary.test.ts` 7).

```text
OPENBOT_TEST_PROFILE=low VITEST_CACHE_DIR=/tmp/vitest-p4c \
pnpm exec vitest run \
  src/gateway/data-governance/cognitive-promotion-apply.test.ts \
  src/gateway/data-governance/cognitive-promotion.test.ts \
  src/gateway/data-governance/placement-resolve.test.ts \
  src/gateway/data-governance/placement-platform-root.test.ts \
  src/gateway/data-governance/cognitive-cas-boundary.test.ts
# Test Files  5 passed (5)
# Tests  146 passed (146)

node --test .kiro/specs/data-governance-v2-p4/gate-p4-cr2.test.mjs
# tests 2, pass 2
```

---

## Full `pnpm check` / `pnpm tsgo`

Full `pnpm check` is not claimed. Scoped checks on this slice’s files:

**P4-c scoped lint:** `oxlint --type-aware` on the implementation/test files → 0 warnings, 0 errors.

**P4-c scoped format:** `oxfmt --check` on those files → pass.

`git diff --check` on the P4-c paths is clean.

---

## Stop

P4-c first-wave adapters / key / Catalog CAS / tombstone order are submitted for Codex Accept.

**未启动 P4-d。未宣称 P4-c Accepted / P4 first-wave Accepted / P4 Accepted。**

Do **not** start P4-d until Codex explicitly writes **P4-c Accept**.
