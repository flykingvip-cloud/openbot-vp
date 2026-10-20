# P4 Later-Wave Gate Evidence Package — Post First-Wave Adapters

**Status:** Four slices **Accepted** 2026-08-18. Umbrella **Accepted**. Production go-live gates **submitted** (not LIVE).  
**Executor:** `cursor-data-governance`  
**Acceptance:** `codex-data-governance`  
**Depends on:** v2 first-wave **Accepted** (`0c34378b07`); **M0–M4 migration Accepted**; P4 first-wave **Accepted** (`4dd0da593f`); P5 **Accepted** (`435a72249f`)  
**Architecture:** §12, §16 P4 (later adapters, lines 1241–1246), §17.5  
**Companion:** `design-p4-later.md`, `inventory-p4-later.md`, `plan.md`  
**Handoff:** `codex-handoff-p4-later-gate.md`

This Gate would freeze **later-wave P4 adapter contracts** (L1–L12 draft). It **does not** amend P4 first-wave D1–D19 except where explicitly listed as superseded deny retirements. It **does not** imply later-wave Accepted and **does not** authorize coding until Codex records **P4-later Gate Accept**.

First-wave baseline: `../data-governance-v2-p4/gate-p4.md` (D1–D19 **Accepted**). Later adapters currently fail closed via `first_wave_adapter_unavailable`, `sync_class_not_first_wave`, `dedicated_key_unsupported`, `dedicated_database_unsupported`, `replication_unsupported`.

---

## Locked decisions (draft — L1–L12)

| ID  | Decision                | Draft conclusion                                                                                                                                                                               |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | Unlock scope            | **tenant-cloud**, **dedicated**, **BYOS**, **cold archive** only. No fifth adapter without Gate amendment                                                                                      |
| L2  | Decision reuse          | **`decideShadowPromotion` only** — same as D1. Later-wave adapters change **execution / binding**, not shadow judgment                                                                         |
| L3  | First-wave preservation | D1–D19 remain valid. First-wave tests must keep passing unchanged. Later-wave adds **additive** matrices                                                                                       |
| L4  | Gate vs coding          | **P4-later Gate Accept** unlocks **P4-L-a coding only**. P4-L-b/c/d locked until prior slice Accepted                                                                                          |
| L5  | Slice order             | Default: **P4-L-a tenant-cloud → P4-L-b dedicated → P4-L-c BYOS → P4-L-d cold archive** (`plan.md`). Codex may reorder at Accept with recorded rationale                                       |
| L6  | Resolver extension      | Each unlocked adapter gets explicit `PlacementResolverOutput` rows in `design-p4-later.md`. Retired deny codes are **per-slice**, not global                                                   |
| L7  | Sync map                | Rows currently denying `sync_class_not_first_wave` unlock **only** when the matching slice is Accepted: `tenant-cloud`, `byos-only`, `archive-only`, and dedicated-related replication classes |
| L8  | Key authority           | First-wave `platform_tenant` only was D14. BYOS / dedicated may introduce new `keyRef.kind` values **only** in `design-p4-later.md` with tenant-binding proofs — never client-supplied         |
| L9  | Export / restore        | Extends D17 binding-only principle. Archive and BYOS bundles add slice-specific manifest fields; never rewrite `resourceId` / `agentAssetId`                                                   |
| L10 | Exit bar inheritance    | Each slice re-proves architecture §16 P4 exit criteria for its adapter surface. Cross-tenant false allow = **0**                                                                               |
| L11 | P5 interaction          | P5 Accepted does not auto-cover later adapters. P5-f reports may need **additive** health probes per slice — charter in slice handoff, not in this Gate                                        |
| L12 | Ops evidence            | **C19 live re-probe** remains non-blocking for v2 first-wave Accept. Codex decides per-slice whether ops evidence is required before slice Accept                                              |

---

## Scope freeze

**In later wave (after slice unlock):**

- Adapter implementations for the Accepted slice only
- Resolver deny-code retirements listed for that slice in `design-p4-later.md`
- Directed test matrices proving fail-closed → allow transitions without regressions

**Out of later wave (remain locked or out of scope):**

- Forking promotion judgment or P2 purge/forget shortcuts
- Dual writable canonicals or identity flatten
- Architecture document edits without Codex authorization
- Claiming “full §16 including all adapters” until umbrella closure, if pursued

---

## Gate decision

| Gate                           | Verdict                                                          |
| ------------------------------ | ---------------------------------------------------------------- |
| L1–L12                         | Frozen in slice handoffs; L-a/b/c/d **Accepted**                 |
| **P4-L-a/b/c/d coding**        | **Accepted** 2026-08-18                                          |
| **Later-wave umbrella Accept** | **Accepted** 2026-08-18                                          |
| **Production LIVE**            | **not claimed** — I4 gates in `codex-handoff-p4-later-golive.md` |

---

## Open questions for Codex (Gate CR)

1. Is **tenant-cloud before dedicated** the correct default slice order?
2. Does **BYOS** require dedicated key infrastructure first, or can it ship with platform wrap only?
3. Is **cold archive** strictly retrieval/export, or does it include promotion into archive as canonical home?
4. Per-slice ops evidence: mandatory or optional for first later-wave slice?
5. Umbrella **P4 later-wave Accepted** vs four independent slice Accepts only?

---

## Historical anchor

v2 first-wave program **Accepted** at `0c34378b07` explicitly **excludes** later adapters. This package is the **separate unlock** path required before any BYOS / tenant-cloud / cold archive / dedicated coding.
