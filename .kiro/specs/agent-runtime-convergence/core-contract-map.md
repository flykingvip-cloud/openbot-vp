# M0 核心跨层契约与决定权收敛表

只读核对专用树 `8a7c94c41cf8c0632e086ecf8a4b23f380a5cb34`。Contributor runtime-mainline-audit；Owner codex-runtime-manager。本文为接口设计与迁移建议，不声明目标模块均已实现，不授权改变产品行为。

## 1. 当前迁移事实

`src/agent-runtime` 当前仅有 context 的 assembly、untrusted、aside-budget、sources/collaboration-mission 及测试。已迁移的是纯材料装配、格式、预算算法及完整协作mission投影；并未迁移任务控制、状态仓库、执行器或交付模块。旧适配入口仍有合法职责，不得仅以路径旧就删除。

## 2. 先定身份与作用域，不先合表

| 对象               | 作用域/标识                                   | 权威内容                               | 不得继承的语义                              |
| ------------------ | --------------------------------------------- | -------------------------------------- | ------------------------------------------- |
| 会话任务板         | tenant/user/session + taskId                  | 焦点、目标、约束、停点、控制、任务完成 | 不等同群私有步骤计划，不含通用依赖图        |
| 群共享契约         | RuntimeAuthority + groupId/boardItemId/taskId | 目标/验收/责任、claim、submit、review  | published不等于已执行，accepted不是聊天成功 |
| 执行者私有todolist | boardItemId + owner + todolistId/version      | 确认后的私有步骤、状态与计划门禁       | 主答确认不应强加所有私聊；不能替代共享目标  |
| 运行/作业          | runId/sessionId/attempt/jobId                 | 在途操作、结果、取消与回调             | 不能修改用户目标或凭回调解除暂停            |
| 消息/交付          | messageId/runId/deliveryId                    | 交流来源、输出归属、投递回执           | 回复完成不等于任务验收完成                  |

目前taskId、runId等是不同域语义，应在契约中保留作用域而非统一成一个任意string。禁止新增全局Task表去替换尚未盘清的域存储。

## 3. contracts：跨层应表达什么

以下是逻辑接口名，不要求一次新增所有TypeScript类型或workspace包。

| 契约               | 最小输入/输出                                           | 所有者/硬边界                             |
| ------------------ | ------------------------------------------------------- | ----------------------------------------- |
| TaskReference      | scope + taskId；需要时附boardItemId/owner/planVersion   | 标识关系，不装入Gateway上下文或完整config |
| InboundIntent      | messageId、原文引用、作用目标、关系/控制含义、条件关系  | command解释；不直接执行副作用             |
| AcceptedAmendment  | 原消息身份、expectedTask、变更/完整约束、结果及版本     | state提交；收到/持久化/执行应用必须可区分 |
| ExecutionRequest   | task reference、run/attempt、有效任务快照引用、取消信号 | execution消费；不能把旧快照当最新授权     |
| ExecutionOutcome   | progress/result/wait/failed/cancelled + evidence        | 执行事实，不自动关闭任务                  |
| WaitCondition      | task/job/attempt identity、触发条件、失效条件           | 原恢复机制校验，禁止凭自由文本造新调度    |
| AcceptanceDecision | 满足项、缺口、证据、所验任务/产物版本                   | delivery验收；不能仅凭模型声称成功        |
| DeliveryReceipt    | output身份、渠道、状态、错误、幂等身份                  | delivery；投递失败不能重跑全部业务        |

契约模块只存类型和纯校验；不加载配置、不执行脚本、不读取板、不发事件来驱动新流程。兼容旧类型先用窄适配，不批量重命名所有公共API。

## 4. 各层决定权与现有实现

| 层        | 决定权/公开能力                                        | 当前实现                                                                                       | 缺口与退场条件                                                                                                       |
| --------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| command   | 关联目标、区分查询/修订/控制、提出编排、提交已接受变更 | Gateway focus处理；turn-relation；agent-runner control/aside/amend                             | 分类分散。提取后旧入口只做协议/身份适配，不能保留另一份业务分类                                                      |
| state     | 原子读改写、身份/epoch比较、约束日志、墓碑与焦点事实   | session-task-board.ts 的 commitSameTaskConstraint、mutateSessionTaskBoard、commitBoardMutation | 会话域已有完整锁；群域另用round-store锁。统一的是接口规范，不统一锁/存储对象。禁止各层直接写文件                     |
| execution | 原模型/工具循环、有限续跑、等待恢复请求、取消生命周期  | agent-runner-execution → embedded/CLI；attempt；stall-loop；task-board-continue                | 统一Todo driver未证实，不另加for-todo循环。迁移后旧runner可以适配/reexport，但只能有一份控制实现                     |
| delivery  | 步骤/整体验收职责划分、产物呈现、投递与回执            | turn-completion、rewrite-visible-reply、payload/reply-delivery、artifact；群submit-review      | completion契约不等于task complete或delivery success；先补真实消费者矩阵。旧改写入口保留语言/协议职责，不再拥有控制权 |
| context   | 已解析材料选择、预算、格式与角色/trust归属             | 新context组件 + 原get-reply/source builders                                                    | 只迁已证明纯投影；knowledge/learning含scope与记账不能直接降为string                                                  |
| policy    | 返回分类/允许拒绝/合法转移条件                         | 分散auth/abort/ledger/规则                                                                     | 保留原规则参数与优先级；不能通过任意回调/配置脚本注入控制                                                            |
| wiring    | 按接口接原实现，注入固定依赖                           | 当前入口初始化分散                                                                             | 无业务分支、无插件化任意控制中心；新root不能变巨大总控                                                               |

## 5. 必须分别验收的三个结束点

1. 本回合结束：模型停止/回合契约；原可见回复处理调用settleTurnCompletion。
2. 业务验收：会话checked completion或群accepted；必须绑定相应任务与版本。
3. 成果送达：payload/渠道回执。只有发送动作成功不代表验收；验收成功不证明投递。

恢复亦分回合内stall（有界）、跨回合continue（票据与焦点校验）、协作wake、Cron/Heartbeat、外部作业回调。先标接口，逐域检查，不以统一命名强行同算法。

## 6. 推荐下一完整业务组件：主人当前任务控制事务

建议在M1纯上下文基础后，选择 command 的 owner-current-task-control 作为完整业务切片，而不是再提取通用helper。

现状：`src/auto-reply/reply/agent-runner.ts` 的control分支与`src/gateway/server-methods/chat.ts`的ownerAbort分支都围绕任务板变更、主run abort、aside abort、queue clear和状态回复；板规则已有唯一实现，但副作用衔接横跨入口。先提交两个路径的精确调用顺序矩阵，再决定可提取的共同事务。

组件边界：接收已认证主体与原控制语/任务身份 → 调用原state变更 → 按现有语义请求取消/清队列 → 返回事实回执。状态存储由state拥有；主体认证和chat广播仍在Gateway；runner实际取消仍在原执行模块；不引入第二abort registry。

接口可为 handleOwnerTaskControl(request, dependencies)；dependencies只能源码组装的固定ports，不是配置执行脚本。明确task_missing、paused、cancelled、already_terminal、abort_requested与实际工具已停止的区别，禁止重构顺便改变现有产品状态枚举。

组件完整性：拥有一个可解释的用户业务行为及失败/重试/取消后果，而非一行append；测试真实两个入口的状态和副作用顺序、停止准备窗口、终局隔离、旧唤醒拒绝。若两入口协议差异无法等价，保留薄适配，不强行统一状态机。

旧入口退场：原分支只认证/路由/映射回执；任务变更和停止副作用顺序只有一份实现；新增入口/循环/模型调用为零。数据格式不变、独立提交可revert。必须先通过baseline/candidate差量与Gateway/agent-runner现有停止契约，不把合并生产授权包含在本切片。

## 7. 未完成M0证据

实际启用扩展/环境开关、全渠道交付回执消费者、外部作业的重启恢复、每个completion调用方的身份绑定、SupervisorTaskBoard作用域仍待补证。不能据此关闭M0生产覆盖，也不能凭本文立即删除兼容入口。
