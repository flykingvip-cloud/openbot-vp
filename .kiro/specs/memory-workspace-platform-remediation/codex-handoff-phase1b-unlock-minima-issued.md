# Phase 1B Unlock Minima Issued Receipt

**Request:** Phase 1B Unlock Minima Receipt Review

This package issues a **scoped minima receipt only**. It does not issue full unlock, does not start Item 6 or Item 7 implementation, does not change the production resolver, does not authorize production writes, and does not perform LIVE cutover.

| Field                       | Value                                                      |
| --------------------------- | ---------------------------------------------------------- |
| operationId                 | `phase1b-unlock-minima-issued-0f92f5b66e-20260820T011000Z` |
| origin/main baseline        | `1d89c302eac9f6105c1784bf8f9e3ab80610bd8d`                 |
| branchSha at start          | `1d89c302eac9f6105c1784bf8f9e3ab80610bd8d`                 |
| PR URL                      | https://github.com/gmood2008/openbot/pull/544              |
| package commit              | `dfeaa6dfe7f00f743664c30f13051d5e76921d5a`                 |
| PR #542 tip                 | `0f92f5b66e62951283f35f69cd931b852de99b9a`                 |
| PR #542 merge               | `1d89c302eac9f6105c1784bf8f9e3ab80610bd8d`                 |
| PR #538 Item 5 tip          | `85f55ee2fa76f88dc538180b481a5823631af649`                 |
| unlock                      | **minima-issued**                                          |
| fullUnlock                  | **not-issued**                                             |
| phase1bExecutionBlocked     | true                                                       |
| deployAuthorized            | false                                                      |
| wiredToProductionResolver   | false                                                      |
| liveCutover                 | false                                                      |
| item6ImplementationUnlocked | false                                                      |
| item7ImplementationUnlocked | false                                                      |

## Independent decision cited

- Request: Phase 1B Unlock Decision Review: minima
- Decision: Accepted
- PR https://github.com/gmood2008/openbot/pull/542
- Tip `0f92f5b66e62951283f35f69cd931b852de99b9a`
- Merge `1d89c302eac9f6105c1784bf8f9e3ab80610bd8d`
- `signedBy=independent-codex-review`

Not a review surface: I4 / kiro-loom dirty tree; `codex-handoff-item5-runtime-alignment-20260819.md`.

## Pointer

`docs/design/evidence/memory-workspace-phase1b-unlock-current.json`

- `fullUnlock=not-issued`
- `minimaUnlock=issued`
- `executionBlocked=true`
- `productionAuthorized=false`

Ordinary callers must not treat the minima receipt as a production unlock.

## Allowed

1. prepare Item 6 independent design package
2. prepare Item 7 independent design package
3. run inventory and fixture verification
4. run read-only and shadow verification
5. run dry-run and production-equivalent verification
6. submit separate implementation request/handoff

## Still forbidden

- Item 6 implementation
- Item 7 implementation
- `wiredToProductionResolver=true`
- Catalog miss=deny
- schema v2 production write
- production Catalog new write
- deleting any `productionWriteWatchIndex` call-site
- Item 7 Retirement
- `deployAuthorized=true`
- LIVE cutover
- cross-tenant migration
- BYOS / tenant-cloud / cold archive
- deriving Item 6/7 met from minima
- modifying PR #538 or PR #542 frozen evidence

## SHA256

| Path                                                                                                  | SHA256                                                             |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `docs/design/evidence/memory-workspace-phase1b-unlock-minima-issued-receipt.json`                     | `111108ad5c5e38d10265c166e81e4ae05b27ebdbab92505af92e94e0a26b9155` |
| `docs/design/evidence/memory-workspace-phase1b-unlock-current.json`                                   | `20e727bbe3cea1c8b6f43da0f66b261ecf2a4af8b7a094670dd995ec0adf3a5b` |
| `.kiro/specs/memory-workspace-platform-remediation/phase1b-item6-evidence-preparation-instruction.md` | `ca4f79103baf709fa46b45a12ad12aefcf2722fa81e01255438e81b0209cce7d` |
| `.kiro/specs/memory-workspace-platform-remediation/phase1b-item7-evidence-preparation-instruction.md` | `3cacae577f697e378dd7032198fc3d40f5789c2d15d4bbce8d62615a82d7d317` |

## Tests

```bash
node --test docs/design/evidence/memory-workspace-phase1b-unlock-minima-issued.test.mjs
node --test docs/design/evidence/memory-workspace-phase1b-unlock-minima.test.mjs
node --test docs/design/evidence/memory-workspace-phase1b-item5-production-closeout.test.mjs
node --test docs/design/evidence/memory-workspace-phase1b-unlock-remaining.test.mjs
```

Local run 2026-08-20 on `cursor-data-governance/phase1b-unlock-minima-issued` at baseline `1d89c302eac9f6105c1784bf8f9e3ab80610bd8d`:

- `memory-workspace-phase1b-unlock-minima-issued.test.mjs`: 6/6 pass
- `memory-workspace-phase1b-unlock-minima.test.mjs`: 6/6 pass
- `memory-workspace-phase1b-item5-production-closeout.test.mjs`: 1/1 pass
- `memory-workspace-phase1b-unlock-remaining.test.mjs`: 3/3 pass

This round does **not** request Item 6/7 implementation start, Item 6/7 met, Phase 1B full unlock, resolver switch, schema v2 production write, Item 7 Retirement, or LIVE cutover.
