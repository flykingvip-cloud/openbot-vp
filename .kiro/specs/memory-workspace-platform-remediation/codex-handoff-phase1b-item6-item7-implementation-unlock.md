# Phase 1B Item 6/7 Implementation Unlock Decision Handoff

**Request:** Item 6/7 Implementation Unlock Decision Review only

This round submits an independent implementation-unlock **decision package**. It does not start implementation. It does not request Item 6/7 met. It does not execute production writes. It does not execute Retirement. It does not execute LIVE cutover. It does not modify the resolver. It does not issue full Phase 1B unlock.

After this decision review, Item 6 and Item 7 still execute, submit, and accept separately. They must not be merged into one production implementation.

| Field                                    | Value                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| reviewRequest                            | Item 6/7 Implementation Unlock Decision Review only                                                     |
| decision                                 | submitted-for-independent-review                                                                        |
| requestedScope                           | item6-item7-implementation-only                                                                         |
| implementationUnlock                     | **not-issued**                                                                                          |
| fullPhase1bUnlock                        | **not-issued**                                                                                          |
| phase1bExecutionBlocked                  | true                                                                                                    |
| deployAuthorized                         | false                                                                                                   |
| wiredToProductionResolver                | false                                                                                                   |
| liveCutover                              | false                                                                                                   |
| item6Met                                 | false                                                                                                   |
| item7Met                                 | false                                                                                                   |
| item7Retirement                          | forbidden                                                                                               |
| implementationStarted                    | false                                                                                                   |
| liveWriteWatchIndex                      | 37                                                                                                      |
| frozenWriteWatchIndex                    | 38                                                                                                      |
| item6OperationId                         | `phase1b-item6-implementation-unlock-decision-e0d5c37501-20260821T164500Z`                              |
| item7OperationId                         | `phase1b-item7-implementation-unlock-decision-e0d5c37501-20260821T164501Z`                              |
| originMainSha / baselineSha              | `e0d5c3750166692bbcdd324854ee65e4a358a9f1`                                                              |
| branchShaAtStart                         | `e0d5c3750166692bbcdd324854ee65e4a358a9f1`                                                              |
| Item 6 implementation-review package tip | `d650a3fafa59192bef7823357d74eeca648e6ecf`                                                              |
| Item 6 implementation-review merge       | `7aaa532f6b5a17e39343d7ab03811801fbcf8faa` (#557)                                                       |
| Item 7 implementation-review package tip | `daa00a3d7006f2b7023f2540f276bc831f538317`                                                              |
| Item 7 implementation-review merge       | `daaadd34cc44cce12a832e6f7c3bc355beb5aca6` (#558)                                                       |
| minima receipt tip                       | `ce6cf5e1702c7f2de20b58f062fd100562b6ee01`                                                              |
| Item 5 final closeout binding            | `85f55ee2fa76f88dc538180b481a5823631af649`                                                              |
| proposed receipt                         | `docs/design/evidence/memory-workspace-phase1b-item6-item7-implementation-unlock-proposed-receipt.json` |
| Item 6 execution plan                    | `.kiro/specs/memory-workspace-platform-remediation/phase1b-item6-implementation-execution-plan.md`      |
| Item 7 execution plan                    | `.kiro/specs/memory-workspace-platform-remediation/phase1b-item7-implementation-execution-plan.md`      |
| PR URL                                   | https://github.com/gmood2008/openbot/pull/585                                                           |
| DDOC commit                              | `a3134180cba78c22139ae63616bb43df53a4b699`                                                              |
| F commit                                 | `203c4fe98241b6251e7d82bc8a230bca00e91b4c`                                                              |
| ACL commit                               | `786feb85835950fd9d598e2856ed8e8932b1fae8`                                                              |
| PR HEAD                                  | https://github.com/gmood2008/openbot/pull/585 (branch tip)                                              |

Proposed receipt fields that stay locked in this packet:

- `status=proposed`
- `effective=false`
- `signedBy=null`
- `issuedAt=null`
- `implementationUnlock=not-issued`

This packet does not self-issue the receipt and keeps `phase1bExecutionBlocked` at true.

## Cited bindings

- minima receipt: `docs/design/evidence/memory-workspace-phase1b-unlock-minima-issued-receipt.json` @ `ce6cf5e1702c7f2de20b58f062fd100562b6ee01`
- Item 6 implementation-review handoff: `.kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-item6-implementation-review.md`
- Item 7 implementation-review handoff: `.kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-item7-implementation-review.md`
- Item 5 final closeout binding: `85f55ee2fa76f88dc538180b481a5823631af649`
- current baselineSha: `e0d5c3750166692bbcdd324854ee65e4a358a9f1`

## Allowed / forbidden matrix

If a later independent review issues implementation unlock, allowed scope is **only**:

| Item | Allowed later (isolated branch / separate PR)                                                                                                                     | Not allowed                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 6    | schema/SQLite on isolated branch; fixture, shadow, dry-run; controlled non-production verification; prepare migration/rollback; separate Item 6 implementation PR | production deploy; production SQLite write; schema v2 production write         |
| 7    | Retirement guard, tombstone/quarantine, receipt; isolated dry-run; rollbackable per-wave prep; separate Item 7 implementation PR                                  | Item 7 Retirement execute; deleting productionWriteWatchIndex call-sites; LIVE |

Still forbidden even after that later approval:

- wiredToProductionResolver=true
- Catalog miss=deny
- schema v2 production write
- production Catalog new write
- production SQLite write
- deleting any productionWriteWatchIndex call-site
- Item 7 Retirement execute
- LIVE cutover
- deployAuthorized=true
- cross-tenant migration
- BYOS / tenant-cloud / cold archive
- marking implementation test results as Item 6/7 met
- modifying PR #538, #542, or #544 or frozen evidence
- modifying the canonical full unlock receipt

## Not requested

- Item 6 implementation start
- Item 7 implementation start
- Item 6/7 met
- Phase 1B full unlock
- resolver switch
- schema v2 production write
- Item 7 Retirement
- LIVE cutover

## Tests

```bash
node --test docs/design/evidence/memory-workspace-phase1b-item6-item7-implementation-unlock.test.mjs
node --test docs/design/evidence/memory-workspace-phase1b-item6-implementation-review.test.mjs
node --test docs/design/evidence/memory-workspace-phase1b-item7-implementation-review.test.mjs
node --test docs/design/evidence/memory-workspace-phase1b-unlock-minima-issued.test.mjs
```

Results (local, 2026-08-21T16:45Z):

- `memory-workspace-phase1b-item6-item7-implementation-unlock.test.mjs` — 5 pass
- `memory-workspace-phase1b-unlock-minima-issued.test.mjs` — 6 pass
- Item 6/7 implementation-review tests still pin `review.baselineSha == origin/main` from the accepted review era. Those JSON packets were **not** retargeted (forbidden by this packet). Frozen review tips remain ancestors of HEAD, which the new unlock test proves.

## Artifact SHA256

| Path                                                                                                    | SHA256                                                             |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `docs/design/evidence/memory-workspace-phase1b-item6-item7-implementation-unlock-request.json`          | `7a3909eb2e0e25c49e2aea2b2482c1866a4f22e0f1593abcd4501af627ece456` |
| `docs/design/evidence/memory-workspace-phase1b-item6-item7-implementation-unlock-proposed-receipt.json` | `e2fdcd610dd1813e76278d0df05da000070b06ef5af599fa442e79cb365599a5` |
| `docs/design/evidence/memory-workspace-phase1b-item6-item7-implementation-unlock.test.mjs`              | `91f0b9199dc14387925c18c1d04b20f9f3b49eb2e020a568f046f3eaac0563b4` |
| `.kiro/specs/memory-workspace-platform-remediation/phase1b-item6-implementation-execution-plan.md`      | `cdd837f475c9310693461b9ab6f3c3c9bee17f3f642bf80a9a97c14bede1d9c2` |
| `.kiro/specs/memory-workspace-platform-remediation/phase1b-item7-implementation-execution-plan.md`      | `71cccbeb843032d4b839fb021742cdd4c920f503f876efb7c97a5d32eb088701` |

Git blob SHA of proposed receipt: `fd9c075d8e08e931dba34299b0dfc20d1587b442`

Git blob SHA of Item 6 execution plan: `1ec091748d2961ea7061a4141068eb09e6266211`

Git blob SHA of Item 7 execution plan: `3fa6f09d07a4ea5cffa89d0a30cabc11e1b6f33c`

Independent review surface. Not the I4 / kiro-loom dirty tree. Not PR #538 / #542 / #544 frozen files. Canonical unlock receipt stays `not-issued`.
