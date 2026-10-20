# OpenBot Diagnosis Platform — P17 delivery_ledger_owner 行动单（2026-09-04）

Date: 2026-09-04

Status: **已过期，勿执行。** LIVE 其后又前移到 seq 63 / `04690f8d2e`（#953）。请改看 [P20 行动单](/design/openbot-diagnosis-p20-delivery-owner-actions-2026-09-05)。[P18](/design/openbot-diagnosis-p18-delivery-owner-actions-2026-09-04) 与 [P19](/design/openbot-diagnosis-p19-delivery-owner-actions-2026-09-04) 同样过期。若仍把 Latest 写成 seq 60 / `457057ba2adb`，就是回写已不是容器事实的 SHA。Diagnosis 不得改写 ledger、不得改 `RELEASE_RECORD.md`、不得发布 `provenance/sha-*`。P17–P20 仍是 No-Go。

Task: `openbot-diagnosis-platform`

Related: [P17 对账](/design/openbot-diagnosis-p17-ledger-2026-09-04) · [seq60 账本](https://github.com/gmood2008/openbot/pull/940)

---

## 1. 已证明的身份

| 对象                          | 值                                                                                      | Diagnosis 决定                    |
| ----------------------------- | --------------------------------------------------------------------------------------- | --------------------------------- |
| LIVE                          | `457057ba2adbdb6958fe092d211f75108d866f42` container `builtAt=2026-09-04T05:23:54.951Z` | 容器为准                          |
| ledger seq 60                 | 同 LIVE，`liveFrom=2026-09-04T05:55:49Z`，#940，notes 含 `no provenance-sha-*`          | **keep / 不改写**                 |
| ledger seq 59                 | `3d03d3b4df`，已 `liveTo=2026-09-04T05:55:49Z`                                          | **historical / 不改写**           |
| RELEASE_RECORD Latest cutover | 仍 `37cc40e51f46` / seq 54                                                              | **defer_to_delivery_owner**       |
| provenance                    | 无 `provenance/sha-457057ba2adb`                                                        | **do_not_mint / published=false** |
| candidate                     | 最新 `origin/main`（#940 后评估为 `330d922074`）                                        | 已对齐                            |

---

## 2. 允许在主干上做的事

只在 **已 fetch 的 `origin/main`** 上做，走常规 PR，禁止 force-push。

1. 把 `deploy/production/RELEASE_RECORD.md` 的 **Latest cutover** 写成已证明的 LIVE `457057ba2adb`，并注明 seq 60 / container evidence / `liveFrom=2026-09-04T05:55:49Z`。
2. 把 Latest 叙述里仍写 seq 54 / `37cc40e51f` 的句子改成 historical。不要回写 `3d03d3b4df` 或 `6d9ea1f2d5da` 当 Latest。
3. 不要回写 `releases.jsonl` 历史行（含 seq 59、seq 60）。
4. 合入后 `git fetch origin`，用 `--candidate-sha "$(git rev-parse origin/main)"` 重跑 P17 CLI。

---

## 3. 明确禁止

- 改写 `releases.jsonl` seq 59 或 seq 60
- 发布 `provenance/sha-457057ba2adb`、`provenance/sha-3d03d3b4df91`、`provenance/sha-6d9ea1f2d5da`
- 打开四门诊断 gate、注册 live pack、生产构建 / 发布 / 重启 / 灰度 / 切流量

补发 provenance 等于伪造“当时已发布”。下一次**新的**正式 cutover 才可以走正常 provenance 发布路径。

---

## 4. 修完 RELEASE_RECORD 之后的预期

`liveEqualsReleaseRecord` 会变成 true。`liveEqualsProvenance` 仍为 false。当前树 SLO 仍 empty，reader/audit/quota 仍 fail-closed。

因此 **P17 仍是 No-Go**，`readyForIndependentApproval` 仍为 false。
