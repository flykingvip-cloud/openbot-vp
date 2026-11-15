# S0 旧规则待退役候选（只列不删）

- 盘点 SHA：`a1433d9e533752e47a01fe8ee9790bcb6c0f0c9f`
- 依据方案 S0：「对旧规则核实原意和消费者，保留不可替代的安全边界；重复控制规则列待退役，不按名称删除。」
- 规则目录原文：`src/agent-runtime/policy/catalog.ts`。目录声明「不是完整运行时清单或开关引擎」；路径只标识实现，从不动态 import。覆盖说明见 `.kiro/specs/agent-runtime-convergence/rule-catalog-coverage.md`。
- 目录钉住的盘点基线 `RULE_CATALOG_INVENTORY_BASELINE=efdb1b98d83e096a31e251095080de954f5883ec`（曾为账本 seq163 的 gateway SHA），**不是**当前源码 SHA，也不是本切片工作树 HEAD。

## 1. 必须保留的安全与生命周期边界（不可按名称删除）

以下目录项在本 SHA 的 `disposition` 均为 `retain`。原意是权限、绑定、回执和取消等硬边界，现仍有消费者。S1–S5 在替代链有证据之前不得退役。

| id | currentOwner | 实现 | 原意（目录／代码） | 主要消费者／执法点 |
| --- | --- | --- | --- | --- |
| `task.binding.current` | policy | `policy/task-binding.ts` | 完成绑定与当前约束的 CAS 式核对 | `before_execution_and_effect`、`completeChecked`、claim 路径 |
| `execution.admitted.binding` | execution | `execution/runner/admitted-turn.ts` | 已准入回合在结果和入口处核对绑定 | `runAdmittedTurn_entry` |
| `interaction.semantic.decision` | command | `command/interpret-interaction.ts` | 语义决定契约；**不得**被遗留 `classifyTurnRelation` 替换 | `route-interaction`、`prepared-interaction` |
| `delivery.receipt.identity` | delivery | `delivery/dispatch/confirm-pending.ts` | 回执身份；不得变成「回复即已送达」 | `confirmPendingTurnDelivery` |
| `execution.lifecycle.preparation` | execution | `execution/runner/execution-lifecycle.ts` | 提供者启动前的受控准备 | 各场景 `createExecutionLifecycle` |
| `task.control.explicit` | policy | `policy/explicit-task-control.ts` | 显式暂停／取消／恢复句法，非推断新工作 | 控制写入前 |
| `task.constraint.owner_gate` / `task.constraints.normalize` | policy | `policy/constraints.ts` | 约束谓词与规范化；看板写入留在 state | 动作前限制 |
| `task.park.abort_inflight` / `task.focus.wake` | policy | `policy/explicit-task-control.ts` | 在途中止与唤醒上限；`classifyTurnRelation` 不得进入 policy | 宿主认领、写入、唤醒 |
| `input.stamp.strip` | policy | `policy/input-stamp.ts` | 入站文本规范化的权威实现 | focus-switch 再导出；对话状态在样本等价后委托 |
| `task.acceptance.checks` | policy | `policy/acceptance-checks.ts` | 验收检查解析，未知算子失败关闭 | 持久化验收契约前 |
| `execution.retry.bounds` / `execution.continuation.bounds` / `execution.queue.action` / `execution.blocker.grade` / `model.context_window.guard` / `interaction.source.recoverable` | policy | 对应 policy 文件 | 重试、续跑、排队动作、障碍分级、窗口、可恢复源错误 | 各执行／交互准备点 |
| `execution.async_wait.job_transition` / `execution.queue.claim` | state | async-wait 与 `claim-queued-execution.ts` | 等待作业身份／认领篱笆；协作路径不得因 ClaimContract 跳过绑定 | 恢复与排队 |
| `collab.policy.compile` / `collab.submit.review_versioning` / `collab.governance.gate` / `collab.peer.review_gate` / `collab.plan.gate` | policy | `collaboration-compile.ts`、`collaboration-rules.ts` | 协作编译与闸门是 policy 决定；IO 与认领锁留在宿主。目录写明不新增确认模式、不改默认关闭开关 | 组正式入口与审查 |

商业身份、预算和工具授权（`tryAcquireEnterpriseAgentRun`、模型门禁、capabilities）同样继续生效，不在待退役之列。

## 2. 目录已标记 pending_migration（待退役候选，不删除）

| id | currentOwner | 实现 | 目录给出的退役条件／边界 | 本 SHA 仍需保留的原因 |
| --- | --- | --- | --- | --- |
| `task.focus.switch` | conversation-task | `src/conversation-task/focus-switch.ts` | stamp 剥离已委托 policy；标题文案委托 context；转录 IO 留在该适配器；无外部消费者的启发式保持局部 | 仍是会话焦点切换适配器，未证明消费者为零 |
| `task.reply.completion` | conversation-task | `src/conversation-task/reply-completion.ts` | 编排留在 conversation-task 适配器；看板写入只经 state；不要把 ConversationTask、ledger 与 SessionTaskBoard 硬合并 | 仍承担回复完成编排 |

## 3. 重复控制规则（待退役候选，不按名称删除）

这些不是目录里的 `retain` 安全边界，而是与已经收口的语义决定／正式入口并行的旧控制。

| 规则／符号 | 位置 | 原意 | 本 SHA 消费者 | 为何列为待退役而非立即删除 |
| --- | --- | --- | --- | --- |
| `classifyDiscussToTaskIntent` | `src/gateway/collaboration-learning/discuss-to-task-classify.ts` | 用动词／团队词／交付条款做正式委派分类 | `controlledDiscussToTask` 在非「已有语义字段」的遗留显式 API 路径上仍调用（约第 252 行），用于字段提取；配套 `discuss-to-task-classify.test.ts` 仍在 | 群 chat hook（`discuss-to-task-chat-hook.ts` 第 51–57 行）已禁止缺决定时词法回退，且仅 `execution_request` + `long_task` 才正式建板。分类器不再是群入口的权威门禁，但显式 API 与测试仍依赖它。删除前须证明无生产／恢复消费者 |
| `classifyTurnRelation` | `src/conversation-task/turn-relation.ts` | 把用户文本与当前目标的关系分成 conversation／amend／new_work 等 | `src/task-orchestration/complex-task-loop.ts` 第 186 行仍调用；自身测试仍在。policy 目录多次写明它必须留在 policy 之外，且不得替换 `interaction.semantic.decision` | 与 command 语义决定并行的旧关系分类；在 orchestration 消费者清零并有替代证据前保留 |
| 旧讨论分类回退逻辑（已切断的行为，代码残留需跟踪） | 历史 `discuss-to-task` 关键词建板 | 无决定时回退关键词 | hook 已改为缺决定抛错 | 行为已改变，函数未删；防止后续「兼容」再次接通 |

方案 S5 还要求：删除对象必须同时满足原意已核准、无生产消费者／恢复资产依赖、替代链有证据；保留 CLI／embedded 能力后端；**不批量删除** hooks／Lobster／OpenProse。这些不在 S0 删除范围，也不在本候选表中当作已经批准删除。

## 4. 本切片未做的事

- 未删除、重命名或注释掉任何上述规则。
- 未把目录 `retain` 项改成 `review_for_retirement`。
- 未宣称运行已贯通，因此也没有任何旧控制分支达到方案第 9 节的退役条件。
