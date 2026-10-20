# Collaboration P4c — Async 责任·贡献·创新·共享 (RCIS) (2026-10-12)

> Status: **gap-only async Learning aggregate** over existing ledger facts.
> Flag `collaboration.learning.rcisAggregate` remains **OFF** by default.
>
> No Floor live, multi-beat, tip-prompt rules, HA, Growth hot-path scoring, or
> second GrowthDimension set that drives selection.

## Inventory-first (AS-IS)

| Surface | Status | Note |
| --- | --- | --- |
| `contribution-quality.ts` | EXISTS | turns / handoffs / reviews / deliverables → `qualityScore` — **reused** |
| `behavior-buffer.ts` | EXISTS | dispatch+execution → habits/alignment hints — **adjacent pattern**, not replaced |
| Collaboration ledger | EXISTS | dispatch / execution / quality / fact kinds — **source of truth** |
| GrowthDimension | EXISTS | `identity` / `capability` / `knowledge` / `habits` / `alignment` — **unchanged; not RCIS** |
| `agents` / spaces `recompute-growth` | EXISTS | Manual/async Growth path — RCIS sync runs **adjacent** when flag ON |
| Admission / decideParticipants / floor-bid | EXISTS | **Must not** import RCIS (C7 / R5) |
| Named RCIS ledger | **was MISSING** | This PR adds flag-gated aggregate |

## Owner principle → ledger signal mapping

| Dimension | Owner meaning | Ledger facts counted |
| --- | --- | --- |
| **责任 Responsibility** | Hold ticket / ownership; fulfill when invited; do not idle | `TaskResponsibilityChanged.ownerAfter`, `TaskHandoffReceiverAccepted`, handoffsReceived, turnsCompleted + deliverablesAccepted; **−** idleWhenInvited (dispatch invite without execution), turnsFailed |
| **贡献 Contribution** | Useful delivery | Reuses `aggregateContributionQuality` → `qualityScore`; fallback turnsCompleted / deliverablesAccepted |
| **创新 Innovation** | Challenge / incremental / non-echo | `contributionRole=challenge`, `incrementalContribution`; **−** `suppressedAsDuplicate`, `skipReason=pure_ack\|no_increment`; reviewsRejected as challenge signal |
| **共享 Sharing** | Hand off / review / artifacts for others | handoffsGiven, reviewsAccepted, quality `artifacts[]` length |

Scores are 0–1 (or null when no samples). Snapshot fields `drivesAdmission` and
`drivesGrowthDimensionSelection` are always `false`.

## What this PR adds

| Surface | Behavior |
| --- | --- |
| Flag `collaboration.learning.rcisAggregate` | Default OFF |
| `aggregateRcisFromLedgerRecords` | Pure aggregate from ledger records |
| `syncCollaborationRcisAggregate` | Flag-on → write `runtime/rcis-aggregate.json`; flag-off → null / no write |
| `collaboration.spaces.recompute-growth` | Adjacent call when flag ON; **does not** mutate GrowthDimension from RCIS |
| Invariants | `rcisScoresMustNotDriveAdmission()` / `…GrowthDimensionSelection()` |

## Explicit non-goals

- Renaming or extending GrowthDimension into RCIS selection inputs
- Feeding RCIS into Admission / Decision / Floor Bid / Badge hot path
- Default-enabling the flag / Floor live / multi-beat / claimContract / handoffContract
- Tip-prompt performance rules / HA / LIVE router
- Second contribution-quality or second ledger writer

## Acceptance checklist (for 执行效率合入验收)

1. Diff is gap-only RCIS async aggregate + config/docs/tests; **no** Floor live / multi-beat / tip-prompt / HA / second GrowthDimension selection set.
2. Default `collaboration.learning.rcisAggregate` stays OFF.
3. Flag-off: `syncCollaborationRcisAggregate` returns null and writes nothing.
4. Flag-on aggregate maps claim/handoff/deliverable/challenge/idle signals; snapshot `drivesAdmission===false`.
5. `admission.ts` / `decision-engine.ts` / `floor-bid.ts` do not import `rcis-aggregate`.
6. GrowthDimension keys remain identity/capability/knowledge/habits/alignment.
7. No HA / LIVE Floor / Path B deploy / default flag flips.
