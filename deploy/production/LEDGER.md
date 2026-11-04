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
- seq **144** tip `9a8e91d19e893fc5d963103538cdbd35f315ac30` was closed with `liveTo` = seq 145 `liveFrom` (`2026-10-25T10:45:47.391Z`) when recording Path B tip 065840dfba12 (#79).
- seq **145** tip `065840dfba129475c9c9030c80af07970dcdd084` was closed with `liveTo` = seq 146 `liveFrom` (`2026-10-29T14:14:38.692Z`) when recording Path B tip 0a6daead74ab.
- Intervening LIVE tip `d04fd5ea0096b78b05d1c2ad3cdcc0762550ad1a` (HK ~2026-10-28) was PATH_B_SUCCESS but **ledger SKIPPED** — no backfill row (gap noted in seq146 notes only).
- seq **146** tip `0a6daead74ab08f85edfe5e61b18eb49289c43cc` was closed with `liveTo` = seq 147 `liveFrom` (`2026-10-30T03:41:25.843Z`) when recording Path B tip d632f4627a15.
- Failed DIGEST tip `cac11e761b2dccb962e7d58d55f0833bfcb528ca` (TS2741) never reached LIVE — no gap row.
- seq **147** tip `d632f4627a158e079dc21810fdb15e17ac440119` was closed with `liveTo` = seq 148 `liveFrom` (`2026-10-30T06:59:55.083Z`) when recording Path B tip 3a391742f260.
- seq **148** tip `3a391742f2603bc80d42ad3d4258e047224da352` is the current Path B LIVE open row.
- seq **154** tip `a17b60872cb62122449a170a24b2f4e150cf9557` was closed with `liveTo` = seq 155 `liveFrom` (`2026-11-02T06:12:06.377Z`) when recording Path B tip 10b9f044707c.
- seq **155** tip `10b9f044707c6439518cbe314fdf470ebd5f4f88` was closed with `liveTo` = seq 156 `liveFrom` (`2026-11-03T04:03:08.447Z`) when recording Path B tip 605e7c296dff.
- seq **156** tip `605e7c296dff1f8bf890a05e80a902f6214a2eaa` was closed with `liveTo` = seq 157 `liveFrom` (`2026-11-03T09:23:21.234Z`) when recording Path B tip 2ea87d9d6fba.
- seq **157** tip `2ea87d9d6fbafa6384710ca65931b83c86fdf871` was closed with `liveTo` = seq 158 `liveFrom` (`2026-11-03T11:38:56.303Z`) when recording Path B tip bc342abbd68f (private soak for 2ea87d incomplete/paused — HK interval backfilled).
- seq **158** tip `bc342abbd68f3a69ed7ad8a97fb1da340575be77` was closed with `liveTo` = seq 159 `liveFrom` (`2026-11-04T00:49:58.012Z`) when recording Path B tip ded9b6e160ab.
- seq **159** tip `ded9b6e160ab64c65a86490da1311e4411dae783` was closed with `liveTo` = seq 160 `liveFrom` (`2026-11-05T02:10:24.655Z`) when recording Path B tip 7e6247ef1378 (skipped unrecorded interim LIVE tips after seq159 — closed #235 3912f320 never merged; 96db11d/#238 not backfilled).
- seq **160** tip `7e6247ef1378bef4aa8094ca847b463461459bf9` was closed with `liveTo` = seq 161 `liveFrom` (`2026-11-05T04:35:58.375Z`) when recording Path B tip 7a968e9aaab1.
- seq **161** tip `7a968e9aaab17df8ada3d008cf87e238c90df8c6` was closed with `liveTo` = seq 162 `liveFrom` (`2026-11-05T06:11:59.956Z`) when recording Path B tip b17420b55618.
- seq **162** tip `b17420b55618cadcafee7daf3347512f8849985c` is the current Path B LIVE open row.
