# Collaboration P5 — multi-Beat Episode raise gate (2026-10-12)

> Inventory-first. Flags / ceilings stay **default single Beat**. Floor live
> cutover stays **BLOCKED** (`FLOOR_LIVE_CUTOVER_DEFAULT=false`). This PR does
> **not** invent a multi-beat production controller.

## Inventory (main @ cdc345df07 / #663)

| Capability | Status | Evidence |
| --- | --- | --- |
| Episode state `next_beat → BID_ADMISSION` | **EXISTS** | `episode-state-machine.ts` |
| G2 single-beat runtime | **EXISTS (FLAG-OFF)** | `episode-single-beat-runtime.ts`; `assertSingleBeatEvent` / `assertAtMostOneBeat` refuse `next_beat` |
| Facilitator `next_beat` deny (default) | **EXISTS** | `facilitator-control.ts` `outcomeFor` → denied when maxBeats=1 |
| L1 `maxBeatsPerEpisode` | **HARDCODED 1** (pre-P5) | `policy-compiler-sections.ts` `L1_FLOOR_TUNING_DEFAULTS.beats` |
| Config raise path | **MISSING → THIS PR** | no `collaboration.episode.maxBeats` before P5 |
| Multi-beat production controller | **MISSING (intentional)** | no `multi-beat-runtime` / beat loop module |
| Floor live cutover | **OFF** | `FLOOR_LIVE_CUTOVER_DEFAULT=false` |

## Gap-only change

1. Config `collaboration.episode.maxBeats` (int 1..12, default unset = 1).
2. `multi-beat-gate.ts`: `resolveMaxBeatsPerEpisode` / `isCollabMultiBeatGateOpen` /
   `clampMaxBeatsPerEpisode` / `facilitatorNextBeatOutcome`.
3. Policy compiler accepts `GroupPolicyInput.maxBeatsPerEpisode` and records the
   raised ceiling on `EffectivePolicy.dispatch.tuning.floor.beats.maxBeatsPerEpisode`
   (source `l2` when >1).
4. Facilitator may record `next_beat` as **authorized** only when maxBeats > 1.
   `leaveEvent` still prefers `stop_loop` / route — authorize ≠ apply.
5. G2 single-beat runtime **unchanged**: still refuses to apply `next_beat`.
6. Raised `maxBeatsPerEpisode` is a **casual** Floor-live flag (cannot sign G1).

## Explicit non-goals

- Floor live / `FLOOR_LIVE_CUTOVER_DEFAULT=true`
- Multi-beat Episode controller / production beat loop
- Defaulting `maxBeats` above 1
- Changing speaker selection / Admission / Bid
- HA / LIVE router

## Acceptance checklist

1. Default / unset → `resolveMaxBeatsPerEpisode` = 1; Facilitator `next_beat` denied.
2. `collaboration.episode.maxBeats=3` → resolve 3; Facilitator may authorize `next_beat`; leave still stop when stop_loop present.
3. EffectivePolicy default 1; input 4 → policy 4 (l2 provenance).
4. G2 source still contains hard refuse of applying `next_beat`.
5. `FLOOR_LIVE_CUTOVER_DEFAULT=false`; raise appears in casual refusal text.
6. No second multi-beat controller module beyond `multi-beat-gate.ts`.
7. Zod rejects 0 / 13 / non-int.

## Deferred (after pilot exit)

Full multi-beat controller that consumes authorized `next_beat` and walks
`BID_ADMISSION` for beat N+1 under budget / Need — only after single-beat pilot
exit criteria and Task loop soak. Keep Floor live OFF until separate G1 receipt.
