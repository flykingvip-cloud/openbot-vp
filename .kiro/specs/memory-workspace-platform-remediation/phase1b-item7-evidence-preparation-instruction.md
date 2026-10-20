# Phase 1B Item 7 Evidence Preparation Instruction

**Authority:** scoped minima receipt `memory-workspace-phase1b-unlock-minima-issued-receipt.json`
**operationId:** `phase1b-unlock-minima-issued-0f92f5b66e-20260820T011000Z`
**Does not authorize:** Item 7 implementation, Retirement, deleting call-sites, production writes, LIVE cutover

This instruction only allows independent evidence preparation for Item 7. It is **not** an implementation unlock and **not** a Retirement authorization.

## Allowed

1. Inventory existing `productionWriteWatchIndex` call-sites.
2. Classify each call-site by owner and risk.
3. Design the Retirement order. Design only; do not execute Retirement.
4. Run dry-run and negative tests against fixtures.
5. Draft a separate implementation request/handoff. That draft does not start implementation and does not delete call-sites.

## Forbidden

- Item 7 implementation
- Item 7 Retirement
- deleting any `productionWriteWatchIndex` call-site
- changing production code
- `wiredToProductionResolver=true`
- Catalog miss=deny
- production Catalog new write
- `deployAuthorized=true`
- LIVE cutover
- deriving Item 7 met from this minima
- modifying PR #538 or PR #542 frozen evidence
- using the I4 / kiro-loom dirty tree as evidence

Any later Item 7 implementation or Retirement still requires a separate independent approval.
