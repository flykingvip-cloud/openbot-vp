# OpenBot Diagnosis Platform — P15 delivery_ledger_owner 行动单（2026-09-04）

Date: 2026-09-04

Status: **已过期，勿执行。** LIVE 已于 2026-09-04 切到 seq 60 / `457057ba2adb`（#940）。请改看 [P17 行动单](/design/openbot-diagnosis-p17-delivery-owner-actions-2026-09-04)。若仍把 Latest 写成 seq 59 / `3d03d3b4df`，就是回写已退役 LIVE。Diagnosis 不得改写 ledger、不得改 `RELEASE_RECORD.md`、不得发布 `provenance/sha-*`。P15/P16/P17 仍是 No-Go。

Task: `openbot-diagnosis-platform`

Related: [P15 #930 合入后重评](/design/openbot-diagnosis-p15-930-2026-09-04) · [seq59 账本](https://github.com/gmood2008/openbot/pull/932)

---

## 1. 已证明的身份

| 对象                          | 值                                                                                      | Diagnosis 决定                    |
| ----------------------------- | --------------------------------------------------------------------------------------- | --------------------------------- |
| LIVE                          | `3d03d3b4df91ab0bfaa33900eba95287c1ab30d2` container `builtAt=2026-09-04T00:43:19.076Z` | 容器为准                          |
| ledger seq 59                 | 同 LIVE，`liveFrom=2026-09-04T02:11:42Z`，notes 含 `no provenance-sha-*`                | **keep / 不改写**                 |
| ledger seq 58                 | `6d9ea1f2d5da`，已 `liveTo=2026-09-04T02:11:42Z`                                        | **historical / 不改写**           |
| RELEASE_RECORD Latest cutover | 仍 `37cc40e51f46` / `2026-09-02T09:50:59Z`（seq 54）                                    | **defer_to_delivery_owner**       |
| provenance                    | 无 `provenance/sha-3d03d3b4df91`；存在 `provenance/sha-37cc40e51f46`                    | **do_not_mint / published=false** |
| candidate                     | 最新 `origin/main`（#930 后评估为 `8298466531`）                                        | 已对齐，不再是 P15 阻断           |

---

## 2. 允许在主干上做的事

只在 **已 fetch 的 `origin/main`** 上做，走常规 PR，禁止 force-push。

1. 把 `deploy/production/RELEASE_RECORD.md` 的 **Latest cutover** 写成已证明的 LIVE `3d03d3b4df`，并注明 seq 59 / container evidence / `liveFrom=2026-09-04T02:11:42Z`。
2. 把 Latest cutover 叙述里仍写 seq 54 / `37cc40e51f` 的句子改成 historical。不要回写 `6d9ea1f2d5da` 当 Latest。
3. 不要回写 `releases.jsonl` 历史行（含 seq 58、seq 59）。
4. 合入后 `git fetch origin`，用 `--candidate-sha "$(git rev-parse origin/main)"` 重跑 P15 CLI。

---

## 3. 明确禁止

- 改写 `deploy/production/releases.jsonl` seq 58 或 seq 59
- 发布 `provenance/sha-3d03d3b4df91`、`provenance/sha-6d9ea1f2d5da` 或任何补发旧 cutover 的 tag
- 打开四门诊断 gate、注册 live pack、生产构建 / 发布 / 重启 / 灰度 / 切流量
- 接真实聊天、live 大白、Doctor `--fix`、Channel restart

补发 provenance 等于伪造“当时已发布”。下一次**新的**正式 cutover 才可以走正常 provenance 发布路径。

---

## 4. 修完 RELEASE_RECORD 之后的预期

`liveEqualsReleaseRecord` 会变成 true。`liveEqualsProvenance` 仍为 false。

因此 **P15 仍是 No-Go**，`readyForIndependentApproval` 仍为 false。独立批准不能仅因 Latest cutover 对齐就打开。
