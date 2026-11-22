# T2 可查询规则目录覆盖（rule-catalog-coverage）

- 日期：2026-11-09（Asia/Shanghai）
- 分支：`codex/openbot/runtime-authority-closure`
- **源码盘点基线**（inventory pin）：`efdb1b98d83e096a31e251095080de954f5883ec`（与最终交付 SHA 分开）
- 实现文件：`src/agent-runtime/policy/catalog.ts`（**扩展现有目录**，不另造第二目录）
- 类型：`RuntimeRuleDeclaration`（`src/agent-runtime/contracts/policy.ts`）— **本轮已扩展为可查询契约字段**
- 查询 API：`listRuntimeRuleDeclarations()` / `getRuntimeRuleDeclaration(id)`（返回深拷贝 detach；无执行控制权）
- 性质：**只读声明视图**；无 UI / 脚本引擎 / 表达式求值 / 自动规则调度器
- 输入：`execution-authority-inventory.md`、`component-migration-matrix.md`、`execution-authority-closure-plan-2026-11-09.md` §5 T2
- 覆盖声明：**非完整 inventory**。可查询 ≠ 已迁入新目录；现役规则按**真实当前位置**登记，待迁用 `disposition: pending_migration` + `currentOwner`/`targetOwner` 表达。
- Batch B（head `050098bc3c318b3c76d89278d293a65d29950999`）：更新 abort / wake / switch / reply-completion 的当前位置说明。目录仍非完整清单。

## 1. 分类原则（落地）

| 种类                                      | 管理方式                                            | catalog 处理                                          |
| ----------------------------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| 系统不变量                                | `code_required`；无普通关闭开关                     | 可进 catalog                                          |
| 产品策略                                  | `reviewed_parameters`                               | 可进 catalog                                          |
| 交互 / 质量偏好（session prompt mode 等） | 归 context/delivery                                 | **不进** policy catalog；本 MD 标明                   |
| 数据契约 / ClaimContract                  | 领域对象，不是可开关脚本                            | **不进** catalog 作「规则」                           |
| 现役待迁协作 / conversation-task 规则     | 按真实当前路径登记；`disposition=pending_migration` | **可进 catalog 查询**（不以是否搬进新目录决定可查询） |

## 2. 可查询契约字段

公开类型化读取必须提供：

`id, category, currentOwner, targetOwner, scope, implementation, enforcementPoints, version, dependencies, configuration, tests, retirementCondition, management, disposition`

| 字段                     | 约定                                                                            |
| ------------------------ | ------------------------------------------------------------------------------- |
| `currentOwner`           | **当前责任**（live 实现所在：policy / state / gateway / conversation-task / …） |
| `targetOwner`            | **目标责任**（迁移后归属；可与 current 相同）                                   |
| `version`                | 固定格式 `inventory:<full-sha>`，对应该条目的源码盘点基线；**禁止**含糊 `tip`   |
| `dependencies.rules`     | 其他 **catalog rule id**；必须全部可解析                                        |
| `dependencies.artifacts` | 非规则依赖（路径 / 合约 / 说明）                                                |
| `enforcementPoints`      | 执行位置列表（原 `checkpoint` 语义并入此字段）                                  |
| `disposition`            | `retain` \| `review_for_retirement` \| `pending_migration`                      |

常量：`RULE_CATALOG_INVENTORY_BASELINE` = 盘点基线 SHA。

## 3. catalog 条目摘要

### 3.1 已在目标目录（currentOwner ≈ targetOwner，retain）

| id                                    | current→target      | implementation                                |
| ------------------------------------- | ------------------- | --------------------------------------------- |
| `task.binding.current`                | policy→policy       | `…/policy/task-binding.ts`                    |
| `execution.admitted.binding`          | execution→execution | `…/execution/runner/admitted-turn.ts`         |
| `interaction.semantic.decision`       | command→command     | `…/command/interpret-interaction.ts`          |
| `execution.retry.bounds`              | policy→policy       | `…/policy/run-limits.ts`                      |
| `execution.continuation.bounds`       | policy→policy       | `…/policy/task-board-limits.ts`               |
| `delivery.receipt.identity`           | delivery→delivery   | `…/delivery/dispatch/confirm-pending.ts`      |
| `execution.lifecycle.preparation`     | execution→execution | `…/execution/runner/execution-lifecycle.ts`   |
| `task.control.explicit`               | policy→policy       | `…/policy/explicit-task-control.ts`           |
| `input.stamp.strip`                   | policy→policy       | `…/policy/input-stamp.ts`                     |
| `task.acceptance.checks`              | policy→policy       | `…/policy/acceptance-checks.ts`               |
| `task.constraints.normalize`          | policy→policy       | `…/policy/constraints.ts`                     |
| `execution.queue.action`              | policy→policy       | `…/policy/execution-queue.ts`                 |
| `execution.blocker.grade`             | policy→policy       | `…/policy/blocker.ts`                         |
| `model.context_window.guard`          | policy→policy       | `…/policy/context-window.ts`                  |
| `interaction.source.recoverable`      | policy→policy       | `…/policy/interaction-availability.ts`        |
| `execution.async_wait.job_transition` | **state→state**     | `…/state/repository/async-wait-job.ts`        |
| `execution.queue.claim`               | **state→state**     | `…/state/mutations/claim-queued-execution.ts` |

说明：两条 state 事务**不再**标成 execution owner；当前责任与目标责任均为 `state`。

### 3.2 现役谓词仍在旧目录（pending_migration，可查询）

| id                           | current→target           | implementation                                      | 说明                                                         |
| ---------------------------- | ------------------------ | --------------------------------------------------- | ------------------------------------------------------------ |
| `task.park.abort_inflight`   | policy→policy            | `src/agent-runtime/policy/explicit-task-control.ts` | 公共入口 `policy/index`；Gateway 直接消费；分类器不在此      |
| `task.constraint.owner_gate` | conversation-task→policy | `src/conversation-task/turn-relation.ts`            | REV-CONSTRAINT 谓词                                          |
| `task.focus.wake`            | policy→policy            | `src/agent-runtime/policy/explicit-task-control.ts` | eligibility 在公共入口；`decideWake` 与槽位仍在 focus-policy |
| `task.focus.switch`          | conversation-task→policy | `src/conversation-task/focus-switch.ts`             | stamp/title 已委托；transcript IO 留 adapter                 |
| `task.reply.completion`      | conversation-task→state  | `src/conversation-task/reply-completion.ts`         | 板结算后再关 CTR；拒绝不对外报成功；见 T4 窗口记录           |

### 3.3 现役协作规则（pending_migration，按 Gateway 真实路径登记）

| id                                | current→target | implementation                                          |
| --------------------------------- | -------------- | ------------------------------------------------------- |
| `collab.policy.compile`           | gateway→policy | `src/gateway/collaboration-dispatch/policy-compiler.ts` |
| `collab.submit.review_versioning` | gateway→policy | `…/submit-review-versioning.ts`                         |
| `collab.governance.gate`          | gateway→policy | `…/governance-gate.ts`                                  |
| `collab.peer.review_gate`         | gateway→policy | `…/peer-review-gate.ts`                                 |
| `collab.plan.gate`                | gateway→policy | `…/plan-gate-exec.ts`                                   |

**合计**：catalog **27** 条。`classifyTurnRelation` **未**登记。ClaimContract **未**登记为规则。

## 4. 明确不收录 / 观察

### 4.1 观察保留（不升 catalog 权威）

| 主题                   | 证据（盘点基线 efdb1b98d）                                                 | catalog    |
| ---------------------- | -------------------------------------------------------------------------- | ---------- |
| `classifyTurnRelation` | 唯一定义 `turn-relation.ts`；唯一源码调用 `complex-task-loop.ts`；默认 OFF | **不登记** |
| `complex-task-loop`    | 观察/休眠路径                                                              | 不登记     |

### 4.2 明确不收录

| 项                           | 理由                                          |
| ---------------------------- | --------------------------------------------- |
| ClaimContract / 群板数据形状 | 领域对象，不是规则目录项                      |
| capabilities 工具声明元数据  | 声明 ≠ 授权                                   |
| hooks / Lobster / OpenProse  | 证据不足（T8）                                |
| `prompt-mode`                | context/delivery 偏好（文件虽在 policy 目录） |

## 5. 与 T1 行为 ID 映射（摘要）

| 行为 ID                                                    | catalog id 或覆盖状态                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| INT-INTERPRET                                              | `interaction.semantic.decision`                                  |
| EXEC-ADMITTED                                              | `execution.admitted.binding` + `execution.lifecycle.preparation` |
| PARK-ABORT-INFLIGHT                                        | `task.park.abort_inflight`                                       |
| REV-CONSTRAINT                                             | `task.constraint.owner_gate` + `task.constraints.normalize`      |
| REL-CLASSIFY                                               | **不进 catalog**（观察）                                         |
| FOCUS-WAKE / FOCUS-SWITCH-HEUR                             | `task.focus.wake` / `task.focus.switch`（pending_migration）     |
| CLOSE-\* / reply-completion                                | `task.reply.completion`（pending；T4 窗口已注入并收口，待验收）  |
| COLLAB-POLICY-COMPILE / SUBMIT / GOVERN / PEER / PLAN-GATE | 对应 `collab.*` pending_migration 条目                           |
| COLLAB-CLAIM                                               | **不进 catalog**（ClaimContract 领域对象）                       |
| DELIV-CONFIRM                                              | `delivery.receipt.identity`                                      |
| ASYNC-WAIT-JOB / QUEUE-CLAIM                               | state 归属的两条 lifecycle                                       |
| LIM-PARKED-TASKS                                           | `execution.continuation.bounds`                                  |
| LIM-PARKED-SLOTS                                           | `task.focus.wake`（待核准语义）                                  |
| STAMP-STRIP                                                | `input.stamp.strip`                                              |
| RULE-CATALOG                                               | 本文件 + 查询 API                                                |

## 6. 验收检查

| 检查                                                                                                          | 结果     |
| ------------------------------------------------------------------------------------------------------------- | -------- |
| 类型化读取含 scope / enforcementPoints / version / dependencies / configuration / tests / retirementCondition | 是       |
| `currentOwner` ≠ 含糊「owner」；与 `targetOwner` 分字段                                                       | 是       |
| version = `inventory:<盘点基线 SHA>`，非 tip                                                                  | 是       |
| state 事务 currentOwner=state                                                                                 | 是       |
| 待迁协作 / conversation-task 按真实路径可查询                                                                 | 是       |
| invariant ⇒ `management === code_required`                                                                    | 测试断言 |
| id 唯一；dependencies.rules 均可解析                                                                          | 测试断言 |
| nested 字段修改不污染目录                                                                                     | 测试断言 |
| 无 ClaimContract 规则条目                                                                                     | 测试断言 |
| 未登记 `classifyTurnRelation`                                                                                 | 是       |

### 6.1 测试命令与结果

```text
OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/agent-runtime/policy/catalog.test.ts
```

结果（Asia/Shanghai 2026-11-09，目录契约补丁后）：

```text
✓ src/agent-runtime/policy/catalog.test.ts (8 tests)
Test Files  1 passed (1)
Tests  8 passed (8)
```

## 6.2 元数据准确性补丁（相对 daa8a3a10）

| id                        | 修正                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `collab.peer.review_gate` | `configuration` 登记 `collaboration.task.requirePeerReview` 默认 false；仅影响 accept 门槛，不控制 `recordPeerReview` 事实写入 |
| `task.reply.completion`   | `configuration` 登记 `OPENBOT_CONVERSATION_TASK_ACTIVATION` / `flags.activation` 默认 OFF 门控                                 |
| `collab.governance.gate`  | `tests` 补入 `governance-gate.test.ts`                                                                                         |
| 其它 pending 条目         | 核对 plan/submit 配置边界；`task.park.abort_inflight` 测试路径改为真实 `session-task-board.inbound-stop.test.ts`               |

新增断言：`records accurate configuration and tests for reviewed rules`（catalog.test 现 8/8）。

## 7. 覆盖缺口（诚实）

1. async-wait **恢复**链路未逐文件进 catalog。
2. ConversationTask / ledger / SessionTaskBoard 完成语义的权威闭环仍待 T4；catalog 仅登记编排当前位置。
3. 全渠道 delivery、生产 flag、hooks/Lobster/OpenProse：证据不足。
4. `input.stamp.strip` 副本等价证明前不删。
5. 私有 todolist / handoff 等协作周边仍可后续补登记；本轮未假装盘全。

## 8. T2 出口 / 现场说明

- 交付：本文件 + 扩展后的 `catalog.ts` / `contracts/policy.ts` + `catalog.test.ts` PASS。
- **不**自动开 T3+；Batch B 仍暂停，直至本批目录契约独立验收。
- 历史说明：初版 coverage / T0 中「未提交／未推送」等措辞描述的是 **2026-11-09 开工当时快照**；其后 Batch A 已切片提交并开 Draft PR，以 PR head SHA 为交付固定点，盘点基线仍为 `efdb1b98d…`。
