# Collaboration P4–5 status inventory (2026-10-12)

> Status: **Task/Handoff/Governance libraries already on `main`; this PR is
> gap-only inventory. No runtime change.**
>
> Flags remain **OFF**. Floor live cutover stays **BLOCKED**
> (`FLOOR_LIVE_CUTOVER_DEFAULT=false`). Multi-beat stays **gated refused**
> (`maxBeatsPerEpisode: 1`; G2 rejects `next_beat`).
>
> P4–5 target (frozen spine): Task/Handoff/Governance closed loop stable; then
> gradually raise beats per Episode. Include task-board/claim productization
> gaps, HandoffContract production path (P1 seam done), governance gate,
> multi-beat gates, and 责任·贡献·创新·共享 ledger hooks if any.
>
> This note maps task-book names onto **existing** symbols. It does **not**
> authorize opening `collaboration.task.handoffContract`,
> `collaboration.ledger.decisionRecords`, `collaboration.episodeStore`,
> `collaboration.floor.protocol=floor`, `FLOOR_LIVE_CUTOVER_DEFAULT`, or raising
> `maxBeatsPerEpisode`. P4a (production handoff callers) is **deferred** until
> after this inventory merges.
>
> **P4a status (follow-on):** production RPC entry landed; flag remains OFF.

Base inventory HEAD at authoring: `3fc3746e94` (P3 merge). Constitution matrix:
[`collaboration-runtime-alignment/Collaboration-Runtime-Constitution-and-Implementation-Matrix.md`](./collaboration-runtime-alignment/Collaboration-Runtime-Constitution-and-Implementation-Matrix.md).
Prior inventories: [`collab-p0-status-inventory-2026-10-12.md`](./collab-p0-status-inventory-2026-10-12.md),
[`collab-p1-status-inventory-2026-10-12.md`](./collab-p1-status-inventory-2026-10-12.md),
[`collab-p2-status-inventory-2026-10-12.md`](./collab-p2-status-inventory-2026-10-12.md),
[`collab-p3-status-inventory-2026-10-12.md`](./collab-p3-status-inventory-2026-10-12.md).

## 1. Task-book → existing symbols

| Capability | Status | Existing symbol / file |
| --- | --- | --- |
| Task runtime + responsibility graph | **EXISTS** | `seedTaskResponsibility` / `resolveTaskResponsibility` / `applyTaskHandoff` / `assertTaskMayComplete` / `assertDeliverableCommit` in `task-runtime.ts` |
| Task governance state machine | **EXISTS (LIVE)** | `task-state-machine.ts`; RPC `collaboration.task.transition` → `transitionCollaborationTask` |
| HandoffContract state machine | **EXISTS (FLAG-OFF)** | `proposeHandoff` → `acceptHandoff` → `approveHandoff` → `applyApprovedHandoff` in `handoff-contract.ts`; flag `collaboration.task.handoffContract` |
| Flag-on refuse of `owner_transfer` shortcut | **EXISTS** (P1 seam) | `HandoffContractRequiredError` in `task-runtime.ts`; `handoffCollaborationTask` in `collaboration-learning/state-machine.ts` fail-closed when flag ON |
| Production callers of contract APIs | **EXISTS (FLAG-OFF)** (P4a) | RPC `collaboration.task.proposeHandoff` / `acceptHandoff` / `approveHandoff` / `applyHandoff` → `handoff-contract-entry.ts` → existing `proposeHandoff*` APIs. Default flag still OFF |
| `collaboration.task.handoff` RPC shortcut | **EXISTS (LIVE when flag OFF)** | `handoffCollaborationTask` → `applyTaskHandoff` |
| `[[collab_edge:handoff\|…]]` | **EXISTS (LIVE) ≠ contract** | `parseCollabEdgesFromText` in `collab-edge.ts`; same-round routing in `round-runtime.ts`. Does **not** write HandoffContract or mutate responsibility |
| Governance Gate | **EXISTS (LIVE)** | `evaluateGovernanceGate` in `governance-gate.ts` (`finalize_decision` / `publish_proposal` / `self_advance`). Callers: handoff approve, `assertTaskMayComplete`, learning finalize |
| `self_advance` action | **PARTIAL** | Gate supports it; **zero** production callers; still gated by `botMaySelfAdvanceWithoutHuman` (default false) |
| Facilitator → task governance | **EXISTS (FLAG-OFF)** | `route_to_task_governance` in `facilitator-control.ts`; gated with `episodeStore` |
| Group task board / Claim productization | **EXISTS (FLAG-OFF)** (P4b) | ClaimContract publish→claim→apply (`claim-contract.ts` / entry / RPC). 1:1 `SessionTaskBoard` unchanged. `currentTaskId` synced on apply. Bots never receive L3 `task.assign` |
| Deliverable completion gate | **PARTIAL** | `assertTaskMayComplete` + object-storage `Deliverable`; depends on `deliverableRequired` |
| Multi-Beat Episode controller | **MISSING (intentional)**; raise gate **EXISTS (DEFAULT 1)** (P5) | State table has `next_beat → BID_ADMISSION`; G2 still refuses apply; `collaboration.episode.maxBeats` (default 1) + `multi-beat-gate.ts` may raise EffectivePolicy + Facilitator observe authorize. **No** multi-beat production controller |
| Floor live cutover | **OFF** | `FLOOR_LIVE_CUTOVER_DEFAULT=false`; Bid never drives production speakers |
| 责任·贡献·创新·共享 (RCIS) named ledger | **EXISTS (FLAG-OFF)** (P4c) | `rcis-aggregate.ts` maps claim/handoff/deliverable/challenge/idle → RCIS scores; reuses `contribution-quality.ts` + ledger reader; sync adjacent to `recompute-growth`. GrowthDimension unchanged. R5/C7: must not drive Admission. Flag `collaboration.learning.rcisAggregate` default OFF |
| EDR / PDR v2 on ledger | **EXISTS (FLAG-OFF)** | `collaboration.ledger.decisionRecords` |
| Execution ledger | **EXISTS (LIVE)** | `appendCollaborationExecutionRecord` |
| Second Task / Handoff / multi-beat orchestrator | **MUST NOT BUILD** | Reuse `task-runtime` + `handoff-contract` + G2 single-beat wrap; do not invent parallel systems |

## 2. Defaults that must stay OFF

| Flag / constant | Default | Note |
| --- | --- | --- |
| `collaboration.task.handoffContract` | unset/false | Contract path + refuse shortcut only when true |
| `collaboration.task.claimContract` | unset/false | ClaimContract path only when true |
| `collaboration.learning.rcisAggregate` | unset/false | P4c RCIS async aggregate only when true |
| `collaboration.ledger.decisionRecords` | unset/false | EDR/PDR v2 writers no-op |
| `collaboration.episodeStore` | unset/false | Single-beat wrap no-op when off |
| `collaboration.floor.protocol` | unset/legacy | Floor is not the live orchestrator |
| `collaboration.floor.shadowStage` | unset | Shadow A/B optional |
| `FLOOR_LIVE_CUTOVER_DEFAULT` | `false` | Unsigned cutover |
| `collaboration.episode.maxBeats` / policy `maxBeatsPerEpisode` | unset/`1` | P5 raise gate; default 1. G2 still refuses apply; Floor live still OFF |

## 3. Constitution lag check (§3.5 / §3.6)

Reviewed against this inventory. **No edit in this PR.**

- R6 HandoffContract = FLAG-OFF — still accurate.
- R6 flag-off `owner_transfer` shortcut = LIVE — still accurate (P1 seam only changes flag-ON behavior).
- R2 Governance Gate = LIVE — still accurate.
- Claim = FLAG-OFF wired (P4b) — see Constitution matrix update.
- Multi-beat = no production controller; G2 refuses `next_beat` — already stated in §3.4 after P3.

Missing production callers of `proposeHandoff*` is an inventory gap for P4a, not a false Constitution row.

## 4. Thin hardening in this PR (path B only)

1. **Docs** — this inventory (no second architecture / no second orchestrator).
2. **Loom** — register `COLLAB_P4_5_INVENTORY`.
3. **Constitution** — **skipped** (no clear lag like P3 §3.4 DESIGN-ONLY mislabel).

## 5. Deferred order (after this inventory merges)

Owner: **P4a later after merge**. Do not start these in this PR.

1. **P4a** — **DONE (follow-on PR):** production RPC entry onto existing `proposeHandoff*` via `handoff-contract-entry.ts`. Flag-off keeps `collaboration.task.handoff` shortcut; flag-on forces the contract. Flag still default OFF.
2. **P4b** — **DONE (follow-on PR):** Group ClaimContract + RPC publish/claim/apply onto task-runtime (`claim-contract*.ts`). Flag `collaboration.task.claimContract` still default OFF. Oral “已派工” / `collab_edge` alone is not board fact. Separate from 1:1 `SessionTaskBoard`. Bots still do not get L3 `task.assign`.
3. **P4c** — **DONE (follow-on PR):** async RCIS aggregate (`rcis-aggregate.ts`) over ledger + `contribution-quality`; flag `collaboration.learning.rcisAggregate` still default OFF. GrowthDimension not renamed; not on Admission hot path (R5/C7).
4. **P5** — **DONE (follow-on PR):** `collaboration.episode.maxBeats` raise gate (`multi-beat-gate.ts`); default 1. Facilitator may authorize `next_beat` only when >1 (observe only). G2 still refuses apply. Floor live OFF. Full multi-beat controller still deferred.

## 6. Explicit non-goals (forbidden redesign)

- Parallel Task runtime / second HandoffContract / multi-beat orchestrator
- Treating `collab_edge:handoff` as HandoffContract or responsibility mutation
- Enabling `handoffContract` / `claimContract` / `learning.rcisAggregate` / `decisionRecords` / `episodeStore` / Floor live / raising `collaboration.episode.maxBeats` above 1 by default
- Tip-prompt task board, Growth hot-path scoring, HA / LIVE router
- Implementing P4a/b/c or P5 in this PR

## 7. Acceptance checklist (for 执行效率合入验收)

1. Diff is thin: this inventory + Loom stream only; **no** Constitution change required; no runtime / second orchestrator / Floor live.
2. Defaults unchanged: `handoffContract`, `decisionRecords`, `episodeStore`, Floor protocol, `FLOOR_LIVE_CUTOVER_DEFAULT`, `collaboration.episode.maxBeats` (1) stay OFF / gated.
3. Matrix/history: multi-beat controller still **MISSING**; P5 raise gate **EXISTS (DEFAULT 1)**; P4a/P4b/P4c mark Handoff entry / Claim / RCIS as **EXISTS (FLAG-OFF)**.
4. Deferred order documented: P4a → P4b → P4c → P5; P4a explicitly after this merge.
5. No HA / LIVE Floor / Path B deploy / default flag flips in this PR.
