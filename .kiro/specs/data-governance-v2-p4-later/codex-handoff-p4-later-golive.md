# Codex Handoff — P4 Later-Wave Production Go-Live Gates

**From:** `cursor-data-governance`  
**To:** `codex-data-governance`  
**Date:** 2026-08-18  
**Branch:** `cursor/merge-live-into-main`  
**Prerequisite:** L-a/L-b/L-c/L-d **Accepted**; later-wave umbrella **Accepted** (2026-08-18)  
**This document is submitted for go-live gate review. It does not claim LIVE image cutover, `origin/main` deploy, or C19 “audit baseline signed”.**

---

## Operator instruction

P4 later-wave L-a/L-b/L-c/L-d four slices passed. Continue go-live under **独立部署 / 密钥 / 区域 / 运维门禁** (architecture §14.1 I4).

Slice Accept is not production enablement. Shared-process managed execution is not a production shortcut until I3 is proven. I4 requires a dedicated execution and host trust boundary; database, key and region follow the contracted isolation level.

## Commands

| Surface                                     | Path                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Domain (explicit params)                    | `runLaterWaveProductionEnablement`                                      |
| Host evaluator (env-derived; signed region) | `evaluateLaterWaveEnablementAtHost`                                     |
| Operator RPC                                | `dataGovernance.laterWave.evaluateEnablement` (`operator.write`)        |
| Cutover decision                            | `decideLaterWaveCutover` / `scripts/ops/evaluate-later-wave-cutover.ts` |

Receipt kind: `p4_later_wave_enablement_receipt`  
`productionReady: true` **only** when all four findings pass.  
`liveCutover` is **always `false`**. This RPC evaluates gates; it does not cut over LIVE.

Host path fail-closes unless:

| Gate     | Host source                                                                                                      | Deny                            |
| -------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 独立部署 | `OPENBOT_LATER_WAVE_DEPLOYMENT_PROFILE` or security profile (never client) + `assertMigrationProductionBoundary` | `independent_deployment_denied` |
| 密钥     | `OPENBOT_PROMOTION_KEY_HMAC_KEY` + adapter-implied `keyRef.kind` (never client)                                  | `key_gate_denied`               |
| 区域     | Signed branded receipt + `authenticateGovernanceCall`; HMAC via `verifyPlatformDeploymentRegionReceipt`          | `region_gate_denied`            |
| 运维     | `OPENBOT_C19_SUMMARY_PATH` + `verifyC19ProbeEvidence` (never client path)                                        | `ops_gate_denied`               |

A client `{ trustedRegionPresent: true }` object is not a region receipt. Platform admin required. Authenticated call `tenantId` must equal params `tenantId`.

## Cutover decision (this drop)

`cutoverAllowed` is always **false**. `--cutover` / `--live` → `live_cutover_forbidden`. A dirty worktree or `HEAD !== origin/main` cannot be a LIVE candidate.

Worktree evidence (2026-08-18): `docs/design/evidence/data-governance-p4-later-cutover-decision-20260818.json` — `enablement_not_ready` + `trunk_dirty`; `headSha` ≠ `originMainSha`.

## Out of scope (this drop)

- `podman` / LIVE container rebuild or cutover from this worktree
- Writing Catalog or treating branch tip as `origin/main`
- Claiming C19 audit baseline signed
- Unlocking `tenant-only`
- Lifting `laterWaveLocked()` migration quarantine
- Forking `decideShadowPromotion`

## Tests

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/data-governance/later-wave-production-gate.test.ts \
  src/gateway/data-governance/later-wave-cutover-gate.test.ts \
  src/gateway/server-methods/data-governance.test.ts \
  src/gateway/data-governance/placement-resolve.test.ts \
  src/gateway/data-governance/cognitive-promotion-apply.test.ts \
  src/gateway/data-governance/cognitive-promotion.test.ts \
  src/gateway/data-governance/placement-export.test.ts \
  src/gateway/data-governance/cognitive-promotion-adapters.test.ts
```

## Submit checklist

- [x] Four gates fail closed independently; pass path sets `productionReady: true`
- [x] Dedicated mix / missing HMAC / missing region / missing C19 never claim ready
- [x] Host path ignores client region booleans; signed receipt required
- [x] RPC is platform-admin + tenant-bound; `liveCutover: false`
- [x] First-wave later-wave directed tests remain green
- [x] Cutover decision fail-closes dirty tree / non-main tip / `--cutover`
- [x] No LIVE cutover claimed
