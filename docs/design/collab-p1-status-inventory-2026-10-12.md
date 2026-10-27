# Collaboration P1 status inventory (2026-10-12)

> Status: **library already on `main`; this PR is gap-only seam + inventory.**
>
> Flags remain **OFF**. N2 / Floor live cutover stays **BLOCKED**.
>
> P1 target (frozen spine): EffectivePolicy sole compose root + legacy projection;
> EDR/PDR + Ledger completeness; HandoffContract with no `owner_transfer` shortcut
> when the contract flag is on; map task-board/claim only.
>
> This note maps task-book names onto **existing** symbols. It does **not**
> authorize opening `collaboration.ledger.decisionRecords`,
> `collaboration.task.handoffContract`, `collaboration.episodeStore`,
> Floor live (`collaboration.floor.protocol=floor`), or
> `collaboration.runtimeNamespace`.

Base inventory HEAD at authoring: `b9e2a34423` (P0 merge). Constitution matrix:
[`collaboration-runtime-alignment/Collaboration-Runtime-Constitution-and-Implementation-Matrix.md`](./collaboration-runtime-alignment/Collaboration-Runtime-Constitution-and-Implementation-Matrix.md).

## 1. Task-book → existing symbols

| Capability                                             | Status                              | Existing symbol / file                                                                                                                                                                                                                  |
| ------------------------------------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EffectivePolicy sole compose root                      | **EXISTS** (LIVE)                   | `compileGroupEffectivePolicy` in `resolve-effective-policy.ts`; `policy-compiler.ts` / `policy-compiler-sections.ts`; per-round `buildGroupRuntimeAuthority` in `runtime-authority.ts`                                                  |
| Legacy compatibility projection (read-only)            | **EXISTS** (LIVE)                   | `toLegacyPolicyView` in `legacy-policy-view.ts`; `resolveDispatchLanePolicyV1` + five `policy-lane-*.ts` (default mode **legacy**)                                                                                                      |
| Round-inline PolicyDecisionRecord                      | **EXISTS** (LIVE)                   | `buildPolicyDecisionRecord` in `policy-decision-record.ts`; written on `PersistedRound` by `round-runtime.ts` (not ledger PDR v2)                                                                                                       |
| Ledger EDR + PDR v2                                    | **EXISTS** (FLAG-OFF)               | `writeBeatDecisionRecords` in `episode-decision-record.ts`; `appendCollaborationEpisodeDecisionRecord` / `appendCollaborationPolicyDecisionRecord` in `collaboration-ledger/writer.ts`; gated by `collaboration.ledger.decisionRecords` |
| Execution ledger                                       | **EXISTS** (LIVE)                   | `appendCollaborationExecutionRecord` (`kind: "execution"`); `chat.ts`                                                                                                                                                                   |
| HandoffContract state machine                          | **EXISTS** (FLAG-OFF)               | `proposeHandoff` → `acceptHandoff` → `approveHandoff` → `applyApprovedHandoff` in `handoff-contract.ts`; `handoff-invariant.test.ts`                                                                                                    |
| Flag-on refusal of `owner_transfer` shortcut           | **EXISTS**                          | `applyTaskHandoff` → `HandoffContractRequiredError` in `task-runtime.ts`                                                                                                                                                                |
| Learning RPC seam never bypasses contract when flag ON | **PARTIAL → fixed in this PR**      | `handoffCollaborationTask` in `collaboration-learning/state-machine.ts` previously reached `applyTaskHandoff` (which throws when flag ON). Now checks the flag first and **never** calls the shortcut when enabled.                     |
| Production callers of contract APIs                    | **MISSING** (by design until gates) | No non-test callers of `proposeHandoff*` yet; closed loop is the contract API surface, not `collaboration.task.handoff` RPC                                                                                                             |
| Flag-off shortcut                                      | **RETIRED (T09-B1 2026-10-25)**     | `applyTaskHandoff` / `handoffCollaborationTask` refuse on flag-off and flag-on; sole writer `applyApprovedHandoff` when flag explicitly on                                                                                              |
| Episode Store (P1-B① adjacent)                         | **EXISTS** (FLAG-OFF)               | `episode-store.ts` / `isCollabEpisodeStoreEnabled`                                                                                                                                                                                      |
| Group task board / claim                               | **PARTIAL / MISSING** (map only)    | `operatingState.activeContext.currentTaskId`; 1:1 `SessionTaskBoard`; UI `SupervisorTaskBoard`. No collab-group claim board product — **do not invent here**                                                                            |
| Floor live / namespace cutover                         | **OFF**                             | `FLOOR_LIVE_CUTOVER_DEFAULT=false`; `RUNTIME_NAMESPACE_CUTOVER_DEFAULT=false`                                                                                                                                                           |

## 2. Defaults that must stay OFF

| Flag / constant                        | Default      | Note                                                                    |
| -------------------------------------- | ------------ | ----------------------------------------------------------------------- |
| `collaboration.ledger.decisionRecords` | unset/false  | EDR/PDR v2 writers no-op                                                |
| `collaboration.task.handoffContract`   | unset/false  | Contract path + state-machine refuse shortcut only when explicitly true |
| `collaboration.episodeStore`           | unset/false  | P1-B① gate                                                              |
| `collaboration.floor.protocol`         | unset/legacy | Floor is not the live orchestrator                                      |
| `collaboration.floor.shadowStage`      | unset        | Shadow-A/B optional; not this PR                                        |
| `collaboration.runtimeNamespace`       | unset/false  | N2 still blocks production enablement                                   |
| `FLOOR_LIVE_CUTOVER_DEFAULT`           | `false`      | Unsigned cutover                                                        |
| `RUNTIME_NAMESPACE_CUTOVER_DEFAULT`    | `false`      | Do not flip                                                             |

## 3. Thin hardening in this PR (path B only)

1. **Docs** — this inventory (no second architecture).
2. **State-machine seam** — `handoffCollaborationTask`: when `collaboration.task.handoffContract === true`, fail closed with `HandoffContractRequiredError` (points at propose → accept → approve → applyApprovedHandoff) and **never** call `applyTaskHandoff`. When false, keep the existing shortcut.
3. **Tests** — flag-off shortcut vs flag-on refuse; closed loop remains covered by `handoff-invariant.test.ts` contract APIs.

## 4. Explicit non-goals (forbidden redesign)

- Parallel EffectivePolicy / second policy compiler / new authorize API
- Parallel Handoff system or auto-approve that bypasses receiver accept + governance
- Enabling decisionRecords / handoffContract / episodeStore / Floor live / namespace defaults
- Group task-board productization or claim pathway invention
- Shadow-A/B as default, multi-beat Floor live, tip-prompt rule churn, Growth hot-path scoring

## 5. Acceptance checklist (for 执行效率合入验收)

1. Diff is thin: this doc + `state-machine.ts` seam + tests; no new orchestrator / second RuntimeAuthority / Floor live.
2. Defaults unchanged: `handoffContract`, `decisionRecords`, `episodeStore`, Floor protocol, `runtimeNamespace` stay OFF.
3. Flag-off: `handoffCollaborationTask` still mutates via `applyTaskHandoff`.
4. Flag-on: `handoffCollaborationTask` throws `HandoffContractRequiredError` and does **not** call `applyTaskHandoff`; task owner unchanged.
5. Flag-on closed loop still only via existing `proposeHandoff` → `acceptHandoff` → `approveHandoff` → `applyApprovedHandoff` (`handoff-invariant.test.ts`).
6. No HA / LIVE Floor / Path B deploy in this PR.
