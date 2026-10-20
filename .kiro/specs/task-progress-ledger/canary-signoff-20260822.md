# Task Progress Ledger 灰度签字 · 2026-08-22

决策：`canary-signed-off`  
签字人：用户（本会话「灰度签字」）  
记录：cursor-grok  
机器回执：`docs/design/evidence/task-progress-ledger-canary-signoff-20260822.json`

## 范围

隔离单租户灰度，**不是**生产。

- 容器：`openbot-ledger-canary`（`127.0.0.1:18799`）
- 镜像：`ghcr.io/gmood2008/openbot:provenance-sha-03b9cd5d8e`
- 运行 SHA：`03b9cd5d8e89b759546a9998bb3648d31d29392b`（含 #597，早于 #605 文档）
- Flag：容器内 `OPENBOT_PROGRESS_LEDGER_ENABLED=1`，且 `gateway.progressLedger.enabled=true`

签字当时重新 `git fetch origin`：

- `origin/main` = `c393dca8feedd8b9db1a1f7fafc4796ac60b5d06`（#605）
- #597 squash `25df222f26971854b00f52a611e810c26e2e8b91` 是其祖先

## 七项

| #   | 结论               | 残差                                                                                                                 |
| --- | ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 1   | pass               | 仅两条 cron jsonl；普通 `chat.send` 未建账本                                                                         |
| 2   | pass               | `TOOL_SUCCEEDED` 后 E1 最多 `executed`                                                                               |
| 3   | pass               | 无 evidence 的 `STEP_COMPLETED` 被 I3 拒绝；校验/完成/met 事件 payload 自带 `validation_result`                      |
| 4   | pass-with-residual | 待办无执行步骤、`humanGateCount=0`。`blocked_user` 正向入待办未在该 CLI 会话打出（无 employee actor / 无 ownership） |
| 5   | pass               | quiet：`emitToChat=false` / `emitNotification=false`                                                                 |
| 6   | pass               | `cron.list` 与 `progress-ledger.admin.list` 的 `progress` 相等                                                       |
| 7   | pass               | `projectionViolations=0`，I1–I8 均为 0                                                                               |

## 本签字解锁 / 不解锁

解锁：可以按 **当时重新 fetch 的** `origin/main` 做生产 **代码** cutover 检查（forward-only + delivery alignment + 构建）。

**不**解锁：

- 生产打开 `OPENBOT_PROGRESS_LEDGER_ENABLED`
- 把 `25df222f26` 当作 cutover 候选（`origin/main` 已前进到 `c393dca8fe`）
- 独立 Turn Contract 模块

生产 flag 仍关，直到另一次明确指令。
