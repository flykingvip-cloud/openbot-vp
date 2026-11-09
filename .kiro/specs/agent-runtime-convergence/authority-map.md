# M0 主线与权威对象审计

负责人 codex-runtime-manager；contributor runtime-mainline-audit。核对提交 `2ea87d9d6fbafa6384710ca65931b83c86fdf871`。静态只读审计，未验证生产配置，不是新执行器实施规格。

## 实际主链

Gateway chat.send（focus/control）→ dispatchInboundMessage → runPreparedReply → runReplyAgent。后者分流 control（板原子变更/abort/清队列）、progress/board_readonly、aside（临时禁工具 session）、amend（持久化/steering）及 normal/followup。正常执行经 runAgentTurnWithFallback → CLI 或 runEmbeddedPiAgent → attempt 的模型工具循环 → 有限续跑 → 可见回复/完成契约 → payload/可选 complex-task shaping → 合法未完成任务续醒并回原队列。

| 定位                     | 当前代码                                                             |
| ------------------------ | -------------------------------------------------------------------- |
| 入站追踪、控制、dispatch | `src/gateway/server-methods/chat.ts:6060`、`:6144`、`:6468`          |
| 准备/调用                | `src/auto-reply/reply/get-reply-run.ts:377`、`:1695`                 |
| 分流、运行、后处理       | `src/auto-reply/reply/agent-runner.ts:136`、`:633`、`:1257`、`:1278` |
| fallback、CLI、embedded  | `src/auto-reply/reply/agent-runner-execution.ts:641`、`:716`、`:907` |
| 有限续跑、可见处理       | `src/agents/pi-embedded-runner/run/attempt.ts:2675`、`:2781`         |
| 回合完成契约             | `src/agents/pi-embedded-runner/run/rewrite-visible-reply.ts:243`     |

## 权威对象

| 对象                    | 权威事实/作用域                                                                                                                   | 不应推断                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| SessionTaskBoard        | 会话焦点、当前/挂起目标、完整约束、停点、取消墓碑、续醒抑制；`src/conversation-task/session-task-board.ts:44`、`:690`             | 不是完整步骤/依赖 TodoList driver    |
| Group ClaimContract     | 群共享目标/验收/约束、领取提交审核及责任；`src/gateway/collaboration-dispatch/claim-contract.ts:1`                                | 不等同私聊焦点，不取代执行者计划     |
| ExecutorPrivateTodolist | board item + owner 私有步骤，propose/confirm/revise/version；`src/gateway/collaboration-dispatch/executor-private-todolist.ts:54` | 不能强加给所有私聊主答确认流程       |
| 模型计划                | 原工具循环提出下一动作                                                                                                            | 非持久权威事实，不授予权限或解除暂停 |
| 运行/队列               | 活动 run、取消、消息递送、在途结果                                                                                                | 不决定用户目标或证明验收             |

协作 task bag：`executor-private-todolist.ts:942`，`:1007` confirmed/current step gate，`:1062` prompt投影。下一动作目前主要由模型提出，分散门禁控制准入/续跑/恢复。未证实贯穿私聊与协作的统一结构化步骤选择器。

## 完成与恢复决定权

| 决定                                     | 位置                                                                                | 边界                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 回合 delivered/permanent_block/true_fork | `src/agents/turn-completion/contract.ts`                                            | 不等于整任务投递成功                                              |
| 会话任务完成落盘                         | `session-task-board.ts:1103` recordCheckedTaskCompletion、`:1217` finishCurrentTask | 支持身份/attempt/version检查，逐调用方是否传足待核实              |
| 可选 complex-task 验收                   | `src/task-orchestration/complex-task-loop.ts:239`、`:280`                           | 可调用 checked completion；实际门禁待核实，不是独立派发循环       |
| 协作提交验收                             | `claim-contract.ts:1`                                                               | submission/version/actor状态；草稿≠提交，私聊delivered≠群accepted |
| 回合内续跑                               | `src/agents/execution-stall-continue.ts`、`execution-stall-continue-loop.ts`        | 保留取消/超时/协议/额度                                           |
| 跨回合续醒                               | `src/conversation-task/task-board-continue.ts:134`、`:163`、`:303`、`:349`          | taskId/focusRevision/抑制/墓碑重查后入原队列，窗口cap见`:24`      |
| 停止                                     | Gateway控制适配＋agent-runner控制适配＋原abort                                      | 共享语义，禁止复制第三套控制规则                                  |
| 投递                                     | payload/reply-delivery/渠道回执                                                     | 与验收、任务关闭分开，完整消费者待补                              |

## 目标结构映射

上层：Gateway focus、turn-relation、agent-runner分流。左列：原fallback/embedded/continue链。上下文供给：get-reply-run、focus-resume、aside history、system prompt及记忆知识。动作供给：pi-tools、插件/MCP、CLI/browser/node。交付：completion、payload、reply-delivery、artifact。公共机制：auth/abort/ledger/版本。现状风险是职责交杂和完成语义混用，不因多个模块存在即认定重复执行器。

## 首切片建议

先提取正常回复上下文装配契约，保留原来源实现和调用顺序。对照prompt片段/角色/预算/不可信边界；新接口承接后删除旧拼接位置。独立提交可回退，不改数据、不另包Todo循环、不先搬attempt大文件。

## 待核实

生产有效开关与hook/plugin/transform/外部流程启用清单；全渠道与协作完成/投递消费者；异步作业taskId/attempt及重启恢复；SupervisorTaskBoard与其余对象的作用域映射。不得据本审计删除群板、另建统一表或宣称生产全覆盖。Gateway AGENTS要求转录经SessionManager写入，禁止raw JSONL append。

## 投递覆盖边界

已知消息投递实现位于 src/auto-reply/reply/reply-delivery.ts，运行输出经 payload 组织进入原投递回调。渠道最终发送与回执尚未逐渠道审计，不能据此宣称全渠道交付完成语义已统一；该缺口不属于 M1 纯上下文提取。
