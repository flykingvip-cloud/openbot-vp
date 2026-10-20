# Phase 1B Unlock Minima Decision Package

**Request:** Phase 1B Unlock Decision Review: minima

This package:

- does not issue unlock
- does not start Item 6 or Item 7
- does not change production resolver
- does not authorize production writes
- does not perform LIVE cutover

If minima is later approved, that means **allow Item 6/7 independent preparation and constrained verification**. It does **not** mean `Item 6/7 implementation unlocked`.

| Field                       | Value                                               |
| --------------------------- | --------------------------------------------------- |
| operationId                 | `phase1b-unlock-minima-85f55ee2fa-20260820T001800Z` |
| baselineSha / originMainSha | `4f14769148dd79559824d9e0229f6af530799851`          |
| branchSha at start          | `4f14769148dd79559824d9e0229f6af530799851`          |
| Item 5 review tip           | `85f55ee2fa76f88dc538180b481a5823631af649`          |
| packageCommitSha            | `1432b71855f8006dda4f8e53fb851ddbc166b405`          |
| PR URL                      | https://github.com/gmood2008/openbot/pull/542       |
| requestedUnlock             | minima                                              |
| unlock                      | **not-issued**                                      |
| stamped                     | false                                               |
| phase1bExecutionBlocked     | true                                                |
| deployAuthorized            | false                                               |
| wiredToProductionResolver   | false                                               |
| liveCutover                 | false                                               |

## Item 5 evidence

- PR https://github.com/gmood2008/openbot/pull/538
- Frozen tip `85f55ee2fa76f88dc538180b481a5823631af649`
- Final binding `docs/design/evidence/memory-workspace-phase1b-item5-final-closeout-binding.json`
- Independent met decision `docs/design/evidence/memory-workspace-phase1b-item5-met-decision.json`
- Closeout handoff `.kiro/specs/memory-workspace-platform-remediation/codex-handoff-item5-final-closeout.md`

Not Item 5 final proof: `.kiro/specs/memory-workspace-platform-remediation/codex-handoff-item5-runtime-alignment-20260819.md`, dirty I4 / kiro-loom worktree.

## Canonical scorecard

This review uses `docs/design/evidence/memory-workspace-phase1b-unlock-minima-scorecard.json`.

| Item | This package | Official source                                                                        |
| ---- | ------------ | -------------------------------------------------------------------------------------- |
| 2    | **met**      | canonical unlock-decision `items.2`; SoT decision `accepted`                           |
| 3    | **met**      | canonical unlock-decision `items.3`; write-switch acceptance `enablesProduction=false` |
| 4    | **met**      | canonical unlock-decision `items.4`; same-release presence; `schemaV2Enabled=false`    |
| 5    | **met**      | independent met on frozen #538; closeout JSON keeps `item5Met=false`                   |
| 6    | **locked**   | Phase 1B Item 6 stays not-met/locked                                                   |
| 7    | **locked**   | canonical unlock-decision `items.7=not-met`                                            |

History / superseded as Phase 1B Item 6 execution SoT:

- `memory-workspace-phase1b-items-2-7-scorecard.json` `items.6=met` is U1 production-equivalent candidate scoring only
- `memory-workspace-phase1b-unlock-decision.json` `items.6=met` is not Item 6 implementation unlock
- `memory-workspace-phase1b-unlock-decision-request.json` is the prior recommend-issue-minimal packet

## Allowed after a later approved minima

1. Prepare independent Item 6 and Item 7 design, inventory, shadow, and fixture packages.
2. Run read-only, shadow, dry-run, and production-equivalent verification.
3. Create a separate implementation request/handoff.
4. Keep production writes and switches blocked until a later independent approval.

## Still forbidden after that approved minima

- `wiredToProductionResolver=true`
- Catalog miss=deny
- schema v2 production write
- delete any `productionWriteWatchIndex` call-site
- Item 7 Retirement
- production Catalog new write
- LIVE cutover
- `deployAuthorized=true`
- cross-tenant migration
- BYOS / tenant-cloud / cold archive
- derive Item 6 met or Item 7 met from this minima
- `Item 6/7 implementation unlocked`

## Revocation

- Reject this request: canonical receipt stays `not-issued`, `phase1bExecutionBlocked=true`.
- Invalid later issued stamp: revoke and restore `not-issued`.
- Frozen Item 5 closeout JSON and final binding are not rewritten.

## SHA256 of cited files

See `references` in `docs/design/evidence/memory-workspace-phase1b-unlock-minima-request.json`.

## Tests

```bash
node --test docs/design/evidence/memory-workspace-phase1b-unlock-minima.test.mjs
node --test docs/design/evidence/memory-workspace-phase1b-item5-production-closeout.test.mjs
node --test docs/design/evidence/memory-workspace-phase1b-unlock-remaining.test.mjs
```

Local run 2026-08-20 on `cursor-data-governance/phase1b-unlock-minima` at baseline `4f14769148dd79559824d9e0229f6af530799851`:

- `memory-workspace-phase1b-unlock-minima.test.mjs`: 6/6 pass
- `memory-workspace-phase1b-item5-production-closeout.test.mjs`: 1/1 pass
- `memory-workspace-phase1b-unlock-remaining.test.mjs`: 3/3 pass

This round does **not** claim unlock is issued. It does **not** start Item 6/7. It does **not** modify the production resolver. It does **not** authorize production writes. It does **not** perform LIVE cutover.
