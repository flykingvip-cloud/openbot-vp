# Collaboration P4b — Group task board + Claim (2026-10-12)

> Status: **gap-only ClaimContract scaffold + production entry onto existing
> task-runtime.** Flag `collaboration.task.claimContract` remains **OFF** by
> default.
>
> No Floor live, multi-beat, RCIS, tip-prompt rules, HA, or SessionTaskBoard /
> SupervisorTaskBoard redesign. Bots still do **not** receive L3 `task.assign`.

## Inventory-first (AS-IS)

| Surface | Status | Note |
| --- | --- | --- |
| 1:1 `SessionTaskBoard` | EXISTS (different domain) | Session focus park/resume — **do not reinvent or overload for group claims** |
| UI `supervisor-task-board` | EXISTS (different domain) | Development Supervisor dashboard — not collab group board |
| `operatingState.activeContext.currentTaskId` | EXISTS | Set via `syncGroupOperatingState` / active task selection |
| `seedTaskResponsibility` / task-runtime | EXISTS | Reused on applyClaim |
| L3 `task.assign` for bots | DENIED (L1-hard) | Unchanged; Claim is not `task.assign` |
| Group ClaimContract / board publish | **was DESIGN-ONLY** | This PR adds flag-gated contract |

## What this PR adds

| Surface | Behavior |
| --- | --- |
| Flag `collaboration.task.claimContract` | Default OFF |
| `publishBoardItem` / `claimBoardItem` / `applyClaim` | Library under `<ns>/board-claims/*.jsonl` |
| RPC `collaboration.task.publishBoardItem` | Flag-on → publish; flag-off → refuse |
| RPC `collaboration.task.claimBoardItem` | Flag-on → claim |
| RPC `collaboration.task.applyClaim` | Flag-on → seed assigned + responsibility + sync `currentTaskId` |
| `oralDispatchCreatesBoardFact()` | Always `false` — verbal “已派工” is not a board fact |

Composition root: `claim-contract-entry.ts` (reuses `createRuntimeAuthority` +
`seedTaskResponsibility` + objectStorage task write + `syncGroupOperatingState`).

## Explicit non-goals

- Second task system / overloading SessionTaskBoard or SupervisorTaskBoard
- Default-enabling `claimContract` / Floor live / multi-beat / RCIS
- Granting bots L3 `task.assign`
- Treating `collab_edge` or chat “已派工” as claim facts
- Tip-prompt rules / HA / LIVE router

## Acceptance checklist (for 执行效率合入验收)

1. Diff is gap-only ClaimContract + entry/RPC/config/docs; **no** SessionTaskBoard rewrite / second task system / Floor live / multi-beat / RCIS / tip-prompt / HA.
2. Default `collaboration.task.claimContract` stays OFF.
3. Flag-off: publish/claim/apply refuse; no board-claims writes.
4. Flag-on: publish → claim → apply updates `assignedMemberIds` + responsibility; `oralDispatchCreatesBoardFact()===false`.
5. L3 bot `task.assign` deny unchanged.
6. No HA / LIVE Floor / Path B deploy / default flag flips.
