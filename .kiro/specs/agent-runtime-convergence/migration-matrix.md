# Agent Runtime 全目标目录迁移矩阵（只读计划）

核对树：runtime-convergence/openbot；HEAD `8a7c94c41cf8c0632e086ecf8a4b23f380a5cb34`。本文件不是“已迁移”报告。

## 真实进度

只有 context 四个组件局部落位：`assembly.ts`、`untrusted.ts`、`aside-budget.ts`、`sources/collaboration-mission.ts`（各含测试）。get-reply-run、history、runtime-context-assembly有真实消费者接入。**contracts/command/execution/delivery/capabilities/policy/state/wiring 尚未迁移为目标组件。** 整体context来源读取、记账及装配仍在旧入口，不可标记context层完成。

## 矩阵

| 目标         | 原实现/事实                                                                                                      | 目标与最小接口方向                                                                                                             | 消费者迁移                                                                   | 旧退场条件                                                   | 专项验证                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| contracts    | `conversation-task/session-task-board.ts:23–127`类型；pi runner params/result；reply payload类型                 | 只提跨边界必需task/message/run identity、context/capability/result DTO；先type-only，不造万能RuntimeContext                    | 原模块type re-export→调用方type import；保留旧路径兼容                       | type定义单源；旧路径只re-export，评估外部SDK消费者后再删     | tsgo差量；公开export快照；无runtime循环依赖                             |
| command      | `gateway/server-methods/chat.ts`入站；`turn-relation.ts`；`agent-runner.ts`控制/查询/amend/aside分支；focus gate | command/intake、interpretation、amendments/dialogue；输入消息+可信身份+task snapshot，输出处理结果/提交请求；Gateway仍适配协议 | chat/get-reply调用窄用例；reply_lane工具禁用和消息身份沿用                   | 被迁分支从旧函数删除，旧入口仅delegate；不保留第二分类器     | 真实chat.send、进度/aside、混合句、控制优先、A/B隔离                    |
| execution    | `agent-runner-execution.ts`，`pi-embedded-runner/run.ts`，`run/attempt.ts`，stall loop/task-board-continue       | runner facade（原实现为唯一内核）；步骤请求/标准结果、AbortSignal、等待回执；恢复仍原队列入口                                  | command调用执行port；平台model/billing adapter注入；先剥离非执行职责再搬目录 | 原循环不复制；旧run入口兼容delegate，下一步决定权唯一        | 工具循环、fallback/compaction、超时、取消、quota、重复回调、重启恢复    |
| delivery     | `rewrite-visible-reply.ts`、turn-completion、run/payloads、reply-delivery、preview/artifact                      | acceptance/presentation/dispatch/artifacts；StepResult与任务验收证据→DeliveryResult；展示不改任务控制                          | runner返回标准候选结果；原channel调用delivery port                           | 拆分结果整形/验收后旧混合分支删除；旧消息接口仍兼容          | partial/block/payload、真实成果有效性、投递失败、重复交付、A/B final    |
| context      | 当前4组件已局部迁；余下get-reply-run，knowledge/learning/identity/session-continuity                             | source adapter负责IO/receipt，纯render负责投影，assembly维护placement/order/budget                                             | 来源逐个迁入或经port接入；原求值时点保持                                     | 每来源唯一实现、旧函数仅delegate；不得旧新双重注入           | prompt字节与顺序、source调用次数、trust、budget、exposure账             |
| capabilities | `agents/pi-tools.ts`、各tool、plugin loader、MCP/connector；composer host执行                                    | catalog/invocation/adapters：能力ID+schema+权限/副作用/取消/异步/幂等元数据；原能力实现保留                                    | runner/tool assembly调用统一接口；plugins实现受控port                        | 原tool factory/adapter单源；任何工作流控制明确退出或声明治理 | 工具wrapper顺序、workspace guard、before-call、abort、sandbox与插件回归 |
| policy       | turn-relation判定；工具过滤、授权、预算/版本/幂等；各停止门禁                                                    | classification/authorization/transitions/limits；纯决策结果+reason，副作用留业务用例                                           | 多检查点调用同规则；不把授权服务整体挪入policy                               | 同语义旧正则/分支替换删除；不得另加仲裁层                    | 冲突矩阵、deny优先、历史词不误触、失效任务/作业拒绝                     |
| state        | SessionTaskBoard锁内RMW、约束log、墓碑、epoch；协作todolist是另一域                                              | repository/mutations；先明确任务域，不把协作board强拼；read/mutate接口保留原锁                                                 | command/execution/delivery通过受控mutation；禁止文件写入                     | 唯一实现与锁；schema兼容旧记录；测试seed非生产               | 跨进程约束×pause/cancel/finish/switch、stale epoch、旧数据恢复          |
| wiring       | get-reply-run/agent-runner及gateway中依赖连接与业务混杂                                                          | composition root仅提供ports与实现；不判断业务、不规划、不调工具                                                                | 新组件使用窄port；旧入口成为组合root或协议adapter                            | 被提取业务分支退出root；root预算自动守门                     | composition-root LOC、manifest、真实入口行为、不引入第二服务容器        |

## 先后依赖

1. contracts按具体切片需求提type→state权威/任务域先定→command能只依赖窄state port。
2. context继续完整source边界提取，与能力元数据可并行；但IO/exposure/执行动作不混到pure context。
3. capabilities/公共policy边界明确后，再拆execution依赖；**不先重写attempt**。
4. delivery的纯payload/呈现可先提取，整体acceptance须与state/任务契约对齐。
5. wiring由每次真实调用替换自然形成，不能预建空框架等待填充。
6. 全局按一条完整调用路径迁移，目录顺序不是要求一次搬完某层。

## 首个完整纵向切片：当前任务进度查询

选择已存在只读task-board进度问，不是新增“统一todolist引擎”。路径：chat.send→原focus处理→command progress用例→state read port→纯context状态投影→delivery payload→原Gateway/UI。

A. contracts提取窄TaskProgressSnapshot（taskId、title、unfinished、stopSummary、wakeSuppressed；不复制完整板）。
B. state adapter用原readSessionTaskBoard生成snapshot；read-only，不造新缓存。
C. command只调用原isProgressStatusQuery，不能新造第二正则；需要迁移则原函数delegate。
D. context迁原formatTaskBoardProgressReply为纯投影，保持最近记录措辞与原文本。
E. delivery复用现有payload返回，不添加progress专属投递器。
F. wiring在原agent-runner接入port，删除原read/format分支主体，保留同一时点和触发条件。
G. 验证真实runReplyAgent与Gateway：活动A不被取消/写板，消息答复身份属于B，system上下文不新增，A/B任意先终局不误清。

这条切片的完整性是“一条用户请求贯穿到交付”，不是每层必须新建文件。无需提取时明确复用原adapter即可。不得为七层齐全造7个空wrapper。

## 所有切片统一完成门槛

- 标明原实现→新实现→消费者替换→旧实现退出；没有真实消费者不计迁移。
- 区分控制权迁移、纯代码提取、行为修复；不同提交，不能将架构清理和功能补齐揉一起。
- 任务语义/权限/取消/回执不变；需修行为先失败用例和授权范围。
- 既有manifest/AOR/组合root/渠道无关性检查复用，不增加治理框架。
- 定向测试+23文件联合场景按影响扩展；格式/lint/type零新增；build动态import增量零。
- 回退为单切片revert；不对运行数据不可逆迁移；不长期双写/双控制；插件与脚本入口退役先核实真实consumer。

## 仍待核实

主任务步骤选择当前是否完全有结构化待办依据、协作todolist与会话任务板的法定边界、所有异步作业跨重启恢复、plugins/hooks/Lobster有效启用。不得因为目标图有框就宣布已有或直接补另一引擎。

## Current checkpoint update

The inventory above records the pre-contract extraction baseline. The current candidate moves only existing SessionTaskBoard data types to src/agent-runtime/contracts/task.ts, with type-only compatibility exports in the existing owner. Contracts is PARTIAL: no new universal task schema, no message/execution/capability/events contract migration. Context remains PARTIAL. Command, execution, delivery, capabilities, policy, state and wiring remain NOT MIGRATED. Functional availability does not equal architectural migration.

Command is now PARTIAL through the read-only current-task status query use case (ddc52146f). Existing controller ordering and absent-current fallback are preserved. Focus text rendering still adapts the original board formatter; do not claim the entire layer is decoupled.

Command additionally owns the active-task amendment transaction (8906041c7), with effects injected by the existing runner. This removes duplicated inline transaction flow, not the existing authority/policy gate. Control, general interpretation and planning remain outside the migrated component.

Current-task control is partially migrated through the agent-runner transaction component. Gateway control stays in its original async protocol path. Neither state persistence nor the underlying abort mechanisms have moved; no claim of a fully independent command/state layer.

Gateway stop execution is now delegated to a command use case (036e9a66b), while protocol/partial transcript/final delivery remain at Gateway. The existing async-vs-sync control differences are explicit rather than flattened. command remains PARTIAL; no broader execution/delivery/state migration is implied.

Execution is now PARTIAL through bounded in-turn stall recovery (ac0f448e1). It is not a full runner facade: original Pi runner, failover, compaction, ledgers and cross-turn wake retain their original owners. Narrow legacy policy dependencies are explicit migration debt.

Execution preparation is PARTIAL through the original embedded parameter projection (7878b9bf9), with a separate preparation public entry. This does not migrate commercial admission, fallback, model transport, provider invocation or result accounting; legacy input/identity dependencies remain.
