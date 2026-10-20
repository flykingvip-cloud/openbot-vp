# Data Governance v2 — P4-d Codex Handoff (placement export / restore)

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Prior review tip:** `6595f0ff8dec8f0aeb9dd9f601ee19e336ee4d58` (P4-c CR pin, **Accepted**)  
**This document does not claim P4-d Accepted, P4 first-wave Accepted, or P4 Accepted.**  
**P5 coding stays locked until P4 first-wave Accept.**

---

## Slice

P4-d is **export / restore across first-wave placement**. Restore reapplies the **binding image only**. It never rewrites `resourceId` / `agentAssetId`. A placement export is **not** a P5 longevity bundle and is **not** a promotion grant.

Frozen receipt (`design-p4.md` §12 / Gate D17) plus durable unique-create fields:

```ts
kind: "p4_placement_export_receipt";
(receiptId, replayId, grantId, resourceId, agentAssetId, tenantId);
(fromBindingId, toCanonicalBindingId, projectionBindingId);
canonicalHome: "local" | "managed_encrypted_cloud";
mode: "local-only" | "encrypted-cloud";
(contentVersion, checksum);
state: "prepared" | "applied" | "failed";
```

Checksum is required on every state (unlike promotion `prepared`).

---

## Implementation SHA

| Milestone                                | SHA                                        |
| ---------------------------------------- | ------------------------------------------ |
| Prior review tip (P4-c CR pin, Accepted) | `6595f0ff8dec8f0aeb9dd9f601ee19e336ee4d58` |
| **This P4-d implementation**             | `e92c35f806d23bec12819411bbdb7b0601ae45b0` |
| **This review tip**                      | `e6e0a534a85f0e0e546d2ef9548494c78167a03b` |

---

## Files changed

- `src/gateway/data-governance/placement-export.ts` (new)
- `src/gateway/data-governance/placement-export-store.ts` (new)
- `src/gateway/data-governance/placement-export.test.ts` (new)
- `src/gateway/data-governance/types.ts`
- `src/gateway/data-governance/cognitive-approval-grant-store.ts`
- `src/gateway/data-governance/paths.ts`
- `src/gateway/data-governance/index.ts`
- `src/gateway/data-governance/cognitive-promotion.test-harness.ts`
- `.kiro/specs/data-governance-v2-p4/codex-handoff-p4d.md`
- `.kiro/specs/data-governance-v2-p4/tasks.md`

Barrel exports `exportPlacement` / `restorePlacement` only. Store internals (`uniqueCreatePlacementExportReceipt`, `finalizePlacementExportReceipt`) stay private.

---

## Grant / auth

Grant kind is **`placement_export_restore`**, resource-scoped. Dedicated kind; promotion / tombstone / merge grants are `grant_kind_mismatch`.

Export and restore both require branded `GovernanceAuthenticatedCall` + `GovernanceApprovalAuth`:

1. Same actor
2. `grantKind === placement_export_restore` and resource scope = target `resourceId`
3. Re-read stored grant (revoked / expired / kind / scope / tenant)
4. Catalog load; `envelope.tenantId === call.callerTenantId`
5. Ownership proof vs Catalog (write-gate, plus tenant-user proof for user-scoped tenant rows)

No raw `tenantId` on the public APIs.

```ts
exportPlacement({ call, auth, resourceId });
restorePlacement({ call, auth, bundle });
```

---

## Export

- Exactly one writable canonical; else `catalog_corrupt`.
- First-wave storage only (`filesystem | sqlite | object-store`); else `first_wave_adapter_unavailable`.
- Checksum = sha256 of canonical **bytes** (local filesystem / replica locator). After cloud cutover, hash the local replica; if only object-store remains, fall back to envelope projection checksum.
- `canonicalHome` / `mode` from current bindings: object-store writable canonical → `managed_encrypted_cloud` / `encrypted-cloud`; else local; presence of a `derived` binding also makes `mode: encrypted-cloud`.
- `replayId = sha256(grantId + resourceId + fromBindingId + toCanonicalBindingId + checksum)`.
- Unique-create `prepared`, then finalize `applied`. Replay of an already-applied receipt returns the durable row. No Catalog write on export.

---

## Restore

Bundle kind `p4_placement_export_bundle`. Allowed keys: `kind | receipt | bindings`. Extra keys or L3 names (`credentials | outbox | cursors | locks | caches`) → `bundle_member_excluded`.

Order:

1. Parse bundle
2. Load durable receipt by `replayId`; must be `applied`
3. Bundle receipt identity (`resourceId` / `agentAssetId` / `grantId` / `toCanonicalBindingId`) must equal durable
4. Auth against **durable.resourceId**
5. Catalog identity must equal durable (`resourceId`, `agentAssetId`, tenant)
6. Force `binding.resourceId = envelope.resourceId`; rewritten binding `resourceId` → `identity_rewrite_rejected`
7. Later-wave `byos` (and any non-first-wave kind) → `first_wave_adapter_unavailable`
8. Exactly one writable canonical after restore; else `catalog_corrupt`
9. Writable canonical `bindingId === receipt.projectionBindingId` → `projection_as_canonical`
10. Ordinary Catalog `compareAndPut` (not privileged cognitive CAS) of **bindings + `canonicalBindingId` only**. Envelope identity fields are copied unchanged.

Restore of an already-matching image is replay (`replay: true`) and does not CAS.

---

## Tests and commands

`placement-export.test.ts` **12** tests:

- Local export: receipt fields, checksum of canonical bytes, `resourceId` unchanged
- Export after managed-cloud cutover: `canonicalHome=managed_encrypted_cloud`, one writable canonical
- Restore reapplies local bindings after cloud cutover without changing `resourceId` / `agentAssetId`
- Restore rejects L3 members `credentials|outbox|cursors|locks|caches`
- Restore rejects binding `resourceId` rewrite
- Restore rejects `agentAssetId` rewrite on the bundle receipt
- Cross-tenant export → `envelope_tenant_mismatch`
- Promotion grant cannot export → `grant_kind_mismatch`
- Later-wave `byos` binding → `first_wave_adapter_unavailable`
- Dual writable canonical image → `catalog_corrupt`
- Restore must not make the projection the writable canonical
- Barrel does not export store internals

```text
OPENBOT_TEST_PROFILE=low VITEST_CACHE_DIR=/tmp/vitest-p4d \
pnpm exec vitest run \
  src/gateway/data-governance/placement-export.test.ts \
  src/gateway/data-governance/cognitive-promotion-apply.test.ts \
  src/gateway/data-governance/cognitive-promotion.test.ts \
  src/gateway/data-governance/placement-resolve.test.ts \
  src/gateway/data-governance/placement-platform-root.test.ts \
  src/gateway/data-governance/cognitive-cas-boundary.test.ts
# Test Files  6 passed (6)
# Tests  166 passed (166)

node --test .kiro/specs/data-governance-v2-p4/gate-p4-cr2.test.mjs
# tests 2, pass 2
```

---

## Full `pnpm check` / `pnpm tsgo`

Full `pnpm check` is not claimed. Scoped `oxlint --type-aware` and `oxfmt --check` on this slice's production/test files: 0 warnings, 0 errors.

---

## Stop

P4-d export / restore is submitted for Codex Accept.

**未宣称 P4-d Accepted / P4 first-wave Accepted / P4 Accepted。P5 coding 仍锁定。**

Do **not** start P5 coding until Codex explicitly writes **P4 first-wave Accept**.
