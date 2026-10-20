# Collaboration CSC ledger identity closure

Date: 2026-08-22 (re-observed 2026-08-23 01:36 CST)

Status: **passed** (ledger-only; LIVE not changed)

Receipt: `docs/design/evidence/collaboration-csc-ledger-identity-closure-2026-08-22.json`

## Observed running identity

| Layer            | Value                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| Base image       | `localhost/openbot:rc-amd64-provenance-5c221b9ec3` · OCI revision `5c221b9ec38c6316b98797342a01fb39ffd80562` |
| Overlay artifact | `build-info.commit=7cd74d4c5c69e7492eb6d624531f27592d6c809a`                                                 |
| Prior overlay    | `affda8bce88939e42c57000896c13fc8a457f536` (seq 34, closed)                                                  |
| Flags            | inbound / CSC / Progress Ledger **unset**                                                                    |

Re-read 2026-08-22T17:36Z (`uptimeMs≈8901604`): same ImageID `ca71ba79d800…`, same overlay `7cd74d4c5c69`, healthz 200, readyz `ready:true`. Task text that named LIVE overlay `affda8bce889` is stale.

## Why seq 28 / seq 29 must not be rewritten

On `origin/main` those rows are **historical overlays on** `ws-c-v1-root-guard-r1-20260815`:

- seq 28 `gatewaySha=6ac338479a16` / `uiSha=34595862f785`
- seq 29 `gatewaySha=aa348b38a14a` / `uiSha=34595862f785`

`imageTag` has no `provenance-` prefix, so `identity-mismatch` does not apply. Retargeting them onto `rc-amd64-provenance-5c221b9ec3` would be historically false **and** would create the two errors (overlay SHA in `gatewaySha`/`uiSha` while the tag claims `5c221b9ec3`).

A 29-release / 2-error audit is a **truncated ledger fork** (stopped after inbound-depth seq 29) that treated `affda8bce889` and `7cd74d4c5c69` as seq 28/29 with both SHAs equal to the overlay. That encoding is rejected. Append-only index: do not collapse seq 30–33.

## Ledger encoding for overlays on the GHCR image

| seq | role                            | imageTag (real image)            | gatewaySha (artifact) | uiSha (image UI) | provenance tag                |
| --- | ------------------------------- | -------------------------------- | --------------------- | ---------------- | ----------------------------- |
| 33  | GHCR full image (closed)        | `rc-amd64-provenance-5c221b9ec3` | `5c221b9ec38c`        | `5c221b9ec38c`   | `provenance/sha-5c221b9ec38c` |
| 34  | overlay `affda8bce889` (closed) | `rc-amd64-provenance-5c221b9ec3` | `affda8bce889`        | `5c221b9ec38c`   | `provenance/sha-affda8bce889` |
| 35  | current LIVE overlay            | `rc-amd64-provenance-5c221b9ec3` | `7cd74d4c5c69`        | `5c221b9ec38c`   | `provenance/sha-7cd74d4c5c69` |

`uiSha` stays the image commit so `shaFromImageTag` matches. Overlay SHA is **not** written into `imageTag`.

`pnpm delivery:ledger:audit`: 35 releases, **0 errors**, **identity-mismatch=0**.

`verify-delivery-alignment.sh --prod-sha 7cd74d4c5c69… --candidate-tag provenance/sha-7cd74d4c5c69`: **FAIL=0**.
