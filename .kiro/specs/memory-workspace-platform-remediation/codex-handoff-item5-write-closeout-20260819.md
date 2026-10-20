# Item 5 submitted for closeout review

**Handoff only.** This packet does not score Item 5 met. It does not unlock Item 6 or Item 7. It does not flip `wiredToProductionResolver`.

| Field                              | Value                                |
| ---------------------------------- | ------------------------------------ |
| Declaration                        | Item 5 submitted for closeout review |
| item5                              | **not-met**                          |
| item5Met                           | false                                |
| item6 / item7                      | **not-met/locked**                   |
| unlock                             | not-issued                           |
| wiredToProductionResolver          | false                                |
| deployAuthorized (closeout packet) | false                                |
| productionCatalogWrite             | compareAndPut                        |
| catalogWriteThisPacket             | existing-user-owned-rows             |

## SHAs

| Kind                                                   | SHA                                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Implementation / baseline (`origin/main` tip at write) | `a7b151a7078ba5be98ec08de9cbfad1a64639242`                                                |
| Production runtime (`build-info.json`)                 | `34595862f785c90a4e0e30587db33690c2e139d2` (not aligned; recorded, not used to claim met) |
| operationId                                            | `item5-closeout-a7b151a707-20260819T133341Z`                                              |

### Evidence SHA (canonical json, `evidenceDigests`)

| File                                                              | sha256                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `memory-workspace-phase1b-item5-production-closeout.json`         | `7c127d1e76905862db935fcb410c52040d7802c0b37ea5259652a784a589cc96` |
| `memory-workspace-phase1b-item5-production-live-caller.json`      | `76f9a60bcd8cc3f46d8b448fc01c223005d753a9061091d2e701ebc490684459` |
| `memory-workspace-phase1b-item5-production-registry-catalog.json` | `a345f3c8554c21bd0f8b0c90560b353eaf867af78dea4baef2fa0503ae954087` |
| `memory-workspace-phase1b-item5-production-tenant-context.json`   | `3ee8f96dbc5b39b98429e22b0d26b97b9fddc3304901d122c694be304bc9d63a` |
| `memory-workspace-phase1b-item5-production-evidence-summary.json` | `7448c8ae105e970905bb1890ed6b195b53393be5e0cb01de28f3f6d4166efc68` |

## Production loop

1. Backup: `/root/openbot-item5-write-pre-20260819T133341Z` (registry / Catalog / membership / hashed primary binding).
2. Write: three env vars + `docs/design/evidence/memory-workspace-phase1b-item5-deploy-execution-runner.ts` with `{ opaque: false }`. `productionContainerWrite.status=executed`, `persisted=2`, `compareAndPutConfirmed=0` (existing user-owned rows). Catalog checksum unchanged: `b772ba6d225cd2db2da99a25ddcf21d1bf59bc3ce6ccf84fb6edbc3bb4444718`.
3. Restart: `podman restart openbot-gateway-rc`; healthz `{"ok":true,"status":"live"}`.
4. Read: closeout runner against production container stateDir. `containerRead.checksumMatch=true`. `restart.catalogUnchangedAcrossRestart=true`.

## Consistency

- liveCallerHits=7 / liveCallerMisses=0
- fallbackHits=0 / mainPathMisses=0
- usersWithRegistryResolvedNotInCatalog=0 / rootCause=none
- no UUID / email / production host IP in git evidence
- five packets share `operationId` / `evidenceId` / `baselineSha`
- Item 6/7 remain locked; unlock not-issued

## Tests

```bash
node --test docs/design/evidence/memory-workspace-phase1b-item5-production-closeout.test.mjs
```

## Out of scope

- Does not declare Item 5 met
- Does not unlock Item 6 or Item 7
- Does not set `wiredToProductionResolver=true`
- Does not change U1 unlock, Catalog miss=deny, schema v2 production write, or LIVE
