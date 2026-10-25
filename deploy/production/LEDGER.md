# Production cutover ledger

Machine-readable Path B production cutover ledger (source of truth for this product):

`deploy/production/releases.jsonl`

Append new rows here only (via `pnpm delivery:cutover:record`). Do not hand-edit historical rows.
Validate with `pnpm delivery:ledger:audit` and `pnpm delivery:check-sot`.

`deploy/production/RELEASE_RECORD.md` remains the human view in this repo. It is not the machine ledger.

## History

On 2026-10-21 the openbot-vp copy of `releases.jsonl` was temporarily removed after a comparison with the harness-Benchmark-Engine (OHBE) copy through seq 143, with seq 144 living only in OHBE. OHBE and openbot-vp are independent projects/servers. Owner decision restored Path B machine SoT in openbot-vp: this file is again the append-only ledger for HK SaaS Path B / dual-track cutovers. OHBE may keep its own ledger for that separate project; do not append Path B openbot-vp cutovers there going forward.

## Open intervals after restore

- seq **127** still omits `liveTo` (pre-existing historical debt).
- seq **143** was closed with `liveTo` = seq 144 `liveFrom` (`2026-10-20T09:21:32Z`) when restoring the seed — OHBE/PR19 had appended seq 144 without closing 143; the close uses the authentic next `liveFrom` only.
- seq **144** tip `9a8e91d19e893fc5d963103538cdbd35f315ac30` is the current Path B LIVE open row.
