# OpenBot Diagnosis Platform — P15 delivery_ledger_owner 行动单

Date: 2026-09-03

Status: **已过期，勿执行。** LIVE 已于 2026-09-04 切到 seq 59 / `3d03d3b4df`。请改看 [2026-09-04 行动单](/design/openbot-diagnosis-p15-delivery-owner-actions-2026-09-04)。Diagnosis 不得改写 ledger、不得改 `RELEASE_RECORD.md`、不得发布 `provenance/sha-*`。P15 仍是 No-Go。

Task: `openbot-diagnosis-platform`

Related:

- [P15 #922 合入后重评](/design/openbot-diagnosis-p15-922-2026-09-03)
- PR #925 <https://github.com/gmood2008/openbot/pull/925>（已批准，auto-merge 已打开，主干策略仍 BLOCKED）

---

## 1. 已证明的身份

| 对象                          | 值                                                                                      | Diagnosis 决定                    |
| ----------------------------- | --------------------------------------------------------------------------------------- | --------------------------------- |
| LIVE                          | `6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96` container `builtAt=2026-09-03T01:37:57.887Z` | 容器为准                          |
| ledger seq 58                 | 同 LIVE，`liveFrom=2026-09-03T02:52:10Z`，notes 含 `no provenance-sha-*`                | **keep / 不改写**                 |
| RELEASE_RECORD Latest cutover | `37cc40e51f468404baf3077307e347f32f636cb1` / `2026-09-02T09:50:59Z`                     | **defer_to_delivery_owner**       |
| provenance                    | 无 `provenance/sha-6d9ea1f2d5da`；存在 `provenance/sha-37cc40e51f46`                    | **do_not_mint / published=false** |
| candidate                     | 最新 `origin/main`（#922 后为 `afdc084a42`）                                            | 已对齐，不再是 P15 阻断           |

---

## 2. 允许在主干上做的事

只在 **已 fetch 的 `origin/main`** 上做，走常规 PR，禁止 force-push。

1. 把 `deploy/production/RELEASE_RECORD.md` 的 **Latest cutover** 写成已证明的 LIVE `6d9ea1f2d5da`，并注明 seq 58 / container evidence / `liveFrom=2026-09-03T02:52:10Z`。
2. 把 Latest cutover 叙述里仍写 seq 54 / `37cc40e51f` 的句子改成 historical，不要回写 `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` 历史行。
3. 合入后 `git fetch origin`，用 `--candidate-sha "$(git rev-parse origin/main)"` 重跑 P15 CLI。

---

## 3. 明确禁止

- 改写 `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 58（它已等于 LIVE）
- 发布 `provenance/sha-6d9ea1f2d5da` 或任何补发旧 cutover 的 tag
- 打开四门诊断 gate、注册 live pack、生产构建 / 发布 / 重启 / 灰度 / 切流量
- 接真实聊天、live 大白、Doctor `--fix`、Channel restart

补发 provenance 等于伪造“当时已发布”。下一次**新的**正式 cutover 才可以走正常 provenance 发布路径。

---

## 4. 修完 RELEASE_RECORD 之后的预期

`liveEqualsReleaseRecord` 会变成 true。`liveEqualsProvenance` 仍为 false。

因此 **P15 仍是 No-Go**，`readyForIndependentApproval` 仍为 false。独立批准不能仅因 Latest cutover 对齐就打开。provenance 缺口必须保持 fail-closed，直到一次新的正式发布带上 tag，而不是回补 seq 58。

---

## 5. 复跑命令

```text
git fetch origin
bun src/diagnosis/production-trunk-convergence.cli.ts \
  --candidate-sha "$(git rev-parse origin/main)" \
  --json-out docs/design/openbot-diagnosis-p15-after-release-record-convergence.json \
  --md-out docs/design/openbot-diagnosis-p15-after-release-record-convergence.md
```

退出码 2 = 仍 No-Go（预期，直到 provenance 可证明）。退出码 0 且 `gatesOpened=true` 视为违规。
