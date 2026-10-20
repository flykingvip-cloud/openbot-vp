# Phase 1B Item 6 Implementation Execution Plan

**Status:** plan only. This file does not start Item 6 implementation.

| Field                        | Value                                         |
| ---------------------------- | --------------------------------------------- |
| item                         | 6                                             |
| requestedScope               | item6-item7-implementation-only (Item 6 half) |
| implementationUnlock         | not-issued in the parent decision packet      |
| item6Met                     | false                                         |
| phase1bExecutionBlocked      | true                                          |
| deployAuthorized             | false                                         |
| wiredToProductionResolver    | false                                         |
| liveCutover                  | false                                         |
| productionSqliteWrite        | false                                         |
| schema v2 production write   | forbidden                                     |
| production Catalog new write | forbidden                                     |

This plan is bound to:

- minima receipt tip `ce6cf5e1702c7f2de20b58f062fd100562b6ee01`
- Item 6 implementation-review package tip `d650a3fafa59192bef7823357d74eeca648e6ecf`
- Item 6 implementation-review handoff `.kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-item6-implementation-review.md`
- Item 5 final closeout binding `85f55ee2fa76f88dc538180b481a5823631af649`
- baselineSha `e0d5c3750166692bbcdd324854ee65e4a358a9f1`
- item6OperationId `phase1b-item6-implementation-unlock-decision-e0d5c37501-20260821T164500Z`

If the independent unlock decision is later issued, Item 6 still executes, submits, and accepts on its own branch/PR. It must not be merged with Item 7 into one production implementation.

## Allowed after a later independent issue

- implement schema/SQLite changes on an isolated branch only
- complete fixture, shadow, and dry-run
- run controlled non-production verification
- prepare migration/rollback code
- submit a separate Item 6 implementation PR

That allowance is not production deploy. `deployAuthorized=true` stays forbidden.

## Schema / SQLite change list

All of the following stay off production until a later production-rollout gate that this plan does not open.

1. Identity classification for `OPENBOT_AUTHORIZED_SQLITE_PATH` (fail-closed; no host search).
2. Isolated copy of the authorized sqlite file; source remains unwritten.
3. Read-only inspect of `sqlite_master` / `table_info` / indexes / foreign keys / triggers / `table_xinfo`.
4. Capped `COUNT(*)` sample (no row payloads) on isolated copy only.
5. Shadow schema objects on the isolated copy only (`recovery_required`, `quarantine`, `tombstone` tables or equivalent columns).
6. Prepared migration statements for later isolated apply (not production apply).
7. Prepared rollback statements that restore the isolated copy from the hashed backup.
8. `SCHEMA_V2_ENABLED` remains `false`. Schema v2 production write stays disabled.

Resource identity remains `{stateDir}/memory/resource-{resourceId}.sqlite`. Guessed `~/.openbot`, evidence dirs, and `mkdtemp` fixtures are not production SoT.

## Migration order

1. Classify path. Unknown identity → stop.
2. Fence: single-writer token on the isolated copy only. Production writer stays disabled.
3. Backup: isolated-copy-then-hash. Empty backup or hash mismatch → fail-closed.
4. Integrity check (`PRAGMA integrity_check`) on the copy.
5. Inspect schema (read-only).
6. Shadow-read against the copy.
7. Dry-run migration statements against a second scratch copy.
8. Record checksums. Do not write production sqlite.
9. Stop. Production apply is a later gate, not this plan.

## Backup / fencing / single-writer

- Backup mode: isolated-copy-then-hash. Source must remain unwritten.
- Backup must be separated from source. Backup bytes are not committed to git.
- Empty backup → fail-closed. Hash mismatch → fail-closed.
- Single-writer: one fenced writer on the isolated copy. Shadow does not take a production lock.
- Production writer enabled = false. Second state machine = false.

## Shadow / read / write / cutover stages

| Stage       | Allowed now in this packet | After later Item 6 issue | Production                        |
| ----------- | -------------------------- | ------------------------ | --------------------------------- |
| shadow-read | plan only                  | isolated copy            | forbidden                         |
| fixture     | plan only                  | isolated fixture         | forbidden as SoT                  |
| dry-run     | plan only                  | isolated scratch         | forbidden                         |
| write       | forbidden                  | isolated copy only       | production SQLite write forbidden |
| cutover     | forbidden                  | forbidden                | LIVE cutover forbidden            |

This plan does not authorize LIVE cutover. Shadow reads do not become Item 6 met.

## Tenant isolation

- Identity keys: `stateDir` + `resourceId`, or operator-issued path token.
- Cross-tenant migration is forbidden.
- Cross-tenant read is deny.
- BYOS / tenant-cloud / cold archive is forbidden.
- Quarantine and tombstone rows stay tenant-scoped. They are not rewritten into a shared Catalog.

## Checksum and data integrity

- SHA-256 of authorized source bytes before copy.
- SHA-256 of backup bytes; must match source.
- `PRAGMA integrity_check` after copy and after any isolated dry-run.
- Row-count cap sample after inspect; payloads are not copied into git.
- Restore requires hash and integrity match. Restore failure is fail-closed.
- Restore is only onto the isolated copy. Production write-back is forbidden.

## recovery_required / quarantine / tombstone

Design only until a later Item 6 implementation PR on an isolated branch:

- `recovery_required`: copy failed integrity or hash mismatch. Stop. Do not repair production.
- `quarantine`: unknown conflict or tenant-boundary violation. Residual, not normal. `quarantineNormalWrites=0`. Do not rewrite into normal Catalog.
- `tombstone`: dark marker for later Item 7 coordination. Item 6 must not delete productionWriteWatchIndex call-sites and must not execute Item 7 Retirement.

## Rollback and stop conditions

Stop immediately on any of:

- missing authorized path
- host search / `~/.openbot` / evidence / mkdtemp treated as production SoT
- hash mismatch
- integrity_check failure
- attempted production SQLite write
- attempted schema v2 production write
- attempted production Catalog new write
- `wiredToProductionResolver=true`
- Catalog miss=deny
- `deployAuthorized=true`
- LIVE cutover
- cross-tenant migration
- marking test results as Item 6 met

Rollback: restore isolated copy from hashed backup; lift isolated tombstone; do not rewrite Freeze; do not write back to production.

## Production rollout pre-gates

All remain closed after this decision packet, and remain closed even if implementation unlock is later issued:

- `phase1bExecutionBlocked=true`
- `deployAuthorized=false`
- `wiredToProductionResolver=false`
- `liveCutover=false`
- Item 6 met = false until independent Item 6 met review
- schema v2 production write forbidden
- production Catalog new write forbidden
- production SQLite write forbidden
- canonical full unlock receipt stays `not-issued`
- PR #538, #542, #544 and accepted Item 6/7 review evidence stay frozen

## Forbidden even after later approval

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

## Review trail

- cursor-data-governance · 2026-08-22 · Item 6 restricted acceptance handoff on `origin/main` `5c221b9ec38c6316b98797342a01fb39ffd80562`: restricted implementation **submitted for review**; item6Met **not-issued**; phase1bUnlock **not-issued**; deployAuthorized=false; no production writes. — `codex-handoff-item6-restricted-accepted.md`
