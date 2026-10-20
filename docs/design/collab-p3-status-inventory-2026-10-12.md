# Collaboration P3 status inventory (2026-10-12)

> Status: **single-Beat Episode wrap + Facilitator library already on `main`; this PR is gap-only inventory + Constitution §3.4 lag fix.**
>
> Flags remain **OFF**. Floor live cutover stays **BLOCKED** (`FLOOR_LIVE_CUTOVER_DEFAULT=false`).
>
> P3 target (frozen spine): wrap the legacy Primary/Supplement executor with
> Episode/Beat orchestration for **one beat**; Peer Floor participation stays
> SHADOW; Facilitator observes at beat end; no multi-beat; no production Floor
> live default ON.
>
> This note maps task-book names onto **existing** symbols. It does **not**
> authorize opening `collaboration.episodeStore`,
> `collaboration.floor.protocol=floor`, `collaboration.floor.shadowStage`,
> `collaboration.ledger.decisionRecords`, or `FLOOR_LIVE_CUTOVER_DEFAULT`.

Base inventory HEAD at authoring: `ff9b7352ec` (P2 merge). Constitution matrix:
[`collaboration-runtime-alignment/Collaboration-Runtime-Constitution-and-Implementation-Matrix.md`](./collaboration-runtime-alignment/Collaboration-Runtime-Constitution-and-Implementation-Matrix.md).
Prior inventories: [`collab-p0-status-inventory-2026-10-12.md`](./collab-p0-status-inventory-2026-10-12.md),
[`collab-p1-status-inventory-2026-10-12.md`](./collab-p1-status-inventory-2026-10-12.md),
[`collab-p2-status-inventory-2026-10-12.md`](./collab-p2-status-inventory-2026-10-12.md).

## 1. Task-book → existing symbols

| Capability | Status | Existing symbol / file |
| --- | --- | --- |
| Single-Beat Episode wrap around legacy round | **EXISTS** (`episodeStore` default OFF) | `runSingleBeatEpisodeAroundRound` / `beginSingleBeatEpisodeRuntime` / `finishSingleBeatEpisodeRuntime` in `episode-single-beat-runtime.ts`; composition root `chat.ts` wraps `executeCollaborationRound` |
| LegacyBeatExecutor retained | **EXISTS** (different name) | `LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR` / `resolveProductionCollaborationExecutor` in `legacy-production-executor.ts`; always the production speaker path while G1 refuses Floor |
| Episode state machine | **EXISTS** | `episode-state.ts`; `episode-state-machine.ts` (`BEAT_ACTIVE`, `FACILITATOR_OBSERVE`, `stop_loop`) |
| Episode Store | **EXISTS** (default OFF) | `episode-store.ts`; `isCollabEpisodeStoreEnabled` ← `collaboration.episodeStore` |
| Facilitator control plane | **EXISTS** (gated with episodeStore) | `facilitator-control.ts`: `gateFacilitatorControl`, `recordFacilitatorObservation`, `singleBeatControlRequests`; outcomes `authorized` / `denied` / `route_to_task_governance` |
| Refuse multi-beat | **EXISTS** | `assertSingleBeatEvent` rejects `next_beat`; `assertAtMostOneBeat` |
| Floor live cutover refuse | **EXISTS** (OFF) | `FLOOR_LIVE_CUTOVER_DEFAULT=false` in `floor-live-cutover.ts`; `FLOOR_DRIVES_PRODUCTION_DECISION=false` in `legacy-production-executor.ts` |
| Peer Floor L0 / L1 / Admission | **EXISTS as SHADOW** | `router-l0.ts` / `router-l1.ts` / `admission.ts` via `floor-shadow-plan.ts`; does **not** rewrite production speakers |
| Floor Bid | **EXISTS as SHADOW-B** | `floor-bid.ts`; `drivesProductionDecision: false` |
| Need resolver (EDR Facilitator path) | **EXISTS** | `need-resolver.ts`; used when Facilitator writes EDR |
| chat wiring assert | **EXISTS** | `episode-single-beat-runtime.g2.test.ts` asserts `chat.ts` contains wrap + `productionExecutor: resolveProductionCollaborationExecutor(...)` |
| Facilitator G3 / Legacy G8 / Cutover G1 tests | **EXISTS** | `facilitator-control.g3.test.ts`; `legacy-production-executor.g8.test.ts`; `floor-live-cutover.g1.test.ts` |
| Digital-team pilot fixtures | **PARTIAL** | `__fixtures__/digital-team-real-rounds.ts`; `collab-dialogue-regressions.test.ts` (selection/visible-reply; not a full P3 exit suite) |
| Facilitator `CHALLENGE` / `REQUEST_EVIDENCE` named actions | **MISSING** (intentional) | Only `stop_loop` / `route_to_task_governance` / deny others |
| Floor live production speaker rewrite | **MISSING** (intentional) | `promoteFloorAdmittedToProductionSpeakers` always refuses |
| Observability / pilot exit gates | **MISSING** (ops, not code) | Useful-reply rate, mention coverage, etc. belong in acceptance, not a new runtime |
| Second Episode / Floor orchestrator | **MUST NOT BUILD** | Keep G8 legacy executor; single-beat only wraps it |

## 2. Defaults that must stay OFF

| Flag / constant | Default | Note |
| --- | --- | --- |
| `FLOOR_LIVE_CUTOVER_DEFAULT` | `false` | Unsigned cutover; keep OFF through P3 |
| `FLOOR_DRIVES_PRODUCTION_DECISION` | `false` | Bids never select production speakers |
| `collaboration.episodeStore` | unset/false | Flag-off: wrap is no-op (calls `executeRound` only) |
| `collaboration.floor.protocol` | unset/legacy | `floor` accepted and ignored (not live) |
| `collaboration.floor.shadowStage` | unset | Shadow A/B optional; leave unset |
| `collaboration.ledger.decisionRecords` | unset/false | No EDR facilitator copy until dual-flag on |

Episode records created under the flag still stamp `protocol: "legacy"` in
`beginSingleBeatEpisodeRuntime` — consistent with Floor not being live.

## 3. Thin hardening in this PR (path B only)

1. **Docs** — this inventory (no second architecture / no second orchestrator).
2. **Constitution §3.4 lag** — Episode Runtime and Facilitator rows updated from
   DESIGN-ONLY to **FLAG-OFF wired** (G2/G3 on `main`, chat composition root
   already calls `runSingleBeatEpisodeAroundRound`). Episode Store / state-machine
   rows corrected so they no longer claim `chat.ts` never references them.
3. **Optional assert test** — **skipped**. G2 already asserts chat wiring and
   flag-off no-op behavior.

## 4. Explicit non-goals (forbidden redesign)

- Parallel Episode / Floor / Admission orchestrator
- Enabling `episodeStore`, `protocol=floor`, `shadowStage`, `decisionRecords`, or Floor live defaults
- Multi-beat Floor live or applying Bid into production `participants` / `executionBots`
- Tip-prompt rule churn, Growth hot-path scoring, HA / LIVE router
- Productizing pilot observability dashboards in this PR

## 5. Acceptance checklist (for 执行效率合入验收)

1. Diff is thin: this inventory + Constitution §3.4 (and related lag notes) only; no new orchestrator / second RuntimeAuthority / Floor live.
2. Defaults unchanged: `FLOOR_LIVE_CUTOVER_DEFAULT`, `episodeStore`, `protocol`, `shadowStage`, `decisionRecords` stay OFF.
3. §3.4 no longer calls Episode Runtime or Facilitator DESIGN-ONLY; both are FLAG-OFF wired (G2/G3).
4. Existing G1/G2/G3/G8 suites remain the regression surface (no required new test in this PR).
5. No HA / LIVE Floor / Path B deploy / default flag flips in this PR.
