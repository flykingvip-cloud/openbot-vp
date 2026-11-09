# T2 可查询规则目录覆盖（rule-catalog-coverage）

- 日期：2026-11-09（Asia/Shanghai）
- 分支：`codex/openbot/runtime-authority-closure`
- 开工 / 抽核 SHA：`efdb1b98d83e096a31e251095080de954f5883ec`
- 实现文件：`src/agent-runtime/policy/catalog.ts`（**扩展现有目录**，不另造第二目录）
- 类型：`RuntimeRuleDeclaration`（`src/agent-runtime/contracts/policy.ts`）— **本轮未改类型**
- 性质：**只读声明视图**；无执行控制权；无 UI / 脚本引擎 / 表达式求值 / 自动规则调度器
- 输入：`execution-authority-inventory.md`、`component-migration-matrix.md`、`execution-authority-closure-plan-2026-11-09.md` §5 T2
- 覆盖声明：**非完整 inventory**。catalog 仅登记路径 `existsSync` 真实、已核实的实现；未盘全 / 待迁 / 观察项诚实标在本 MD，**不**假装已在 policy 实现路径上。

## 1. 分类原则（落地）

| 种类 | 管理方式 | catalog 处理 |
| --- | --- | --- |
| 系统不变量（身份隔离、版本/绑定校验、取消围栏、fail-closed 契约） | `code_required`；无普通关闭开关 | 可进 catalog |
| 产品策略（重试、容量、窗口阈值等） | `reviewed_parameters` | 可进 catalog |
| 交互 / 质量偏好（提示频率、风格、session prompt mode） | 归 context/delivery | **不进** policy catalog；本 MD 标明 |
| 数据契约 / ClaimContract | 领域对象，不是可开关脚本 | **不进** catalog 作「规则」 |
| 待迁协作规则（仍在 `gateway/collaboration-dispatch`） | 迁移后才登记真实 policy/state 路径 | **仅本 MD 追踪** |

## 2. catalog.ts 条目：既有 + 本次新增

### 2.1 既有（T2 前已在 main）

| id | category | owner | implementation | checkpoint | management | disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `task.binding.current` | invariant | policy | `src/agent-runtime/policy/task-binding.ts` | before_execution_and_effect | code_required | retain |
| `execution.admitted.binding` | invariant | execution | `src/agent-runtime/execution/runner/admitted-turn.ts` | before_outcome_and_admission | code_required | retain |
| `interaction.semantic.decision` | classification | command | `src/agent-runtime/command/interpret-interaction.ts` | interaction | code_required | retain |
| `execution.retry.bounds` | operational | policy | `src/agent-runtime/policy/run-limits.ts` | retry | reviewed_parameters | retain |
| `execution.continuation.bounds` | operational | policy | `src/agent-runtime/policy/task-board-limits.ts` | before_continuation_reservation | reviewed_parameters | retain |
| `delivery.receipt.identity` | lifecycle | delivery | `src/agent-runtime/delivery/dispatch/confirm-pending.ts` | delivery_confirmation | code_required | retain |
| `execution.lifecycle.preparation` | lifecycle | execution | `src/agent-runtime/execution/runner/execution-lifecycle.ts` | before_provider_startup | code_required | retain |

### 2.2 本次新增（路径均已在 tip 核实存在）

| id | category | owner | implementation | checkpoint | management | disposition | 对照行为 ID |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `task.control.explicit` | classification | policy | `…/policy/explicit-task-control.ts` | before_explicit_control_mutation | code_required | retain | CTRL-EXPLICIT |
| `input.stamp.strip` | operational | policy | `…/policy/input-stamp.ts` | before_inbound_text_use | code_required | retain | STAMP-STRIP（权威意图；副本仍待 T3 等价证明） |
| `task.acceptance.checks` | quality_experience | policy | `…/policy/acceptance-checks.ts` | before_acceptance_contract_persist | code_required | retain | ACCEPT 契约解析（fail-closed） |
| `task.constraints.normalize` | operational | policy | `…/policy/constraints.ts` | before_constraint_read_or_write | code_required | retain | 约束规范化（写仍 state） |
| `execution.queue.action` | operational | policy | `…/policy/execution-queue.ts` | before_queue_occupancy | code_required | retain | 队列占用判定（语义已由 interaction 解决） |
| `execution.blocker.grade` | classification | policy | `…/policy/blocker.ts` | before_blocker_effect | code_required | retain | blocker 分级（无 IO） |
| `model.context_window.guard` | operational | policy | `…/policy/context-window.ts` | before_model_context_use | reviewed_parameters | retain | 上下文窗口 warn/block |
| `interaction.source.recoverable` | operational | policy | `…/policy/interaction-availability.ts` | interaction_source_error | code_required | retain | 窄 IO 可恢复错误 |
| `task.park.abort_inflight` | invariant | policy | `src/conversation-task/turn-relation.ts` | before_focus_switch_abort | code_required | retain | PARK-ABORT-INFLIGHT（**仅**现役安全谓词；非整包分类器） |
| `task.constraint.owner_gate` | classification | policy | `src/conversation-task/turn-relation.ts` | before_owner_constraint_persist | code_required | retain | REV-CONSTRAINT 谓词（实现仍待迁 policy 文件） |
| `execution.async_wait.job_transition` | lifecycle | execution | `…/state/repository/async-wait-job.ts` | async_wait_job_lock | code_required | retain | ASYNC-WAIT-JOB |
| `execution.queue.claim` | lifecycle | execution | `…/state/mutations/claim-queued-execution.ts` | before_queued_execution_start | code_required | retain | QUEUE-CLAIM |

**合计**：catalog 现 **19** 条（原 7 + 新 12）。`classifyTurnRelation` **未**登记为 catalog 权威规则。

## 3. 完整字段矩阵（方案要求字段）

`RuntimeRuleDeclaration` 运行时字段：`id/category/owner/implementation/checkpoint/management/disposition`。  
下列扩展字段（`scope/enforcementPoints/version/dependencies/configuration/tests/retirementCondition`）**只写本 MD**，不改类型。

### 3.1 已在 catalog 的规则（按类摘要；逐条细节见表）

| id | scope | enforcementPoints | version | dependencies | configuration | tests | retirementCondition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `task.binding.current` | session task board + completion binding | completeChecked / effect gates / claim paths | tip 内源码 | contracts task-binding；active constraints | 无开关（code_required） | `task-binding.test.ts` | 消费者归零且替代 CAS 接上（当前保留） |
| `execution.admitted.binding` | admitted turn | runAdmittedTurn 入口 | tip | binding；lifecycle | 无 | `admitted-turn*.test.ts` | 执行后端退役时一并审 |
| `interaction.semantic.decision` | inbound interaction | route-interaction / prepared-interaction | tip | command ports | 无 master flag | `interpret-interaction.test.ts` | 禁止被旧 classify 替代；仅在 command 权威迁移时审 |
| `execution.retry.bounds` | provider run loop | retry / failover / overflow compaction | tip | profile candidate count | 源码常量（reviewed_parameters） | `run-limits.test.ts` | 参数评审后可改常量；非用户脚本 |
| `execution.continuation.bounds` | session board parked **tasks** + continue windows | parkTask；continuation reservation | tip | state task-record | `MAX_PARKED_TASKS=3` 等源码常量 | policy / task-record 测试 | **勿与** `MAX_PARKED_SLOTS` 硬合后退役一方 |
| `delivery.receipt.identity` | pending delivery | confirmPendingTurnDelivery | tip | pending-delivery；optional completeChecked | 无 | `confirm-pending.test.ts` | 投递确认权威变更时审；不得改成「有回复即送达」 |
| `execution.lifecycle.preparation` | provider startup | execution-lifecycle 准备段 | tip | runner | 无 | execution runner 测试 | 与 admitted/attempt 拆分审 |
| `task.control.explicit` | explicit pause/cancel/resume syntax | Gateway recheck → state explicit-control | tip | input-stamp | 固定句法，无产品开关 | `explicit-task-control.test.ts` | 句法变更须评审；非推断新工作 |
| `input.stamp.strip` | inbound text normalize | 多判定链前 | tip | 无 | 正则常量 | 经 explicit-control / turn-relation 等间测 | 副本（focus-switch / ForDialogue）**样本等价证明后**删副本；权威本条保留 |
| `task.acceptance.checks` | acceptance contract parse | persist 前 fail-closed | tip | contracts/quality | 未知 operator 拒绝 | 随 quality/admission 测试 | 扩展 validator 白名单须评审 |
| `task.constraints.normalize` | constraint entries | read/write 规范化 | tip | contracts/task | 无 | 随 constraints 消费者 | 与 owner_gate 谓词迁移对齐 |
| `execution.queue.action` | queue occupancy | followup / steer 占用 | tip | 已解释的 interaction 标志 | queueMode 枚举 | `execution-queue.test.ts` | 不得回退为二次语义分类 |
| `execution.blocker.grade` | blocker narrative grade | before blocker effect | tip | contracts/blocker；probes 由调用方提供 | 无 | `blocker.test.ts` | 分级规则变更评审 |
| `model.context_window.guard` | model context tokens | before model use | tip | OpenBotConfig models / agentContextTokens | warn/hardMin 常量可审 | 随 context-window 使用处 | 阈值变更走 reviewed_parameters |
| `interaction.source.recoverable` | local IO degradation | interaction source error | tip | errno 白名单 | 无 | 随 command/interaction 测试 | 扩大可恢复码须评审 |
| `task.park.abort_inflight` | focus switch abort | Gateway `chat.ts` 现役 | tip | cutContext / abortInFlight | 无 | `turn-relation.test.ts`；inbound-stop | **实现迁入 policy 文件后**更新 implementation 路径；禁止整包带走 classify |
| `task.constraint.owner_gate` | owner constraint revise/replace/persist | session-task-board 约束路径 | tip | stamp；板写 state | 无 | `turn-relation.test.ts` | 同上，小批迁纯谓词 |
| `execution.async_wait.job_transition` | async-wait job file | lock 内 RMW | tip | async-wait-job-store；file lock | 无 | `async-wait-job*.test.ts` | 身份/claimToken 围栏变更时审 |
| `execution.queue.claim` | queued execution claim | followup-runner 等 | tip | board + binding + job 身份 | 无 | claim-queued-execution 测试 | 协作路径不得因 ClaimContract 跳过 binding |

### 3.2 `prompt-mode`（明确不进 catalog）

| 项 | 说明 |
| --- | --- |
| 路径 | `src/agent-runtime/policy/prompt-mode.ts`（文件在 policy 目录，但职责是 session → minimal/full **提示偏好**） |
| 归属 | **context / delivery 偏好**，不进 policy catalog |
| 理由 | 方案：交互/质量偏好归 context/delivery |

## 4. 未进 catalog：待迁 / 观察 / 明确不收录

### 4.1 待迁（当前实现仍在 conversation-task / gateway；**不**登记假 policy 路径）

| 主题 | 当前实现 | 目标 | 处置 | 映射行为 ID |
| --- | --- | --- | --- | --- |
| focus-wake / `MAX_PARKED_SLOTS` | `conversation-task/focus-policy.ts` | policy focus-wake（**独立名**，勿与 TASKS 硬合） | 待迁 T3；槽位语义先核准 | FOCUS-WAKE / LIM-PARKED-SLOTS |
| focus-switch 启发式 + transcript IO | `conversation-task/focus-switch.ts` | 判定→policy；IO→adapter；文案→context | 待迁 T3/T7 | FOCUS-SWITCH-HEUR |
| reply-completion 双关闭编排 | `conversation-task/reply-completion.ts` | 编排可留 adapter；完成写只经 state；T4 优先核准窗口 | 待迁/适配保留；**不**当 catalog「完成权威」单条假装闭环 | CLOSE-CT-STORE / CLOSE-LEDGER / CLOSE-SESSION-BOARD |
| collab effective-policy / compiler / hash | `gateway/collaboration-dispatch/effective-policy.ts`、`policy-compiler*.ts` | policy；同输入同 policyHash | 待迁 T5；**当前实现仍在 gateway** | COLLAB-POLICY-COMPILE |
| submit-review-versioning / governance / peer-review / plan-gate | 同目录对应文件 | policy（判定）+ state（事实） | 待迁 T5/T6 | COLLAB-SUBMIT-VER / GOVERN / PEER / PLAN-GATE |
| claim-contract 状态机 | `claim-contract.ts` | 合法边→policy；锁内→state；编排→command | 待迁 T5/T6；**ClaimContract ≠ 可开关脚本，不进 catalog 当规则引擎条目** | COLLAB-CLAIM |
| private todolist / handoff | `executor-private-todolist.ts`、`handoff-contract.ts` | 独立 state + policy 纯分类 | 待迁 T6 | COLLAB-PRIVATE-PLAN / HANDOFF |
| Floor / round-runtime / wake / legacy-primary-supplement | collaboration-dispatch 周边 | 迁移期暂留 Gateway；最终 adapter | 适配保留 | （场景编排） |

### 4.2 观察保留（不升 catalog 权威）

| 主题 | 证据（efdb1b98d） | catalog | retirementCondition（记录用） |
| --- | --- | --- | --- |
| `classifyTurnRelation` | 唯一定义 `turn-relation.ts`；**唯一源码调用** `task-orchestration/complex-task-loop.ts:186`；shaping API 无生产 importer；orch 默认 OFF | **不登记** | 生产消费者归零 + 与 `interpretInteraction` 重复核准 + 归档位置后删除 |
| `complex-task-loop` | 观察/休眠路径 | 不登记 | 同左；不得第二关闭权 |

### 4.3 明确不收录

| 项 | 理由 |
| --- | --- |
| ClaimContract / 群板数据形状 | 数据契约与领域对象，不是规则目录项 |
| capabilities 工具声明元数据 | 声明 ≠ 授权；另有 capabilities catalog |
| hooks / Lobster / OpenProse | 证据不足（T8）；不假装已清 |
| 渠道级投递偏好文案 | delivery/context 偏好 |
| 任意「配置即可执行」脚本规则 | 非目标 |

## 5. 与 T1 行为 ID 映射（摘要）

| 行为 ID | catalog id 或覆盖状态 |
| --- | --- |
| INT-INTERPRET | `interaction.semantic.decision` |
| ADM-SESSION / PROP-INTERACTION / CTRL-* / RESUME-* / CLOSE-SESSION-BOARD | 板事务在 state；相关纯规则见 binding / explicit / constraints；完成写不单列「假闭环」 |
| ADM-COLLAB / COLLAB-* | **待迁**；仅 §4.1 |
| EXEC-ADMITTED | `execution.admitted.binding` + `execution.lifecycle.preparation` |
| PARK-ABORT-INFLIGHT | `task.park.abort_inflight` |
| REV-CONSTRAINT | `task.constraint.owner_gate` + `task.constraints.normalize` |
| REL-CLASSIFY | **不进 catalog**（观察） |
| FOCUS-WAKE / FOCUS-SWITCH-HEUR | **待迁** |
| DELIV-CONFIRM | `delivery.receipt.identity` |
| ASYNC-WAIT-JOB / QUEUE-CLAIM | `execution.async_wait.job_transition` / `execution.queue.claim` |
| ASYNC-WAIT-RECOVER | 覆盖缺口：恢复扫描/enqueue 多文件；本轮未逐文件登记，标 **未盘全子集** |
| LIM-PARKED-TASKS | `execution.continuation.bounds`（含 MAX_PARKED_TASKS） |
| LIM-PARKED-SLOTS | **待迁/先核准**；未进 catalog |
| STAMP-STRIP | `input.stamp.strip`（权威路径）；副本待 T3 |
| RULE-CATALOG | 本文件 + `listRuntimeRuleDeclarations` |

## 6. 验收检查

| 检查 | 结果 |
| --- | --- |
| 可类型化读取 `listRuntimeRuleDeclarations()` | 是；返回 detach 副本 |
| invariant ⇒ `management === code_required` | 由 `catalog.test.ts` 断言 |
| id 唯一 | 测试断言 Set size === length |
| 每条 `implementation` 路径存在 | `existsSync` 测试 |
| 无隐藏调度 / 动态 import 规则 | catalog 注释与实现：路径仅标识，从不动态加载 |
| 未改 `RuntimeRuleDeclaration` 类型 | 是 |
| 未登记 `classifyTurnRelation` 为权威 | 是 |
| 协作未迁规则未假装在 policy | 是（§4.1） |
| HEAD 父提交 | `efdb1b98d`（本轮未 commit） |

### 6.1 测试命令与结果

```text
pnpm exec vitest run src/agent-runtime/policy/catalog.test.ts
```

结果（Asia/Shanghai 2026-11-09）：

```text
RUN  v4.0.18
✓ src/agent-runtime/policy/catalog.test.ts (2 tests) 3ms
Test Files  1 passed (1)
Tests  2 passed (2)
```

PASS：路径 existsSync、id 唯一、invariant⇒code_required、detach 副本均通过。

## 7. 覆盖缺口（诚实）

1. async-wait **恢复**链路（scan / claim fence / enqueue / followup consumer）未逐文件进 catalog；仅登记 job 锁内转移与 queue claim。
2. ConversationTask store / ledger-binding / control-plane 完成语义未进 catalog（等 T4 核准窗口，避免「目录有条目 = 闭环成立」）。
3. 全渠道 delivery outlet、生产环境实际 flag 取值、hooks/Lobster/OpenProse 资产：仍 **证据不足**（继承 T1）。
4. focus-policy / focus-switch / 协作 compiler 等 **待迁** 项仅 MD 追踪。
5. `input.stamp.strip` 登记的是权威实现；focus-switch 本地副本与 `stripInboundStampForDialogue` 仍在，等价证明前不删。

## 8. T2 出口

- `rule-catalog-coverage.md`（本文件）+ 扩展后的 `catalog.ts` + `catalog.test.ts` PASS。
- **不**自动开 T3+；批次 A（T0–T2）须独立验收后才开行为迁移。
- 本轮 **无 commit / push**；切片提交留待批次 A 齐套后按仓库 committer 流程。
