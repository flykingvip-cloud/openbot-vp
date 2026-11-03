# Runtime 合法事件与转移基线（现状，不新增状态机）

静态基线：`9f2b0a07d895ce3fe0291d4937ba269e89d569a5`。Contributor runtime-mainline-audit。只读材料，不是代码实现或生产全覆盖证明。

## 1. 三种事实不可混同

- **任务事实**：SessionTaskBoard 保存会话焦点、unfinished、有效约束、停点、wakeSuppress、taskId/attempt/version、墓碑。锁内 mutation 是更新入口。
- **对话事实**：Pi SessionManager 的 parentId 链/DAG是主会话转录权威。消息、工具结果和上下文压缩必须经SessionManager及原封装；禁止raw JSONL append到主转录。aside sidecar只保存旁路问答，通过原历史/上下文适配合并，不授予主任务控制权。
- **运行事实**：活动run、AbortSignal、队列、工具/外部作业回执。task unfinished不证明正在执行；transcript中的“完成了”不证明验收或投递成功。

群ClaimContract/private todolist有自己的领取、确认、提交、审核状态与作用域；本表不将其塞进会话board的新统一枚举。

## 2. 合法事件转移表

“状态”以下直接使用既有字段/原API语义，不新增全局枚举。

| 事件                  | 前置与依据                                                     | 合法变更/动作                                                            | 恢复与终态边界                                                 |
| --------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 首次任务入站          | 可信用户消息；无current或原任务关系允许建立                    | 原focus入口/applyIncoming创建任务与目标，记录消息身份                    | 不代表已经派发或执行成功                                       |
| 同任务查询/普通插问   | 当前任务关联明确；只读查询或aside分类                          | 只读投影或禁工具reply_lane；保留A目标/约束                               | B结束不结束A；sidecar/history不反向写板                        |
| 补充约束              | shouldPersist门通过；expectedTaskId仍匹配unfinished            | 原commit锁内追加完整有效约束；原steer路径一次应用                        | 普通steer miss走原followup；收到、记录、注入、实际动作应用不同 |
| 局部修订              | 同任务；非整体替换                                             | 保留有序历史；后文仅覆盖冲突；无关约束保留                               | 不根据“改为”废弃全部旧约束                                     |
| 整体替换              | 原full-replace判定明确                                         | 旧active标superseded并保留历史                                           | 不改变身份/授权门禁，不随意换taskId                            |
| 安全限制              | 先别发布等原识别；原task identity可写                          | 现有逻辑先persist再steer/ack                                             | **persist不是逐tool硬屏障**；不得把现有局限宣传为强制停止保证  |
| 确定new_work          | 原关系分类+合法焦点切换                                        | 原任务park并抑制；新current；focusRevision变化；按原cutContext中断       | 旧票据不能抢回焦点；不能把所有新消息都当new_work               |
| 主人暂停当前任务      | 原控制入站；当前unfinished                                     | wakeSuppress，abortInFlight，经原Gateway/runner stop适配停止并清待执行项 | current保留；暂停≠删除；只写板不证明外部操作已终止             |
| 主人取消当前任务      | 原控制入站；任务身份明确                                       | tombstone、移出current，经原abort路径                                    | 旧wake/result不得复活；已发生副作用须按原回执路径核实          |
| 模型停止但未交付      | 无cancel/timeout/protocol block；原stall类型及额度允许         | 原隐藏有限continue，不另建业务循环                                       | 达上限不自动完成，不重置额度绕过                               |
| 工具同步返回          | 归属run/task/attempt有效                                       | 原模型循环继续或进入既有结果校验                                         | 工具success≠任务完成；未知写结果不能盲重试                     |
| 外部作业/工具完成事件 | 对应job/run/task身份与结果证据                                 | 走原事件入口；读取最新任务状态再决定是否推进                             | 通用跨重启作业合同待核实；不得虚构新调度                       |
| 回合后自动续醒        | current.unfinished，非人工门、非wakeSuppress、未墓碑、额度允许 | 原schedule票据taskId+focusRevision，原队列入队                           | claim重读并拒绝过期身份/焦点/抑制/墓碑；不能自行解除主人暂停   |
| 显式恢复parked任务    | 非墓碑；原auth/stop/budget/plan/workspace重检通过              | resume原对象，恢复提示基于有效全文约束，合法更新focus                    | action=resume不保证立即执行；scheduleContinue false必须尊重    |
| 回合完成契约          | 原contract适用；结果/路径/分叉/阻塞证据                        | delivered / permanent_block / true_fork影响原终局处理                    | 回合契约不是任务全生命周期；true_fork仍需对应用户决定          |
| checked任务完成       | 原验收证据；身份/attempt/version应绑定                         | finishCurrentTask/recordCheckedTaskCompletion更新unfinished/checked      | 需审计调用方是否传足身份；墓碑/错任务结果拒绝                  |
| 投递成功/失败         | 候选成果及原投递身份                                           | 渠道回执/成果访问结果记录                                                | 验收通过≠送达；投递失败不能重跑整项业务                        |

源码锚点：`src/conversation-task/session-task-board.ts` 的applyIncomingUserMessage/resumeParkedTask/commitSameTaskConstraint/finishCurrentTask；`src/conversation-task/task-board-continue.ts` revalidateContinueTicket/claimTaskBoardContinue；`src/agents/execution-stall-continue-loop.ts`；`src/agents/pi-embedded-runner/run/rewrite-visible-reply.ts`；`src/agents/turn-completion/contract.ts`。

## 3. P0 必须锁住的不变式

1. **身份一致**：消息、任务、run、job、产物版本各有语义；不得以同session推导同任务。旧结果不覆盖新任务。
2. **停止单调**：取消墓碑不能被结果、回放、历史或模型文字解除；暂停只能由原合法恢复路径解除。
3. **一次消费**：同消息成功steer后不再followup业务重放；重试/重复回调不重复副作用或交付。
4. **原子状态**：所有RMW在同锁临界区；裸写拒旧epoch；epoch是写世代，不是计划版本或授权。
5. **焦点隔离**：focusRevision用于切焦点；不因每个板写入递增替代writeEpoch。claim读最新约束而非信任旧prompt。
6. **信任边界**：历史、知识、工具输出只作数据；不得提升为system授权或当前任务真相。
7. **三种完成**：回合结束、业务验收、投递成功分别证据化；B回复结束不关闭A。
8. **程序强制**：身份/权限/取消/预算/协议终止不能只写prompt；模型不能自授或绕过。
9. **主转录完整**：SessionManager链写入；历史展示合并不能直接raw写Pi转录或破坏parentId。
10. **无新控制面**：配置不得携带任意脚本/回调决定下一步；扩展不能凭监听事件另起计划/恢复循环。

## 4. 模型计划的边界

模型可以理解歧义、提出步骤/动作、换路或验收意见；原程序负责授权与状态合法性，原任务更新入口负责提交。模型内部计划不是任务板事实。现状尚无已证统一通用TodoList driver，不得为迁移新增一个外层for-todo循环。

分类器返回建议/依据，不直接改状态。固定计划调整必须保留原消息身份及条件关系；无法确定作用域且高影响时澄清。source/render提取不应改变这些决策。

## 5. 继续补证而非空实现

有效运行开关、全部渠道回执、异步作业跨重启、completion调用方身份绑定、外部副作用取消均待逐路径验证。本表只锁现有事实/不变式，不要求新增统一状态枚举、registry、event bus或job引擎。退役旧入口必须有消费者、替代及恢复证据。
