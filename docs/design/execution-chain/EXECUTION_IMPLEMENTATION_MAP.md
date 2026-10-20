# 执行预检实现地图

行号对应当前分支 `cursor-grok/execution-chain-closure`。测试名是 vitest 的 `it` 标题。

| 行为                             | 代码                                                                                                                                                                            | 测试                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单一入口                         | `src/agents/pi-embedded-runner/run/attempt.ts:1104` 建预检，`:1123` 过滤服务端工具                                                                                              | `keeps chat and cron on the same embedded agent entry`；`keeps subagent, cron resume, and the ledger on the shared runner`                               |
| 别名收成一个主技能               | `src/agents/execution-preflight/resolve.ts:81` `resolvePrimary`；未解析目标时 `:117` `skill_alias_unresolved`                                                                   | `resolves an alias to one primary skill`；`binds the real primary and keeps that contract across a provider retry`                                       |
| 主技能绑定                       | 同上，决策码 `primary_skill_selected` / `skill_alias_resolved`                                                                                                                  | `does not let a lower skill replace an explicit primary`                                                                                                 |
| 工具不可见                       | `resolve.ts:181` `not_visible`（不在策略集）                                                                                                                                    | `keeps unauthorized tools out of the candidate set and distinguishes visibility`                                                                         |
| 可见但执行拒绝                   | `resolve.ts:186` `execution_denied`（在策略集，契约不允许）                                                                                                                     | 同上                                                                                                                                                     |
| 契约读取                         | `src/agents/execution-preflight/skill-contract.ts:57` `readSkillContract`                                                                                                       | `reads a reusable contract rather than a product-specific switch`；`parses the deck skill only as contract data`                                         |
| 重试分类                         | `src/agents/execution-preflight/failure.ts:35` `classifyExecutionFailure`；HTTP 重试咨询 `src/auto-reply/reply/agent-runner-execution.ts:931`                                   | `classifies failures and refuses retry or privilege fallback for contract, validation, and permission stops`                                             |
| 交付完成门                       | `src/agents/execution-preflight/delivery.ts:212` `resolveAttemptDelivery`；`attempt.ts:2546`                                                                                    | `hashes the written artifact inside the attempt delivery function`                                                                                       |
| 校验器缺失                       | `src/agents/execution-preflight/resolve.ts:216` `validator_unavailable`                                                                                                         | `blocks a missing validator before delivery and leaves ordinary chat alone`                                                                              |
| qa_passed 的受信任来源           | `src/agents/execution-preflight/validation.ts:18` `registerTrustedValidator`，`:31` `issueValidationReceipt`                                                                    | 同上。未注册校验器发不出回执                                                                                                                             |
| taskId / attemptNumber           | `src/agents/execution-preflight/trace.ts:7` `resolveExecutionTaskId`；`resolve.ts:241` `nextAttemptNumber`；`attempt.ts:1104` 传入                                              | `binds the real primary and keeps that contract across a provider retry`                                                                                 |
| 客户端 / MCP 形态 / 技能身份工具 | `resolve.ts:387` `filterLaneTools`；`attempt.ts:1143` 接在客户端工具合并之前                                                                                                    | `drops client, mcp-shaped, and skill-identity tools that the contract does not allow`；`leaves ordinary tasks unchanged when no skill contract is bound` |
| 跟踪                             | 进程内 `recordExecutionTrace`，并写入 lifecycle。不保证跨进程恢复                                                                                                               | `records reconstructable traces without prompt text`                                                                                                     |
| 焦点门                           | `src/conversation-task/focus-switch.ts:439` `applyFocusSwitchGate`；冲突仍由 `src/gateway/server-methods/chat.ts:4205` 挡住；异常记 `focus_state_unavailable` 在 `chat.ts:4217` | `degrades when focus state is missing and blocks a confirmed focus conflict`                                                                             |

## 工具面

- 服务端工具：`createOpenClawCodingTools` 的结果进入 `applyPreflightToTools`。
- 客户端工具：`filterLaneTools` 使用同一允许集。无契约时原样返回。
- MCP：没有独立工具对象。`mcp_*` 客户端工具走允许集。`mcporter` 经 `exec` 只做 MCP-shaped command detection only，不是 independent MCP authorization。
- 最终传入 `createAgentSession` 的名单是 `customToolAllowlist`，由预检后的服务端工具和客户端工具再经 `applyEmbeddedCustomToolPolicy` 收窄。事件字段 `passedToSession` 记录这份名单。
- exec / process：包装在 `applyPreflightToTools`。
- 子代理：`src/agents/subagent-spawn.ts:589` 调 gateway `agent`，`src/gateway/server-methods/agent.ts` 进入 `agentCommandFromIngress`，`src/commands/agent.ts` 调用 `runEmbeddedPiAgent`。
- cron：`src/cron/isolated-agent/run.ts:863` 调用同一个 `runEmbeddedPiAgent`。
- Progress Ledger：`createCronLedgerSession` 不调用 `runEmbeddedPiAgent`。
- ConversationTask 旗标默认关闭时，普通回合仍会建预检。

## 未完成

- 跟踪只提供 request-lifetime trace correlation。不提供跨进程恢复或重启后 task replay。后续应把 `taskId`、`attemptNumber`、`primarySkill`、`decisionCode` 和 artifact receipt 写入现有事件/账本，而不是另造日志库。
- 宿主注册了 `json-canvas-structure` 版本 `1`。只有 `OPENBOT_CANARY_VALIDATORS` 包含它时，`json-canvas` 的契约才生效。其他已发布技能没有生产校验器。模型不能注册校验器。进程重启后回执消失，交付失败关闭。没有跨进程 trace。
- `exec` 里的 `mcporter` 是 MCP-shaped command detection only，not independent MCP authorization。系统只能约束 `exec` 这个宿主工具。
- 完成声明只有 `judgeCompletionSend` 一个判定。需要校验器且回执未生效时，流式回调只收到固定进度句；`message`、`sessions_send`、渠道发送和子代理转发在调用传输前拒绝完成句。已经离开进程的旧消息仍然无法撤回。
- 阶段只读技能 frontmatter 的 `execution-stage`。模型正文不能把阶段改成 delivery。未声明时写工具保持原来的默认。
- 定时任务文案把「本次运行已结束」和「交付未通过 / 交付已通过」分开。挂起通知写「这次定时运行已经结束」，不写技能已交付。
- 复数 `required-validators` 与 `required-artifacts` 必须全部满足。四个「校验器 × 产物」绑定少任意一份都不放行。
- attempt 会话锁在 `runEmbeddedPiAgent` 返回时已经解除。延迟交付上下文按 taskId 保留。有效回执只表示允许交付。渠道发送、cron `chat.inject`、子代理转发必须带上本次执行的 taskId；缺少 taskId 时完成声明 fail-closed，不会改用该 session 最新的任务。传输成功后才经 `finalizeDeliveryContext({ taskId, outcome: "delivered" })` 释放该 task。传输失败或完成声明被挡住时不释放。不可重试的执行失败和用户中止使用当前 run 的 taskId，分别记 failed 和 cancelled。provider retry 和 compaction retry 不释放。
- 保留上下文的唯一清扫所有者是 gateway 维护定时器：`startGatewayMaintenanceTimers` 启动一次 `startDeliveryContextSweep`（默认 60 秒，`unref`，重复调用不建第二个 timer）。`createGatewayCloseHandler` 在关闭时停止它。没有后续任务时也会清扫。默认保留 15 分钟，到期原因是 timeout。记录只含 task 标识、原因和计数。
- 跟踪仍是 request-lifetime。`mcporter` 仍不是独立 MCP 授权。已经发出的消息不能撤回。
- `dist/build-info.json` 的 commit 是构建时的 Git SHA，只说明运行包来自哪次提交，不能代替 PR head SHA。
- 没有部署到生产流量。线上构建仍是 `1617926868e64b3d65e1b2f37e488ba6e8fb08f0`。这条分支还不能部署，执行链还没有完成。
