# Item 5 Final Closeout Package

**Request:** Item 5 Final Closeout Review only.

**Mandatory review surface:** GitHub PR https://github.com/gmood2008/openbot/pull/538 (committed, based on `origin/main`). Do **not** review the dirty I4 / kiro-loom worktree. That tree does not contain this handoff as a committed object, so it cannot bind evidence SHAs.

`codex-handoff-item5-runtime-alignment-20260819.md` is the previous alignment round. Its SHA table (`16658cfe…`) is **superseded** and must not be used to bind the current five JSON files.

SHA SoT for this package:

- this handoff
- `docs/design/evidence/memory-workspace-phase1b-item5-final-closeout-binding.json`

`Item 5 = submitted/not-met` is the executing-team status inside the final closeout **package**. It is not a missing verdict file. The executing team still does **not** self-score Item 5 met.

This packet does **not** request Phase 1B unlock. It does **not** unlock or start Item 6 or Item 7. It does **not** flip `wiredToProductionResolver`. It does **not** switch Catalog miss=deny. It does **not** enable schema v2 production write. It does **not** delete old write sites. It does **not** execute Item 7 Retirement. It does **not** perform a LIVE cutover.

| Field                     | Value                                                                             |
| ------------------------- | --------------------------------------------------------------------------------- |
| Round                     | Item 5 Final Closeout Package                                                     |
| Request                   | **Item 5 Final Closeout Review**                                                  |
| Review surface after land | independent PR on current `origin/main`                                           |
| operationId / evidenceId  | `item5-closeout-6ac338479a-20260819T163148Z`                                      |
| item5                     | **submitted/not-met**                                                             |
| item5Met                  | false                                                                             |
| item6 / item7             | **not-met/locked**                                                                |
| item6Unlocked             | false                                                                             |
| item7Unlocked             | false                                                                             |
| unlock                    | not-issued                                                                        |
| canonical receipt         | `not-issued`                                                                      |
| phase1bExecutionBlocked   | true                                                                              |
| deployAuthorized          | false                                                                             |
| wiredToProductionResolver | false                                                                             |
| cutoverLive               | false                                                                             |
| SHA binding               | `docs/design/evidence/memory-workspace-phase1b-item5-final-closeout-binding.json` |
| packageCommitSha          | `abac93115f32fcc0353a7e65cc65dc01161a4660`                                        |

`openbot-cogniweave-u1-item6-production-equivalent-receipt.json` (`item6Candidate=met`) remains official production-equivalent scoring only. It is **not** Item 6 unlock.

`memory-workspace-phase1b-unlock-decision.json` `items.5=met` remains historical canonical-receipt scoring. This packet does not rewrite it and does not treat it as Item 5 closeout met.

## SHA identity

Measurement-time identity in the five closeout JSON files. Do not replace these with a later `origin/main` tip.

| Field                        | Value                                             |
| ---------------------------- | ------------------------------------------------- |
| implementation / baselineSha | `6ac338479a1644d28a6bca1c48e1921c11f9d36f`        |
| originMainSha at packet      | `6ac338479a1644d28a6bca1c48e1921c11f9d36f`        |
| production runtimeSha        | `6ac338479a1644d28a6bca1c48e1921c11f9d36f`        |
| runtimeAlignedToBaseline     | **true**                                          |
| overlay                      | `item5-runtime-align-r1` / `20260819T162800Z`     |
| previousLive                 | `34595862f785c90a4e0e30587db33690c2e139d2`        |
| landed overlay evidence      | #531 (`97d88b38a42cf38ad92a1643936892e94fc5682c`) |

`runtimeAlignedToBaseline=true` is **binary identity**: production `build-info.commit` equals closeout `baselineSha`. It is not ancestor-as-identity.

Current `origin/main` may be later (`222cb8ee3ab45d0b5327104134cf757c73462617` at package time, #528). `6ac338479a…` remains an ancestor of that tip. Later merges are evidence or other-feature only. **Do not overlay** `97d88b38a4` or `222cb8ee3a` as a new gateway runtime.

## Binary identity proof

```text
podman exec openbot-gateway-rc cat /app/dist/build-info.json
  commit=6ac338479a1644d28a6bca1c48e1921c11f9d36f
  overlay.id=item5-runtime-align-r1
  overlay.stamp=20260819T162800Z
  overlay.buildMode=gateway-dist-keep-ui

git merge-base --is-ancestor 6ac338479a1644d28a6bca1c48e1921c11f9d36f 6ac338479a1644d28a6bca1c48e1921c11f9d36f
git merge-base --is-ancestor 6ac338479a1644d28a6bca1c48e1921c11f9d36f 222cb8ee3ab45d0b5327104134cf757c73462617
```

Plan A was a gateway dist overlay that kept the Control UI pin. Base image was not replaced. `RELEASE_RECORD` LIVE cutover was not performed. `cutoverLive=false`.

## Production write / restart / post-restart read

Env:

- `OPENBOT_PRODUCTION_STATE_DIR=/root/.openbot`
- `OPENBOT_PRODUCTION_EXECUTION_MODE=production`
- `OPENBOT_PRODUCTION_ON_GATEWAY_HOST=1`

Write runner: `docs/design/evidence/memory-workspace-phase1b-item5-deploy-execution-runner.ts`

| Step                             | Result                                                             |
| -------------------------------- | ------------------------------------------------------------------ |
| Pre-write registry sha256        | `d82d054235c20a73538ff0ca3282f5a3900ab2cf05df898e9f9edd66050f3707` |
| Pre-write Catalog sha256         | `b66edd184972bea1a0397131ed453c863655dab26ca3ab8065583f93d399d866` |
| Pre-write membership sha256      | `686ace1fe292ac915e0b7dd2572f03c748ead84beeef14cb026be62a1c913717` |
| Pre-write hashed primary binding | `d2d20b13ac6bb81e37b2664ea8543bf5c702b034f95fbf5c36d47e3d70785269` |
| productionContainerWrite         | `executed` (persisted=2, compareAndPutConfirmed=0)                 |
| Post-write checksums             | unchanged vs pre-write (existing user-owned rows)                  |
| Backup                           | `/root/openbot-item5-runtime-align-write-pre-20260819T163148Z`     |
| Restart                          | `podman restart openbot-gateway-rc` at `2026-08-19T16:31:49Z`      |
| Catalog/registry across restart  | unchanged                                                          |
| containerRead.checksumMatch      | true                                                               |
| main registry asset              | active                                                             |
| membership primary binding       | present                                                            |
| liveCallerHits / users           | 7 / 7                                                              |
| liveCallerMisses                 | 0                                                                  |
| mainPathMisses                   | 0                                                                  |
| membershipFallbackHits           | 0                                                                  |
| oldRootFallback                  | 0                                                                  |
| emptyCatalogSynthesis            | 0                                                                  |
| registry/Catalog mismatch        | 0                                                                  |
| unique_user_owned_row            | 7 (**not** labeled as registry resolve hit)                        |
| registryCatalogResolveHits       | 0                                                                  |

This package does not re-run production write, restart, or LIVE cutover.

## Five evidence files (same operationId)

Canonical JSON SHA256 (`evidenceDigests`; `evidenceDigests` key excluded from the hash):

| File                                                              | sha256                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `memory-workspace-phase1b-item5-production-closeout.json`         | `d0c55f593ae3adf73fbf99513992c1077ff133bff752333d0162ed8f88ebc97a` |
| `memory-workspace-phase1b-item5-production-live-caller.json`      | `a3b2bcca2ece30f6d6720c8226eadbfaf49d98347987bf555b9479035e789f53` |
| `memory-workspace-phase1b-item5-production-registry-catalog.json` | `3cdb8021cbea5dc2bd995f60074704b89e2f281e18e0257e6378b8bffbc79b81` |
| `memory-workspace-phase1b-item5-production-tenant-context.json`   | `fda84b9a561a17fbfc42b768a7549b3b5a38b50251383517c7d752edd1c20dba` |
| `memory-workspace-phase1b-item5-production-evidence-summary.json` | `8654dc299e6fc9fcae702483fe65c3a045f6cf4d7b6d1c69162d626b6c8ffc46` |

Raw file SHA256 (includes `evidenceDigests` bytes; this is the working-tree / blob content hash):

| File                                                              | sha256                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `memory-workspace-phase1b-item5-production-closeout.json`         | `c88c12889b53ea5acc234ee7b4577211cf427236ded77e0de832ce7e21cbe9dc` |
| `memory-workspace-phase1b-item5-production-live-caller.json`      | `31ef555cfadeb0ea3520e64ccf677d6d9660958d1d2d6f469997fb2e355e2045` |
| `memory-workspace-phase1b-item5-production-registry-catalog.json` | `20d95517227f864d8e53dc49e2ec73a9ee9f2ac6f627de52e25ce835aba8324d` |
| `memory-workspace-phase1b-item5-production-tenant-context.json`   | `dd2df071511cc513e331f1576101a55bbc4922bc3df0d9ef5fbe90f0900eb240` |
| `memory-workspace-phase1b-item5-production-evidence-summary.json` | `955ae72751b9e485558d8125673dcb523f211207cd626e768929093fc3324953` |

Git blob SHA1 (`git hash-object`):

| File                                                              | blob                                       |
| ----------------------------------------------------------------- | ------------------------------------------ |
| `memory-workspace-phase1b-item5-production-closeout.json`         | `739512a6e4f6ac1fd8499bef17d301b494da3a9e` |
| `memory-workspace-phase1b-item5-production-live-caller.json`      | `9435b8140c6ea04860b0f845da26292540ffc86a` |
| `memory-workspace-phase1b-item5-production-registry-catalog.json` | `d5930e5bdd2ed93071d1977511e065c7658a1c24` |
| `memory-workspace-phase1b-item5-production-tenant-context.json`   | `db50ecab2636b4d7d7654ff91edebd911825b8e3` |
| `memory-workspace-phase1b-item5-production-evidence-summary.json` | `cc1ae20ea8ec79d6630d57fed90c2d8d4f1e05fa` |

Pointers on all five files:

- `unlockReceipt` = `docs/design/evidence/memory-workspace-phase1b-unlock-decision.json`
- `unlockRevokeReceipt` = `docs/design/evidence/memory-workspace-phase1b-unlock-issued-stamp-revoke.json`
- `runtimeEligibility` = `docs/design/evidence/memory-workspace-phase1b-item5-runtime-eligibility.json`

Superseded packet: `docs/design/evidence/superseded/item5-closeout-a7b151a707-20260819T133341Z/`. It is **not** current SoT.

SHA binding file: `docs/design/evidence/memory-workspace-phase1b-item5-final-closeout-binding.json`

## Tests

```bash
node --test docs/design/evidence/memory-workspace-phase1b-item5-production-closeout.test.mjs
node --test docs/design/evidence/memory-workspace-phase1b-unlock-remaining.test.mjs
```

Results recorded in this package (2026-08-20, local workspace):

```text
===== closeout =====
TAP version 13
# Subtest: item 5 production closeout stays a review packet and keeps field semantics consistent
ok 1 - item 5 production closeout stays a review packet and keeps field semantics consistent
  ---
  duration_ms: 15.390042
  type: 'test'
  ...
1..1
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 59.834167
===== unlock remaining =====
TAP version 13
# Subtest: canonical unlock receipt is not-issued and binds the scorecard
ok 1 - canonical unlock receipt is not-issued and binds the scorecard
  ---
  duration_ms: 2.394083
  type: 'test'
  ...
# Subtest: item 6 receipt green is vacated until backup is reviewable
ok 2 - item 6 receipt green is vacated until backup is reviewable
  ---
  duration_ms: 0.572417
  type: 'test'
  ...
1..2
# tests 2
# suites 0
# pass 2
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 41.016375
```

No runner, validator TypeScript, or production TypeScript was changed in this final package. No extra typecheck/format gate beyond these two evidence tests.

The closeout test now requires this handoff to exist and to contain the five file SHA256 values and five canonical digests. `codex-handoff-item5-runtime-alignment-20260819.md` is not that binding.

## What Codex should review

1. The five JSON files share one `operationId`/`evidenceId`.
2. `baselineSha` = `runtimeSha` = `originMainSha` = `6ac338479a…` and `runtimeAlignedToBaseline=true`.
3. `evidenceDigests` recomputed from current files match.
4. Production checksums for stateDir registry, Catalog, membership, and primary binding are consistent across backup / write / restart / container read.
5. Production metrics above remain zero-miss / zero-fallback / zero-mismatch.
6. `unique_user_owned_row` is not scored as a registry resolve hit.
7. Item 6 production-equivalent candidate is not Item 6 unlock.
8. `tasks.md` unique current state is submitted/not-met + locked + `not-issued` + blocked.
9. This handoff exists as a committed object on PR #538, not only as a dirty-worktree file.

## What this resubmission does not request

- Phase 1B unlock
- Item 6/7 start
- `wiredToProductionResolver=true`
- LIVE cutover
- Executing-team self-score of Item 5 met

Codex may return Changes Required or accept the package. Until an independent review scores Item 5 met, `item5Met` stays false.
