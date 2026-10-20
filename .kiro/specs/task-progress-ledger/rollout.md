# Task Progress Ledger 灰度与生产 Cutover

> 代码已在 #597 squash 进 `main`。独立 Turn Contract 模块是后续重构 PR，**不是**本次上线前置条件。
> 不能仅凭「PR 已合并」做生产 cutover。

实现 SHA（#597 squash，必须是 cutover 候选的祖先）：

`25df222f26971854b00f52a611e810c26e2e8b91`

灰度签字（2026-08-22，隔离单租户）：`canary-signed-off`。回执见 `canary-signoff-20260822.md`。

签字当时 `origin/main`：

`c393dca8feedd8b9db1a1f7fafc4796ac60b5d06`

## 1. 灰度（先做）

在 **staging** 或 **单租户** 环境打开 flag，生产默认保持关：

```bash
OPENBOT_PROGRESS_LEDGER_ENABLED=1
```

等价配置：`gateway.progressLedger.enabled: true`。env 或 config 任一为真即开。

重启对应 Gateway 后，用一条带 `goal` + `acceptanceRules` 的长程 Cron 验收：

| #   | 必须看到                                                                                                                                                        | 禁止看到                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | 任务目录出现 append-only `{cronStoreDir}/progress-ledger/{taskId}.jsonl`                                                                                        | 普通 `chat.send` 建账本               |
| 2   | `TOOL_SUCCEEDED` 后步骤最多 `executed`                                                                                                                          | 工具成功直接 `completed` / 验收 `met` |
| 3   | `VALIDATION_PASSED` / `STEP_VERIFIED` / `STEP_COMPLETED` / `ACCEPTANCE_*` 的 **该事件 payload** 自带白名单 evidence 后，才进入 `verified` / `completed` / `met` | 复用历史 `tool_result` 当作校验证据   |
| 4   | 仅 `blocked_user` / `blocked_authorization` 出现在工作台待办（`kind: "human-gate"`）                                                                            | 执行步骤进待办                        |
| 5   | `notify.inApp === false` 的 quiet 任务写账本、打开详情可见，但不推 Chat / 不 notify                                                                             | quiet 任务弹通知                      |
| 6   | `progress-ledger.admin.list` 与 `cron.list` 的 `progress` 来自同一 `projectProgress`                                                                            | 管理后台另算一套进度                  |
| 7   | metrics：`projectionViolations` 与 `violationsById.I1–I8` 无新增异常                                                                                            | I1–I8 计数持续上涨                    |

Flag 关闭时：不建账本、Cron 无 `progress` 字段、`progress-ledger.admin.list` 为空。

2026-08-22 隔离灰度已签字。第 4 项残差：工作台未出现执行步骤；`blocked_user` 正向入待办未在无 employee actor 的 CLI 会话打出。

## 2. 生产 Cutover（灰度已签字，仍须重测 tip）

只部署 **cutover 当时** 刚 fetch 的 `origin/main` tip。该 tip 必须包含 #597 `25df222f26`。签字时 tip 是 `c393dca8fe`（#605），若远程已前进则改用新 tip，**禁止**仍按 `25df222f26` 或本文件里的旧快照 cutover。

```bash
git fetch origin
CANDIDATE="$(git rev-parse origin/main)"
git merge-base --is-ancestor 25df222f26971854b00f52a611e810c26e2e8b91 "$CANDIDATE"
./deploy/production/scripts/verify-forward-only.sh --candidate "$CANDIDATE"
# delivery alignment（tag / origin / image / ledger）
# 构建验证：候选 SHA 必须等于刚 fetch 的 origin/main，再 build
```

任一失败即停止：

- `origin/main` 已前进 → 旧快照作废，重新校验新 tip
- `25df222f26` 不是候选祖先 → 停
- forward-only 退出 20/21 → 候选落后或 LIVE 未知
- delivery alignment 或构建失败 → 不得用「PR 已合并」或「灰度已签字」绕过

本签字 **允许** 做生产代码 cutover 检查。2026-08-22 21:13 用户指令「启用flag」后，生产已通过 `gateway.progressLedger.enabled=true` 打开（LIVE `c393dca8fe`）。`.env.docker` 已写 `OPENBOT_PROGRESS_LEDGER_ENABLED=1`，进程 env 要等容器 recreate 才会注入。

## 2.1 2026-08-22 预备结果

重新 fetch 后候选 = `c393dca8feedd8b9db1a1f7fafc4796ac60b5d06`。LIVE 容器 `openbot-gateway-rc` 已是同一 SHA（overlay `origin-main-item6-path-gate-r1`，`gateway-dist-keep-ui`）。

| 门禁                               | 结果                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `25df222f26` 是候选祖先            | 是                                                                                                  |
| `verify-forward-only.sh`           | allow（exit 0），LIVE = 候选                                                                        |
| 生产 flag                          | **已开**（`gateway.progressLedger.enabled=true`；`.env.docker=1`；进程 env 仍 UNSET 直至 recreate） |
| Gateway dist 含 Ledger             | 是（`progress-ledger.admin.list` / `projectProgress` 在包内）                                       |
| Control UI pin `index-Dpg8P1UR.js` | 已挂 `ledger-ui-pin-r1`，含「项验收已满足」                                                         |
| `verify-delivery-alignment.sh`     | 本地 PASS（`RELEASE_RECORD` 已记 `c393dca8fe`）                                                     |

2026-08-22 已补齐：`RELEASE_RECORD` Latest 记 `c393dca8fe`；Control UI pin 换为 `index-Dpg8P1UR.js`（`ledger-ui-pin-r1`）。针对 LIVE SHA 的 alignment / forward-only 在 fresh fetch 后 PASS。

**2026-08-22 21:08 验收签字**：合并验收 **批准**；当时生产 cutover 与生产 flag **不批准**。见 `acceptance-signoff-20260822.md`。

**2026-08-22 21:13**：用户指令「启用flag」。LIVE 仍为 `c393dca8fe`，runtime `enabled=true`（配置源）。回执 `docs/design/evidence/task-progress-ledger-prod-flag-on-20260822.json`。

## 3. 后续（非本波前置）

独立 `src/auto-reply/turn-contract/` 列为后续重构 PR。当前运行时用 `inferTurnContractFromLedger` 从账本推断 mode/gate。
