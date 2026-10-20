# Collaboration CSC candidate alignment (no LIVE swap)

Date: 2026-08-23

Status: **candidate ready, LIVE unchanged** — not marked “生产逻辑已部署，发布闭环已验收”

Receipt: `docs/design/evidence/collaboration-csc-candidate-align-2026-08-23.json`

Clean worktree: `/tmp/openbot-candidate-72b33bead9`. Candidate was built from then-tip `72b33bead9d19b99da41612015124344a11d9b23` (#632). Receipts land on later `origin/main` `5a39526798493464ff0a7f29ab65ab66ad7670ed` (#631), which already records LIVE overlay `e6f26e13795a` as Latest / seq 36. Dirty inbound-depth workspace was not used as the commit/cutover tree.

This run did **not** recreate `openbot-gateway-rc`, did **not** overlay LIVE, and did **not** set inbound / CSC / Progress Ledger flags.

## Task-text LIVE vs running artifact

Task text named overlay `7cd74d4c5c69`. Fail-closed read of the running container disagrees.

| Layer               | Observed 2026-08-23 11:29 CST                         | Task text           |
| ------------------- | ----------------------------------------------------- | ------------------- |
| Base image / OCI    | `5c221b9ec38c6316b98797342a01fb39ffd80562`            | `5c221b9ec38c`      |
| imageTag            | `localhost/openbot:rc-amd64-provenance-5c221b9ec3`    | same                |
| ImageID / digest    | `ca71ba79d800…` / `sha256:b0995382…`                  | unchanged           |
| `build-info.commit` | `e6f26e13795a86084e9f227453ee1d439d25d018`            | `7cd74d4c5c69`      |
| `builtAt`           | `2026-08-23T02:39:22.337Z`                            | `2026-08-22T15:09`  |
| StartedAt           | `2026-08-23T02:40:47Z` (`2026-08-23 10:40:47 +0800`)  | `2026-08-22T15:10`  |
| Container pin       | `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Ol92eg1L.js`   | `index-Ol92eg1L.js` |
| Host `pin.env`      | `index-Dpg8P1UR.js`                                   | —                   |
| Served UI           | `assets/index-Dpg8P1UR.js`                            | —                   |
| Flags               | inbound / CSC / Progress Ledger process env **unset** | do not enable       |

healthz `200` `{ok:true,status:live}`; readyz `ready:true`. Host backups:

- current overlay: `/root/openbot-maintenance-origin-main-e6f26e13795a-r1-20260823T023758Z`
- prior `7cd74d4c` overlay: `/root/openbot-maintenance-origin-main-7cd74d4c-item7-s18-r1-20260822T150915Z`

`7cd74d4c5c69` and `e6f26e13795a` are both ancestors of candidate `72b33bead9`. After #631, Latest `Source revision` and seq 36 already name the running overlay `e6f26e13795a`. This receipt does not rewrite that row.

## Candidate full-dist (auditable SHA)

Built off-host from detached `72b33bead9`. `scripts/write-build-info.ts` stamped `git rev-parse HEAD`, not the base-image SHA.

| Field               | Value                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate SHA       | `72b33bead9d19b99da41612015124344a11d9b23`                                                                                                     |
| Provenance          | annotated tag `provenance/sha-72b33bead9d1` (pushed; not force-moved)                                                                          |
| `build-info.commit` | `72b33bead9d19b99da41612015124344a11d9b23`                                                                                                     |
| `builtAt`           | `2026-08-23T03:26:57.131Z`                                                                                                                     |
| UI entry            | `assets/index-Dpg8P1UR.js`                                                                                                                     |
| Tarball             | `full-dist-72b33bead9d1.tgz` sha256 `87a24c2200186eaf8a17e24945d055dc026d6df1f3570eb5e5b01ce2b22613a8` (35 548 208 bytes)                      |
| Local image         | `localhost/openbot:rc-amd64-provenance-72b33bead9` ImageID `e955299d24615110c74b07dae177be8a2f17131cb47d25882f3ae06ad97a33a4`                  |
| GHCR                | `ghcr.io/gmood2008/openbot:provenance-sha-72b33bead9d1-amd64` digest `sha256:ef4822c9a4c03c5206c7311b402a701c958a6b108f349eae3f0be998573c8ac1` |
| OCI revision label  | `72b33bead9d19b99da41612015124344a11d9b23`                                                                                                     |
| Runtime base        | derived FROM `ghcr.io/gmood2008/openbot:provenance-sha-5c221b9ec38c` (seq 33), `/app/dist` replaced with this full-dist                        |

`docker run --platform linux/amd64 --entrypoint cat … /app/dist/build-info.json` prints commit `72b33bead9…`, not `5c221b9ec38c`.

Image was **not** staged onto the production host. `cutover-from-ghcr.sh --stage` / swap were **not** run.

## Gates

`pnpm delivery:ledger:audit` on `5a39526798`: 36 releases, **0 errors**, **identity-mismatch=0**, historical overlay warnings only.

`verify-forward-only --live-sha e6f26e13795a --candidate 72b33bead9`: **allow** (LIVE ⊂ candidate). Latest `Source revision` is now also `e6f26e13795a` (#631).

`verify-forward-only --live-sha 7cd74d4c5c69 --candidate 72b33bead9`: **allow**.

`verify-delivery-alignment` `--prod-sha e6f26e13795a --candidate-tag provenance/sha-72b33bead9d1 --candidate-sha 72b33bead9 --candidate-image-hint localhost/openbot:rc-amd64-provenance-72b33bead9`: **PASS=8 WARN=2 FAIL=0**. L3-local candidate image pins `72b33be`.

Same alignment with `--prod-sha 7cd74d4c5c69`: **PASS=8 WARN=2 FAIL=0**.

## Smoke (candidate + LIVE, no swap)

Candidate image only:

- `OpenBot 2026.7.12-rc.2 (72b33be)`
- `/app/dist/build-info.json` commit `72b33bead9d19b99da41612015124344a11d9b23`
- Control UI entry `assets/index-Dpg8P1UR.js`

LIVE (read-only, unchanged):

- healthz `200` live
- readyz `ready:true`
- overlay still `e6f26e13795a`
- image still `rc-amd64-provenance-5c221b9ec3`

## Rollback receipt (not executed)

If a later authorized swap applies this candidate onto LIVE, roll back **without** recreating the container:

1. Keep image `localhost/openbot:rc-amd64-provenance-5c221b9ec3` / digest `sha256:b0995382…`.
2. Restore current LIVE overlay from `/root/openbot-maintenance-origin-main-e6f26e13795a-r1-20260823T023758Z` into `/app/dist`.
3. Alternate prior overlay: `/root/openbot-maintenance-origin-main-7cd74d4c-item7-s18-r1-20260822T150915Z`.
4. `podman restart openbot-gateway-rc` only after an explicit operator order. This receipt does **not** authorize that restart.
5. Do not set inbound / CSC / Progress Ledger flags.

This receipt does **not** append a new LIVE ledger row. seq 36 already exists on #631 (`e6f26e13795a`, `liveTo` still null). seq 35 is already closed (`liveTo=2026-08-23T02:40:47Z`).

## Decision

Candidate publication is complete: provenance tag + GHCR full-dist image + gates green.

LIVE remains overlay `e6f26e13795a` on image `5c221b9ec38c` (seq 36 / #631). The published candidate is the next full-dist image with `build-info.commit=72b33bead9`. Do not swap. Do not enable inbound / CSC flags. Do not claim inbound/CSC production close-out.
