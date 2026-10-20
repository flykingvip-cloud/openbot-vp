# Collaboration CSC ledger identity realign

Date: 2026-08-23

Status: **passed** (ledger-only; LIVE not changed)

Receipt: `docs/design/evidence/collaboration-csc-ledger-identity-realign-2026-08-23.json`

Clean worktree: `/tmp/openbot-ledger-realign-e1cbc1e804` @ freshly fetched `origin/main` `e1cbc1e804` (PR #614). Task text named `dbedde8fad`; that SHA is an ancestor, not the tip.

## Observed LIVE (2026-08-23T00:19Z)

| Layer               | Value                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Base image          | `localhost/openbot:rc-amd64-provenance-5c221b9ec3` · OCI revision `5c221b9ec38c6316b98797342a01fb39ffd80562`               |
| imageTag            | `rc-amd64-provenance-5c221b9ec3`                                                                                           |
| Gateway overlay SHA | `7cd74d4c5c69e7492eb6d624531f27592d6c809a`                                                                                 |
| UI SHA              | `5c221b9ec38c6316b98797342a01fb39ffd80562`                                                                                 |
| Provenance          | `provenance/sha-7cd74d4c5c69` → overlay; `provenance/sha-5c221b9ec38c` → image                                             |
| Rollback            | restore seq 34 overlay `affda8bce889` from `/root/openbot-maintenance-origin-main-7cd74d4c-item7-s18-r1-20260822T150915Z/` |
| Flags               | inbound / CSC / Progress Ledger process env **unset**                                                                      |

Container `openbot-gateway-rc` StartedAt `2026-08-22T15:10:36Z` unchanged. healthz 200, readyz `ready:true`.

## seq 28 / seq 29

Not rewritten. Those rows are historical overlays on `ws-c-v1-root-guard-r1-20260815`:

- seq 28 `gatewaySha=6ac338479a16` / `uiSha=34595862f785` / `tag=provenance/sha-6ac338479a16`
- seq 29 `gatewaySha=aa348b38a14a` / `uiSha=34595862f785` / `tag=provenance/sha-aa348b38a14a`

`imageTag` has no `provenance-` prefix, so `identity-mismatch` does not apply. Retargeting them onto `rc-amd64-provenance-5c221b9ec3` would forge history. Current GHCR overlays are already seq 34 / seq 35.

## Gates (worktree `e1cbc1e804`)

`pnpm delivery:ledger:audit`: 35 releases, **0 errors**, **identity-mismatch=0**.

`verify-forward-only.sh --live-sha 7cd74d4c5c69… --candidate HEAD`: **allow** (LIVE ⊂ `e1cbc1e804`).

`verify-delivery-alignment.sh --prod-sha 7cd74d4c5c69… --candidate-tag provenance/sha-7cd74d4c5c69`: **FAIL=0**.
