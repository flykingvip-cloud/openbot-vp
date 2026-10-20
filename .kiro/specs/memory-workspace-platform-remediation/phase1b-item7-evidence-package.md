# Phase 1B Item 7 Evidence Package

**Authority:** scoped minima receipt tip `ce6cf5e1702c7f2de20b58f062fd100562b6ee01`
**operationId:** `phase1b-item7-evidence-f495f7a6a1-20260820T041500Z`
**status:** evidence-preparation
**Item 7:** not-met / locked
**implementationUnlocked:** false
**Retirement:** forbidden

This package is independent evidence preparation for Item 7. It is **not** an implementation unlock, **not** a Retirement authorization, and **not** an Item 7 met decision.

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

## Inventory

| Index                              | Value | Source                                                                                                  |
| ---------------------------------- | ----- | ------------------------------------------------------------------------------------------------------- |
| Freeze `productionWriteWatchIndex` | 38    | Phase 0 freeze `memory-workspace-phase0-20260814.call-sites.json`                                       |
| Live write/index sites             | 37    | `memory-workspace-phase1b-item7-retirement-scan.json`                                                   |
| Ledger rows                        | 38    | ledger still lists `tool-cwd.ts:51 createEmptyWorkspaceCatalog`, which is already absent from live scan |
| `retiredThisChange`                | 0     | this package                                                                                            |

Do **not** rewrite Freeze 38 to 37 or 0. Do **not** treat inventory as Item 7 met.

Each of the 37 live call-sites has exactly one inventory owner, a resource domain, a tenant boundary, and a risk class. Inventory owner is classification only; this package does not claim those production paths for implementation.

## Retirement order (design only)

- W0: independent Item 7 implementation unlock required first
- W1: tombstone / quarantine new writes; Catalog miss=deny stays off
- W2: retire write callers after replacement is proven
- W3: retire catalog synthesis after no caller needs empty catalog
- W4: retire steward helpers after callers are gone
- W5: retire memory index last so rollback can still locate

Deleting resolver helpers before remaining callers would split writes. Deleting index sites before write sites have a replacement would lose recovery. This package executes none of those waves.

Rollback design: restore from git + lift tombstone. Never rewrite the Freeze baseline to zero.

## Dry-run / negative proofs

- Dry-run reads the existing scan and checks that each cited source line still contains its symbol.
- Dry-run does not modify production code and does not delete call-sites.
- Deny: retirement without unlock, deleting a call-site now, rewriting Freeze 38 to 0, Catalog miss=deny, LIVE cutover.

## Implementation request draft

Draft only. Do **not** submit Item 7 implementation start or Retirement.

- implementationUnlocked stays false
- no production write-path change
- no resolver switch
- Catalog miss=deny stays off
- no LIVE cutover

Any later implementation or Retirement still needs a separate independent approval.

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
- deriving Item 7 met from inventory or dry-run
- modifying PR #538, #542, or #544 frozen evidence
- using the I4 / kiro-loom dirty tree as evidence
