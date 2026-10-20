# 执行前确定性门

## 位置

`buildExecutionPreflight` 在 `src/agents/pi-embedded-runner/run/attempt.ts` 里、工具策略过滤之后、系统提示和模型循环之前跑一次。对话回复和定时任务都经过 `runEmbeddedPiAgent`，所以都经过这一次。它不调用模型，不创建代理，不写进度账本。

## 输入

- 本轮用户文本（已有的 `prompt`）
- 策略过滤后的工具名
- 技能条目的 frontmatter。快照若丢掉 frontmatter，按技能文件路径读一次并缓存
- 可选的入站深度。只有 retrieve 会把意图标成检索
- 现有 `qualifyTurn`。不另写一套任务分类

## 输出

`ExecutionPreflight`：意图类、唯一主技能、别名、候选、允许工具、拒绝工具、可见性（`visible` / `not_visible` / `execution_denied`）、资源范围、交付条件、决定码、给模型的短约束。

意图类只从资格结果映射：

| 资格                                             | 意图           |
| ------------------------------------------------ | -------------- |
| `long_running_candidate`                         | `long_running` |
| 入站深度 retrieve，且不是长程                    | `retrieve`     |
| 主技能声明了确认门，且不是长程                   | `multi_stage`  |
| `short_action` / `reminder` / `scheduled_action` | `short_action` |
| 其余                                             | `chat`         |

`scheduled_action` 和 `reminder` 不会升成 `long_running`。多阶段确认门也不会升成账本任务。

## 硬规则

1. 用户文本里点名的技能优先于触发词。
2. `alias-of` 必须解析到目录里的另一个契约，否则 `skill_alias_unresolved`，写入工具退出候选。
3. 收束后只能有一个主技能。两个互不归属的主技能得到 `skill_ambiguous`。
4. `forbidden-final-engines` 写在契约里。`exec` / `write` / `edit` / `process` 的参数若包含这些记号，抛 `SkillContractViolationError`，分类为不可重试、不可扩大权限。
5. 候选只在进入循环前生成一次。工具步骤不会重扫技能目录。用户的下一句是新的一轮，才会重新 preflight。
6. 不在策略允许集里的工具标 `not_visible`，不会进入模型候选。
7. 策略允许、但契约禁止的工具标 `execution_denied`。
8. 匹配失败不会静默改挂一个相近技能。
9. 绑定提示只复述已经做出的决定。模型文本不能改主技能或权限。
10. 目标不清（资格为 `needs_clarification`）时决定码 `goal_unclear`，只留读取类工具。

没有契约字段的技能保持原样：不收窄工具，也不拦交付。这是故意的，避免把所有闲聊都变成多阶段任务。

## 技能契约字段

写在 SKILL.md 的 frontmatter，扁平字符串，列表用逗号分隔。任意技能都可以用，不是 PPT 专用。

| 字段                                         | 含义                                             |
| -------------------------------------------- | ------------------------------------------------ |
| `alias-of`                                   | 唯一正主                                         |
| `aliases`                                    | 对外别名                                         |
| `primary-engine`                             | 正式引擎                                         |
| `forbidden-final-engines`                    | 禁止当作终版的引擎记号                           |
| `allowed-tools`                              | 非空时与策略允许集取交集                         |
| `forbidden-tools`                            | 从允许集去掉                                     |
| `required-confirmations`                     | 有则把非长程任务标成 `multi_stage`               |
| `required-artifacts` / `delivery-conditions` | 交付要求                                         |
| `delivery-blocked-until`                     | 工具元数据出现该阶段的通过记号之前，不能宣称完成 |
| `triggers`                                   | 没有点名时的触发词                               |

`cyber-ppt` 只声明别名、正式引擎和禁止终版引擎。它不声明 `required-validators`。线上还没有注册生产校验器，所以不能把校验字段写进已发布技能，否则该技能会在预检时变成 `validator_unavailable`。校验能力由测试夹具覆盖。

## 交付

`evaluateDeliveryEvidence`：有 `delivery-blocked-until` 或交付要求时，`validationPassed` 必须为真。文件存在不单独放行。`gateAssistantTexts` 只替换带「完成」声明的句子，分析阶段的原文保留。

通过只认已注册校验器发出的回执。`attempt.ts` 读取本轮 `write` / `edit` 记下的路径，计算 sha256，再交给交付门。没有路径或哈希时决策码是 `delivery_blocked`。哈希不一致时是 `artifact_changed`。校验器未注册时，预检决策码是 `validator_unavailable`，并计入 `readExecutionDecisionCount`，技能在交付前就不可用。模型文本不能充当通过。

跟踪是 request-lifetime trace correlation：同一进程内可按 `taskId` 读回，并写入既有 lifecycle 事件。不提供跨进程恢复或重启后 task replay。后续写入现有事件/账本，不另造日志库。`exec` 里的 `mcporter` 是 MCP-shaped command detection only，不是 independent MCP authorization。

## 观测

preflight 通过现有 `emitAgentEvent` 发生命周期事件，只带 taskId、sessionId、决定码和技能 id。不带用户原文、工具参数、文件正文或凭证。

## 仍不做

- 不新建代理循环。
- 不把 ConversationTask 激活打开。
- 不让影子路由参与选择。
- 不按历史偏好越过权限。
- 技能正文里没有写进契约字段的句子，仍然只是提示，不是闸门。
