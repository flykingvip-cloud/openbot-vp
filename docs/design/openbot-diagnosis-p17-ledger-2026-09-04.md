# P17 账本 / provenance 对账报告

Date: 2026-09-04

Status: **LIVE 与 ledger seq 60 已对齐。RELEASE_RECORD 仍落后。provenance 仍缺失。Diagnosis 未改写账本、未改 RELEASE_RECORD、未补 tag。**

Task: `openbot-diagnosis-platform`

Machine: [ledger JSON](/design/openbot-diagnosis-p17-ledger-2026-09-04.json)

---

## 逐项

| 身份                          | SHA            | 来源                                                                                                      | 证据                                                                        | 结论                              |
| ----------------------------- | -------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------- |
| candidate                     | `330d92207478` | `git rev-parse origin/main`（已 `git fetch origin`）                                                      | #940 merge                                                                  | 等于最新 origin/main              |
| origin/main                   | `330d92207478` | 同上                                                                                                      | #940 在 #938/#939 之后                                                      | 唯一 candidate 基线               |
| LIVE                          | `457057ba2adb` | 运行容器 `/app/dist/build-info.json`                                                                      | `builtAt=2026-09-04T05:23:54.951Z`                                          | 唯一运行事实；是 origin/main 祖先 |
| ledger 开放行 seq 60          | `457057ba2adb` | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` | #940 / `d48aff7310`；`liveFrom=2026-09-04T05:55:49Z`；`no provenance-sha-*` | 与 LIVE 一致；**keep**            |
| ledger seq 59                 | `3d03d3b4df91` | 同上，已 `liveTo=2026-09-04T05:55:49Z`                                                                    | 已关闭                                                                      | historical；**不得写成 Latest**   |
| RELEASE_RECORD Latest cutover | `37cc40e51f46` | `RELEASE_RECORD.md` Source revision                                                                       | seq 54 / `2026-09-02T09:50:59Z`                                             | **仍落后**                        |
| provenance                    | missing        | `git tag` / `git ls-remote`                                                                               | 仅有 `provenance/sha-37cc40e51f46`                                          | **不可证明**                      |

Forward-only：`allow`。LIVE ⊂ candidate 且 LIVE ⊂ origin/main。

## RELEASE_RECORD 修复

**本增量未修复，且明确无法由 Diagnosis 修复。**

- 角色：`cursor-grok-diagnosis` 不是 `delivery_ledger_owner`。
- 路径：不得在特征分支改 `RELEASE_RECORD.md`。
- 诚实 Latest 只能写成已证明的 LIVE/ledger **seq 60 / `457057ba2adb`**，`liveFrom=2026-09-04T05:55:49Z`。
- 禁止写成 `37cc40e51f46`（仍停在 Latest）、`3d03d3b4df91`（已退役 seq 59）或 `6d9ea1f2d5da`。
- 2026-09-04 的 P15 行动单若仍要求写 seq 59，**已过期，勿执行**。

## Provenance remint plan

- `action: do_not_mint`
- `published: false`
- `proposedTag: provenance/sha-457057ba2adb`
- 原因：seq 60 拉的是无 `provenance-sha-*` 的 GHCR digest。现在补 tag 会伪造既有发布史。
- 不得补发 `provenance/sha-3d03d3b4df91` 或 `provenance/sha-6d9ea1f2d5da`。
