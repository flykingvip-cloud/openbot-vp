# P4 Later-Wave Plan — Post First-Wave Adapters

**Owner:** `cursor-data-governance`  
**Acceptance:** `codex-data-governance`  
**Status:** P4-L-a / P4-L-b / P4-L-c / P4-L-d **Accepted** (operator/Codex 2026-08-18, in tree). Later-wave umbrella **Accepted**. I4 enablement + cutover decision **submitted** — `cutoverAllowed: false` (dirty worktree is not a LIVE candidate).  
**Prerequisite:** v2 first-wave program **Accepted** (`0c34378b07`); **M0–M4 migration Accepted** (`14a4f22d1d`); P4 first-wave **Accepted** (`4dd0da593f`); P5 **Accepted** (`435a72249f`)  
**Architecture:** §12, §16 P4 (later adapters), §17.5  
**Companion:** `gate-p4-later.md`, `design-p4-later.md`, `inventory-p4-later.md`, `tasks.md`

## Agents

- cursor-data-governance · role: owner · scope: P4 later-wave adapters, I4 enablement, fail-closed cutover · paths: .kiro/specs/data-governance-v2-p4-later/\*_, src/gateway/data-governance/later-wave-_.ts, src/gateway/data-governance/cognitive-promotion-adapter-path.ts, src/gateway/data-governance/cognitive-promotion-adapters.ts, src/gateway/data-governance/placement-resolve.ts, src/gateway/server-methods/data-governance.ts, scripts/ops/evaluate-later-wave-cutover.ts · since: 2026-08-18

## Sequence (mandatory)

```text
v2 first-wave Accepted
  → M0–M4 legacy migration Accepted
  → P4-later Gate (this package) → Codex Gate Accept
  → P4-L-a / P4-L-b / P4-L-c / P4-L-d  (each slice independently Accepted)
  → P4 later-wave closure (umbrella Accept)
  → I4 go-live gates (独立部署 / 密钥 / 区域 / 运维)
  → cutover decision (fail closed unless clean origin/main; LIVE still a separate ops act)
```

Hard rules:

- v2 program Accept **does not** auto-Accept later adapter slices.
- **M4 Accepted** — adapter **implementation unlocked** (operator 2026-08-18).
- **P4-later Gate Accept** unlocks **P4-L-a coding charter** (when Codex records Accept).
- Each subsequent slice stays locked until the prior slice is **Accepted**.
- First-wave contracts (D1–D19) remain frozen. Later-wave amends via new L\* ids only.
- Must **not** fork `decideShadowPromotion` or weaken first-wave exit bars.
- Later-wave adapter slices L-a/b/c/d and umbrella are **Accepted** (2026-08-18). Production go-live still requires the four I4 gates; LIVE image cutover is a separate ops act.

## Proposed slice order (draft — freeze at Gate Accept)

| Slice      | Adapter      | Deliverable (draft)                                                                                                   |
| ---------- | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| **P4-L-a** | tenant-cloud | Resolver + adapter for tenant managed cloud; extend sync map row `tenant-cloud`; key/region under tenant contract     |
| **P4-L-b** | dedicated    | Dedicated regional placement + `requireDedicatedKey` / `requireDedicatedDatabase` / `replicationClass` regional paths |
| **P4-L-c** | BYOS         | Customer-controlled storage binding; custodian `byos`; deny-code retirement for `byos-only` where policy allows       |
| **P4-L-d** | cold archive | Archive-only sync class; retrieval policy vs normal cognitive recall; export/restore for archive bindings             |

Codex may reorder slices at Gate review if dependency evidence requires (e.g. dedicated before tenant-cloud).

## Per-slice exit bar (inherits first-wave)

Each slice must re-prove (directed tests + handoff):

- Cross-tenant false allow = **0**
- Tombstone / revoke propagation in frozen §6.5 order
- Offline never serves projection as writable canonical
- Placement export/restore changes **bindings only** (`resourceId` / `agentAssetId` unchanged)
- Later-wave success never bypasses `decideShadowPromotion` or grant/receipt contracts

## Non-goals

- Reopening P4 first-wave Accept or v2 program closure
- Editing Codex-owned architecture document without separate authorization
- Bundling all four adapters in one coding drop
- P2 purge adapter expansion beyond placement scope unless explicitly in slice charter

## Evidence artifacts (to create after Gate Accept)

| Slice         | Handoff                              | Directed tests (names TBD at coding)          |
| ------------- | ------------------------------------ | --------------------------------------------- |
| P4-L-a        | `codex-handoff-p4la.md`              | tenant-cloud resolver + adapter matrix        |
| P4-L-b        | `codex-handoff-p4lb.md`              | dedicated region / replication matrix         |
| P4-L-c        | `codex-handoff-p4lc.md`              | BYOS binding + key authority matrix           |
| P4-L-d        | `codex-handoff-p4ld.md`              | archive retrieval + export/restore matrix     |
| Umbrella      | `codex-handoff-p4-later-umbrella.md` | **Accepted** 2026-08-18 (does not claim LIVE) |
| Go-live gates | `codex-handoff-p4-later-golive.md`   | independent deployment / key / region / ops   |

## Unlock ledger

| Milestone                      | Status            | Tip                                                                                                                                                              |
| ------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0–M4 migration                | **Accepted**      | `14a4f22d1d`                                                                                                                                                     |
| P4-later Gate                  | **not submitted** | —                                                                                                                                                                |
| P4-L-a coding                  | **Accepted**      | Codex Accept 2026-08-18 (tenant-cloud; in tree, unlanded)                                                                                                        |
| P4-L-a Accept                  | **Accepted**      | Codex 2026-08-18                                                                                                                                                 |
| P4-L-b coding                  | **Accepted**      | Codex Accept 2026-08-18 (dedicated; in tree, unlanded)                                                                                                           |
| P4-L-b Accept                  | **Accepted**      | Codex 2026-08-18                                                                                                                                                 |
| P4-L-c coding                  | **Accepted**      | Codex Accept 2026-08-18 (BYOS; in tree, unlanded)                                                                                                                |
| P4-L-c Accept                  | **Accepted**      | Codex 2026-08-18                                                                                                                                                 |
| P4-L-d coding                  | **Accepted**      | Codex/operator Accept 2026-08-18 (cold archive; in tree, unlanded)                                                                                               |
| P4-L-d Accept                  | **Accepted**      | Codex/operator 2026-08-18                                                                                                                                        |
| P4 later-wave umbrella         | **Accepted**      | `codex-handoff-p4-later-umbrella.md`; **not** LIVE cutover / C19 signed                                                                                          |
| P4 later-wave go-live gates    | **submitted**     | `codex-handoff-p4-later-golive.md` — I4 独立部署 / 密钥 / 区域 / 运维；RPC evaluate（**not** LIVE）                                                              |
| P4 later-wave cutover decision | **submitted**     | `decideLaterWaveCutover` + `scripts/ops/evaluate-later-wave-cutover.ts`; evidence `docs/design/evidence/data-governance-p4-later-cutover-decision-20260818.json` |
