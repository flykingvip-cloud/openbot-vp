# Chat Bridge + 硬闸 — 实机 E2E 清单

> 前置与父 spec `acceptance-guide.zh-CN.md` §12 场景 B/C 相同；**仅验员工工作台**，不验 Telegram/WhatsApp。

## 环境

```bash
export OPENBOT_SUPERVISOR_ENABLED=1
# 或 openclaw config set gateway.supervisor.enabled true

# 默认 workspace 指向真实 git 仓库（含 package.json test/lint）
openclaw config set collaboration.defaults.workspace /path/to/openbot

# codex-cli 已安装且 gateway 侧 health 通过
openclaw channels status --probe   # 可选
# UI：员工端 → 我的任务 → 开发监督 → CLI 就绪面板
```

## A. Bridge（大白 → 监督任务）

1. 打开 **员工工作台 → 大白助手**
2. 发送：`用 codex 重构开发监督 Tab 的 UI`
3. 预期：prelude 出现 **「创建开发监督任务」** + 说明文案（非升级支持单）
4. 点击 → 确认卡 → 确认执行
5. 预期：聊天区 `taskId` 卡片 + **「打开开发监督看板」**
6. 点击深链 → **我的任务 → 开发监督** 自动选中该任务

## B. 硬闸（自由聊天不得裸跑 codex-cli）

1. 保持 `OPENBOT_SUPERVISOR_ENABLED=1`
2. 在**普通对话 agent**（非大白 execute）将模型选为 **codex-cli**
3. 发送改代码类消息
4. 预期：失败并提示走 **开发监督任务**（`free-chat-cli-guard` 文案），**不**产生未监督的仓库改动

## C. 硬闸（exec 工具不得 shell codex）

1. 使用带 `exec` 工具的 embedded 模型（非 codex-cli 模型面）
2. 让 agent 执行 `codex exec ...` 或等价命令
3. 预期：`exec` 被拒绝，同上引导文案

## D. 对照（监督路径仍可用）

1. 在开发监督看板手动创建任务，或完成 A 步
2. 预期：Worker 正常 dispatch，`runCliAgent({ supervisedRun: true })` 不被硬闸拦截

## 证据留存

- 截图：prelude 建议卡、确认卡、task 卡片、看板选中态
- Gateway 日志：`supervisor.task.create` 成功 + 无自由聊天 `codex` spawn
- 可选：`supervisor.task.audit` / Fabric 审计条目
