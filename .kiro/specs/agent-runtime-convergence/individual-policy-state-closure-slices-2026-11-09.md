# 个体机器人执行任务规则 → policy/state 收口切片（修订版）

**日期：** 2026-11-09（Asia/Shanghai）
**核对树：** `runtime-convergence/openbot`
**分支：** `codex/openbot/runtime-convergence`
**文档原定位 tip：** `5b46483c9`（`5b46483c96fb087723e959545a3106e2699466b9`）
**专家源码抽核 tip：** `e3fef11c8b40a8ec0ace10a29e2fd82e07c9be66`（消费者/权威清单按此修订）
**作者角色：** 执行器迁移（grok-bot）
**性质：** **迁移盘点依据 + 修订后的切片建议。不宜原样作为实施指令。** 方向正确；若切片把旧机制整包搬进新目录，会固化重复逻辑。本轮仍不改代码、不跑测试；实施须另授权；仍不 push/PR/部署。

**配套交互页：** [协作小组长程任务规则体系](https://cursor.com/canvas/store-761ce8fe-deeb-4b47-b0f3-f32c7a3b3acc/bd5a2b21-9e94-4c2e-aa39-dba05d0d2040)（页签「个体完整度 / 个体切片」）

**配套协作文档：** [`collab-policy-state-migration-boundary-2026-11-09.md`](./collab-policy-state-migration-boundary-2026-11-09.md)

**规格参照：** `completion-gates.md`、`package6-same-sha-acceptance.md`、`scenario-architecture.md`、`authority-map.md`

**修订依据：** 专家评审 t37u — 批准作盘点；实施前修订 I1、提前 I4；消费者清单按抽核更新。

---

## 1. 定位声明（盘点 ≠ 实施指令）

| 声明         | 含义                                                                             |
| ------------ | -------------------------------------------------------------------------------- |
| 批准用途     | 作为迁移盘点与权威/消费者核对依据                                                |
| 不宜原样实施 | 原切片若把旧分类器/双源常量整包搬入 policy，会把重复逻辑固化进新目录             |
| tip 差异     | 文档定位基线 `5b46483c9`；抽核基于 `e3fef11c8…` — **以抽核修订消费者与权威清单** |
| 本轮范围     | 只修订文档；不改代码、不跑测试、不提交                                           |

---

## 2. 结论（给专家）

| 问题                                                    | 结论                                                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 个体长程任务的会话板机制是否已进新执行器 policy/state？ | **部分是** — 绑定/墓碑/续跑上限/暂停取消/准入完成/async-wait 已在 `agent-runtime`；`session-task-board.ts` 多为 facade |
| 是否已完整迁移？                                        | **否** — 焦点分类、挂起策略副本、回合关系分类、回复关闭触发仍在 `conversation-task`（及旁路 `task-orchestration`）     |
| Package6 是否等于个体规则收口完成？                     | **否** — Packages 1–6 为源码迁移阶段；不宣称旧执行器全部退役                                                           |
| `policy/catalog` 是否完整清单？                         | **否** — 自述 _Selected verified rules, not a complete inventory_                                                      |
| 原 I0→I1→I2→I3→I4 顺序是否可原样开工？                  | **否** — 须先更新消费者清单、提前完成态一致性（原 I4）、再消已证实等价副本；I1 禁止整包迁移 `classifyTurnRelation`     |

---

## 3. 应保留的设计（硬边界）

与协作文档共有，实施时不得破坏：

| 边界           | 要求                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------- |
| 三状态分离     | **SessionTaskBoard ≠ ClaimContract ≠ ExecutorPrivateTodolist** — 各有作用域，不能合成一个大看板 |
| policy / state | **policy 只判定**；**state 承担事务**（锁、版本校验、认领、事实写入）不散落编排代码             |
| 共享执行后端   | 不统一所有场景入口：成员执行完成 ≠ 群契约完成；执行成功 ≠ 成果已送达                            |
| 迁移保留行为   | 不顺便改默认开关、规则阈值、提示词或调度顺序                                                    |

---

## 4. 已在 policy / state（个体可用）

| 规则                                                                     | 位置                                                 | 旧入口                         |
| ------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------ |
| 活绑定六元组 / 墓碑                                                      | `policy/task-binding.ts`                             | `session-task-board` re-export |
| 挂起上限 3、续跑 3 / 15min                                               | `policy/task-board-limits.ts`                        | `task-board-continue` facade   |
| 显式暂停/取消语                                                          | `policy/explicit-task-control.ts`                    | chat resume/parked recheck     |
| 约束归一 / 活跃约束                                                      | `policy/constraints.ts`                              | state mutations                |
| 验收 checks 解析                                                         | `policy/acceptance-checks.ts`                        | `admit-task`                   |
| 队列 steer/followup/drop                                                 | `policy/execution-queue.ts`                          | runner                         |
| 重试/过载退避上限                                                        | `policy/run-limits.ts`                               | execution                      |
| `stripInboundStamp`（权威副本）                                          | `policy/input-stamp.ts`                              | `turn-relation` 已 re-export   |
| admit / pause / cancel / resume / complete / continue claim / async-wait | `state/mutations/*`、`state/repository/async-wait-*` | `session-task-board` facade    |

---

## 5. 未完整收口 / 双源（按抽核修订）

| 规则簇                                    | 现文件（约行）                             | 问题（修订后）                                                                                   |
| ----------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 焦点切换启发式                            | `focus-switch.ts` (~382)                   | 纯判定 + transcript IO 混在一起；**自带第二份** `stripInboundStamp`（须先证行为等价再删）        |
| 回合关系 amend/conversation/new_work      | `turn-relation.ts` (~301)                  | **禁止整包升为新 policy 权威**；见 §6.2 I1 分类处理                                              |
| FOCUS/PARKED 槽、心跳禁动作、`decideWake` | `focus-policy.ts` (~169)                   | `MAX_PARKED_SLOTS=3` 与 `policy.MAX_PARKED_TASKS=3` **数值相同不足以合并**                       |
| 成功回复后关任务                          | `reply-completion.ts` (~310)               | **失败窗口优先核准**（见 I4 提前）：先 `transitionTask(closed)` 后 `recordCheckedTaskCompletion` |
| complex-task 整形旁路                     | `task-orchestration/complex-task-loop.ts`  | 默认关；抽核显示 `classifyTurnRelation` 消费者在此 `:186`；不得成为第二关闭权                    |
| ConversationTask 激活控制面 / ledger      | `control-plane.ts`、`ledger-binding.ts` 等 | 与 SessionTaskBoard **不同权威**；勿粗合                                                         |

### 5.1 双源 / 待证等价（优先消，但须先证语义）

1. `MAX_PARKED_TASKS`（policy，会话任务板限制）∥ `MAX_PARKED_SLOTS`（focus-policy，执行槽位）— **先判定是否同一种资源**
2. `stripInboundStamp`：`policy/input-stamp.ts` ∥ `focus-switch.ts` 本地实现 — **先用输入样本证明行为等价**
3. completion-gates：须明确 session 文件锁权威是「合法 state adapter」还是「已迁入仓库」——二选一写清，避免目录幻觉

### 5.2 消费者与权威清单（按抽核；原笼统清单作废）

先区分路径类型，再决定迁入/归档：

| 符号 / 机制                                 | 抽核消费者                                                                | 路径类型                                     | 处置方向                             |
| ------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------ |
| `shouldTaskParkAbortInFlight`               | Gateway `src/gateway/server-methods/chat.ts:6142`（同文件 turn-relation） | **现役主链安全谓词**                         | 核准职责后迁入 policy                |
| `classifyTurnRelation`                      | `task-orchestration/complex-task-loop.ts:186`                             | **须核实：观察路径 / 启用配置 / 是否默认关** | **不直接升级为新 policy 权威**       |
| 与 `interpretInteraction` 重复的分类        | （语义重叠）                                                              | 遗留 / 重复分流                              | **归档或退役**；不保留第二次语义分流 |
| Session 板 mutations                        | 经 facade / state                                                         | 现役主链                                     | 保持唯一写路径                       |
| ConversationTask `transitionTask("closed")` | `reply-completion.ts:291` 等                                              | 另一权威                                     | 与板完成**分别论证**；见 I4          |

更新清单时标注：现役主链 / 可选路径 / 观察路径 / 无消费者遗留。

---

## 6. 修订后的切片建议

> **提醒：** 下列为盘点后的切片建议，**不是可原样执行的实施指令**。每批开工前须另授权，并按 §7 验收四元组证明。

### 6.1 收口原则（保留）

1. **policy** 只收纯判定；**state** 只收既有板事务；IO/flag/ledger 留 conversation-task adapter。
2. 迁后旧文件只 **re-export / delegate**，禁止第二实现；**每批只移动一项权威实现**。
3. **SessionTaskBoard ≠ ConversationTask store/ledger** — 可联动关闭，权威不合并。
4. 不与协作 ClaimContract 切片混提同一变更集。
5. 不能为了「分类规则都在 policy」而恢复旧分类器的主链地位。
6. 本清单不改代码，直至另授权。

### 6.2 I0 — 先证语义，再消等价副本（修订）

| 项       | 内容                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 源       | `focus-policy.MAX_PARKED_SLOTS`；`focus-switch.stripInboundStamp`                                                                                                        |
| **先证** | 明确 `MAX_PARKED_SLOTS`（执行槽位）与 `MAX_PARKED_TASKS`（会话任务板限制）是否控制**同一种资源**；`stripInboundStamp` 用输入样本证明与 `policy/input-stamp` **行为等价** |
| 合并条件 | **相同资源 / 已证等价** → 合并为单一常量或单一实现，旧文件改 import + re-export                                                                                          |
| 不同则   | **保留独立名称与归属**；不得因「当前都等于 3」合并                                                                                                                       |
| 验证     | 既有 focus-policy / focus-switch / turn-relation 测试；`rg` 无未核准第二实现                                                                                             |

### 6.3 I1 — turn-relation：**禁止整包迁移**（修订）

原「I1 整包迁入 `classifyTurnRelation` + 笼统消费者」**作废**。改为分类处理：

| 内容                                                       | 建议                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| 仍被主链使用的安全谓词（如 `shouldTaskParkAbortInFlight`） | 核准职责后迁入 policy                                    |
| 旧 `classifyTurnRelation`                                  | 先核实观察路径与启用配置，**不直接升级为新 policy 权威** |
| 与 `interpretInteraction` 重复的分类                       | 归档或退役，**不保留第二次语义分流**                     |

| 项               | 内容                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| 可迁入（核准后） | `shouldTaskParkAbortInFlight`；确属主链且职责清晰的 owner-constraint 等安全谓词                                 |
| 暂不升权威       | `classifyTurnRelation` 及 LANGUAGE_ASIDE / PRIOR_CORRECTION / AMEND / NEW_WORK 整包分类器                       |
| 依赖             | 若迁安全谓词，可依赖已证等价的 `stripInboundStamp`（policy）                                                    |
| 旧文件           | 未退役前可 facade；**禁止**为目录整齐把整文件搬进 `policy/turn-relation.ts` 当新产品权威                        |
| 消费者（抽核）   | Gateway 用 `shouldTaskParkAbortInFlight`（`chat.ts:6142`）；`classifyTurnRelation` → `complex-task-loop.ts:186` |
| 不做             | 不并入 `interpretInteraction`；不改分类语义「顺便优化」；**不为「都在 policy」恢复旧分类器主链地位**            |

### 6.4 I2 — focus-policy → policy（小批；在 I0 语义结论之后）

| 项     | 内容                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 常量   | `MAX_FOCUS_SLOTS=1`；park 上限按 I0 结论（合并或独立命名）；`WAKE_REASONS`；`HEARTBEAT_FORBIDDEN_ACTIONS`；`isHeartbeatActionAllowed` |
| 判定   | `decideWake` / parkIncomingDroppingOldest / parkCurrentAndSwitch → 如 `policy/focus-wake.ts`（每批一项权威）                          |
| state  | 实际 park/switch 仍走既有 `task-focus` / `task-record`                                                                                |
| 消费者 | `infra/heartbeat-focus`、`heartbeat-parked-notice`、cron focus                                                                        |
| 不做   | 不把 ConversationTask SQLite 控制面搬进 agent-runtime state；不改变默认开关/阈值                                                      |

### 6.5 I3 — focus-switch 纯判定（可选紧随）

| 项         | 内容                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| → policy   | `isLikelyNewTask`、`incomingRejectsFocus`、`tokenOverlapRatio`、`GOAL_OVERLAP_THRESHOLD`、deixis/markers 谓词（确认现役后再迁） |
| 留 adapter | `read*FromTranscript` / sessionFile IO                                                                                          |
| fence 文案 | 可跟判定进 policy 或 context 投影；**不写板**                                                                                   |
| 前置       | I0 已处理本地 `stripInboundStamp`（等价合并或明确保留理由）                                                                     |

### 6.6 I4 — 完成状态一致性（**提前**；不能排最后）

`src/conversation-task/reply-completion.ts:291` 当前顺序：

1. `store.transitionTask(task.id, "closed")`
2. 随后才 `recordCheckedTaskCompletion`

这不证明已经发生错误，但存在**需核准的窗口**：前一权威已关，后一因绑定或写入失败未完成。

| 归属                         | 内容                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 须先定义                     | 两种「关闭」各代表什么（ConversationTask store closed vs SessionTaskBoard 完成）                           |
| 须先定义                     | 后一步失败时的**重试、拒绝、对账**行为                                                                     |
| 留 conversation-task（编排） | activation flag、tenant、ConversationTask store 匹配、alignment 观测、ledger close、delivery-close consult |
| 已在 / 须只经 state          | `recordCheckedTaskCompletion` / `finishCurrentTask`；binding 校验；**不得**另写 session board 文件         |
| 可抽 policy（可选）          | 何时允许关板：aligned / strictEvidence / empty-reply 拒绝 — 纯谓词                                         |
| 不做                         | **无需合并两个存储**；**不新增总控**；不能只声明「两条权威」就当闭环成立                                   |
| 验证                         | 失败窗口有收口路径；严格证据失败不造成「一边 closed、一边板未完成」且无人理会；binding 错配不落盘          |

**权威声明：** `store.transitionTask("closed")` 与 SessionTaskBoard 完成是两条权威；本切片要保证：**分别可论证 + 失败可收口**，且后者只经 state。

---

## 7. 建议收尾顺序（替换原 I0→I1→I2→I3→I4）

| 步  | 内容                                                                                              | 对应                   |
| --- | ------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | **更新消费者与权威清单**：区分现役主链、可选路径、观察路径、无消费者遗留                          | §5.2                   |
| 2   | **优先核准完成状态一致性**：reply-completion 与受控完成入口失败窗口                               | **原 I4 提前**         |
| 3   | **消除已证实等价的副本**：输入清洗与确实同义的常量                                                | **修订后 I0**          |
| 4   | **小批迁移现役纯规则**：每批只移动一项权威实现，不保留双实现（含核准后的安全谓词、focus-wake 等） | I1 拆分 + I2 + 可选 I3 |
| 5   | 协作事务逐项收口（见协作文档）                                                                    | 协作文                 |
| 6   | **最后清理兼容门面**：消费者归零、恢复资产核准后再删除                                            | 退役门                 |

**每切片验收须同时证明：**

1. **唯一实现**
2. **正确消费者**
3. **行为等价**
4. **失败可收口**

公开入口和目录检查只是其中一部分；**不能**用 helper 文件数 / 目录齐全代替主链收口。

---

## 8. 明确不做

- 不把 `complex-task-loop` 当个体主链（默认关；验收不得第二关闭权）
- **不为「分类规则都在 policy」整包迁移或恢复 `classifyTurnRelation` 主链地位**
- 不因「都等于 3」合并 `MAX_PARKED_SLOTS` 与 `MAX_PARKED_TASKS`
- 不删 `control-plane` / ledger，除非另开退役证据（见 `retirement-intent-contract.md`）
- 不与协作 S0–S5 混提
- 不用「helper 文件数 / 目录齐全」代替主链收口
- **不把本盘点文档原样当实施指令**

---

## 9. 专家验收检查点（修订）

1. 是否承认：**盘点依据 ≠ 可原样实施指令**；I1/I4 修订已写入正文？
2. 消费者清单是否已按抽核区分现役主链 / 观察或可选路径 / 遗留（Gateway 用 `shouldTaskParkAbortInFlight`，而非笼统「classifyTurnRelation 消费者」）？
3. 完成态：两种「关闭」语义与失败重试/拒绝/对账是否已定义，而不仅是「两条权威」声明？
4. 常量与 `stripInboundStamp`：是否先证同资源/行为等价，再合并？
5. Session 板任何完成/取消/续跑写是否只经 **state mutations**？
6. ConversationTask ledger 关闭与 SessionTaskBoard 完成是否仍可**分别**论证且失败可收口？
7. 是否避免为目录整齐恢复旧分类器主链地位？
8. catalog 更新后是否诚实标注仍非完整 inventory（或补齐声明）？

---

## 10. 与协作文档的分工

| 文档                                                   | 覆盖                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 本文                                                   | 1:1 / 成员会话执行规则收口；完成态窗口；个体纯规则小批迁移                                  |
| `collab-policy-state-migration-boundary-2026-11-09.md` | 群 ClaimContract / EffectivePolicy / 计划确认 / peer review；Gateway 迁移期暂留 vs 最终归属 |

共享执行、三状态分离、policy/state 分工、迁移保留行为见两文共同硬边界（§3）。

— 执行器迁移 / 2026-11-09（修订：纳入专家评审 t37u）
