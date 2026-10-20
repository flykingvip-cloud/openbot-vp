# Data Governance v2 — P4 first-wave Codex Handoff

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Historical:** P4 first-wave **Accepted** (`acd3b4a944`, 2026-08-17). This document records the first-wave exit matrix; it does **not** claim P4 overall Accepted or v2 program complete.  
**Later adapters (BYOS / tenant cloud / cold archive / dedicated) stay locked.**

User 2026-08-17: **P4-d 验收：Accept**. All four first-wave slices have independent Codex Accept. Codex recorded **P4 first-wave Accept** at `acd3b4a944`.

---

## Ask of Codex

Review **this first-wave tip** against `gate-p4.md` B3 and `design-p4.md` §10–§11.

1. If the exit matrix is met → write **P4 first-wave Accept**. That is the coding unlock for P5 (P5 Gate Accept is still required separately). It does **not** Accept P4 overall.
2. Else **Changes Required** with file/line.

Do **not** treat this as P4 Accepted. Do **not** unlock BYOS / tenant-cloud / cold archive / dedicated from this verdict.

---

## Slice Accept trail

| Slice                           | Verdict      | Implementation                             | Review tip                                 |
| ------------------------------- | ------------ | ------------------------------------------ | ------------------------------------------ |
| P4-a resolver                   | **Accepted** | CR6                                        | `296b14b8ac`                               |
| P4-b promotion protocol         | **Accepted** | CR3                                        | `5a3337b56f`                               |
| P4-c adapters / CAS / tombstone | **Accepted** | `a0ae9ddf0a`                               | `6595f0ff8d`                               |
| P4-d export / restore           | **Accepted** | `1dffe292a4320ef134cc3291b180d2a11ab46908` | `84860c7448ed9b0e30a5bb904f906820ad2b5357` |

| Milestone                      | SHA                                        |
| ------------------------------ | ------------------------------------------ |
| P4-d CR pin (Accepted)         | `b94c091a50b6885632267f56be0a29e2ee6f7106` |
| **This first-wave review tip** | `acd3b4a94485c8954431617ce7fc82e62e307c16` |

---

## B3 / §10 exit matrix → evidence

| Exit criterion                                                         | Where proven                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision reuse — executor calls `decideShadowPromotion`; no local fork | `cognitive-promotion.test.ts` (source must match `decideShadowPromotion`; `recommend_deny` / `invalid_score` create no receipt). `cognitive-shadow-promotion.test.ts` keeps P3 floors. Resolver source forbids score/decision imports (`placement-resolve.test.ts`). |
| Resolver + precedence deny-code matrix                                 | `placement-resolve.test.ts` (81): offline, residency, trusted region, later-wave, consent.                                                                                                                                                                           |
| Exactly one writable canonical; crash/cutover                          | `cognitive-promotion-apply.test.ts`: local apply, managed-cloud cutover without dual canonicals, orphan reclaim when Catalog unchanged.                                                                                                                              |
| Cross-tenant false allow = 0                                           | Resolver + prepare + apply + export: `envelope_tenant_mismatch` (`placement-resolve.test.ts`, `cognitive-promotion.test.ts`, `cognitive-promotion-apply.test.ts`, `placement-export.test.ts`). `serveCloudProjection` other-tenant call denied.                      |
| Revoke / tombstone E2E, §6.5 order                                     | Apply tests: tombstone then checksum then Catalog CAS then hide body; tombstone wins stale projection; dedicated `cognitive_projection_tombstone` grant; no forged in-memory receipt.                                                                                |
| Offline policy-compliant local canonical / replica                     | `placement-resolve.test.ts`: `offline_requires_local_canonical`, `offline_conflicts_managed_cloud`; never a cloud writable canonical when `offlineRequired`; caller cannot relax tenant offline.                                                                     |
| Key / region / projection                                              | Apply: `keyRefId` / region on managed cutover; projection envelope requires checksum / consentVersion / tombstoneVersion. Platform root: `placement-platform-root.test.ts` (4).                                                                                      |
| Later adapters fail closed                                             | `laterWaveAdapterUnavailable` for byos / tenant-cloud / cold-archive / dedicated. Export/restore: non-first-wave storage → `first_wave_adapter_unavailable` or integrity deny. Resolver: `first_wave_adapter_unavailable`.                                           |
| Binding-only placement change                                          | Apply + export: `resourceId` unchanged across local → managed cloud. Restore reapplies durable image only; `bindingsChecksum` + durable image; locator/objectKey tampers denied before CAS (`placement-export.test.ts`).                                             |
| Grant kinds not reused                                                 | Promotion / tombstone / export each have a dedicated grant kind. Cross-kind → `grant_kind_mismatch`.                                                                                                                                                                 |

`design-p4.md` §11 named tests map onto the suites above (skip / deny / source guard / forged tenant / grant fail-closed / local→cloud binding only / later-wave fail-closed / tombstone wins / offline never serves projection as canonical).

---

## Directed commands

```text
OPENBOT_TEST_PROFILE=low VITEST_CACHE_DIR=/tmp/vitest-p4-fw \
pnpm exec vitest run \
  src/gateway/data-governance/placement-export.test.ts \
  src/gateway/data-governance/cognitive-promotion-apply.test.ts \
  src/gateway/data-governance/cognitive-promotion.test.ts \
  src/gateway/data-governance/placement-resolve.test.ts \
  src/gateway/data-governance/placement-platform-root.test.ts \
  src/gateway/data-governance/cognitive-cas-boundary.test.ts \
  src/gateway/data-governance/cognitive-shadow-promotion.test.ts
# Test Files  7 passed (7)
# Tests  172 passed (172)

node --test .kiro/specs/data-governance-v2-p4/gate-p4-cr2.test.mjs
# tests 2, pass 2
```

Full `pnpm check` / `pnpm tsgo` are not claimed.

---

## Still locked after first-wave Accept

- **P4 Accepted** — requires later-adapter unlock + operational evidence; not this verdict
- **Later adapters** — tenant cloud / BYOS / cold archive / dedicated
- **P5 coding** — **Accepted** (`435a72249f`); required P4 first-wave Accept (met)
- Dual Catalog / identity-kernel flatten / engine purge / forking `decideShadowPromotion`

---

## Stop

P4 first-wave is submitted for Codex Accept.

**未宣称 P4 first-wave Accepted / P4 Accepted。未启动 P5 coding。未解锁 later adapters。**
