# T1 执行权威与消费者盘点（execution-authority-inventory）

- 日期：2026-11-09（Asia/Shanghai）
- 分支：`codex/openbot/runtime-authority-closure`
- 开工 / 抽核 SHA：`efdb1b98d83e096a31e251095080de954f5883ec`（含已合入 `#250` / `#252` 的最新 `origin/main` tip）
- 性质：**T1 规格盘点**；不改业务代码；不构成实施授权或上线证据。
- 实施权威：`execution-authority-closure-plan-2026-11-09.md`；冲突时用方案「先核准后迁移」。
- 输入盘点：`individual-policy-state-closure-slices-2026-11-09.md`、`collab-policy-state-migration-boundary-2026-11-09.md`（定位基线旧 tip；本表以 **main 现役** 为准）。
- 检索覆盖：`src/`、`extensions/`、`scripts/`、配置 schema（`src/config/*`）；区分产品调用 / 测试 / re-export / 动态加载。
- 避免重复施工：`#250`（`cf364161a`）、`#252`（`45c6c227c`）均已是 tip 祖先；已在 `agent-runtime` 的机制标 **已在 main / 接续**，不建议从合入前 tip 重做。

## 0. 必须核实结论（efdb1b98d）

| 项 | 结论（本 tip） | 证据 |
| --- | --- | --- |
| `classifyTurnRelation` 生产调用点 | **仅** `src/task-orchestration/complex-task-loop.ts:186`（`applyComplexTaskLoop` 内）。Gateway **不**调用。`shapeAdmittedComplexTaskReply` / `applyComplexTaskLoop` 在非测试生产源码中 **未见 importer**；再叠加 orchestration `dispatch` 默认 OFF + 租户 allowlist 空 ⇒ **观察/休眠路径，非现役主链**。 | `rg` + `task-orchestration/feature.ts` / `observe-gate.ts` / `index.ts` |
| Gateway `shouldTaskParkAbortInFlight` | **现役主链安全谓词**：`src/gateway/server-methods/chat.ts:6142` import 自 `conversation-task/turn-relation.js`。 | `chat.ts:68`、`:6142` |
| `reply-completion` 关闭顺序 | 在 `observeConversationTaskReplyCompleted` 成功路径：先 `store.transitionTask(task.id, "closed")`（`:291`），随后 `recordCheckedTaskCompletion({… closed:true …})`（`:292–296`）。整段受 CTR `activation` flag 门控（默认 OFF）。存在「ConversationTask 已 closed、Session 板完成未落」窗口，**不证明现网已故障**，须 T4 失败注入核准。 | `reply-completion.ts:203–306`；`feature.ts` activation env |
| `MAX_PARKED_SLOTS` vs `MAX_PARKED_TASKS` | **数值均为 3，语义不同，不可因相等合并。** `MAX_PARKED_SLOTS`（`focus-policy.ts:11`）注释明确为 **执行槽位**（FOCUS/PARKED scheduling）；`MAX_PARKED_TASKS`（`policy/task-board-limits.ts:2`）为 **会话任务板 parked 容量**（`state/mutations/task-record.ts` `parkTask` 截断/归档）。 | 定义与调用点 |
| `stripInboundStamp` 双源 | **仍多源**：① `agent-runtime/policy/input-stamp.ts`（权威；`turn-relation` / `session-task-board` / 若干 state 已 import）；② `conversation-task/focus-switch.ts:173` **本地副本**（同正则）；③ `command/task-status.ts` 的 `stripInboundStampForDialogue`（同正则，对话窄用）。样本字节上看正则相同，**行为等价未做输入矩阵证明前不得删副本**。 | 三处 `INBOUND_STAMP_RE` |
| `#250/#252` 合入后已收敛 | 见 §2；对照方案 §4：个体绑定/板事务/async-wait/投递确认/`runAdmittedTurn`/`interpretInteraction` 等 **已在 main**；turn-relation 拆分、focus-wake、reply 完成窗口、协作 policy/state **仍分散**。方案抽核 tip `e3fef11c8` **不是** 本 tip 祖先（历史参考 only）。 | `git merge-base`；目录现状 |

路径类型标注：`现役主链` / `可选路径` / `观察路径` / `无消费者遗留` / `已在 main 接续` / `证据不足`。

---

## 1. 行为权威表

列：`行为ID | 定义 | 生产消费者 | 测试消费者 | 配置/flag | 读状态 | 写入口 | 锁/CAS | 副作用 | 当前权威 | 目标权威 | 处置`

### 1.1 交互解释 / 准入 / 修订

| 行为ID | 定义 | 生产消费者 | 测试消费者 | 配置/flag | 读状态 | 写入口 | 锁/CAS | 副作用 | 当前权威 | 目标权威 | 处置 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INT-INTERPRET | 入站语义解释（查询/控制/修订/新工作等） | `command/route-interaction.ts` → `interpret-interaction.ts`；经 `prepared-interaction` / wiring `interaction-turn` | `interpret-interaction.test.ts`、`route-interaction.test.ts` | 无独立 master；走 command 路径 | 可选 task snapshot / 板只读 | 不直接写板；产出 decision | 无 | 无 IO | **已在 main**：`agent-runtime/command/interpret-interaction.ts` | command | **已在 main / 接续**；禁止用旧 `classifyTurnRelation` 做第二语义分流 |
| ADM-SESSION | 个人会话任务准入落板 | wiring `execution-admission` / `interaction-turn` → `sessionTaskState.admitExecution` → `state/mutations/admit-task.ts`；facade re-export `session-task-board.commitAdmittedSessionTask` | admit / session-task 测试；cross-process-child | CTR 相关与会话板路径；非 orch | `readSessionTaskBoardUnlocked` | `commitAdmittedSessionTask` | `withSessionTaskBoardLock` | 写 session board 文件 | **已在 main**：state mutations | state（事务）+ command（编排） | **已在 main / 接续** |
| ADM-COLLAB | 协作工作准入（群回合/契约，非个人板） | `collaboration-learning/*` + `claim-contract` publish/claim；`command/scenarios/collaboration-entry.ts` 仅场景入口薄层 | 大量 collab `controlled-collab-*.test.ts` | `collaboration.task.claimContract` **默认 OFF** | 群 store / effective policy | claim-contract 写路径 | `withRoundLock` + revision（claim-contract 内） | 群板事实；锁外 wake/fan-out | **仍在** `gateway/collaboration-dispatch` | command 协作领域 + state 群板；Gateway 仅 adapter | **迁移**（T5/T6）；迁移期暂留 Gateway |
| REV-CONSTRAINT | 活动任务约束修订（owner constraint） | `session-task-board.appendSameTaskConstraint` 等调用 `shouldPersistOwnerConstraint` / `isOwnerConstraint*`（`turn-relation.ts`） | `turn-relation.test.ts`、session-task-board 测试 | 无 | 当前板 current/constraints | `appendTaskConstraint`（state）经 facade | 板锁 | 写约束 | 谓词仍在 `conversation-task/turn-relation.ts`；写入已在 state | policy（纯谓词）+ state | **迁移**（T3 核准后小批）；属安全/约束谓词，非整包分类器 |
| PROP-INTERACTION | 交互提案提交（取消/换题等板事务） | `commitInteractionTaskProposal`（state）；经 session-task-board re-export | interaction-proposal / session 测试 | 无 | 板 | `interaction-proposal.ts` | 板锁 | 可 cancel/suppress | **已在 main** state | state | **已在 main / 接续** |

### 1.2 推进 / 暂停 / 取消 / 恢复 / focus-wake

| 行为ID | 定义 | 生产消费者 | 测试消费者 | 配置/flag | 读状态 | 写入口 | 锁/CAS | 副作用 | 当前权威 | 目标权威 | 处置 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EXEC-ADMITTED | 已准入回合推进 | `auto-reply/reply/agent-runner.ts` → wiring `runAdmittedTurn`；execution registry 标注 | `admitted-turn*.test.ts`、`#252` embedded 测试 | 商业/治理入口登记；非第二分类 | binding / session | 执行生命周期；不关群契约 | 执行侧 binding 校验 | 模型/工具/accounting | **已在 main**：`execution/runner/admitted-turn.ts`（#250/#252） | execution | **已在 main / 接续** |
| CTRL-EXPLICIT | 显式暂停/取消语解析 | Gateway `chat-resume-parked-recheck.ts`；cross-process-child | `explicit-task-control` 测试、inbound-stop 测试 | 无产品开关（代码常量） | inbound text | 经 `applyExplicitControl` → pause/cancel/resume mutations | 板锁 | abort/清队列由宿主 | **已在 main**：`policy/explicit-task-control.ts` + `state/mutations/explicit-control.ts` | policy + state | **已在 main / 接续** |
| CTRL-CANCEL-CURRENT | 取消当前任务 | explicit-control / proposal / facade | session-task-board / stop 测试 | 无 | 板 + tombstone 策略 | `cancelCurrentTask` | 板锁；可清 async-wait | 墓碑/抑制 | **已在 main** state | state | **已在 main / 接续** |
| CTRL-PAUSE-PARKED | 暂停已挂起任务 | explicit-control | 同上 | 无 | 板 | `pauseParkedTask` | 板锁 | 板字段 | **已在 main** state | state | **已在 main / 接续** |
| RESUME-PARKED | 恢复挂起任务 | Gateway `chat-resume-parked-recheck` → `sessionTaskState.resumeCurrent` / `resumeParkedTask` | `resume-parked.test.ts`、recheck 测试 | 无 | 板 + stop 查找 | `resume-parked.ts` / `resume-current.ts` | 板锁 | 可生成 resume prompt（context） | **已在 main** state | state；prompt → context | **已在 main / 接续** |
| FOCUS-WAKE | 焦点槽 acquire/park/switch 判定 | **生产**：`infra/heartbeat-focus.ts`、`cron/isolated-agent/main-session-focus.ts` 调用 `decideWake` | `focus-policy.test.ts` | 无 | FocusSnapshot（可经 board enrich） | **判定不写**；实际 park/switch 另走 task-focus/task-record | 判定无锁；写路径板锁 | heartbeat 禁 create_identity/write_completion/replan | **仍在** `conversation-task/focus-policy.ts` | policy（`focus-wake` 类）+ state 写；触发留宿主 | **迁移**（T3；先完成 I0 槽位语义核准） |
| FOCUS-SWITCH-HEUR | 用户消息焦点切换启发式 / transcript 读取 | Gateway `chat.ts` import `focus-switch`；session-task-board 内部 | `focus-switch.test.ts`、chat.task-status-order 测试 | 无 | transcript / session 文件只读 | 纯判定 + read helpers；不写 Task/Ledger | 无写锁 | 文案/fence | **仍在** `conversation-task/focus-switch.ts`（含本地 stamp） | 纯判定→policy；IO→adapter；文案→context | **迁移**（T3/T7）；须先证 stamp 等价 |
| PARK-ABORT-INFLIGHT | 切焦点时是否中止 in-flight | Gateway `chat.ts:6142` | `turn-relation.test.ts`、`session-task-board.inbound-stop.test.ts` | 无 | cutContext / abortInFlight 标志 | 不写板；触发 abortChatRuns / abortEmbedded / clearQueues | 无 | **中止运行、清队列** | `conversation-task/turn-relation.ts:299` | policy（安全谓词） | **迁移**（T3）；主链谓词，非整包分类器 |
| REL-CLASSIFY | amend/conversation/new_work 语义分类 | **源码调用**：仅 `complex-task-loop.ts:186`；**无生产 importer** 接到 `shapeAdmittedComplexTaskReply` | `turn-relation.test.ts`、`complex-task-loop.test.ts` | orch `dispatchEnabled` 默认 OFF；tenant allowlist 空则无人 admitted | userText / currentGoal | 可影响 shaping 文案；注释称不在 transport 确认前关板 | 无 | 可见四步报告（若启用） | `turn-relation.classifyTurnRelation` | **不**升为新 policy 权威；与 `interpretInteraction` 重复则归档 | **观察保留 → 核准后退役**（T3/T8）；禁止整包迁 policy |

### 1.3 验收 / 关闭（ConversationTask | ledger | SessionTaskBoard）/ 投递确认

| 行为ID | 定义 | 生产消费者 | 测试消费者 | 配置/flag | 读状态 | 写入口 | 锁/CAS | 副作用 | 当前权威 | 目标权威 | 处置 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CLOSE-CT-STORE | ConversationTask 生命周期 → `closed` | `reply-completion.observeConversationTaskReplyCompleted`（`dispatch-from-config` 调用） | reply-completion / consult-lock / standby 测试 | `OPENBOT_CONVERSATION_TASK_ACTIVATION` 等；**activation 默认 OFF** | Task store by conversation | `store.transitionTask(id,"closed")` | store 自身 | SQLite/CTR store | `conversation-task/store.ts` + reply-completion 编排 | 保留领域含义；**不与会话板合并** | **适配保留** 编排；T4 核准与板完成窗口 |
| CLOSE-LEDGER | 回复结果关闭 conversation ledger | reply-completion → `completeConversationTaskLedgerOnReplyOutcome`（`ledger-binding.ts`） | ledger / consult 测试 | activation；strict evidence 相关 | task + cronStorePath | ledger 写 | ledger 路径 | 工具观察 flush | `ledger-binding.ts` | 保留独立权威；联动条件写清 | **适配保留**；T4 |
| CLOSE-SESSION-BOARD | SessionTaskBoard 受控完成 | ① reply-completion 在 CT closed 后调用 `recordCheckedTaskCompletion`；② delivery-confirm ports `completeTask: sessionTaskState.completeChecked`；③ facade re-export | `task-completion` / completion-binding / cross-process | 需 `closed:true` + binding | 板 + live binding | `state/mutations/task-completion.ts` | **板文件锁** + binding CAS 语义 | 可选 completion notice 追加 transcript | **已在 main** state | state | **已在 main / 接续**；与 CLOSE-CT-STORE 双权威失败窗口 → **T4 优先** |
| ACCEPT-ALIGN | 输出与目标对齐（关板前） | reply-completion 内 `assessTaskOutputAlignment`；complex-task-loop 亦用 | 相关测试 | strictClose evidence flag | goal / assistant text | 不写；失败则不关 | 无 | 无 | `cron/task-focus` assess + reply-completion 编排 | policy 谓词可选抽；编排留宿主 | **证据不足→核准中**（是否抽纯谓词） |
| DELIV-CONFIRM | 投递回执确认（非推断送达） | `followup-runner`、`dispatch-from-config` → wiring `confirmPendingTurnDelivery` → `delivery/dispatch/confirm-pending.ts` | delivery / followup 测试 | 无 | pending-delivery 记录 | `confirmRunnerTurnDelivery` + 可选 completeChecked | pending 查找；板完成走既有锁 | 记录 delivered/failed/unknown；**不得**把投递失败改成执行失败 | **已在 main** delivery | delivery + state 受控入口 | **已在 main / 接续**（T4/T9 防回归） |

### 1.4 async-wait / 队列认领

| 行为ID | 定义 | 生产消费者 | 测试消费者 | 配置/flag | 读状态 | 写入口 | 锁/CAS | 副作用 | 当前权威 | 目标权威 | 处置 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ASYNC-WAIT-JOB | 异步等待 job 生命周期 | `agents/bash-tools.exec-runtime`、`bash-process-registry`；cancel 清 job | 大量 `async-wait-*.test.ts` | 无 | job store 文件 | `async-wait-job.ts` 锁内转移 | job 锁读判写 | 无渠道投递 | **已在 main** state/repository | state | **已在 main / 接续** |
| ASYNC-WAIT-RECOVER | Gateway 启动恢复 / claimToken 栅栏 | `gateway/server.impl.ts` boot：`recoverAsyncWaitJobsAtGatewayBoot` + continue enqueue | recovery / four-defects / cross-process 测试 | 无 | jobs dir | claim + enqueue followup | claim fence | 入原队列续跑；确认经 delivery | **已在 main** | state；续跑宿主 adapter | **已在 main / 接续** |
| QUEUE-CLAIM | 占用队列执行认领 | `followup-runner` → `claimQueuedExecution` | claim-queued-execution 测试 | 无 | 板 + binding + job 身份 | `claim-queued-execution.ts` | 板/执行绑定校验 | 绑定真实 run id | **已在 main** state | state | **已在 main / 接续**；协作路径不得因 ClaimContract 跳过 binding |

### 1.5 协作认领 / 提交 / 评审 / 私有计划

| 行为ID | 定义 | 生产消费者 | 测试消费者 | 配置/flag | 读状态 | 写入口 | 锁/CAS | 副作用 | 当前权威 | 目标权威 | 处置 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| COLLAB-CLAIM | 群板 publish/claim/apply/inProgress/submit/accept/return/block/cancel | `collaboration-learning/claim-contract-entry` 等；tools `collaboration-board-tool`（flag 探测） | claim-contract / controlled-collab 测试 | `collaboration.task.claimContract` **默认 OFF** | 群 board 文件 | `claim-contract.ts` | `withRoundLock` + revision | **锁外** wake/fan-out | gateway/collaboration-dispatch | policy 边 + state 群板 + command 编排 | **迁移**（T5/T6）；flag 保留迁移前默认 |
| COLLAB-POLICY-COMPILE | EffectivePolicy 编译与 policyHash | `resolve-effective-policy` → learning/state-machine/policy-lane-* / round-policy-snapshot | policy compiler 测试 | 配置 overlay / operatingState | 配置快照 | 纯编译（组合根在 resolve-*） | 无写锁 | 无 | `policy-compiler*.ts` + `effective-policy.ts` | policy；薄壳可暂留 | **迁移**（T5）；同输入同 hash |
| COLLAB-SUBMIT-VER | 提交版本/空提交/重复正文 | claim-contract 路径 import submit-review-versioning | collab-s3 测试 | 无（纯规则） | submission 快照 | 判定；写在 claim 事务 | 随群锁 | 无独立副作用 | `submit-review-versioning.ts` | policy | **迁移**（T5） |
| COLLAB-GOVERN | finalize / publish_proposal / self_advance 治理门 | handoff-contract、state-machine、task-runtime、self-advance | governance 测试 | 模式/角色 | actor + policy | 判定 | 无 | 拒绝推进 | `governance-gate.ts` | policy | **迁移**（T5） |
| COLLAB-PEER | peer review 判定与事实 | peer-review-gate；accept 门闩；learning 观察 | peer-review 测试 | `collaboration.task.requirePeerReview` **默认 OFF**；`drivesAdmission=false` | peer-reviews 存储 | append + accept 前读 | 写路径独立；accept 读门闩 | 不驱动 Admission | `peer-review-gate.ts` | policy 判定 + state 事实 | **迁移**（T5/T6） |
| COLLAB-PLAN-GATE | 交付执行门 / todolist mapping | delivery-exec-prompt、self-advance | plan-gate / collab-s2 测试 | 无 | board + todolist | 判定；confirm 事务另册 | 随相关锁 | prompt 侧 | `plan-gate-exec.ts` | policy + state 计划事务 | **迁移**（T5/T6） |
| COLLAB-PRIVATE-PLAN | 执行者私有计划 propose/confirm/revise/superseded | claim-contract-entry、attach-wake-binding、owner-decision-* | executor-private-todolist 测试 | 随 claimContract 等 | 私有 todolist 存储 | `executor-private-todolist.ts` | 自有事务 | **不得**当群共享板 | gateway 文件 | **独立 state 作用域** | **迁移**（T6） |
| COLLAB-HANDOFF | 交接分类与 apply | handoff-contract-entry、learning wake 证据 | handoff 测试 | 随协作启用 | live board / 责任快照 | `handoff-contract.ts` | 锁内写 | 责任快照 | gateway 文件 | policy 纯分类 + state | **迁移**（T5/T6） |

### 1.6 双源常量 / 输入清洗 / 目录

| 行为ID | 定义 | 生产消费者 | 测试消费者 | 配置/flag | 读状态 | 写入口 | 锁/CAS | 副作用 | 当前权威 | 目标权威 | 处置 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LIM-PARKED-TASKS | 会话板 parked 任务容量 | `state/mutations/task-record.parkTask`；context completion-notice slice；facade re-export | policy / task-record 测试 | 代码常量=3 | parked[] | park 时截断并 archive | 板锁内 | 可能归档溢出任务 | **已在 main** `policy/task-board-limits.ts` | policy | **已在 main / 接续**；与 SLOTS **勿硬合** |
| LIM-PARKED-SLOTS | 焦点调度 parked **槽位** | `focus-policy` 内部 parkIncoming*/parkCurrent*；export 经 conversation-task index | `focus-policy.test.ts` | 代码常量=3 | FocusSnapshot | 仅影响 decideWake 决策 | 无 | 可决定 droppedTaskId | `conversation-task/focus-policy.ts` | policy（独立名）或保留独立归属 | **证据不足→先核准是否同资源**（T3/I0）；当前倾向 **不同资源名保留** |
| STAMP-STRIP | 去掉入站时间戳前缀 | policy 权威消费者：turn-relation、session-task-board、explicit-control、task-title、task-focus mutations；**并行** focus-switch 本地；dialogue 用 ForDialogue | 各单测 | 无 | text | 无 | 无 | 无 | 意图权威：`policy/input-stamp.ts`；**事实仍双/三源** | 单一 policy 实现 | **消除已证等价副本**（T3/I0）；先样本等价 |
| RULE-CATALOG | 可查询规则目录 | `policy/catalog.ts` `listRuntimeRuleDeclarations` | `catalog.test.ts` | N/A | N/A | N/A | N/A | 无动态 import | 自述 *Selected verified rules, not a complete inventory* | 扩展现有 catalog（T2） | **接续 T2**；本 T1 不假装完整 |

---

## 2. 对照方案 §4：#250/#252 后收敛快照

| 方案 §4 锚点 | main（efdb1b98d）状态 | 处置标签 |
| --- | --- | --- |
| turn-relation.ts | 仍在 conversation-task；Gateway 只用 `shouldTaskParkAbortInFlight`；`classifyTurnRelation` 仅 dormant complex-task-loop | 拆分迁移 / 观察退役 |
| focus-switch.ts | 仍在；含本地 stamp；Gateway/chat 消费 | 迁移（判定）+ IO 适配 |
| focus-policy.ts | 仍在；heartbeat/cron 消费 `decideWake` | 迁移纯 wake 规则 |
| reply-completion.ts | 仍在；dispatch-from-config 消费；双关闭顺序窗口 | T4 优先核准 |
| session-task-board.ts | **多为 facade → agent-runtime state/policy/contracts**；仍有少量板辅助逻辑/ re-export | 适配保留至消费者迁完 |
| control-plane.ts / ledger-binding.ts | 仍在 conversation-task；reply-completion / activation / bootstrap 消费 | 适配保留；证明独立控制权 |
| complex-task-loop.ts | 默认关；无生产 importer 到 shaping API | 观察保留 |
| collaboration-dispatch policy/claim/todolist/handoff/* | **全部仍在 gateway**；learning 大量消费 | 迁移（暂留≠终态） |
| get-reply-run / agent-runner | 受控宿主；`runAdmittedTurn` 已接 | 适配保留宿主；逐项查第二决策 |
| commands/agent、cron、followup-runner | 场景宿主保留；followup 用 claimQueuedExecution + confirmPending | 适配保留 |
| embedded-attempt* / cli-run / admitted-candidate* | **#250/#252 已收敛进** `agent-runtime/execution/runner/` | **已在 main / 接续** |
| groups / runtime-context-assembly / system-prompt | 部分 context 组件已在 agent-runtime；完整装配链未宣称完成 | 部分接续 / T7 |
| capabilities catalog / adapters | **已在** agent-runtime/capabilities（#250） | **已在 main / 接续** |
| async-wait-* / confirm-pending | **已在** agent-runtime state/delivery | **已在 main / 接续** |
| hooks / Lobster / OpenProse | `extensions/lobster` 等仍在；完整启用/资产清单 | **证据不足**（T8） |

---

## 3. 检索方法与覆盖声明

- 工具：`rg` 于 `src`、`extensions`、`scripts`；配置键于 `src/config/zod-schema.ts`、`types.collaboration.ts`、`schema.help.ts`。
- 区分：产品 import（非 `*.test.ts`）、测试、re-export（session-task-board / turn-relation / index）、动态加载（本轮 **未发现** complex-task-loop 动态生产加载；若后续 webpack/lazy 边界变化须重核）。
- **未盘全**：全渠道投递回执消费者逐渠道审计；生产环境实际 flag 取值；hooks/Lobster/OpenProse 用户资产与恢复 token；Floor LIVE 全路径。标 **证据不足**，不当作已退役或已迁完。

## 4. T1 出口 Cond

- 本文件 + `component-migration-matrix.md` 构成批次 A 的权威/消费者盘点交付。
- **不**自动开 T3+ 行为迁移；须独立验收放行后再开 B。
- 源码盘点基线：`efdb1b98d83e096a31e251095080de954f5883ec`（与最终交付 SHA 分开；本文件记录的是对该基线的盘点结论）。
