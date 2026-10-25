# Collaboration P4a — proposeHandoff production entry (2026-10-12)

> Status: **gap-only production entry onto existing HandoffContract APIs.**
>
> Flag `collaboration.task.handoffContract` remains **OFF** by default.
> No Floor live, multi-beat, group task board (P4b), or RCIS (P4c).

## Inventory-first

P4–5 inventory marked production callers of `proposeHandoff*` as **MISSING**.
Contract state machine already existed (`handoff-contract.ts`); P1 seam already
refused the `collaboration.task.handoff` shortcut when the flag is on.

## What this PR adds

| Surface | Behavior |
| --- | --- |
| `collaboration.task.proposeHandoff` | Flag-on → `proposeHandoff`. Flag-off → refuse (`HandoffContractFlagOffError`) |
| `collaboration.task.acceptHandoff` | Flag-on → `acceptHandoff` |
| `collaboration.task.approveHandoff` | Flag-on → `approveHandoff` (human default for owner_transfer) |
| `collaboration.task.applyHandoff` | Flag-on → `applyApprovedHandoff` + sync learning task store |
| `collaboration.task.handoff` | Unchanged: flag-off shortcut; flag-on still `HandoffContractRequiredError` |

Composition root: `src/gateway/collaboration-learning/handoff-contract-entry.ts`
(reuses `createRuntimeAuthority` + existing contract APIs only).

## Explicit non-goals

- Second handoff system / auto-approve bypass
- Default-enabling `handoffContract`
- Floor live / multi-beat / task board / RCIS / tip-prompt rules

## Acceptance checklist (for 执行效率合入验收)

1. Diff wires production RPC entry only; reuses `handoff-contract.ts` APIs; no second handoff system / Floor live / multi-beat / task board / RCIS.
2. Default `collaboration.task.handoffContract` stays OFF.
3. Flag-off (historical): shortcut once mutated; **T09-B1**: shortcut refused; propose/accept/approve/apply still refuse until flag on.
4. Flag-on: propose→accept→approve→apply updates learning task owner; shortcut still refused.
5. No HA / LIVE router / Path B deploy / tip-prompt rules.

## T09-B1 retirement note (2026-10-25 Asia/Shanghai)

The flag-off `collaboration.task.handoff` / `applyTaskHandoff` shortcut **no longer mutates** responsibility.
UI and organizers use `collaboration.task.proposeHandoff` (then accept → approve → apply) when `collaboration.task.handoffContract` is explicitly enabled.
Platform default remains flag-off (no silent LIVE). Historical statements above that claim flag-off shortcut still mutates are **superseded**.
