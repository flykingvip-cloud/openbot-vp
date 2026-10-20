# Collaboration context P2 — Context Scope single-track (2026-10-14)

**Status:** Draft implementation  
**Flag:** `collaboration.lane.context` = `legacy` | `shadow` | `effective` (default **unset = effective** after Owner cutover; see collab-lane-context-effective-cutover-2026-10-14.md)  
**Related:** Floor Runtime v2.1 §5.5 P1-A5 ④ (BP-11 / BP-12); P0 private run bag; P1 same-round coverage

## Goal

Single track for Context Scope policy:

1. Runtime consumers **must not** read raw `PolicyV1.contextPolicy` (or session confidentiality tiers) themselves.
2. All live values come from the composition-root helpers in `policy-lane-context.ts`.
3. After a clean **shadow** divergence window, operators may cut over to **effective** (still flag-gated; default remains safe).

## Architecture

```
resolveCollaborationPolicyV1 / compileGroupEffectivePolicy
        │
        ▼
resolveContextLaneForRound / resolveContextLaneForReplyRun
        │  mode = collaboration.lane.context (default legacy)
        ▼
planPolicy + groupConfidentiality  →  resolveContextScopePlan(...)
```

| Mode | Live serve | Side effect |
|------|------------|-------------|
| `legacy` (kill-switch) | PolicyV1 / session-tier path | none |
| `shadow` | same as legacy | `policy_lane_divergence` when legacy ≠ effective |
| `effective` (default) | `authority.policy.effective.context` | none |

Bypass ratchet: `scripts/check-collab-policy-consumption.mjs` — context bucket is `[]`. New raw `PolicyV1.contextPolicy` reads in consumers **fail CI**.

## Group chat defaults (safe)

For collaboration group sessions (`groupId` set):

| Inbound / UI | Mode | Mandatory sources | Knowledge |
|--------------|------|-------------------|-----------|
| `chat` | minimal | conversation + group | **no** auto prefetch |
| unset depth (group) | minimal (P2) | conversation + group | **no** auto prefetch |
| `retrieve` / `act` | auto / deep | conversation + group | optional / strategy-gated |
| UI `focused` + sources | focused | conversation + group | only requested sources |

Direct 1:1 sessions without depth keep `auto` (unchanged).

`DEFAULT_CONTEXT_POLICY.mandatoryGroupContext = true` — group mandatory cannot be dropped by “current conversation only”.

## Cutover (shadow → effective) — **completed**

Owner cutover landed: unset → **effective**. See [`collab-lane-context-effective-cutover-2026-10-14.md`](./collab-lane-context-effective-cutover-2026-10-14.md).

1. ~~Keep unset/legacy in LIVE~~ → default is now effective.
2. Kill-switch: set `collaboration.lane.context=legacy` (or `shadow` to re-observe).
3. `isContextLaneShadowWindowClean` remains for observe windows under shadow.
4. Do **not** enable Floor live; do **not** turn on `collaboration.privateRunBag` as part of this cutover.
5. Group chat defaults above remain in force under all three modes.

Helper: `describeContextLaneSingleTrackCutover()` in `policy-lane-context.ts`.

## Invariants

- GROUP_PUBLIC remains SoT; no per-bot full group-history copies.
- Private run bag never writes to group transcript.
- Floor live stays unsigned / off.
- Effective is the unset default; explicit `legacy` is the kill-switch.

## Tests

- `src/gateway/context-scope/controller.test.ts` — group default minimal; retrieve/UI expand; 1:1 unchanged
- `src/gateway/collaboration-dispatch/policy-lane-context.test.ts` — cutover guide + shadow-window clean
- Existing P1-A5 ④ lane mode tests remain the shadow/effective contract

## Non-goals

- Long-term private memory promote (see collab-context P3)
- Same-round coverage (P1) changes
- Floor live / other lane defaults (presentation/participation/… stay legacy)
