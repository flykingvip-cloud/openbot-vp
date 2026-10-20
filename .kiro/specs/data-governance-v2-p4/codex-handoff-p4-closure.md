# Data Governance v2 — P4 Closure Handoff (first-wave Accepted)

**Implementation owner:** `cursor-data-governance`  
**Acceptance owner:** `codex-data-governance`  
**Branch:** `cursor/merge-live-into-main`  
**Prerequisite:** P4 first-wave **Accepted** (`acd3b4a944`, 2026-08-17)  
**This document records P4 Accepted** (first-wave scope, closure tip `4dd0da593f`, 2026-08-18). It does **not** claim v2 program complete.

All first-wave P4 slices **P4-a … P4-d** have independent Codex Accept. Codex recorded **P4 Accepted** (first-wave scope only) per `plan.md` and `design-p4.md` §10–§11. Later adapters remain explicitly out of scope.

---

## Ask of Codex

**P4 Accepted** (first-wave scope, closure tip `4dd0da593f`, 2026-08-18).

First-wave slice Accepts + §10 exit bar recorded. Accept does **not** unlock BYOS / tenant-cloud / cold archive / dedicated and does **not** declare v2 program complete.

---

## Slice Accept trail

| Slice                           | Verdict      | Implementation | Review tip   |
| ------------------------------- | ------------ | -------------- | ------------ |
| P4-a resolver                   | **Accepted** | CR6            | `296b14b8ac` |
| P4-b promotion protocol         | **Accepted** | CR3            | `5a3337b56f` |
| P4-c adapters / CAS / tombstone | **Accepted** | `a0ae9ddf0a`   | `6595f0ff8d` |
| P4-d export / restore           | **Accepted** | `1dffe292a4`   | `84860c7448` |

| Milestone                      | SHA          |
| ------------------------------ | ------------ |
| P4 first-wave Accept           | `acd3b4a944` |
| P4 Gate CR3 package            | `c58652f74e` |
| P4 closure package             | `26622309b7` |
| **This P4 closure review tip** | `4dd0da593f` |

---

## §10 exit criteria → evidence

| Exit criterion                           | Where proven                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Cross-tenant false allow = 0             | `placement-resolve.test.ts`, `cognitive-promotion.test.ts`, `cognitive-promotion-apply.test.ts`, `placement-export.test.ts` |
| Revoke / tombstone E2E (§6.5 order)      | `cognitive-promotion-apply.test.ts`, `placement-export.test.ts`                                                             |
| Offline policy-compliant local canonical | `placement-resolve.test.ts`                                                                                                 |
| Decision reuse (`decideShadowPromotion`) | `cognitive-promotion.test.ts`, `cognitive-shadow-promotion.test.ts`                                                         |
| Later adapters fail closed               | `laterWaveAdapterUnavailable` / `first_wave_adapter_unavailable` in resolver + export                                       |

Full matrix: `codex-handoff-p4-first-wave.md` B3 table.

---

## Directed test suite

```text
OPENBOT_TEST_PROFILE=low VITEST_CACHE_DIR=/tmp/vitest-p4-closure \
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

---

## Still locked

- **Later adapters** — tenant cloud / BYOS / cold archive / dedicated regional
- **v2 program complete** — requires separate v2 closure after P4 + P5 Accept
- Dual Catalog / identity-kernel flatten / forking `decideShadowPromotion`
