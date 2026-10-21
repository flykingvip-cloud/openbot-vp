# Next official cutover — carry list

Status: **CARRY ONLY.** This file does **not** authorize a cutover, grant a deployment
lock, change LIVE, or write `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`. The next official window must still
re-lock to a freshly fetched `origin/main` tip and pass I1/I2 gates.

Recorded: 2026-09-03  
Owner ask: include the conversation peek rail in the next official window; do **not**
cut over from `cursor-grok/employee-web-surface-compose`.

## Live baseline (do not treat as candidate)

| Field                        | Value                                                   |
| ---------------------------- | ------------------------------------------------------- |
| LIVE (ledger)                | seq **52** / `756a577ec77e9420ad5e927f7ddc963555ca1a97` |
| Host / container             | `8.217.93.71` / `openbot-gateway-rc`                    |
| Peek rail on LIVE Control UI | **No**                                                  |

## Carry items

| Item                                  | On `origin/main`?                                                                  | Notes                                                                                                                                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation peek rail (对话历史弦线) | **Yes** — [#921](https://github.com/gmood2008/openbot/pull/921) merge `0b51998caa` | Faint stacked ticks in the chat-thread upper-left gutter; hover / peak shows the prior-turn summary card (`overflow: visible` + `:hover`). Already merged. Local Control UI accepted 2026-09-03. **Not** on LIVE. |

## Must not ride this window

- Do **not** merge or deploy `cursor-grok/employee-web-surface-compose` (behind `origin/main`; not a cutover source).
- Do **not** treat local `3cd94d7062` as a production SHA. Same card-unclip change is already in #921.

## Window reminder

A full-dist cutover from current LIVE to today's `origin/main` still carries **all** trunk
commits since `756a577ec77e` (about 160 as of 2026-09-03), not the peek rail alone.
Re-count and re-qualify at lock time. Seq52 canary lock (`seq52-deployment-lock-request.md`)
remains **not granted**.
