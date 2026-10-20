# Collaboration CSC production closeout request — d3f59d55d82d (post-#639)

Date: 2026-08-23

Status: **`productionCloseout: requested`** — LIVE unchanged (`bad5f90a1d` overlay)

Receipt: `docs/design/evidence/collaboration-csc-candidate-align-d3f59d55d8-2026-08-23.json`

Frozen tip: **`d3f59d55d82d89af8d0b9575afe5259e2366fbca`** (merge PR #639)

Clean worktree: `/tmp/openbot-post639-d3f59d55d8`

## Six-gate summary (re-run after merge)

| Gate                    | Result                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| 1. Fresh fetch + freeze | `d3f59d55d82d` @ post-merge fetch                                                                  |
| 2. Shadow 3 tests       | **5/5 pass** @ merge tip                                                                           |
| 3. Full-dist identity   | `build-info` / OCI revision / digest → **`d3f59d55d82d…`** / `825e14cc…` (rebuilt; not pre-rebase) |
| 4. Forward-only         | **allow** (`bad5f90a1d` ⊂ candidate)                                                               |
| 5. Delivery alignment   | **PASS=9 WARN=1 FAIL=0** (post-#640 RELEASE_RECORD)                                                |
| 6. Smoke + rollback     | Candidate `:18889` healthz/readyz OK; rollback tarball → `e6f26`; LIVE restored `bad5f90a1d`       |
| 7. Ledger preview       | `SEQ39_LEDGER_PREVIEW_20260823.json` — **not appended**                                            |

## Candidate full-dist

| Field   | Value                                                                     |
| ------- | ------------------------------------------------------------------------- |
| SHA     | `d3f59d55d82d89af8d0b9575afe5259e2366fbca`                                |
| Tag     | `provenance/sha-d3f59d55d82d`                                             |
| Image   | `localhost/openbot:rc-amd64-provenance-d3f59d55d82d`                      |
| Digest  | `sha256:825e14cc217a51d28b132037307c0844dcdd9af2ce8616f580bac73b0988ede5` |
| Tarball | `full-dist-d3f59d55d82d.tgz` sha256 `433afdf3f256…` (881 394 208 bytes)   |

Build note: in-container `docker build` OOM on this host; candidate built via host `pnpm build:docker` + runtime pack Dockerfile (same dist/UI as canonical full-dist).

## Explicit non-actions

- Did not swap `openbot-gateway-rc` to candidate image
- Did not append seq 39 to LIVE ledger
- Did not enable inbound / CSC flags

## Owner decision requested

Approve seq 39 full-dist cutover per `SEQ39_LEDGER_PREVIEW_20260823.json`, or reject with reason.
