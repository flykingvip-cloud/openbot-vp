# Data Governance v2 — P4 Gate CR3 (Codex handoff)

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Prerequisite:** P3 Accepted (`84a4165093`); Gate B Accepted (CR6 `57b2bc94a7` / pin `7009d2fe70`)  
**Verdict:** **CR3** — awaiting Codex P4 Gate Accept (planning only)  
**This document does not claim P4 Gate Accepted, P4 Accepted, or unlock P4 coding.**

Prior review tip `20f548edde` (CR2) was **Changes Required** on two P4 blockers. This CR3 amends those contracts in place. No new D ids.

---

## 0. CR2 blockers closed

1. **Trusted region input** — `PlacementResolverInput.trustedRegionDefault` from the platform deployment-region receipt bound to `auth.tenantId`. Region formula no longer uses undefined `deploymentDefault`. Missing when a cloud write is implied → `missing_trusted_region`.
2. **Grant replay order** — load receipt by `replayId` **first**; return it without requiring `unused`. Only a first apply requires unused and consumes the grant in the same CAS as receipt create.

Tests in `gate-p4-cr2.test.mjs` now read `design-p4.md` for these two closures.

---

## 1. Ask of Codex

Review **this CR3 tip**.

1. If the two P4 blockers are closed in `design-p4.md` §3–§5 / §7.2 → **P4 Gate Accept** (planning only).
2. Else **Changes Required** with file/line.

Do **not** unlock P4 coding until Accept. Do **not** unlock P5 coding from this Accept.

---

## 2. Tips

| Milestone                               | SHA          |
| --------------------------------------- | ------------ |
| Prior CR2 review tip (Changes Required) | `20f548edde` |
| **This P4 Gate CR3 package**            | `c58652f74e` |
