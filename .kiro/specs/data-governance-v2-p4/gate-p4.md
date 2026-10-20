# P4 Gate Evidence Package — Governed Placement and Sync

**Status:** **P4 Gate Accepted** (planning, 2026-08-16). **P4 Accepted** (first-wave, closure `4dd0da593f`, 2026-08-18).  
**Executor:** `cursor-data-governance`  
**Acceptance:** `codex-data-governance`  
**Depends on:** P3 Accepted (`84a4165093`); Gate B Accepted (CR6 `57b2bc94a7` / pin `7009d2fe70`)  
**Architecture:** §12, §16 P4, §17.2, §17.5  
**Companion:** `design-p4.md`, `inventory-p4.md`, `plan.md`  
**Handoff:** `codex-handoff-p4-gate.md`

This Gate freezes **first-wave P4 contracts** (D1–D19). **P4 Gate Accepted** (planning, 2026-08-16). **P4 Accepted** (first-wave, closure `4dd0da593f`, 2026-08-18). P4-a/b/c/d slice Accepts recorded. Later adapters (BYOS / tenant cloud / cold archive / dedicated) stay **locked**. v2 program complete: `closeout.md`.

CR2 (`20f548edde`) was **Changes Required**. **CR3** amends existing D2 / D11 / D12 / D14 / D15 (no new D ids): trusted `trustedRegionDefault` on the resolver input, and receipt-before-unused-grant replay order. Machine-checkable: `gate-p4-cr2.json` + tests that read `design-p4.md`.

---

## Locked decisions (P4 Gate)

| ID  | Decision                        | Conclusion                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Sole promotion judgment         | **`decideShadowPromotion` only** (`cognitive-shadow-promotion.ts`). `recommend_admit` may enter execution; `recommend_deny` / `invalid_score` fail closed. P4 must **not** fork thresholds, copy `0.8`/`0.5` into the executor, or invent a parallel judge                                                                                                                                            |
| D2  | Scores still do not authorize   | Execution requires branded **`GovernanceApprovalAuth`** + grant. **`grantKind` is exactly `cognitive_promotion_apply`** — no synonym. Scope is `{ kind: "resource", resourceId }`. Tenant from grant/auth — envelope must not self-assert cloud tenant. Replay: load receipt by `replayId` **before** requiring `unused`; consumed grant cannot start a **new** apply. Frozen in `design-p4.md` §3–§4 |
| D3  | Placement inputs                | ownership, classification, retention/hold, residency, deployment profile, tenant contract, offline/cost. **Not** authorization inputs: semantic value, `CognitiveTier`, `PreservationPriority` alone, or raw scores as mode choosers                                                                                                                                                                  |
| D4  | First-wave adapters             | **local** + **managed encrypted cloud** only. `byos` / tenant-cloud / cold archive / dedicated stay **fail closed** until a later unlock after first-wave evidence                                                                                                                                                                                                                                    |
| D5  | Identity on move                | Placement change updates **binding** only. `resourceId` / `agentAssetId` unchanged                                                                                                                                                                                                                                                                                                                    |
| D6  | Exit bar                        | Cross-tenant false allow = **0**; revoke/tombstone end to end in frozen order; offline uses policy-compliant local canonical/replica only                                                                                                                                                                                                                                                             |
| D7  | P2 / admit boundary             | P4 must **not** open P2 `requestPurge` / `forget` / `activeLifecycleOperation`. No auto-admit Catalog insert (G6 retained)                                                                                                                                                                                                                                                                            |
| D8  | Slice order                     | P4-a resolver → P4-b signed protocol + receipt → P4-c adapters → P4-d export/restore. Independent handoffs; one slice Accept at a time                                                                                                                                                                                                                                                                |
| D9  | P3 retention                    | P3-e/f/g and P3 Accepted remain valid. Shadow evaluation datasets stay shadow until execution lands; false-promotion metrics still use labeled fixtures                                                                                                                                                                                                                                               |
| D10 | P5 lock                         | P5 coding was locked until **P4 first-wave Accepted** (`acd3b4a944`). **P5 Accepted** (`435a72249f`); v2 first-wave program complete (`0c34378b07`)                                                                                                                                                                                                                                                   |
| D11 | Resolver contract               | Structured `PlacementResolverInput` / `PlacementResolverOutput` and deny `reasonCode` union in `design-p4.md` §5. Input includes `trustedRegionDefault` (platform deployment-region receipt / `auth.tenantId` only). Missing policy, sync class, classification, or trusted region fails closed                                                                                                       |
| D12 | Resolver precedence             | Fail-closed ordered list in `design-p4.md` §5.3. First deny wins. Region uses `trustedRegionDefault` membership, not an undefined `deploymentDefault`. `offlineRequired` vs managed-cloud is deterministic (local canonical + projection, or deny — never dual writable)                                                                                                                              |
| D13 | Sync → mode map                 | Frozen table in `design-p4.md` §5.4. Later-wave sync classes deny `sync_class_not_first_wave`                                                                                                                                                                                                                                                                                                         |
| D14 | Key / region / projection       | Key authority = platform key-service receipt (`platform_tenant` only). Tenant DEK isolated from platform root. Region = `trustedRegionDefault` if it is in `allowedRegions ∩ residency`; else `missing_trusted_region` / `residency_conflict`. Projection minimum fields = architecture §12.4. Checksum/version verify on read. Tombstone wins stale projection                                       |
| D15 | Approval names                  | `cognitive_promotion_apply` only. Resource scope, tenant binding, replay identity, receipt schema, and §4 receipt-before-unused order frozen now — not at slice coding                                                                                                                                                                                                                                |
| D16 | Canonical / mirror / commit     | Cloud Intelligence = `derived` projection, never writable canonical. Cutover (only when `canonicalHome=managed_encrypted_cloud`) demotes local to `replica`+`read_only` in the **same** Catalog CAS. That CAS is the irreversible commit. Crash recovery never yields two writable canonicals. Tombstone durable **before** Catalog CAS                                                               |
| D17 | P4-d placement export / restore | Receipt `kind: "p4_placement_export_receipt"`. Payload is the binding image (`fromBindingId`, `toCanonicalBindingId`, optional `projectionBindingId`, `canonicalHome`, `mode`, `contentVersion`, `checksum`). Restore applies **bindings only**. Never rewrite `resourceId` / `agentAssetId`. Bundle must exclude credentials/outbox/cursors/locks/caches                                             |
| D18 | Classification union            | Resolver `classification` is exactly `DataClassification` = `public \| internal \| confidential \| restricted`. Missing / other string → deny `missing_classification`                                                                                                                                                                                                                                |
| D19 | Grant issuance                  | Unique-create `grantId`. Issuer is `enterprise-ops` or `tenant-admin` only. Engine / CogniWeave **never** self-issues. `expiresAt` required. First apply CAS: unique-create receipt + `unused → consumed`. Consumed grant cannot start a new apply; same `replayId` returns the existing receipt                                                                                                      |

---

## B1. Why this Gate exists

Architecture §16 P4 is larger than one drop. P3 delivered shadow promotion **decision** and proved metrics without execution. P4 must execute placement/sync without reopening cognitive scoring or inventing a second promotion policy — Codex explicitly required reuse of `decideShadowPromotion`.

---

## B2. Scope freeze

**In after Gate Accept (coding may start):** P4-a/b/c/d as in `plan.md`, implementing the frozen contracts above.

**Out of first wave:** tenant cloud, BYOS, cold archive, dedicated regional placement.

**Never in P4:** dual Catalog; flattening Persona/Capability/OI; engine-executed purge; CogniWeave model rewrite; replacing `decideShadowPromotion`; leaving grant kind / resolver reasons / commit order to implementers.

---

## B3. Exit criteria vs gates

| Exit criterion               | Gate Accept         | P4 first-wave Accepted                                                        |
| ---------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| Decision reuse               | D1 frozen in design | Directed tests prove executor calls `decideShadowPromotion` and forbids forks |
| Resolver + precedence        | D11–D13 frozen      | Directed deny-code matrix green                                               |
| Single writable canonical    | D16 frozen          | Crash/cutover tests prove §17.2                                               |
| Cross-tenant false allow = 0 | Test matrix named   | Matrix green                                                                  |
| Revoke / tombstone E2E       | D16 order frozen    | Proven on local + managed encrypted cloud                                     |
| Offline policy-compliant     | D12/D13 frozen      | Offline path tests green                                                      |
| Key / region / projection    | D14 frozen          | Adapter + envelope tests green                                                |
| Later adapters               | Fail closed         | Still fail closed until separate unlock                                       |

---

## B4. Evidence (planning-only)

No new production tests in this drop. Facts this Gate must not ignore:

- `decideShadowPromotion` already gates lifecycle, classification, privacy, sync, and score floors.
- P2 purge adapters already fail closed for missing cloud/BYOS adapters — first-wave P4 must not weaken that.
- P3 Accepted tip `84a4165093` and Gate B CR6 are ancestors of the current branch tip.
- Existing grant kinds in `types.ts` do **not** yet include `cognitive_promotion_apply`; that name is frozen here and added only after Gate Accept.

---

## Gate decision (final)

| Gate                               | Verdict                                                          |
| ---------------------------------- | ---------------------------------------------------------------- |
| D1–D19                             | **Accepted** (CR3 package `c58652f74e`, 2026-08-16)              |
| **P4 Gate overall**                | **Accepted** (planning only)                                     |
| **P4 first-wave**                  | **Accepted** (`acd3b4a944`)                                      |
| **P4 Accepted** (first-wave scope) | **Accepted** (closure `4dd0da593f`, 2026-08-18)                  |
| **Later adapters**                 | **locked** — separate Gate + unlock required                     |
| **P5**                             | **Accepted** (`435a72249f`); not a license for later P4 adapters |

## Historical snapshot (pre–first-wave Accept)

Superseded planning rows retained for audit only (do not use for current unlock state):

| Gate              | Verdict (historical)                                              |
| ----------------- | ----------------------------------------------------------------- |
| D1–D19 at CR2     | **Changes Required** (review tip `20f548edde`)                    |
| P4-a/b/c/d coding | unlocked slice-by-slice after Gate Accept (2026-08-16–2026-08-17) |

Evidence: slice handoffs `codex-handoff-p4a.md` … `codex-handoff-p4d.md`, first-wave `codex-handoff-p4-first-wave.md`, closure `codex-handoff-p4-closure.md`.
