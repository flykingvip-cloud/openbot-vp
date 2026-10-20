# 执行决策责任矩阵

唯一执行器仍然是 `runEmbeddedPiAgent`。本矩阵不新增路由器。重复判断以左列模块为准，其他模块不得再做同一决定。

| 层            | 唯一模块                                                                                         | 只能负责                                            | 不得负责                                   |
| ------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------ |
| 能力目录      | `src/agents/tool-catalog.ts`                                                                     | 工具身份、读写模式、副作用级别                      | 用户授权、任务排序                         |
| 会话/频道策略 | `src/agents/tool-policy-pipeline.ts` 与频道工具策略                                              | 当前上下文可见哪些工具                              | 主机路径、资源是否可读                     |
| 入站天花板    | `src/agents/inbound-tool-policy.ts`                                                              | 仅当开关打开且深度为 retrieve/chat 时收窄已可见工具 | 默认关闭时不要假设它在过滤；不替代技能契约 |
| 技能策略      | `src/agents/skills/skill-policy.ts`                                                              | 技能能否进入本轮目录                                | 资源授权、审批、换引擎                     |
| 主技能绑定    | `src/agents/execution-preflight/`                                                                | 别名收成一个主技能，生成允许工具集和禁止引擎        | 第二套执行器；不重新实现 allow/deny        |
| 资源授权      | 工作区与 `src/gateway/workspace/`、`src/gateway/context-scope/`                                  | 哪些文件、数据和账号可读写                          | 工具是否存在、重试次数                     |
| 执行审批      | `src/infra/exec-approvals.ts` `requiresExecApproval`                                             | 这一次高风险动作是否获批                            | 永久扩大 allowlist                         |
| 任务编排      | 现有代理循环；长程只附加焦点提示                                                                 | 顺序、去重、停止。焦点门只要求用户选择，失败则放行  | 重写 ACL，不另起循环                       |
| 重试策略      | `classifyExecutionFailure` 决定可否重试；`runAgentTurnWithFallback` 只执行它允许的瞬时 HTTP 重试 | 技术失败是否重试                                    | 把权限失败升级成重试或扩权                 |
| 交付层        | `evaluateDeliveryEvidence` / `gateAssistantTexts`                                                | 有没有验收证据才允许完成声明                        | 重决工具权限或重试                         |
| 任务账本      | `src/progress-ledger/cron-binding.ts`                                                            | 进度、验收项、恢复状态                              | 代替代理执行器                             |
| 对话长程识别  | `src/conversation-task/`                                                                         | 纯分类。激活默认关闭，不创建任务                    | 第二套执行器                               |
| 影子路由      | `packages/toolkit/src/execution-router/`                                                         | 观察。编译期不记录、不改路由                        | 生产选技能或放权                           |

## 同一件事只留一个主人

| 决定                   | 主人                                                                                | 降级                                                      |
| ---------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 工具是否可见           | 工具策略管线                                                                        | 影子打分不得把不可见工具加回来                            |
| 工具可见但这次不能执行 | preflight 的 `execution_denied`，以及入站天花板在开关打开时的执行包装               | 不把「不可见」和「拒绝执行」写成同一个错误                |
| 主技能是谁             | preflight，别名必须落到唯一 `alias-of`                                              | 提示词里的「请改走某技能」不再单独算数                    |
| 能否重试               | `classifyExecutionFailure`                                                          | 模型不得因为失败就扩大权限                                |
| 能否说完成             | 交付门。契约要求校验器时，必须有绑定当前产物哈希的受信任回执                        | 文件写成功不算完成                                        |
| 是否长程任务           | `qualifyTurn` 的 `long_running_candidate`。一次性多阶段只标 `multi_stage`，不建账本 | 进度账本不接管没有目标+验收条的定时任务，也不接管普通对话 |

## 失败类与责任

| 类                                                    | 重试             | 主人                                                   |
| ----------------------------------------------------- | ---------------- | ------------------------------------------------------ |
| `transient_failure`、部分 `timeout`                   | 可以，由重试策略 | `runAgentTurnWithFallback` 只在分类允许时重试一次 HTTP |
| `approval_required`                                   | 否，进入审批     | `requiresExecApproval`                                 |
| `approval_denied`                                     | 否，不换工具绕过 | 审批结果                                               |
| `authorization_denied`                                | 否，不扩权       | 工具策略 / 入站天花板                                  |
| `resource_out_of_scope`                               | 否，告诉用户缺口 | 工作区授权                                             |
| `skill_contract_violation`                            | 否，回到契约     | preflight 对 exec/write/edit/process 的包装            |
| `validation_failed`                                   | 否，停在当前阶段 | 交付门                                                 |
| `permanent_failure`、目标不清、技能禁用、别名无法收束 | 否，用户可见阻塞 | preflight                                              |
