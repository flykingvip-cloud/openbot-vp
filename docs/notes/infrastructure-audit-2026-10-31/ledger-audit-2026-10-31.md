# delivery:ledger:audit capture — 2026-10-31 Asia/Shanghai

Command: `pnpm delivery:ledger:audit` in audit worktree; exit **30**.

## Counts

- ERROR lines: 147
- warn lines: 37

## By class

     157 regression
      15 overlay-debt
       9 timeline-gap
       1 open-interval
       1 missing-tag
       1 ledger: 149 releases, 147 errors, 36 warnings

## Tip window (seq 146–151)

ERROR seq 151 [open-interval] 2 rows omit liveTo (seq 127, 151); at most one open interval (the current LIVE row) is allowed

## Interpretation (audit)

- Dense ERROR [regression] on historical seq hops = SHA-ancestry drops between successive LIVE tips; many later rows are dual-track full-dist tips that are not git-merge ancestors of the prior LIVE tip.
- timeline-gap warns include known seq 99–103 backfill holes called out in RELEASE_RECORD.
- overlay-debt warns are historical scoped-UI debt; R9 ban is forward-looking.
- Open LIVE seq 151 / d37bed5117d6 still matches host build-info (separate SSH probe); ledger audit exit 30 is **delivery debt signal**, not LIVE identity split.

## Post-capture update (after #172)

This note records the **pre-#172** `delivery:ledger:audit` capture. PR #172 later closed seq127 (`liveTo=2026-10-14T16:31:38Z`) and synced RELEASE_RECORD L3 to seq151 / `d37bed5117d6`. Re-running the audit after #172 should report **one** open interval (current LIVE only), not seq127+151. This file does not edit `releases.jsonl` / `RELEASE_RECORD.md`.
