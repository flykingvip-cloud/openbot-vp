# P20.2 账本 / Latest / provenance 对账报告

Date: 2026-09-05

Status: **LIVE、开放 ledger seq 63、主干 Latest 与 provenance peeled target 已对齐为 `04690f8d2e`。#960 已合入，不是 OPEN。本增量未改 `RELEASE_RECORD.md`、未改 `releases.jsonl`、未补 tag。do_not_mint。**

Task: `openbot-diagnosis-platform`

Machine: [ledger JSON](/design/openbot-diagnosis-p20.2-ledger-2026-09-05.json)

---

## 逐项

| 身份                          | SHA            | 来源                                                 | 证据                                              | 结论                            |
| ----------------------------- | -------------- | ---------------------------------------------------- | ------------------------------------------------- | ------------------------------- |
| candidate                     | `a83214ae57cf` | `git rev-parse origin/main`（已 `git fetch origin`） | #965 tip                                          | 等于最新 origin/main            |
| origin/main                   | `a83214ae57cf` | 同上                                                 | #960 Latest 回填与 P20.2 记录已在主干             | 唯一 candidate 基线             |
| LIVE                          | `04690f8d2ed5` | 运行容器 `/app/dist/build-info.json`                 | `builtAt=2026-09-04T13:29:54.802Z`                | 唯一运行事实                    |
| ledger 开放行 seq 63          | `04690f8d2ed5` | `releases.jsonl`                                     | #953；`liveFrom=2026-09-04T13:39:37Z`；`tag=main` | 与 LIVE 一致；**keep**          |
| ledger seq 62                 | `81aafe1e218e` | 已 `liveTo=2026-09-04T13:39:37Z`                     | historical                                        | 不得写成 Latest                 |
| RELEASE_RECORD Latest cutover | `04690f8d2ed5` | 第一个 `## Latest cutover` = seq 63                  | #960；`liveFrom` 复用账本时间，未伪造             | 与 LIVE/ledger 一致；本增量不改 |
| provenance tag object         | `8efc2eaa0525` | annotated `provenance/sha-04690f8d2ed5`              | 只标识 tag 对象                                   | **不参与 LIVE 比对**            |
| provenance peeled target      | `04690f8d2ed5` | `git rev-parse tag^{commit}`                         | 等于 LIVE                                         | **一致**；**do_not_mint**       |

Forward-only：`allow`。无 RELEASE_RECORD 警告。

## RELEASE_RECORD

`delivery_ledger_owner` 已通过 #960 在 `main` 追加第一个 Latest = seq 63 / `04690f8d2e`。旧 seq 61/59 段保留。LIVE 未前移，因此 **不再写第二次 Latest**。
