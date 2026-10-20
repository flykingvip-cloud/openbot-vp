# Collaboration context — lane.context effective cutover (2026-10-14)

**Status:** Draft implementation (Owner-requested cutover)  
**Flag:** `collaboration.lane.context` = `legacy` | `shadow` | `effective`  
**Default:** unset → **`effective`** (`CONTEXT_LANE_DEFAULT_MODE`)  
**Kill-switch:** set `collaboration.lane.context=legacy` (or `shadow` to re-observe)  
**Related:** P2 single-track [`collab-p2-context-scope-single-track-2026-10-14.md`](./collab-p2-context-scope-single-track-2026-10-14.md)

## Goal

Cut production Context Scope path from shadow-observe / legacy-default to **effective**:
consumers already go through `policy-lane-context.ts`; unset config now serves
`authority.policy.effective.context` instead of raw PolicyV1 / session-tier legacy.

## What changed

| Before (P2) | After (this cutover) |
|-------------|----------------------|
| unset → `legacy` | unset → `effective` |
| Operator must set `effective` after clean shadow window | Default is effective; rollback is explicit |
| `describeContextLaneSingleTrackCutover().defaultMode = "legacy"` | `defaultMode = "effective"`, `killSwitch = "legacy"` |

Only the **context** lane default changes. Presentation / participation / dispatch /
governance lanes still default to `legacy` via shared `resolvePolicyLaneMode`.

## Rollback

```json5
{
  collaboration: {
    lane: {
      context: "legacy", // kill-switch: restore pre-cutover live serve
      // or "shadow" to serve legacy live while recording divergences again
    },
  },
}
```

## Invariants (unchanged)

- GROUP_PUBLIC remains SoT; no per-bot full history copies
- Private run bag / private LTM never dirty-write the group transcript
- Floor live stays unsigned / off
- Group chat: conversation + group mandatory; no auto knowledge without retrieve/act or UI scope

## Tests

- `policy-lane-context.test.ts` — default effective; kill-switch; effective path for round/reply; group defaults in cutover guide
- `controller.test.ts` — group minimal / knowledge gating (unchanged, mode-agnostic)

## Non-goals

- Changing other `collaboration.lane.*` defaults
- Enabling Floor live, privateRunBag, or privateMemoryPromote
- Merging without coordinating-bot / Owner accept
