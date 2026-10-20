# Phase 1B Item 7 Batch 17 deployment preflight

Batch 17 / S28 is **already accepted** on `origin/main` as #654. This packet is **production preflight only**. It does not retire another site and does not cut over.

| Field                           | Value                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| status                          | deployment-preflight-only                                                                           |
| Batch 17 PR                     | https://github.com/gmood2008/openbot/pull/654                                                       |
| Batch 17 merge                  | `47d6934c34dced654652f027f2c66fedea35a67f`                                                          |
| ledgerId / replacement          | S28 `tool-cwd.ts:52` `buildUserOwnedWorkspaceCatalogEntry` → `WorkspaceResourceCatalog.getResource` |
| fallback                        | none; fail-closed; no host mkdir / `process.cwd`                                                    |
| current origin/main / candidate | `9b1833490424a0eaaf99fa6b64268a9254249d37`                                                          |
| LIVE                            | `a12e4c59e5754e0c280b423c68c989c6973ac9b0`                                                          |
| previousAcceptedBaseline        | 13 (#665 / S24)                                                                                     |
| retiredThisChange               | 0                                                                                                   |
| remaining / liveWriteWatchIndex | 13 / 13                                                                                             |
| item7                           | not-met                                                                                             |
| phase1bUnlock                   | not-issued                                                                                          |
| deployAuthorized                | false                                                                                               |
| live                            | forbidden                                                                                           |
| productionCatalogWrite          | none                                                                                                |
| schemaV2ProductionWrite         | false                                                                                               |
| rollbackProof / quarantineProof | true / true                                                                                         |

Historical Batch 17 locks at accept time remain: `previousAcceptedBaseline=18`, `retiredThisChange=1`, `remaining/liveWriteWatchIndex=17`. They must not be rewritten onto the current scan.

## Directed tests

- `docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch17-s28.test.mjs` — pass
- `src/gateway/workspace-resolver/tool-cwd-item7-s28.test.ts` + `tool-cwd.test.ts` — 11 pass

## Production gates (precheck only)

1. `candidateSha == origin/main == 9b18334904`
2. `verify-forward-only.sh --candidate 9b18334904 --live-sha a12e4c59e575` → allow
3. `verify-delivery-alignment.sh` for LIVE tag `provenance/sha-a12e4c59e575` → PASS=10 WARN=0 FAIL=0
4. Ledger audit: 41 releases, 0 errors, 19 warnings
5. Merge-back plan: dry-run stdout only; not executed
6. Current main has **no** `provenance/sha-9b18334904` and **no** published full-dist image
7. Rollback remains the recorded LIVE path (`openbot-gateway-rc-prev-47d693-before-a12e4c`); no new live drill
8. Remaining live sites: S01, S02, S25–S27, S30–S37
9. Canonical unlock decision stays **not-issued**

## Forbidden this packet

- redo Batch 17 or write current remaining back to 17
- start S25 / Batch 22
- write `liveWriteWatchIndex=0`
- Item 7 met, Phase 1B unlock, LIVE cutover, production Catalog / schema v2 write, I3
- deploy a side branch or dirty worktree
- mint a provenance tag or build a production image

## Requested review

**Item 7 Batch 17 deployment preflight Review only.**

Not requested: production cutover, Item 7 met, Phase 1B unlock.
