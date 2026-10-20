# Collaboration CSC ledger acceptance (read-only)

Date: 2026-08-23

Status: **blocked** — not marked “生产逻辑已部署，发布闭环已验收”

Receipt: `docs/design/evidence/collaboration-csc-ledger-acceptance-2026-08-23.json`

Clean worktree: `/tmp/openbot-ledger-accept-e6f26e1379` @ freshly fetched `origin/main` `e6f26e1379` (#627). Named tip matches. Dirty inbound-depth workspace was not used.

This run did **not** rebuild, restart, switch the container, or change flags.

## Trunk receipts reviewed

On `e6f26e1379`:

- `COLLAB_CSC_LEDGER_FINAL_REVERIFY_20260823.md` (#621)
- `…_POST619.md` (#623)
- `…_POST621.md` (#625)
- `…_ON_525EE95547.md` (#627)

Those receipts recorded LIVE overlay `7cd74d4c5c69` and container `StartedAt=2026-08-22T15:10:36Z`. That observation is now stale.

## Observed LIVE (2026-08-23T02:52Z) — read-only

| Layer               | Observed now                                                                        | Task expected          |
| ------------------- | ----------------------------------------------------------------------------------- | ---------------------- |
| Base image / OCI    | `5c221b9ec38c6316b98797342a01fb39ffd80562`                                          | `5c221b9ec38c`         |
| imageTag            | `rc-amd64-provenance-5c221b9ec3`                                                    | same                   |
| ImageID / digest    | `ca71ba79d800…` / `sha256:b0995382…`                                                | unchanged              |
| `build-info.commit` | `e6f26e13795a86084e9f227453ee1d439d25d018`                                          | `7cd74d4c5c69`         |
| `builtAt`           | `2026-08-23T02:39:22.337Z`                                                          | `2026-08-22T15:09`     |
| StartedAt           | `2026-08-23T02:40:47Z` (`2026-08-23 10:40:47 +0800`)                                | `2026-08-22T15:10`     |
| Provenance          | `provenance/sha-e6f26e13795a` → LIVE overlay; `provenance/sha-5c221b9ec38c` → image | overlay tag `7cd74d4c` |
| Host backup         | `/root/openbot-maintenance-origin-main-e6f26e13795a-r1-20260823T023758Z`            | —                      |

healthz 200 live; readyz `ready:true`. inbound / CSC / Progress Ledger process env **unset**. Pin `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Ol92eg1L.js`.

`7cd74d4c5c69` is an **ancestor** of the running overlay. Image identity still matches seq 33. Overlay identity does **not** match seq 35 / Latest cutover.

## seq 34 / seq 35 vs LIVE

| seq | ledger gatewaySha | ledger imageTag / digest                              | matches LIVE now             |
| --- | ----------------- | ----------------------------------------------------- | ---------------------------- |
| 34  | `affda8bce889`    | `rc-amd64-provenance-5c221b9ec3` / `sha256:b0995382…` | historical only              |
| 35  | `7cd74d4c5c69`    | same                                                  | **no** (`liveTo` still null) |

`RELEASE_RECORD` Latest `Source revision` is still `7cd74d4c5c69`. `verify-forward-only` against actual LIVE warns: running SHA ≠ release-record SHA.

## Gates (worktree `e6f26e1379`)

`pnpm delivery:ledger:audit`: 35 releases, **0 errors**, **identity-mismatch=0**, 14 historical warnings.

`verify-forward-only --live-sha 7cd74d4c5c69 --candidate HEAD`: **allow** (ancestor check).

`verify-forward-only --live-sha e6f26e1379 --candidate HEAD`: **allow**, warning that LIVE ≠ `RELEASE_RECORD`.

`verify-delivery-alignment` for `provenance/sha-7cd74d4c5c69`: **PASS=8 WARN=2 FAIL=0**.

`verify-delivery-alignment` for actual LIVE `provenance/sha-e6f26e13795a`: **FAIL=1** (`RELEASE_RECORD` does not mention `e6f26e1379`).

## Acceptance decision

**Not accepted.** Checklist item 6 required LIVE overlay `7cd74d4c5c69`. Observed overlay is `e6f26e1379` on the same GHCR image. Ledger Latest / seq 35 are stale relative to the running artifact.

Do not treat this as a new authorized cutover. This receipt is observation only.
