# Phase 1B Item 7 retirement batch 24 (S26 + S27, atomic)

This round atomically retires the **last two** live ledger sites in
`src/gateway/workspace-resolver/steward-write.ts`:

- **S26** `resolveEmployeeStewardSourceWorkspaceDir` (was line 279)
- **S27** `resolveEmployeeStewardTargetWorkspaceDir` (was line 280)

both inside the test-only `runEmployeeStewardCutoverPilot`. It does **not** mark Item 7 met.

| Field                           | Value               |
| ------------------------------- | ------------------- |
| status                          | retirement-batch-24 |
| sites retired                   | S26 + S27 (atomic)  |
| retiredThisChange               | 2                   |
| remaining / liveWriteWatchIndex | 10 / 10             |
| previousAcceptedBaseline        | 12 (S25 / batch 22) |
| proposedRemaining               | 10                  |
| item7                           | not-met             |
| phase1bExecutionBlocked         | true                |
| phase1bUnlock                   | not-issued          |
| live                            | forbidden           |
| productionCatalogWrite          | none                |
| schemaV2ProductionWrite         | false               |
| absorbsUnacceptedBatches        | false               |
| rollbackProof                   | true                |
| quarantineProof                 | true                |

## What changed and why

Batch 23 (#674) was a Semantic Gate CR that concluded S26/S27 are a
**provisioning/create lifecycle**: the source/target Catalog bindings do not pre-exist at
the call site, so a read-existing-binding resolver swap (as used for S24/S25) would be
circular. It retired nothing and kept the baseline at 12.

The honest remediation, the narrow domain command `provisionEmployeeStewardCutoverWorkspace`,
was implemented and accepted in #679 and is present in this batch's base commit
`3db1aa85d0`. Batch 24 now wires it in:

- `runEmployeeStewardCutoverPilot` moved from `steward-write.ts` to
  `provision-steward-cutover.ts` (it is test-only; the sole callers are in
  `steward-write.test.ts`).
- The pilot accepts **trusted caller-supplied placement** (`sourceRoot` / `targetRoot`);
  it no longer builds host paths.
- It calls `provisionEmployeeStewardCutoverWorkspace`, which validates
  tenant/actor/ownership, enforces the placement policy (absolute, no `..` traversal,
  source != target), allocates a stable `resourceId`, writes the unique **source
  canonical/active** binding and the unique **target compatibility/read_only** binding,
  emits a Catalog receipt + operationId + fencing marker, and performs `mkdir`/copy
  **only after** Catalog success.
- **S26** now reads the source canonical binding locator; **S27** reads the target
  compatibility/read_only binding locator. The host-path resolvers are no longer called
  in production code.
- Two now-unused imports (`advanceCutoverOperation`, `createWorkspaceCutoverOperation`)
  were removed from `steward-write.ts`.

Neighbour accepted sites **S24** (`resolveWorkspaceLocator`) and **S25**
(`resolveWorkspaceTargetBinding`) keep their posture. Because the import removal shifted
line numbers, their neighbour tests were re-anchored to the site content
(`const sourceRoot =` / `const targetRoot =`) instead of brittle absolute line indices.

## Objective honesty gate

Phase 0 freeze scanner stays **ok=true** with **addedProductionCallSites=[]** (also
`addedProductionHelpers=[]`, `addedCatalogSynthesis=[]`, `trusted=true`): no new frozen
production call sites were introduced while claiming retirement.

```
node --import tsx docs/design/evidence/memory-workspace-phase0-inventory.mjs --mode freeze \
  --baseline-blob 583c1fc0c93da386289a276b77884d24255440c4 \
  --baseline docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json
```

Fail-closed coverage (all verified by tests): missing tenant context, missing
actor/ownership proof, non-absolute placement, path-escape placement, source==target
placement, missing/duplicate source binding, missing/duplicate target binding,
cross-tenant access, and receipt failure all halt with **no host fallback, no partial
binding, no partial directory, and no double write**. The pilot test reaches
`resolver_write_cutover` and the target contains the copied bytes while the source is
preserved (non-destructive).

## Supersedes

- **#674 / `kiro-data-governance-phase1b-item7-batch23-s26-semantic-gate`** marked
  superseded (Loom `state: abandoned`). That author's WIP is **untouched**; the shared
  `steward-write.ts` / retirement scan / steward test lander was repointed to
  `kiro-data-governance-phase1b-item7-batch24-s26-s27`.

## Forbidden this round

- decrementing below 10 in this packet, or claiming baseline 12 -> 10 is canonical before
  operator acceptance
- if any part of S26 or S27 fails, the baseline stays **12** and must not drop to 11 or 10
- shifting or re-pinning the accepted S24/S25 posture
- writing `liveWriteWatchIndex=0`
- rewriting the Phase 0 freeze baseline (stays 38)
- Item 7 met, LIVE, schema v2 production write, production Catalog write, I3, Stage C /
  Phase 1B unlock

`item7RetirementUnlocked=true` remains controlled-retirement execute authorization only.
Canonical `memory-workspace-phase1b-unlock-decision.json` still blocks full unlock;
`phase1bExecutionBlocked` stays true.

## Requested review

**Item 7 Batch 24 S26+S27 Atomic Review** only.

— kiro-data-governance
