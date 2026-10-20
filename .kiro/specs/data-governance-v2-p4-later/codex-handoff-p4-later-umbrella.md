# Codex Handoff — P4 Later-Wave Umbrella

**From:** `cursor-data-governance`  
**To:** `codex-data-governance`  
**Date:** 2026-08-18  
**Branch:** `cursor/merge-live-into-main`  
**This document records later-wave umbrella Accepted (operator 2026-08-18: L-a/L-b/L-c/L-d all passed).**  
**It does not claim production LIVE cutover or C19 “audit baseline signed”.**

---

## Status

| Slice               | Status                                                                          |
| ------------------- | ------------------------------------------------------------------------------- |
| P4-L-a tenant-cloud | **Accepted** 2026-08-18                                                         |
| P4-L-b dedicated    | **Accepted** 2026-08-18                                                         |
| P4-L-c BYOS         | **Accepted** 2026-08-18                                                         |
| P4-L-d cold archive | **Accepted** 2026-08-18                                                         |
| Later-wave umbrella | **Accepted** 2026-08-18                                                         |
| Production go-live  | **submitted** — `codex-handoff-p4-later-golive.md` (RPC evaluate, **not** LIVE) |

Umbrella Accept means the four adapter slices are closed. It does **not** mean:

- LIVE container / `origin/main` image cutover
- C19 audit baseline signed
- `tenant-only` unlocked
- `laterWaveLocked()` migration quarantine lifted

---

## What this package is

Evidence index for later-wave adapter closure. It does not:

- Reopen P4 first-wave D1–D19
- Fork `decideShadowPromotion`
- Unlock `tenant-only` (still `sync_class_not_first_wave`)
- Change `laterWaveLocked()` migration quarantine
- Claim production / C19 ops sign-off

Go-live continues under architecture §14.1 I4: **独立部署 / 密钥 / 区域 / 运维门禁**.

---

## Slice contracts (frozen at each Accept)

| Slice | `mode`         | `canonicalHome`        | `projection` | Key kind           |
| ----- | -------------- | ---------------------- | ------------ | ------------------ |
| L-a   | `tenant-cloud` | `tenant_managed_cloud` | `none`       | `platform_tenant`  |
| L-b   | `dedicated`    | `dedicated_regional`   | `none`       | `dedicated_tenant` |
| L-c   | `byos`         | `byos`                 | `none`       | `byos_customer`    |
| L-d   | `cold-archive` | `cold_archive`         | `none`       | `archive_tenant`   |

Shared post–Changes Required bar:

- Path tokens + `path.resolve`/`path.relative` containment (`cognitive-promotion-adapter-path.ts`)
- Write and unlink share the same resolver
- Encrypt functions runtime-check `keyRef.kind` (not TypeScript unions alone)
- Live archive recall denied (`archive_recall_denied`); `role=archive` is never the writable canonical

---

## Handoffs

| Artifact                           | Role                           |
| ---------------------------------- | ------------------------------ |
| `codex-handoff-p4la.md`            | L-a Accepted                   |
| `codex-handoff-p4lb.md`            | L-b Accepted                   |
| `codex-handoff-p4lc.md`            | L-c Accepted                   |
| `codex-handoff-p4ld.md`            | L-d Accepted                   |
| `codex-handoff-p4-later-golive.md` | I4 production enablement gates |
| `plan.md`                          | Unlock ledger                  |
| `design-p4-later.md`               | Resolver rows + §6 gates       |
| `inventory-p4-later.md`            | Touchpoints                    |

---

## Directed tests

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/data-governance/placement-resolve.test.ts \
  src/gateway/data-governance/cognitive-promotion-apply.test.ts \
  src/gateway/data-governance/cognitive-promotion.test.ts \
  src/gateway/data-governance/placement-export.test.ts \
  src/gateway/data-governance/cognitive-promotion-adapters.test.ts \
  src/gateway/data-governance/later-wave-production-gate.test.ts
```

## Acceptance record

| Milestone           | Verdict                 | Tip                                            |
| ------------------- | ----------------------- | ---------------------------------------------- |
| P4-L-d              | **Accepted** 2026-08-18 | `codex-handoff-p4ld.md`                        |
| Later-wave umbrella | **Accepted** 2026-08-18 | operator: four slices passed                   |
| Production LIVE     | **not claimed**         | I4 gates in `codex-handoff-p4-later-golive.md` |
