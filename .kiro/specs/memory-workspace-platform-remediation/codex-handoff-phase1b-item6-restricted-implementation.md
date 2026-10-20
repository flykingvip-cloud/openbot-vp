# Phase 1B Item 6 Restricted Implementation Handoff

**Request:** Item 6 Restricted Implementation Review only

This round reports **restricted Item 6 implementation progress**. It does not request Item 6/7 met. It does not execute production writes. It does not execute Retirement. It does not delete old call-sites. It does not switch the resolver. It does not execute LIVE cutover.

`implementationStarted=true` means the isolated-copy code started. It does **not** mean Item 6 met.

| Field                            | Value                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| status                           | implementation-in-progress                                                                      |
| itemMet / item6Met               | false                                                                                           |
| implementationUnlocked           | true                                                                                            |
| implementationStarted            | true                                                                                            |
| phase1bExecutionBlocked          | true                                                                                            |
| deployAuthorized                 | false                                                                                           |
| wiredToProductionResolver        | false                                                                                           |
| liveCutover                      | false                                                                                           |
| productionSqliteWrite            | false                                                                                           |
| authorizedSqlitePathRequired     | true                                                                                            |
| originMainSha / baselineSha      | `e0d5c3750166692bbcdd324854ee65e4a358a9f1`                                                      |
| Item 6 unlock receipt            | `docs/design/evidence/memory-workspace-phase1b-item6-implementation-unlock-issued-receipt.json` |
| Item 6 unlock merge              | `d3fd0f62cd9d979a07e0a64366127d62088485a2` (#569)                                               |
| Item 6 implementation-review tip | `d650a3fafa59192bef7823357d74eeca648e6ecf`                                                      |
| Item 7 implementation-review tip | `daa00a3d7006f2b7023f2540f276bc831f538317`                                                      |
| minima receipt tip               | `ce6cf5e1702c7f2de20b58f062fd100562b6ee01`                                                      |
| Item 5 final closeout tip        | `85f55ee2fa76f88dc538180b481a5823631af649`                                                      |
| runtime                          | `src/memory/item6-authorized-sqlite-migrate.ts`                                                 |
| PR URL                           | https://github.com/gmood2008/openbot/pull/586                                                   |

## Allowed this round

- isolated-copy schema/SQLite shadow tables
- `OPENBOT_AUTHORIZED_SQLITE_PATH` only
- backup / fencing / single-writer / rollback on the isolated copy
- checksum + `recovery_required` on hash/integrity failure
- fail-closed on illegal paths

## Forbidden

- host search; guessed stateDir; implicit `~/.openbot` SoT
- evidence / mkdtemp / temp fixture as production path
- write real production SQLite
- production Catalog write
- schema v2 production write
- modify resolver / `wiredToProductionResolver=true`
- LIVE cutover
- Item 6 met

## Tests

```bash
node --test docs/design/evidence/memory-workspace-phase1b-item6-implementation-progress.test.mjs
node --test docs/design/evidence/memory-workspace-phase1b-item6-implementation*.test.mjs
pnpm exec vitest run src/memory/item6-authorized-sqlite-migrate.test.ts src/memory/item6-authorized-sqlite-path.test.ts src/memory/item6-authorized-sqlite-read.test.ts
```

Independent Item 6 restricted-implementation review. Not Item 6 met. Not I4 / kiro-loom dirty tree.
