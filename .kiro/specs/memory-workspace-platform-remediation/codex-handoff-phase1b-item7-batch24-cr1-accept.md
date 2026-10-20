# Phase 1B Item 7 Batch 24 CR1 accept (S26 + S27)

This records the **independent reviewer's formal acceptance** of Batch 24 (atomic
retirement of S26 + S27) after CR1 re-verification. It flips `batch24Accepted`
`false -> true` and canonicalizes the accepted retirement baseline `12 -> 10` in the
Batch 24 evidence packet. It is **not** a deploy authorization, an unlock, or an Item 7
completion.

| Field                           | Before (review-only) | After (accepted)                           |
| ------------------------------- | -------------------- | ------------------------------------------ |
| reviewRequest                   | ...-review-only      | ...-accepted                               |
| reviewRequestIsBatchAccept      | false                | true                                       |
| batch24Accepted                 | false                | true                                       |
| lastAcceptedRetirementBaseline  | 12                   | 10                                         |
| previousAcceptedBaseline        | 12                   | 12 (unchanged)                             |
| proposedRemaining               | 10                   | 10 (unchanged; now the canonical baseline) |
| remaining / liveWriteWatchIndex | 10 / 10              | 10 / 10 (unchanged)                        |
| retiredThisChange               | 2                    | 2 (unchanged)                              |
| frozenWriteWatchIndex           | 38                   | 38 (unchanged)                             |

## Why this is accepted now

Batch 24 (#696) atomically retired the last two live steward host-path resolver call
sites (S26 `resolveEmployeeStewardSourceWorkspaceDir`, S27
`resolveEmployeeStewardTargetWorkspaceDir`), both inside the test-only
`runEmployeeStewardCutoverPilot`, taking the accepted baseline from 12 to a proposed 10.

The original independent review returned **changes-required** on one blocker: the
test-only pilot was still re-exported from the production barrel
`src/gateway/workspace-resolver/index.ts`, so "test-only" was not machine-enforced. That
blocker was fixed and landed in **#720**, which:

- removed `runEmployeeStewardCutoverPilot` from the `index.ts` barrel (kept
  `provisionEmployeeStewardCutoverWorkspace` and its types),
- added the machine gate `pilot-test-only-boundary.test.ts` that walks `src/**`
  (excluding tests, harnesses, fixtures, and the defining module) and fails on any
  production `import` / re-export / call of the pilot, and asserts `index.ts` no longer
  contains the symbol, with no hardcoded caller count.

## CR1 re-verification basis

Re-verified against `origin/main` at `bb9b6205fb` in an isolated worktree:

1. **Pilot boundary machine gate** `pilot-test-only-boundary.test.ts` passes, and is
   **proven effective**: a throwaway untracked production probe that imported the pilot
   was added, the gate **failed as expected**, and the probe was deleted (negative
   control).
2. `index.ts` no longer exports `runEmployeeStewardCutoverPilot` (only
   `provisionEmployeeStewardCutoverWorkspace` + types remain).
3. No production file under `src/**` imports, re-exports, or calls the pilot; its only
   callers are `steward-write.test.ts`, importing from `./provision-steward-cutover.js`.
4. Retirement scan holds: `remaining=10`, `sites.length=10`,
   `liveWriteWatchIndex=10` (`= remaining`), `retiredThisChange=2`, and the Phase 0
   freeze baseline stays `frozenWriteWatchIndex=38` / `productionWriteWatchIndex=38`.
5. Phase 0 freeze scanner stays **ok=true** with **addedProductionCallSites=0**.

Verdict: **accepted**.

## What this accept does NOT grant

Acceptance updates **only** the Item 7 accepted retirement baseline (12 -> 10). Every
lock is preserved in the packet and unchanged by this round:

- `deployAuthorized=false`, `live=forbidden`, `liveCutover=false`
- `item7=not-met`, `itemMet=false`
- `phase1bExecutionBlocked=true`, `phase1bUnlock=not-issued`, `fullUnlock=not-issued`
- `productionCatalogWrite=none`, `productionCatalogWriteEnabled=false`,
  `productionWrite=false`, `wiredToProductionResolver=false`
- `schemaV2Write=disabled`, `schemaV2ProductionWrite=false`
- `deleteCallSites=false`, `retirementExecuted=false`, `i3Executed=false`

No production Catalog write, no schema v2, no resolver cutover, no delete of old data, no
I3, no Stage C / Phase 1B unlock, and **no Batch 25** is started by this round.

## Deploy verdict (upheld)

Final pre-deploy verdict remains **not passed, deployment forbidden**. Even with Batch 24
accepted, this only means the Item 7 accepted baseline is 10. Deployment stays forbidden
until Item 7 reaches 0, I3 is executed, a Phase 1B unlock receipt is issued, and the
production candidate passes `verify-forward-only.sh` and delivery alignment. The running
baseline is whatever the container reports (`build-info.json`), not this branch tip.

## Files changed

- `docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch24-s26-s27.json`
  (accept fields + note; all locks and `retiredThisChange=2` / `remaining=10` /
  `frozenWriteWatchIndex=38` unchanged)
- `docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch24-s26-s27.test.mjs`
  (`batch24Accepted -> true`, plus `reviewRequestIsBatchAccept === true` and
  `lastAcceptedRetirementBaseline === 10`; `previousAcceptedBaseline === 12` and
  `proposedRemaining === 10` unchanged)
- this handoff

The retirement scan (`...-retirement-scan.json`) is **not** touched: the live scan stays
`remaining=10`; the accepted baseline lives in the packet's
`lastAcceptedRetirementBaseline`, not the scan.

— kiro-sot-reviewer
