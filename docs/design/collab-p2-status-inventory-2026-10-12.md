# Collaboration P2 status inventory (2026-10-12)

> Status: **Shadow-A / Shadow-B library already on `main`; this PR is gap-only inventory + legacy compare fix.**
>
> Flags remain **OFF**. Floor live cutover stays **BLOCKED**.
>
> P2 target (frozen spine): Shadow-A (deterministic L0/L1/Admission vs legacy) then
> Shadow-B (Bid as candidate signal, never authorization). No production side
> effects; same `RuntimeAuthority` policy snapshot; record diffs; Floor live OFF.
>
> This note maps task-book names onto **existing** symbols. It does **not**
> authorize opening `collaboration.floor.shadowStage`,
> `collaboration.ledger.decisionRecords`, `collaboration.floor.protocol=floor`,
> or `FLOOR_LIVE_CUTOVER_DEFAULT`.

Base inventory HEAD at authoring: `598301c017` (P1 merge). Constitution matrix:
[`collaboration-runtime-alignment/Collaboration-Runtime-Constitution-and-Implementation-Matrix.md`](./collaboration-runtime-alignment/Collaboration-Runtime-Constitution-and-Implementation-Matrix.md).
Prior inventories: [`collab-p0-status-inventory-2026-10-12.md`](./collab-p0-status-inventory-2026-10-12.md),
[`collab-p1-status-inventory-2026-10-12.md`](./collab-p1-status-inventory-2026-10-12.md).

## 1. Task-book → existing symbols

| Capability                                 | Status                              | Existing symbol / file                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shadow stage flag A/B                      | **EXISTS** (default OFF)            | `readCollabFloorShadowConfig` / `isCollabFloorShadowStageA\|B` in `shadow-stage-flag.ts`; config `collaboration.floor.shadowStage` in `types.collaboration.ts` / `zod-schema.ts`                                                                                                                                       |
| Shadow-A L0 / L1 / Admission plan          | **EXISTS**                          | `computeFloorShadowA` / `attachFloorShadowA` in `floor-shadow-plan.ts`; `routeL0` (`router-l0.ts`); `routeL1` (`router-l1.ts`); `admit` (`admission.ts`)                                                                                                                                                               |
| Attach onto decide without speaker rewrite | **EXISTS**                          | `decideParticipants` → `attachFloorShadow` in `decision-engine.ts`; `assertFloorShadowDidNotReplaceSpeakers` in `floor-live-cutover.ts`                                                                                                                                                                                |
| Legacy vs Floor compare                    | **PARTIAL → fixed in this PR**      | `compareLegacyFloorAdmission` in `floor-shadow-plan.ts`; EDR `floorCompare` in `episode-decision-record.ts`. Writers previously set `legacy.admitted` from lead-only `primaryQueue`. Now use `legacyAdmittedSpeakersFromDecision` → `executionBots` (full production speakers). `primaryQueue` stays a separate field. |
| Same policy snapshot                       | **EXISTS**                          | Shadow uses the caller's `RuntimeAuthority.policy` (`policyHash` / `policySnapshotId`)                                                                                                                                                                                                                                 |
| Persist Stage-A compare to ledger          | **EXISTS** (dual-flag OFF)          | `recordFloorShadowStageAAfterRound` — requires `shadowStage=A` **and** `collaboration.ledger.decisionRecords`                                                                                                                                                                                                          |
| Shadow-B bid collect (signal only)         | **EXISTS** (default no model calls) | `startFloorBidShadow` / `collectFloorBids` in `floor-bid.ts`; budget `floor-bid-budget.ts`; model `floor-bid-model.ts`; `drivesProductionDecision: false` + `assertBidDoesNotDriveProduction`                                                                                                                          |
| Shadow-B calibration sink                  | **EXISTS**                          | `<ns>/shadow/floor-bid-calibration.jsonl` + `floor-bid-tokens.json` (stage=B; independent of decisionRecords)                                                                                                                                                                                                          |
| Persist Stage-B bids / calibration to EDR  | **EXISTS** (dual-flag OFF)          | `recordFloorShadowStageBAfterRound` — requires `shadowStage=B` **and** `decisionRecords`                                                                                                                                                                                                                               |
| Round wiring (no dispatch side effects)    | **EXISTS**                          | `round-runtime.ts` `executeCollaborationRound`: Stage-B bid parallel; Stage-A/B record in `finishShadow`; throws swallowed                                                                                                                                                                                             |
| Protocol=`shadow` jsonl metrics            | **EXISTS** (sibling, default OFF)   | `isCollabFloorShadowEnabled` / `observeFloorShadowAfterRound` in `floor-shadow.ts` — **independent** of `shadowStage`                                                                                                                                                                                                  |
| Floor live cutover refuse                  | **EXISTS** (OFF)                    | `FLOOR_LIVE_CUTOVER_DEFAULT=false`; G1 receipt in `floor-live-cutover.ts`; `legacy-production-executor.ts`                                                                                                                                                                                                             |
| Tests                                      | **EXISTS** (+ this PR)              | `floor-shadow-stage-a.test.ts`, `floor-shadow.test.ts`, `floor-bid.test.ts`, `floor-bid-model.test.ts`, `floor-live-cutover.g1.test.ts`                                                                                                                                                                                |
| Second Shadow orchestrator / Bid→admission | **MUST NOT BUILD**                  | Admission does not consume model bids; bids never rewrite production decisions                                                                                                                                                                                                                                         |
| Observability dashboards / 200-ep gate     | **MISSING** (ops, not code)         | Exit criteria belong in observation / acceptance, not a new runtime module                                                                                                                                                                                                                                             |

## 2. Defaults that must stay OFF

| Flag / constant                        | Default      | Note                                                                   |
| -------------------------------------- | ------------ | ---------------------------------------------------------------------- |
| `collaboration.floor.shadowStage`      | unset        | Shadow-A/B optional; leave unset                                       |
| `collaboration.floor.bidSampleRate`    | unset → 0    | Even with stage=B, no model calls                                      |
| `collaboration.floor.bidDailyTokenCap` | unset → 0    | Even with stage=B, no model calls                                      |
| `collaboration.floor.protocol`         | unset/legacy | `shadow` writes jsonl metrics; `floor` accepted and ignored (not live) |
| `collaboration.ledger.decisionRecords` | unset/false  | No EDR `floorCompare` until explicitly on                              |
| `FLOOR_LIVE_CUTOVER_DEFAULT`           | `false`      | Unsigned cutover; shadowStage alone cannot promote Floor speakers      |

## 3. Thin hardening in this PR (path B only)

1. **Docs** — this inventory (no second architecture / no second Shadow engine).
2. **Legacy compare seam** — `legacyAdmittedSpeakersFromDecision` in `episode-decision-record.ts`; Stage A/B after-round writers set `legacy.admitted` from `executionBots`, keep `legacy.primaryQueue` as the lead queue.
3. **Tests** — Stage A after-round with `executionBots` wider than `primaryQueue`; Stage B EDR expects full speaker admitted set.

## 4. Explicit non-goals (forbidden redesign)

- Parallel Shadow / Floor / Admission engine
- Applying Bid into Admission or production `participants` / `primaryQueue` / `executionBots`
- Enabling `shadowStage`, `decisionRecords`, `protocol=floor`, or Floor live defaults
- Multi-beat Floor live, tip-prompt rule churn, Growth hot-path scoring
- Observability dashboard productization as part of this PR

## 5. Acceptance checklist (for 执行效率合入验收)

1. Diff is thin: this doc + `legacy.admitted` seam + tests; no new orchestrator / second RuntimeAuthority / Floor live.
2. Defaults unchanged: `shadowStage`, `decisionRecords`, `protocol`, `FLOOR_LIVE_CUTOVER_DEFAULT` stay OFF.
3. Stage A/B after-round: `legacy.admitted` equals `executionBots` ids (not lead-only `primaryQueue`); `legacy.primaryQueue` still mirrors `decision.primaryQueue`.
4. Speakers unchanged: attach / bid paths still do not rewrite production participant lists; `drivesProductionDecision` remains false.
5. Focused vitest for shadow Stage A/B + G1 cutover still pass.
6. No HA / LIVE Floor / Path B deploy in this PR.
