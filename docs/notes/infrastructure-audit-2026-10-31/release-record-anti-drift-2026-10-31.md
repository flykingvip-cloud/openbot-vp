# RELEASE_RECORD anti-drift (Priority 2) — 2026-10-31 Asia/Shanghai

> **历史标识：** 本页 Baseline note 写于 #172/#174 尚未同时出现在主干之时（当时 `origin/main` `0e4d269615e26909bbac606f1dfb755b3511400c`，文中「#172 not merged」是当天事实）。2026-11-01 现行结论：两者均已在主干，`pnpm delivery:release-record:check` 在候选 `c3b00f492411dc96d2befd67921fe4951cfede97` 上退出码 0。见 [closeout-2026-11-01.md](closeout-2026-11-01.md)。下面正文不改写成新事实。

## Scope

- Machine SoT remains `deploy/production/releases.jsonl`.
- `RELEASE_RECORD.md` stays the **human view**. A managed block between
  `<!-- BEGIN GENERATED: current-identity -->` … `<!-- END GENERATED: current-identity -->`
  is generated from the unique open ledger tip.
- **ledger ↔ doc consistent ≠ live container identity reconciled.** Check/generate
  never SSH to HK and never claim LIVE verify.

## Commands

```sh
pnpm delivery:release-record:check      # read-only; exit 20 on drift / unusable ledger
pnpm delivery:release-record:generate   # upsert managed block (--write)
```

Dry-run generate (print block, no write):

```sh
node --import tsx scripts/delivery/release-record.ts generate
```

## Fail-closed cases

| Condition | Result |
|---|---|
| cannot parse `releases.jsonl` | exit 20 `parse-error` |
| zero open intervals | exit 20 `zero-open` |
| multiple open intervals | exit 20 `multi-open` |
| missing markers / field drift vs open tip | exit 20 |
| check + `--write` | refused |

## Baseline note (this PR)

- Branched from `origin/main` `0e4d269615e26909bbac606f1dfb755b3511400c`.
- On that tip, ledger still has **dual-open seq 127 + 151** (#172 closes 127; not merged).
  Therefore `pnpm delivery:release-record:check` against the committed ledger is
  expected to fail with `multi-open` until #172 lands.
- The committed generated block was produced from a **temporary** one-open ledger
  (seq127 `liveTo` = successor StartedAt `2026-10-14T16:31:38Z`, matching #172) so the
  human view already points at seq **151** / `d37bed5117d6`. After #172 merges, re-run
  `pnpm delivery:release-record:generate` (idempotent) and `check` should pass for
  ledger↔doc (still not a LIVE container proof).

## What this does not do

- No DIGEST / deploy / A3 / billing / runner / ruleset changes.
- No ledger row deletes, no bulk `regressionAcknowledged`.
- Does not rewrite historical cutover prose under `## Latest cutover` / historical L3 bullets
  (seq 107 bullet label only demoted to Historical so it is not a second “current”).
