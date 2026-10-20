# Data Governance v2 — P4 Later-Wave (L-a/b/c/d + I4 go-live)

## Agents

- cursor-data-governance · role: owner · scope: P4 later-wave adapters, I4 enablement gates, fail-closed cutover decision · paths: .kiro/specs/data-governance-v2-p4-later/\*\*, src/gateway/data-governance/cognitive-promotion-adapter-path.ts, src/gateway/data-governance/cognitive-promotion-adapters.ts, src/gateway/data-governance/cognitive-promotion-adapters.test.ts, src/gateway/data-governance/later-wave-production-gate.ts, src/gateway/data-governance/later-wave-production-gate.test.ts, src/gateway/data-governance/later-wave-cutover-gate.ts, src/gateway/data-governance/later-wave-cutover-gate.test.ts, src/gateway/data-governance/placement-resolve.ts, src/gateway/data-governance/placement-resolve.test.ts, src/gateway/data-governance/cognitive-promotion-apply.ts, src/gateway/data-governance/cognitive-promotion-apply.test.ts, src/gateway/data-governance/placement-export.ts, src/gateway/data-governance/placement-export.test.ts, src/gateway/server-methods/data-governance.ts, src/gateway/server-methods/data-governance.test.ts, src/gateway/server-methods/data-governance.pack.ts, src/gateway/server-methods/packs/manifest.ts, scripts/ops/evaluate-later-wave-cutover.ts, docs/design/evidence/data-governance-p4-later-cutover-decision-20260818.json · since: 2026-08-18

## Sequence

- [x] P4-L-a tenant-cloud — **Accepted** 2026-08-18 — cursor-data-governance
- [x] P4-L-b dedicated — **Accepted** 2026-08-18 — cursor-data-governance
- [x] P4-L-c BYOS — **Accepted** 2026-08-18 — cursor-data-governance
- [x] P4-L-d cold archive — **Accepted** 2026-08-18 — cursor-data-governance
- [x] Later-wave umbrella — **Accepted** 2026-08-18 — cursor-data-governance
- [x] I4 enablement gates + RPC — **submitted** (not LIVE) — cursor-data-governance
- [x] Cutover decision fail-closed — **submitted** (`cutoverAllowed: false`) — cursor-data-governance
- [ ] Land onto clean `origin/main` then LIVE cutover — blocked on trunk tip

## Notes

- Does **not** reopen P4 first-wave Accept (`4dd0da593f`) or v2 program Accept (`0c34378b07`).
- `tenant-only` remains `sync_class_not_first_wave`. `laterWaveLocked()` migration quarantine unchanged.
- `decideShadowPromotion` not forked. LIVE cutover is a separate ops act.
