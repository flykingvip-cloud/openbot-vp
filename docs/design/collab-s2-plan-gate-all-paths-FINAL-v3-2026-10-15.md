# Collab S2 — Plan gate on all delivery exec paths (FINAL v3)

| Field | Value |
| --- | --- |
| Date | 2026-10-15 Asia/Shanghai |
| Status | Code ready; **flags default OFF** — tip gray needs explicit allowlist |
| Spec | `openbot-collab-self-run-FINAL-v3-2026-10-15.md` §S2 + §A mapping |
| Depends | **P0 #731**, **S1 #734** (tip `18bdbc58…`) |
| Code | `plan-gate-exec.ts`, `self-advance.ts` (delivery vs plan_nudge), `executor-private-todolist.ts` (bag ACL), `collab-s2-plan-gate-all-paths.test.ts` |

## Scope

1. **Plan gate covers real exec entries**, not only `markBoardItemInProgress`:
   - Unconfirmed Todolist → cannot enter `in_progress` (existing P2)
   - Bot **cannot** treat `applied` self-advance as delivery opportunity without confirm
2. **`applied`**: draft OK; **delivery-type** self-advance only when Todolist confirmed + claimant valid + non-terminal + governance already allowed; else **plan_nudge** (remind / ask to complete plan)
3. **三件套** required for delivery_exec: board summary + group context pointer + confirmed current Todolist step — missing any → refuse delivery
4. **§A mapping** encoded in `boardTodolistDeliveryMapping` (code, not prompt-only)
5. **ACL**: unauthorized private Todolist read + cross-executor task-bag 串读 refused

## Flags (stay OFF in this PR)

| Flag | Default | Tip gray enable |
| --- | --- | --- |
| `collaboration.task.claimContract` | false | Prefer scoped `001/grp-…` after P0 |
| `collaboration.task.wakeContract` | false | Unchanged |
| `collaboration.task.challengeWindow` | false | Unchanged (S1) |
| `collaboration.runtimeNamespace` | false | Unchanged (N2 unsigned) |
| `botMaySelfAdvanceWithoutHuman` | false | **S5 only** — this PR does not flip |

**Does not** open production gray writes. LIVE / Floor untouched.

## Acceptance

- Vitest: `collab-s2-plan-gate-all-paths.test.ts` + updated `self-advance.test.ts` + existing todolist/claim plan-gate green
- LIVE_touched = false
- No second orchestrator

## Out of scope

S3 submit/accept versioning, S4 heartbeat scheduler proof, S5 enabling `botMaySelfAdvanceWithoutHuman`, Floor live, multi-beat, tip production gray writes.
