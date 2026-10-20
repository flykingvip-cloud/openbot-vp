# Item 5 runtime alignment remediation

**Handoff only.** This round is Item 5 runtime alignment remediation. It does not score Item 5 met. It does not unlock Item 6 or Item 7. It does not flip `wiredToProductionResolver`. It does not execute Item 7 Retirement. It is not a LIVE cutover.

| Field                     | Value                                                       |
| ------------------------- | ----------------------------------------------------------- |
| Round                     | Item 5 runtime alignment remediation                        |
| Plan                      | **A** (redeploy candidate runtime identical to baselineSha) |
| Declaration               | Item 5 submitted for closeout review                        |
| item5                     | **not-met**                                                 |
| item5Met                  | false                                                       |
| item6 / item7             | **not-met/locked**                                          |
| unlock                    | not-issued                                                  |
| canonical receipt         | not-issued                                                  |
| wiredToProductionResolver | false                                                       |
| phase1bExecutionBlocked   | true                                                        |
| deployAuthorized          | false                                                       |

Validator-required SoT phrase in `tasks.md`:

`canonical receipt = `not-issued``

## SHA identity

| Field                    | Value                                        |
| ------------------------ | -------------------------------------------- |
| baselineSha              | `6ac338479a1644d28a6bca1c48e1921c11f9d36f`   |
| originMainSha            | `6ac338479a1644d28a6bca1c48e1921c11f9d36f`   |
| runtimeSha               | `6ac338479a1644d28a6bca1c48e1921c11f9d36f`   |
| runtimeAlignedToBaseline | **true**                                     |
| operationId / evidenceId | `item5-closeout-6ac338479a-20260819T163148Z` |
| supersedes               | `item5-closeout-a7b151a707-20260819T133341Z` |

Plan A applied as the existing gateway dist overlay with live Control UI pin retained. Overlay id `item5-runtime-align-r1`, stamp `20260819T162800Z`, `buildMode=gateway-dist-keep-ui`, previousLive `34595862f785c90a4e0e30587db33690c2e139d2`. Base image was not replaced. RELEASE_RECORD LIVE cutover was not performed.

## Production execution

Env:

- `OPENBOT_PRODUCTION_STATE_DIR=/root/.openbot`
- `OPENBOT_PRODUCTION_EXECUTION_MODE=production`
- `OPENBOT_PRODUCTION_ON_GATEWAY_HOST=1`

Write runner: `docs/design/evidence/memory-workspace-phase1b-item5-deploy-execution-runner.ts`

| Step                            | Result                                                             |
| ------------------------------- | ------------------------------------------------------------------ |
| Pre-write registry sha256       | `d82d054235c20a73538ff0ca3282f5a3900ab2cf05df898e9f9edd66050f3707` |
| Pre-write Catalog sha256        | `b66edd184972bea1a0397131ed453c863655dab26ca3ab8065583f93d399d866` |
| Pre-write membership sha256     | `686ace1fe292ac915e0b7dd2572f03c748ead84beeef14cb026be62a1c913717` |
| Pre-write primary binding       | `d2d20b13ac6bb81e37b2664ea8543bf5c702b034f95fbf5c36d47e3d70785269` |
| productionContainerWrite        | `executed` (persisted=2, compareAndPutConfirmed=0)                 |
| Post-write checksums            | unchanged vs pre-write (existing user-owned rows)                  |
| Backup                          | `/root/openbot-item5-runtime-align-write-pre-20260819T163148Z`     |
| Restart                         | `podman restart openbot-gateway-rc` at `2026-08-19T16:31:49Z`      |
| healthz                         | `{"ok":true,"status":"live"}`                                      |
| Catalog/registry across restart | unchanged                                                          |
| main registry asset             | active                                                             |
| membership primary binding      | present                                                            |
| liveCallerHits / users          | 7 / 7                                                              |
| liveCallerMisses                | 0                                                                  |
| mainPathMisses                  | 0                                                                  |
| membershipFallbackHits          | 0                                                                  |
| oldRootFallback                 | 0                                                                  |
| emptyCatalogSynthesis           | 0                                                                  |
| unique_user_owned_row           | 7 (not labeled as registry resolve hit)                            |
| registryCatalogResolveHits      | 0                                                                  |

## Evidence SHA (canonical json, `evidenceDigests`)

| File                                                              | sha256                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `memory-workspace-phase1b-item5-production-closeout.json`         | `16658cfe55b92de54a2daa92f66f775dce2bc4b0414c6667729b421652814175` |
| `memory-workspace-phase1b-item5-production-live-caller.json`      | `4c7b6615e21e2c1e336dddd1599d138bccccf5287c3020c72b6b329ad1a48fa9` |
| `memory-workspace-phase1b-item5-production-registry-catalog.json` | `8531d0a12a039673d17fe15acecac9584e83e68a7284f09a2f9828b8b3365508` |
| `memory-workspace-phase1b-item5-production-tenant-context.json`   | `a0464ecb31785ee9d524467651513689d5b5e77eabd34922f0cd68da4898dbe7` |
| `memory-workspace-phase1b-item5-production-evidence-summary.json` | `ccb7522762c9e926547f856a774e863df6011f1170135756cfa9432afb085eac` |

Prior packet kept at `docs/design/evidence/superseded/item5-closeout-a7b151a707-20260819T133341Z/`.

## Tests

```bash
node --test docs/design/evidence/memory-workspace-phase1b-item5-production-closeout.test.mjs
node --test docs/design/evidence/memory-workspace-phase1b-unlock-remaining.test.mjs
```

Both passed on 2026-08-19:

- `memory-workspace-phase1b-item5-production-closeout.test.mjs` 1/1
- `memory-workspace-phase1b-unlock-remaining.test.mjs` 2/2

Closeout runner TypeScript was only extended with `originMainSha` / `runtimeSha` / `runtimeAlignedToBaseline` / `supersedes` on the shared window. No Item 5 scoring or resolver-switch change. No extra TypeScript unit file was added.

## Out of scope

- Does not declare Item 5 met
- Does not unlock Item 6 or Item 7
- Does not set `wiredToProductionResolver=true`
- Does not change Catalog miss=deny
- Does not perform schema v2 production write
- Does not issue unlock
- Does not delete old write sites / Item 7 Retirement
- Does not cut over LIVE
