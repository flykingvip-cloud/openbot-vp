# Phase 1B Item 6 Evidence Package

**Authority:** scoped minima receipt tip `ce6cf5e1702c7f2de20b58f062fd100562b6ee01`
**operationId:** `phase1b-item6-evidence-f495f7a6a1-20260820T041500Z`
**status:** evidence-preparation
**Item 6:** not-met / locked
**implementationUnlocked:** false

This package is independent evidence preparation for Item 6. It is **not** an implementation unlock, **not** an Item 6 met decision, and **not** a production write authorization.

## Baseline recorded at start

| Field                     | Value                                      |
| ------------------------- | ------------------------------------------ |
| originMainSha             | `f495f7a6a17ea5a1b4bdbfbec83842501b3ef38f` |
| branchShaAtStart          | `f495f7a6a17ea5a1b4bdbfbec83842501b3ef38f` |
| minima receipt tip        | `ce6cf5e1702c7f2de20b58f062fd100562b6ee01` |
| Item 5 final closeout tip | `85f55ee2fa76f88dc538180b481a5823631af649` |

Ancestry required on this branch:

```text
git merge-base --is-ancestor ce6cf5e1702c7f2de20b58f062fd100562b6ee01 HEAD
```

The minima tip is already contained in this `origin/main` baseline (`f495f7a6a1`, which includes #544 / #547 / #548 / #550). PR #538 / #542 / #544 frozen evidence is not rewritten.

## SQLite path identities

1. Resource layout `{stateDir}/memory/resource-{resourceId}.sqlite`
   - Identity keys: `stateDir` + `resourceId`
   - Source: Item 6 cutover drill receipt
   - That drill is fixture-layout green and remains `item6=not-met`
   - It is not a production sqlite snapshot
2. Operator-issued `OPENBOT_AUTHORIZED_SQLITE_PATH`
   - Identity key: redacted path token
   - Source: U1 production-equivalent receipt
   - That receipt may score `item6Candidate=met`; this package must not derive Phase 1B Item 6 met from it

Host search, guessed `stateDir`, `mkdtemp`, `~/.openbot`, and `docs/design/evidence` paths are not production SoT.

## Backup / fencing / rollback

- Backup: isolated copy then hash. Empty backup or hash mismatch fail-closed.
- Fencing: single writer in design; this package does not take a production lock and does not enable a production writer.
- Rollback: restore only onto an isolated copy after hash + integrity match. Production write-back is forbidden. Restore failure fail-closed.
- Cutover record snapshot is not an authorized sqlite backup.

## Shadow / dry-run / production-equivalent

- Shadow and dry-run are read-only. `productionWrites=0`.
- Production-equivalent verification remains read-only and cites the existing U1 receipt.
- This package does **not** mark Item 6 met from that candidate score.

## Negative proofs

Deny: missing authorized path, mkdtemp fixture, `~/.openbot`, evidence path, cross-tenant read, restore hash mismatch, attempted production write.

## Implementation request draft

Draft only. Do **not** submit Item 6 implementation start.

- implementationUnlocked stays false
- no production SQLite write
- no schema v2 production write
- no resolver switch
- no LIVE cutover

Any later implementation still needs a separate independent approval.

## Forbidden

- Item 6 implementation
- changing production code or production SQLite
- `wiredToProductionResolver=true`
- schema v2 production write
- production Catalog new write
- `deployAuthorized=true`
- LIVE cutover
- deriving Item 6 met from minima or this evidence package
- modifying PR #538, #542, or #544 frozen evidence
- using the I4 / kiro-loom dirty tree as evidence
