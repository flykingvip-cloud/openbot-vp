# Collaboration CSC ledger final reverify

Date: 2026-08-23

Status: **passed** (ledger-only; LIVE not changed)

Receipt: `docs/design/evidence/collaboration-csc-ledger-final-reverify-2026-08-23.json`

Clean worktree: `/tmp/openbot-ledger-final-ac52234d99` @ freshly fetched `origin/main` `ac52234d99` (PR #618). Task text named `e1cbc1e804`; that SHA is an ancestor, not the tip.

Dirty inbound-depth workspace was not used.

## Observed LIVE (2026-08-23T00:38Z)

Read-only: `podman exec openbot-gateway-rc cat /app/dist/build-info.json` on `root@8.217.93.71`.

| Layer               | Value                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Base image          | `localhost/openbot:rc-amd64-provenance-5c221b9ec3` · OCI revision `5c221b9ec38c6316b98797342a01fb39ffd80562`               |
| imageTag            | `rc-amd64-provenance-5c221b9ec3`                                                                                           |
| ImageID / digest    | `ca71ba79d800…` / `sha256:b09953827133890b162dcd47dda12509bdf4a7a86d6d57e32b221dbd41b8b257`                                |
| Gateway overlay SHA | `7cd74d4c5c69e7492eb6d624531f27592d6c809a` (`build-info.commit`)                                                           |
| UI SHA              | `5c221b9ec38c6316b98797342a01fb39ffd80562`                                                                                 |
| Provenance          | `provenance/sha-7cd74d4c5c69` → overlay; `provenance/sha-5c221b9ec38c` → image                                             |
| Rollback            | restore seq 34 overlay `affda8bce889` from `/root/openbot-maintenance-origin-main-7cd74d4c-item7-s18-r1-20260822T150915Z/` |
| Flags               | inbound / CSC / Progress Ledger process env **unset**; pin `OPENBOT_UI_OVERLAY_PINNED_ENTRY=index-Ol92eg1L.js`             |

Container `openbot-gateway-rc` StartedAt `2026-08-22T15:10:36Z` unchanged. healthz 200 `{ok:true,status:live}`; readyz `ready:true`.

## seq 34 / seq 35

| seq | imageTag                         | imageDigest        | gatewaySha     | uiSha          | tag                           |
| --- | -------------------------------- | ------------------ | -------------- | -------------- | ----------------------------- |
| 34  | `rc-amd64-provenance-5c221b9ec3` | `sha256:b0995382…` | `affda8bce889` | `5c221b9ec38c` | `provenance/sha-affda8bce889` |
| 35  | `rc-amd64-provenance-5c221b9ec3` | `sha256:b0995382…` | `7cd74d4c5c69` | `5c221b9ec38c` | `provenance/sha-7cd74d4c5c69` |

`RELEASE_RECORD.md` Latest cutover `Source revision` = seq 35 `gatewaySha`. Previous cutover records seq 34. Image digest matches the running GHCR base image.

## Gates (worktree `ac52234d99`)

`pnpm delivery:ledger:audit`: 35 releases, **0 errors**, **identity-mismatch=0**, 14 historical warnings.

`verify-forward-only.sh --live-sha 7cd74d4c5c69… --candidate HEAD`: **allow** (LIVE ⊂ `ac52234d99`).

`verify-delivery-alignment.sh --prod-sha 7cd74d4c5c69… --candidate-tag provenance/sha-7cd74d4c5c69`: **PASS=8 WARN=2 FAIL=0**.

The two WARNs are expected: local docker reports the **base image** SHA `5c221b9`; the running overlay is `7cd74d4`. They are not identity mismatches and do not authorize a LIVE swap.

## Production close-out

**Passed.** audit errors=0, identity-mismatch=0, alignment FAIL=0, LIVE overlay/image split confirmed, `RELEASE_RECORD` matches `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`.

Explicitly not done: no LIVE switch, no inbound/CSC flag change, no container recreate, no new overlay.
