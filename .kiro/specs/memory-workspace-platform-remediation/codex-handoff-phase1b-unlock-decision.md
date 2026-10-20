# Phase 1B Unlock Decision Preparation

**Request:** Phase 1B Unlock Decision Review only.

This packet is **preparation**. It is **not** an issued unlock. Canonical receipt remains `docs/design/evidence/memory-workspace-phase1b-unlock-decision.json` with `unlock=not-issued`.

Do **not** start Item 6 or Item 7. Do **not** flip `wiredToProductionResolver`. Do **not** execute LIVE cutover. Do **not** treat this as Item 6/7 implementation acceptance or production switch review.

**Mandatory review surface:** a new PR parented on frozen Item 5 tip https://github.com/gmood2008/openbot/commit/85f55ee2fa76f88dc538180b481a5823631af649 (PR #538). Do **not** review the dirty I4 / kiro-loom worktree.

| Field                     | Value                                                      |
| ------------------------- | ---------------------------------------------------------- |
| Round                     | Phase 1B unlock decision preparation                       |
| operationId               | `phase1b-unlock-decision-85f55ee2fa-20260820T031500Z`      |
| baselineSha               | `ac6e89185b7fb0451cfe6ff0f17c182fb6ece48b` (`origin/main`) |
| reviewTip                 | `85f55ee2fa76f88dc538180b481a5823631af649`                 |
| recommendUnlock           | issue-minimal                                              |
| unlock (current receipt)  | **not-issued**                                             |
| phase1bExecutionBlocked   | true                                                       |
| deployAuthorized          | false                                                      |
| wiredToProductionResolver | false                                                      |
| cutoverLive               | false                                                      |
| packageCommitSha          | `5b13e3136e3c22ac5cb08406f4c59a3eb22b91e0`                 |

## Current item status

| Item | This package       | Notes                                                                                                                                                         |
| ---- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2    | **met**            | Canonical origin/main scorecard / unlock-decision. SoT decision `accepted`. Not miss=deny.                                                                    |
| 3    | **met**            | Write-switch acceptance, `enablesProduction=false`.                                                                                                           |
| 4    | **met**            | Same-release schema v2 **presence**. `schemaV2Enabled=false`. Production v2 write stays forbidden.                                                            |
| 5    | **met**            | Independent met decision on frozen #538 closeout. Closeout JSON files keep `item5Met=false` as executing-team packet fields.                                  |
| 6    | **not-met/locked** | Drill receipt `revoked`, `backup=null`. U1 `item6Candidate=met` is **not** Item 6 unlock. origin/main scorecard `items.6=met` is that candidate scoring only. |
| 7    | **not-met/locked** | `productionWriteWatchIndex` not 0. No Retirement / I3.                                                                                                        |

Item 5 met citations:

- PR https://github.com/gmood2008/openbot/pull/538
- Tip `85f55ee2fa76f88dc538180b481a5823631af649`
- `.kiro/specs/memory-workspace-platform-remediation/codex-handoff-item5-final-closeout.md`
- `docs/design/evidence/memory-workspace-phase1b-item5-final-closeout-binding.json`
- `docs/design/evidence/memory-workspace-phase1b-item5-met-decision.json`

Not Item 5 final proof: `codex-handoff-item5-runtime-alignment-20260819.md`, dirty I4 worktree.

## Recommendation

Preconditions for a **minimal** unlock are present (items 2–5 met; 6/7 remain locked; wired and deployAuthorized stay false). This package **recommends** `issue-minimal` and still records `unlock=not-issued` until independent review signs a new receipt.

If rejected: keep `unlock=not-issued` and `phase1bExecutionBlocked=true`.

### Allowed after an issued minimal unlock (future receipt only)

- Item 6 / Item 7 design or limited implementation under each owner and a **new** handoff
- shadow / read-only / fixture verification
- separately approved write slices after their own review

### Still forbidden after that issued unlock

- `wiredToProductionResolver=true`
- Catalog miss=deny full cutover
- schema v2 production write
- deleting old write sites
- Item 7 Retirement / I3
- LIVE cutover
- cross-tenant migration
- unapproved production data mutation
- `deployAuthorized=true`

## Rollback / revoke

- Rejecting this request leaves the canonical receipt not-issued.
- An invalid later issued stamp must be revoked (same pattern as `memory-workspace-phase1b-unlock-issued-stamp-revoke.json`).
- Frozen Item 5 closeout JSON and final binding are not rewritten.
- Unlock does not overlay a new production runtime.

## Tests

```bash
node --test docs/design/evidence/memory-workspace-phase1b-item5-production-closeout.test.mjs
node --test docs/design/evidence/memory-workspace-phase1b-unlock-remaining.test.mjs
node --test docs/design/evidence/memory-workspace-phase1b-unlock-decision-request.test.mjs
```

Results are recorded after the local run in this package's landing comment.

This round does **not** claim unlock is issued. It does **not** start Item 6/7. It does **not** modify the production resolver. It does **not** perform LIVE cutover.
