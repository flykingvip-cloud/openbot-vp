# P4 Design — Governed Placement and Sync (Planning)

**Status:** **P4 Accepted** (first-wave scope, closure `4dd0da593f`, 2026-08-18). P4-a/b/c/d slice Accepts recorded. Later adapters locked. v2 first-wave program complete (`0c34378b07`).

**Depends on:** P3 Accepted (`84a4165093`); Gate B Accepted  
**Architecture:** §12, §16 P4, §17.2, §17.5  
**Historical note:** Body below freezes Gate/planning contracts (D1–D19). Status line above is the current Accept ledger.

Retained: all P0–P3 contracts. Especially G2 (scores do not authorize), G6 (no auto-admit Catalog insert), G7/G11 (no engine purge/forget), and the P3 shadow decision module.

This revision freezes contracts that the 2026-08-16 third-party Gate CR required before coding: resolver types and precedence, canonical/mirror state machine, promotion commit/recovery, key/region authority, projection envelope, tombstone E2E order, and the approval grant name.

---

## 1. Split of duties

```text
CogniWeave scores  →  decideShadowPromotion (P3, frozen)
                         │
                         ├─ recommend_deny / invalid_score → stop (no execution)
                         └─ recommend_admit → P4 execution protocol
                              → GovernanceApprovalAuth + grantKind cognitive_promotion_apply
                              → placement resolver (D11–D13)
                              → signed tenant-bound promote
                              → binding / projection CAS (single writable canonical)
                              → durable receipt + tombstone hooks
```

P4 never re-derives allow/deny from raw scores. Callers that skip `decideShadowPromotion` fail closed.

---

## 2. Decision contract (frozen — D1)

Module: `src/gateway/data-governance/cognitive-shadow-promotion.ts`

- Floors: `SHADOW_PROMOTION_MIN = 0.8`, `SHADOW_ADMISSION_MIN = 0.5` (policy change only via that module + Gate amendment — not via executor locals).
- Gates already included: lifecycle blocked set, `restricted`, `privacyLevel=private`, `syncEligibility=blocked`, invalid scores.
- Executor records the decision + `reasonCode` on the promotion receipt; it does not invent parallel reason codes for the same inputs.

---

## 3. Approval contract (frozen — D2 / D15)

No synonym. Gate Accept does not rename these fields.

```ts
grantKind: "cognitive_promotion_apply";

scope: {
  kind: "resource";
  resourceId: string;
}
// One resource per grant. agentAsset-wide or conflict_edge_pair grants
// MUST NOT authorize promotion.

tenantId: string | null; // grant.tenantId MUST equal auth.tenantId
approverUserId: string; // enterprise-ops / tenant-admin only; engine never self-issues
issuerRole: "enterprise-ops" | "tenant-admin";
expiresAt: string; // ISO-8601; required (D19)
state: "unused" | "consumed" | "expired" | "revoked";
```

**Issuance (D19):** unique-create `grantId`. CogniWeave / executor / shadow evaluator MUST NOT mint grants. Apply consumes `unused → consumed`. `consumed` / `expired` / `revoked` cannot authorize.

**Replay identity** (unique, durable):

```text
replayId = sha256(
  grantId + "\0" + recommendationId + "\0" + resourceId + "\0" + decisionFingerprint
)
decisionFingerprint = sha256(canonical JSON of decideShadowPromotion input + output)
```

- A **new** apply (no existing receipt for this `replayId`) requires `grant.state == unused`. Consumed / expired / revoked cannot start a new apply.
- Same `replayId` returns the existing receipt and **does not** re-require `unused` (see §4). That is replay, not a second authorize.
- Envelope `tenantId` is never cloud or grant authority.

**Receipt schema** (`kind: "cognitive_promotion_receipt"`):

| Field                  | Required                               | Notes                                                                          |
| ---------------------- | -------------------------------------- | ------------------------------------------------------------------------------ |
| `receiptId`            | yes                                    | Unique create                                                                  |
| `replayId`             | yes                                    | Above                                                                          |
| `grantId`              | yes                                    | Consumed grant                                                                 |
| `recommendationId`     | yes                                    | Shadow recommendation that produced `recommend_admit`                          |
| `resourceId`           | yes                                    | Same as grant scope                                                            |
| `tenantId`             | yes                                    | From auth                                                                      |
| `decision`             | yes                                    | Must be `recommend_admit`                                                      |
| `decisionReasonCode`   | yes                                    | From `decideShadowPromotion`                                                   |
| `placementMode`        | yes                                    | `local-only` \| `encrypted-cloud`                                              |
| `canonicalHome`        | yes                                    | `local` \| `managed_encrypted_cloud`                                           |
| `fromBindingId`        | yes                                    | Prior writable canonical                                                       |
| `toCanonicalBindingId` | yes                                    | After apply (may equal `fromBindingId`)                                        |
| `projectionBindingId`  | yes if projection written              | Derived Cloud Intelligence binding                                             |
| `keyRefId`             | yes if any cloud write                 | Platform-tenant key ref                                                        |
| `region`               | yes if any cloud write                 | Selected region                                                                |
| `contentVersion`       | yes                                    | Canonical content version at apply                                             |
| `checksum`             | yes at apply; omitted while `prepared` | sha256 of canonical resource bytes (P4-c). P4-b MUST NOT hash locator metadata |
| `state`                | yes                                    | `prepared` \| `applied` \| `conflicted` \| `failed` \| `aborted`               |

---

## 4. Execution protocol (P4-b — frozen steps)

1. Authenticate → branded `GovernanceApprovalAuth`. `call.actor` MUST equal `auth.actor` (full `ActorRef`, not tenant-only).
2. Load candidate + scores + classification / lifecycle / privacy / sync inputs.
3. `decision = decideShadowPromotion(candidate)`.
4. If not `ok` or decision ≠ `recommend_admit` → refuse; no binding write.
5. Resolve placement via P4-a (`PlacementResolverInput` only). Cloud write without a P4-c key-service `keyRef` / region → `key_ref_required` (P4-b does not mint cloud prepared receipts).
6. Compute `replayId` (grantId + recommendationId + resourceId + decisionFingerprint).
7. **Load receipt by `replayId` first.** If one exists (`prepared` \| `applied` \| `conflicted` \| `failed` \| `aborted`) → return it and **stop**. Do not require `grant.state == unused`. Do not consume the grant again.
8. Else (no receipt): require grant `grantKind: "cognitive_promotion_apply"`, matching `scope.resourceId` / `tenantId`, unexpired, `state == unused`.
9. **One CAS:** unique-create receipt (`prepared`) keyed by `replayId` **and** `unused → consumed` on that grant. Implementation: durable prepare journal, then grant CAS (re-read unused under the grant lock), then receipt unique-create; crash recovery completes both. If the CAS loses because a receipt now exists → return that receipt (step 7). If the CAS loses because the grant is no longer unused **and** no receipt exists → deny (grant was consumed by a different apply).
10. Adapter write under authenticated tenant (local bytes and/or managed encrypted cloud + projection).
11. **Commit point:** one Catalog CAS (see §6). Never rewrite `resourceId` / `agentAssetId`.
12. Finalize receipt `applied` | `conflicted` | `failed`. Crash recovery is convergent (see §6.3).

---

## 5. Placement resolver contract (P4-a — frozen — D3 / D11 / D13)

### 5.1 Input

All fields below are structured. Missing required fields → deny, never default-open.

```ts
type SyncClassification =
  | "blocked"
  | "local-only"
  | "tenant-only"
  | "eligible-with-consent"
  | "encrypted-cloud"
  | "tenant-cloud"
  | "byos-only"
  | "archive-only";

type PlacementPolicy = {
  allowedCustodians: readonly ("device" | "openbot" | "tenant" | "byos")[];
  allowedRegions: readonly string[];
  requireDedicatedKey: boolean;
  requireDedicatedDatabase: boolean;
  offlineRequired: boolean;
  replicationClass: "none" | "local" | "regional" | "multi-region";
};

type PlacementResolverInput = {
  tenantId: string; // auth only
  ownerScope: "user_owned" | "position_owned" | "group_owned";
  controllerId: string;
  classification: "public" | "internal" | "confidential" | "restricted" | null;
  retentionClass: string | null;
  legalHoldActive: boolean;
  residencyRequiredRegions: readonly string[] | null;
  deploymentProfile: "personal" | "managed_enterprise" | "dedicated";
  trustedRegionDefault: string | null;
  tenantContract: PlacementPolicy | null;
  requestedOfflineRequired: boolean | null; // may strengthen policy.offlineRequired; must not relax it
  costObjective: "standard" | "archive_preferred" | null; // never authorizes
  recoveryObjective: "local" | "regional" | null; // never authorizes alone
  syncClassification: SyncClassification | null;
  resourceConsentScope: ResourceConsentScope | null; // verified Catalog/envelope subjects
  subjectConsent: SubjectConsentProof | null; // verified; governance approval is not consent
};
```

`trustedRegionDefault` is the only default-region input. Its **trusted source** is the platform deployment-region receipt bound to `auth.tenantId` (later-wave dedicated region binding, if that adapter is unlocked). Client query, envelope, CogniWeave, and `tenantContract` MUST NOT supply it. Missing / empty when a cloud write is implied → `missing_trusted_region`. There is no `deploymentDefault` field.

P4-a consumes verified proofs only. Production issuance is `placement-platform-verify.ts`. The gateway composition root (`placement-platform-root.ts`, called from `server.impl.ts` after `createDefaultDeps`) binds the process-wide Catalog adapter and file consent store. `installPlacementPlatformAuthority` takes **no arguments**: it binds `resolveStateDir()` **once** and a later call is a no-op (`alreadyBound: true`). Production code cannot pass `stateDir`, adapters, or extra keys. Runtime directory rebind exists only in the test harness (`replacePlacementAuthorityBindingsForTests`). The Catalog loader reads through `loadValidatedCatalogRecordSync` (official `parseCatalogRecord` / Envelope validator); corrupt or illegal rows return null. First-wave `dataSubjectIds` come from `envelope.owner` when `kind === "user"` — never from `projection`. Position/group/system owners yield no consent scope. Adapters re-read durable files on each verify. Tenant identity comes from a `GovernanceAuthenticatedCall`. `verify*` does not accept a per-call catalog/store. Missing platform key, bad signature, revoked, expired, or unauthenticated calls fail closed. `reverifySubjectConsent` re-reads the bound store — P4-b must call it before execution. Unauthenticated raw mint exists only in `*.test-harness.ts`. `evaluationTime` is not an input. `installPlacementPlatformAuthority` is not exported from the public barrel.

Effective offline is `policy.offlineRequired || requestedOfflineRequired === true`. A caller `false` cannot relax a tenant `offlineRequired=true` policy.

`eligible-with-consent` that would imply a cloud write requires a verified `resourceConsentScope` (authoritative `resourceId` + `dataSubjectIds` from the Catalog user owner) and a verified `subjectConsent` that: binds the same `tenantId` / `resourceId` / `purpose=eligible_cloud_projection` / `consentVersion`; covers **every** scope data subject; is not revoked; and expires after the server clock. Missing subject, cross-subject, wrong resource, revoked, expired, position/group owner, illegal first-wave `projection`, or a Catalog row that fails the official parser → `consent_required`. Governance approval does not replace data-subject consent. Test Catalog rows must be written through official `put`/CAS, not by rewriting JSON.

Forbidden as authorization inputs (D3): semantic value, `CognitiveTier`, `PreservationPriority` alone, raw admission/retrieval/promotion scores as mode choosers.

### 5.2 Output

```ts
type PlacementDenyReason =
  | "missing_auth_tenant"
  | "missing_placement_policy"
  | "missing_sync_classification"
  | "missing_classification"
  | "policy_conflict"
  | "custodian_not_allowed"
  | "residency_conflict"
  | "offline_requires_local_canonical"
  | "offline_conflicts_managed_cloud"
  | "dedicated_key_unsupported"
  | "dedicated_database_unsupported"
  | "replication_unsupported"
  | "sync_class_blocked"
  | "sync_class_not_first_wave"
  | "legal_hold_blocks_placement_change"
  | "first_wave_adapter_unavailable"
  | "missing_trusted_region"
  | "consent_required";

type PlacementResolverOutput =
  | {
      ok: true;
      mode: "local-only" | "encrypted-cloud";
      canonicalHome: "local" | "managed_encrypted_cloud";
      projection: "none" | "managed_encrypted_cloud";
      region: string | null;
      keyRef: { kind: "platform_tenant"; keyRefId: string; tenantId: string } | null;
      replicationClass: "none" | "local";
      reasonCode: "resolved";
    }
  | { ok: false; reasonCode: PlacementDenyReason };
```

First-wave `ok: true` never returns `tenant-cloud` / `byos` / `dedicated` / `cold-archive`.

### 5.3 Fail-closed precedence

Evaluate in order. First matching deny wins. Do not continue to a weaker allow.

1. Missing / empty `tenantId` → `missing_auth_tenant`.
2. `tenantContract == null` → `missing_placement_policy`.
3. `syncClassification == null` → `missing_sync_classification`.
4. `classification` missing or not in `{public,internal,confidential,restricted}` → `missing_classification`.
5. `syncClassification == "blocked"` → `sync_class_blocked`.
6. `legalHoldActive` and the resolve would **move or retire** the writable canonical → `legal_hold_blocks_placement_change`. Adding a derived projection while local stays canonical is allowed if later steps allow.
7. `requireDedicatedKey == true` → `dedicated_key_unsupported` (first wave).
8. `requireDedicatedDatabase == true` → `dedicated_database_unsupported` (first wave).
9. `replicationClass` ∈ {`regional`, `multi-region`} → `replication_unsupported` (first wave allows `none` | `local` only).
10. Conflicting policy fields (empty `allowedCustodians`; `offlineRequired` vs custodian set that cannot keep a local canonical; `allowedRegions` empty when a cloud write is implied) → `policy_conflict`.
11. Sync class maps to a later-wave mode (`tenant-only`, `tenant-cloud`, `byos-only`, `archive-only`) → `sync_class_not_first_wave`.
    11a. `eligible-with-consent` would imply a cloud write (`openbot` allowed) and verified `resourceConsentScope` + `subjectConsent` do not cover this resource's data subjects (missing/unverified proof or scope, tenant/resource/purpose mismatch, missing subject, revoked, or expired vs server clock) → `consent_required`. Governance approval is not consent. `evaluationTime` is not accepted from the caller.
12. Effective `offlineRequired` (`policy.offlineRequired || requestedOfflineRequired === true`) **and** implied `canonicalHome` would be `managed_encrypted_cloud` → `offline_requires_local_canonical`.
13. Effective `offlineRequired` **and** sync class requires cloud **without** remaining local canonical **and** without a legal projection-only outcome → `offline_conflicts_managed_cloud`.
14. Custodian check: local home needs `device`; managed cloud write needs `openbot`. Failure → `custodian_not_allowed`.
15. Region. Let `impliedCloudWrite` be true iff the §5.4 row for this `syncClassification` would set `projection=managed_encrypted_cloud` or `canonicalHome=managed_encrypted_cloud`. If `impliedCloudWrite` and `trustedRegionDefault` is null/empty → `missing_trusted_region`. Else `selected = trustedRegionDefault` only when it is a member of `allowedRegions ∩ (residencyRequiredRegions ?? *)`. If `impliedCloudWrite` and that membership fails → `residency_conflict` (do not pick another region; there is no `deploymentDefault`). Local-only with no cloud write may return `region: null`.
16. Else emit the sync→mode row in §5.4.

`costObjective` / `recoveryObjective` / `PreservationPriority` never override a deny and never select a later-wave adapter.

### 5.4 Sync classification → first-wave placement

| `syncClassification`    | `mode`                                                                                                                                                                                                             | `canonicalHome`                                              | `projection`                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------- |
| `blocked`               | deny `sync_class_blocked`                                                                                                                                                                                          | —                                                            | —                                                         |
| `local-only`            | `local-only`                                                                                                                                                                                                       | `local`                                                      | `none`                                                    |
| `tenant-only`           | deny `sync_class_not_first_wave`                                                                                                                                                                                   | —                                                            | —                                                         |
| `eligible-with-consent` | `encrypted-cloud` if `openbot` allowed **and** verified consent covers every authoritative data subject; else `local-only` if `openbot` is not allowed; deny `consent_required` if cloud write lacks bound consent | `local`                                                      | `managed_encrypted_cloud` if encrypted-cloud, else `none` |
| `encrypted-cloud`       | `encrypted-cloud`                                                                                                                                                                                                  | `local` if `offlineRequired`, else `managed_encrypted_cloud` | `managed_encrypted_cloud`                                 |
| `tenant-cloud`          | deny `sync_class_not_first_wave`                                                                                                                                                                                   | —                                                            | —                                                         |
| `byos-only`             | deny `sync_class_not_first_wave`                                                                                                                                                                                   | —                                                            | —                                                         |
| `archive-only`          | deny `sync_class_not_first_wave`                                                                                                                                                                                   | —                                                            | —                                                         |

Deterministic `offlineRequired` + managed-cloud outcome:

- `offlineRequired=true` + `encrypted-cloud` + `openbot` allowed → **allow**: local writable canonical + cloud **projection** (not a second canonical).
- `offlineRequired=true` + any path that would make cloud the writable canonical → **deny** `offline_requires_local_canonical`.
- `offlineRequired=false` + `encrypted-cloud` → cloud object-store may become writable canonical; local becomes read-only replica; Cloud Intelligence remains a derived projection.

---

## 6. Canonical / mirror / projection state machine (frozen — D11 / D16)

Architecture: Principle 5 and §17.2 (exactly one writable canonical); §12.4 (Cloud Intelligence is a **governed projection**, not an automatic mirror).

### 6.1 Three objects

| Object                                | Binding `role`                   | May be writable canonical? |
| ------------------------------------- | -------------------------------- | -------------------------- |
| Local or managed-cloud **bytes home** | `canonical` while `state=active` | Yes — at most one          |
| Local **mirror** after cutover        | `replica` + `state=read_only`    | No                         |
| Cloud Intelligence **projection**     | `derived`                        | Never                      |

`compatibility` / `cache` / `archive` bindings never become the writable canonical (P0/P1 retained).

### 6.2 After local → managed encrypted cloud

**Projection-only apply** (`canonicalHome=local`):

- Local binding stays `role=canonical`, `state=active` (sole writer).
- Cloud Intelligence binding is created/updated as `role=derived`, `state=read_only`.
- Optional managed-cloud raw-evidence object (when policy requires) is `role=derived` or `archive`, never a second `canonical`.
- Local is **not** retired.

**Canonical cutover** (`canonicalHome=managed_encrypted_cloud`):

- Managed encrypted object-store binding becomes `role=canonical`, `state=active`.
- Prior local binding becomes `role=replica`, `state=read_only` (offline mirror).
- Cloud Intelligence projection stays `role=derived`.
- Local is **not** deleted; it is no longer writable.

### 6.3 Irreversible commit point

The **only** irreversible commit is the Catalog `compareAndPut` that, in **one** record:

1. Leaves exactly one binding with `role=canonical` and `state=active`.
2. Demotes the previous canonical when cutover applies.
3. Attaches/updates the derived projection binding and envelope `tombstoneVersion` / checksum.
4. Records `contentVersion` matching the receipt.

Adapter writes **before** this CAS are speculative. Receipt stays `prepared` until CAS succeeds.

### 6.4 Crash recovery (forever one writable canonical)

| Observed                                                        | Recovery                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Receipt `prepared`, Catalog unchanged                           | Reclaim orphan cloud objects; do not flip roles; local remains sole writer; retry is idempotent on `replayId` |
| Receipt `prepared`, Catalog already matches intended post-image | Heal receipt → `applied` (same as P3 prepared-replay healing)                                                 |
| Receipt `applied`                                               | Never re-activate the demoted local as writable                                                               |
| Load finds two `canonical`+`active`                             | `catalog_corrupt`; **no writes**; fail closed                                                                 |
| Load finds zero writable canonical                              | Fail closed; do not invent a writer from a projection or replica                                              |

Rollback never restores a second writable root (P0-d retained).

### 6.5 Revoke / tombstone vs binding CAS order

End-to-end order is mandatory (architecture §17.3: tombstone wins against stale cloud replicas):

1. Durably write tombstone (and revoke the grant if this is a revoke path) in the projection store with `tombstoneVersion = N+1`.
2. Durably persist the tombstone object checksum.
3. Catalog CAS: envelope / projection `tombstoneVersion = N+1`, binding states, checksum.
4. Only then may a derived cloud body be deleted or marked unreadable.

Forbidden:

- CAS-clear or rewrite the writable canonical **before** step 1 is durable.
- Serve a projection whose `tombstoneVersion` is behind Catalog, or whose checksum mismatches.
- Let a stale projection resurrect a purged/revoked asset.

On conflict, **tombstone wins**.

---

## 7. Key, region, and projection envelope (frozen — D14)

### 7.1 Key reference authority

- Authority is the **platform key-service receipt** bound to `auth.tenantId`.
- Envelope, client, and projection body MUST NOT supply a trusted `encryptionKeyRef`.
- First wave `keyRef.kind` is only `platform_tenant` (platform-held wrap of a tenant DEK).
- Platform root MUST NOT encrypt tenant content directly.
- Tenant key material is isolated by `tenantId` in the wrap key id. Cross-tenant `keyRef` → fail closed (`key_tenant_mismatch` at adapter time).
- Customer / BYOS / dedicated keys stay fail closed (`dedicated_key_unsupported`).

### 7.2 Region

- Selected region is `trustedRegionDefault` when it survives the §5.3 step 15 membership test.
- `trustedRegionDefault` is not client-supplied and is not named `deploymentDefault`.
- An empty intersection or a default outside the intersection is `residency_conflict` / `missing_trusted_region`. Never fall back to cheapest or nearest region.

### 7.3 Cloud projection minimum fields (§12.4)

```ts
type CloudProjectionEnvelope = {
  resourceId: string;
  atomId?: string | null;
  permittedClaims: readonly string[];
  scope: string;
  privacyLevel: string;
  contentVersion: string;
  checksum: string; // sha256
  provenanceRefs: readonly string[];
  consentVersion: string;
  policyVersion: string;
  tombstoneVersion: number;
};
```

Read path: verify checksum + `contentVersion` + `tombstoneVersion` against Catalog. Any mismatch → do not serve.

Stale projection vs tombstone: Catalog/tombstone version wins; body is ignored.

---

## 8. Binding identity (D5)

Moving placement updates **storage binding** (kind, locator, region, key refs, role, state).  
`resourceId` and `agentAssetId` do not change because of promotion.

---

## 9. First-wave adapters (D4)

| Mode                              | First wave       |
| --------------------------------- | ---------------- |
| Local only                        | Yes              |
| OpenBot encrypted cloud (managed) | Yes              |
| Tenant managed cloud              | No — fail closed |
| BYOS                              | No — fail closed |
| Dedicated deployment              | No — fail closed |
| Cold archive                      | No — fail closed |

---

## 10. Exit criteria (architecture §16 P4)

- Cross-tenant false allow is **zero** in the directed test matrix.
- Revocation and tombstone propagation are proven end to end for first-wave adapters, in the §6.5 order.
- Offline retrieval uses only a policy-compliant local canonical or local replica (never a stale projection as canonical).

---

## 11. Tests (planning — names freeze at implementation)

1. Forced skip of `decideShadowPromotion` cannot promote.
2. `recommend_deny` / `invalid_score` never writes a binding.
3. Stubbing a second local threshold in the executor is forbidden (source / barrel guards).
4. Client-forged tenant on envelope cannot redirect cloud write.
5. Missing / wrong-kind / consumed grant fails closed. Synonym grant kinds fail closed.
6. Local → managed encrypted cloud changes binding only.
7. BYOS / tenant-cloud / archive / dedicated paths return fail-closed in first wave.
8. Revoke / tombstone blocks stale cloud projection (tombstone wins).
9. Offline path never serves a non-policy local mirror or a projection as canonical.
10. Crash mid-protocol resumes without dual writable canonicals.
11. `offlineRequired=true` never yields `canonicalHome=managed_encrypted_cloud`.
12. Missing policy / conflicting custodians / empty region intersection deny with the frozen reason codes.
13. Projection missing checksum / consentVersion / tombstoneVersion is rejected.

---

## 12. Placement export / restore (frozen — D17)

Architecture §16 P4 first wave includes export and restore across placement changes.

```ts
type PlacementExportReceipt = {
  kind: "p4_placement_export_receipt";
  receiptId: string;
  resourceId: string;
  agentAssetId: string;
  fromBindingId: string;
  toCanonicalBindingId: string;
  projectionBindingId: string | null;
  canonicalHome: "local" | "managed_encrypted_cloud";
  mode: "local-only" | "encrypted-cloud";
  contentVersion: string;
  checksum: string;
  state: "prepared" | "applied" | "failed";
};
```

Restore reapplies the binding image. It MUST NOT rewrite `resourceId` or `agentAssetId`. The portable members follow P5 L3 exclusions (no credentials/outbox/cursors/locks/caches). A placement export is not a P5 longevity bundle and is not a promotion grant.

## 13. Non-goals

See `plan.md`. P5 coding locked until P4 first-wave Accept.
