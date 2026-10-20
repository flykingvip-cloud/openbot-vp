# Data Governance v2 — P4 Implementation

## Agents

- cursor-data-governance · role: owner · scope: P4 governed placement and sync (Gate planning → Codex Accept → first-wave slices) · paths: .kiro/specs/data-governance-v2-p4/\*\*, src/gateway/data-governance/placement-resolve.ts, src/gateway/data-governance/placement-resolve.test.ts, src/gateway/data-governance/placement-resolve.test-harness.ts, src/gateway/data-governance/placement-platform-proofs.ts, src/gateway/data-governance/placement-platform-verify.ts, src/gateway/data-governance/placement-platform-root.ts, src/gateway/data-governance/placement-platform-root.test.ts, src/gateway/data-governance/placement-platform-bindings.ts, src/gateway/data-governance/placement-consent-store.ts, src/gateway/data-governance/catalog-store.ts, src/gateway/data-governance/cognitive-promotion.ts, src/gateway/data-governance/cognitive-promotion-store.ts, src/gateway/data-governance/cognitive-promotion.test.ts, src/gateway/data-governance/cognitive-promotion.test-harness.ts, src/gateway/data-governance/cognitive-promotion-key.ts, src/gateway/data-governance/cognitive-promotion-adapters.ts, src/gateway/data-governance/cognitive-promotion-apply.ts, src/gateway/data-governance/cognitive-promotion-apply.test.ts, src/gateway/data-governance/cognitive-approval-grant-store.ts, src/gateway/data-governance/placement-export.ts, src/gateway/data-governance/placement-export-store.ts, src/gateway/data-governance/placement-export.test.ts, src/gateway/data-governance/types.ts, src/gateway/data-governance/paths.ts, src/gateway/data-governance/index.ts, src/gateway/data-governance/envelope.ts, src/gateway/server.impl.ts · since: 2026-08-16

## Prerequisites

- [x] P3 Accepted (`84a4165093`) — codex-data-governance 2026-08-16
- [x] P3 Gate B Accepted (CR6 `57b2bc94a7` / pin `7009d2fe70`)
- [x] **P4 Gate Accepted** — planning only; P4-a coding unlocked 2026-08-16

## Phase A — Gate (Submitted)

- [x] P4 Gate package submitted — cursor-data-governance
- [x] P4 Gate CR resubmit (resolver/canonical/key/projection/grant freeze) — cursor-data-governance
- [x] P4 Gate CR2 after `93148515c0` (P4-d export / classification union / grant issuance) — cursor-data-governance
- [x] P4 Gate CR3 closes trusted-region + grant-replay blockers — cursor-data-governance
- [x] **P4 Gate Accepted** — planning only; P4-a coding unlocked 2026-08-16

## Phase B — first wave (Accepted)

- [x] P4-a placement / residency resolver — **Accepted** (CR6 `296b14b8ac`) — cursor-data-governance
- [x] P4-b signed tenant-bound promotion protocol + receipt — **Accepted** (CR3 `868de8c348e3` / pin `5a3337b56f`) — cursor-data-governance
- [x] P4-c local + managed encrypted cloud adapters — **Accepted** (CR `a0ae9ddf0a` / pin `6595f0ff8d`) — cursor-data-governance
- [x] P4-d export / restore across placement — **Accepted** (CR `1dffe292a4` / pin `84860c7448`) — cursor-data-governance
- [x] **P4 first-wave Accepted** — `acd3b4a944` — 2026-08-17 — cursor-data-governance

## Phase C — P4 closure (submitted)

- [x] P4 closure handoff submitted — `codex-handoff-p4-closure.md` — cursor-data-governance (2026-08-18)
- [x] **P4 Accepted** (first-wave scope) — `4dd0da593f` — codex-data-governance (2026-08-18)

## Phase D — later adapters (locked)

- [ ] tenant cloud / BYOS / cold archive / dedicated regional — separate unlock after first-wave evidence

## Notes

- Decision contract: reuse `decideShadowPromotion` only. Do not invent a second promotion judgment. — cursor-data-governance
- P4 **Accepted** (first-wave scope, `4dd0da593f`, 2026-08-18). Later adapters stay locked. — cursor-data-governance
- P5 **Accepted** (`435a72249f`, 2026-08-18). v2 program closure CR resubmitted. — cursor-data-governance
