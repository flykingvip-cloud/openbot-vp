# Phase 1B Item 6 Evidence Preparation Instruction

**Authority:** scoped minima receipt `memory-workspace-phase1b-unlock-minima-issued-receipt.json`
**operationId:** `phase1b-unlock-minima-issued-0f92f5b66e-20260820T011000Z`
**Does not authorize:** Item 6 implementation, production writes, resolver switch, LIVE cutover

This instruction only allows independent evidence preparation for Item 6. It is **not** an implementation unlock.

## Allowed

1. Prepare an independent Item 6 design package.
2. Inventory SQLite paths that would be in scope for a later Item 6 review.
3. Prepare backup, fencing, and rollback fixtures.
4. Run shadow and dry-run verification.
5. Run production-equivalent **read-only** verification.
6. Draft a separate implementation request/handoff. That draft does not start implementation.

## Forbidden

- Item 6 implementation
- changing production code or production SQLite
- `wiredToProductionResolver=true`
- schema v2 production write
- production Catalog new write
- `deployAuthorized=true`
- LIVE cutover
- deriving Item 6 met from this minima
- modifying PR #538 or PR #542 frozen evidence
- using the I4 / kiro-loom dirty tree as evidence

Any later Item 6 implementation still requires a separate independent approval.
