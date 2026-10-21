# Production cutover ledger

The machine-readable production cutover ledger is **not** in openbot-vp.

Canonical copy (append new rows here only):

https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl

OHBE (OpenBot Harness Benchmark Engine) product repository:

https://github.com/flykingvip-cloud/harness-Benchmark-Engine

## Why this file replaced `releases.jsonl`

On 2026-10-21 the openbot-vp copy of `deploy/production/releases.jsonl` was compared with the OHBE copy:

- Comments matched.
- Rows seq 1–143 were identical (141 JSON rows; seq 110 and seq 111 are gaps in both copies).
- Open intervals in that copy were seq 127 and seq 143.
- OHBE also has seq 144 (`gatewaySha` `9a8e91d19e893fc5d963103538cdbd35f315ac30`), landed via harness-Benchmark-Engine PR #3, merge commit `c0a283ecc290d313f6e82c9c8123efb6118ee6ef`.
- openbot-vp PR #19 (the same seq 144 row) was closed without merge.

No openbot-vp-only row was found, so the duplicated JSONL was removed. Git history of openbot-vp still has the blob from before this removal. Do not recreate `deploy/production/releases.jsonl` in this repository.

`pnpm delivery:ledger:audit` and `pnpm delivery:check-sot` recognize this stub and do not audit or append a local ledger. `pnpm delivery:cutover:record` refuses the old default path.

`deploy/production/RELEASE_RECORD.md` remains the human view in this repo. It is not the machine ledger.
