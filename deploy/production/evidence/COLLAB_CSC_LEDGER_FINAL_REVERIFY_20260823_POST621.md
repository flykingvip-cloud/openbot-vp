# Collaboration CSC ledger final reverify (post #621 / #623)

Date: 2026-08-23

Status: **passed** (ledger-only; LIVE not changed)

Receipt: `docs/design/evidence/collaboration-csc-ledger-final-reverify-2026-08-23-post621.json`

Clean worktree: `/tmp/openbot-ledger-final-761d42a0ff` @ freshly fetched `origin/main` `761d42a0ff` (PR #621). Dirty inbound-depth workspace was not used.

#623 merged first (`fd1e18b94f`), then #621 (`761d42a0ff`). Both receipts are now on trunk.

## Observed LIVE (2026-08-23T01:31Z)

| Layer               | Value                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Base image          | `5c221b9ec38c6316b98797342a01fb39ffd80562` / `rc-amd64-provenance-5c221b9ec3` |
| Gateway overlay SHA | `7cd74d4c5c69e7492eb6d624531f27592d6c809a`                                    |
| StartedAt           | `2026-08-22T15:10:36Z` unchanged                                              |
| Flags               | inbound / CSC / Progress Ledger process env **unset**                         |

healthz 200 live; readyz `ready:true`.

## seq 34 / seq 35

Both rows keep `imageTag=rc-amd64-provenance-5c221b9ec3` and digest `sha256:b0995382…`. gatewaySha `affda8bce889` / `7cd74d4c5c69`. provenance tags match. `RELEASE_RECORD` matches `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`.

## Gates (worktree `761d42a0ff`)

`pnpm delivery:ledger:audit`: 35 releases, **0 errors**, **identity-mismatch=0**.

`verify-forward-only`: **allow** (LIVE ⊂ `761d42a0ff`).

`verify-delivery-alignment`: **PASS=8 WARN=2 FAIL=0** (expected local-image WARNs).

## Production close-out

**Passed.** No LIVE switch, no inbound/CSC flag change, no container recreate.
