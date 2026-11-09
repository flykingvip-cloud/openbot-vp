# 协作小组长程任务规则 → policy/state 迁移边界（修订版）

**日期：** 2026-11-09（Asia/Shanghai）
**核对树：** `runtime-convergence/openbot`
**分支：** `codex/openbot/runtime-convergence`
**文档原定位 tip：** `5b46483c9`（`5b46483c96fb087723e959545a3106e2699466b9`）
**专家源码抽核 tip：** `e3fef11c8b40a8ec0ace10a29e2fd82e07c9be66`（消费者/权威清单按此修订）
**作者角色：** 执行器迁移（grok-bot）
**性质：** **迁移盘点依据 + 修订后的边界/切片建议。不宜原样作为实施指令。** 方向正确；若切片把旧机制整包搬进新目录，会固化重复逻辑。本轮仍不改代码、不跑测试；实施须另授权；仍不 push/PR/部署。

**配套交互页：** [协作小组长程任务规则体系](https://cursor.com/canvas/store-761ce8fe-deeb-4b47-b0f3-f32c7a3b3acc/bd5a2b21-9e94-4c2e-aa39-dba05d0d2040)（页签「迁移边界 / 尚未迁入」）

**配套个体文档：** [`individual-policy-state-closure-slices-2026-11-09.md`](./individual-policy-state-closure-slices-2026-11-09.md)

**修订依据：** 专家评审 t37u — 批准作盘点；「留 Gateway」改为**迁移期暂留**；精确化 SessionTaskBoard 共用；编译器/群板强调行为锁定而非文件搬家；flag 保留迁移前默认/配置/启用行为。

---

## 1. 定位声明（盘点 ≠ 实施指令）

| 声明 | 含义 |
| --- | --- |
| 批准用途 | 作为协作机制迁移盘点与分层归属核对依据 |
| 不宜原样实施 | 原「§6 留 gateway」易被读成最终架构；原「flag 默认 OFF」易破坏迁移保留行为 |
| tip 差异 | 文档定位基线 `5b46483c9`；抽核基于 `e3fef11c8…` — 清单与归属表按评审修订 |
| 本轮范围 | 只修订文档；不改代码、不跑测试、不提交 |

---

## 2. 结论（给专家）

| 问题 | 结论 |
| --- | --- |
| 协作成员执行长程任务时，会话级绑定/续跑/墓碑/async-wait 是否已在 agent-runtime？ | **部分是（共享能力）** — 与个体共用若干 policy + state 能力；**准入权威仍须区分**（见 §4） |
| 群治理与群板契约（ClaimContract、计划确认、peer review、EffectivePolicy）是否已在 agent-runtime policy/state？ | **否** — 仍在 `src/gateway/collaboration-dispatch/` |
| 是否应迁入？ | **应迁（分批）** — 机制判定 → policy；原子事实 → state/群 store；**Gateway 仅为迁移期暂留宿主，不是最终领域归属** |
| 本文件是否授权开工？ | **否** — 仅盘点边界；切片开工需另授权 |
| 原「留 Gateway」表述是否可作最终架构？ | **否** — 改为迁移期暂留；最终归属见 §3.2 |

---

## 3. 应保留的设计 / 硬边界

与个体文档共有：

| 边界 | 要求 |
| --- | --- |
| 三状态分离 | **SessionTaskBoard ≠ ClaimContract ≠ ExecutorPrivateTodolist** — 不能合成一个大看板 |
| policy / state | **policy 只判定**；**state 承担事务**（锁、版本校验、认领、事实写入）不散落编排 |
| 共享执行后端 | 不统一所有场景入口：成员执行完成 ≠ 群契约完成；执行成功 ≠ 成果已送达 |
| 迁移保留行为 | 不顺便改默认开关、规则阈值、提示词或调度顺序 |

### 3.1 三板分离（禁止合并）

| 对象 | 作用域 | 现状权威位置 |
| --- | --- | --- |
| **SessionTaskBoard** | 成员/私聊会话焦点、约束、墓碑、续跑抑制 | `agent-runtime/state`（`conversation-task/session-task-board.ts` 多为 facade） |
| **ClaimContract** | 群共享目标/认领/提交/评审/版本 | `gateway/collaboration-dispatch/claim-contract.ts` |
| **ExecutorPrivateTodolist** | 认领后成员私有计划 propose/confirm/revise | `gateway/collaboration-dispatch/executor-private-todolist.ts` |

共享执行器只接受**已准入**工作项并返回证据/失败/等待回执；不能确认私有计划、不能关闭群契约、不能把成员结果推断为组成果终局投递。

### 3.2 分层职责 — 最终归属（非「永久留 Gateway」）

迁移期可以把轮次编排、唤醒、prompt、投递**暂留**在 Gateway；**最终架构**须按下表收敛。不要求现在搬完；**禁止把「暂留宿主」写成最终职责**。

| 职责 | 最终归属 |
| --- | --- |
| 群目标、认领、评审和回合编排 | **command** 的协作领域组件 |
| 合法转移、审批要求、策略编译 | **policy** |
| 群板、私有计划和评审事实事务 | **state** |
| 群材料与提示词投影 | **context** |
| 成果展示与实际投递 | **delivery** |
| 请求入口、连接与事件转接 | **Gateway adapter** |

| 层 | 可包含 | 禁止 |
| --- | --- | --- |
| **policy** | 纯函数：快照 → allow/deny/limits/下一状态合法性 | IO、锁、config 副作用、动态 import 规则引擎 |
| **state / 群 store** | 锁内 RMW：读事实、调 policy、写 revision/tombstone/日志 | 拼 prompt、wake fan-out、渠道投递 |
| **command（协作领域）** | 群目标/认领/评审/回合编排（最终） | 私藏第二套 L1 硬不变量实现 |
| **context / delivery** | 材料与提示词投影；成果展示与实际投递（最终） | 写群板事实、改 ClaimContract 状态 |
| **Gateway adapter** | 请求入口、连接与事件转接；迁移期可暂留编排副作用 | 迁完后仍私藏机制判定为「最终归属」 |

---

## 4. 已共用规则 — 「协作成员共用 SessionTaskBoard」精确化

**不能**用一句「都走会话板」概括。须区分：

| 维度 | 含义 |
| --- | --- |
| **共享能力** | 取消、等待恢复、身份围栏、执行生命周期（绑定/墓碑/async-wait 等）— 成员执行路径可复用 agent-runtime policy/state |
| **准入权威** | **个人任务**由个人准入负责；**协作工作**由群回合和契约负责 |

硬约束：

- **不能**要求协作成员额外创建个人任务才能执行群工作。
- **不能**让个人看板关闭群契约。
- 须**逐个恢复入口核准 binding** 要求；async-wait 仍须 `jobId`+`claimToken` 等既有栅栏。
- 群板状态**不写入** session board；`claimQueuedExecution` 协作路径不因 ClaimContract 跳过 binding。

（源码可溯的共享能力示例，仍受上述准入区分约束：）

| 规则簇 | policy / state |
| --- | --- |
| 活绑定六元组、墓碑 | `policy/task-binding.ts` |
| 挂起上限 3、续跑 3 次 / 15 min | `policy/task-board-limits.ts` |
| 显式暂停/取消语 | `policy/explicit-task-control.ts` |
| 约束归一 / 活跃约束 | `policy/constraints.ts` |
| 验收 checks 解析 | `policy/acceptance-checks.ts` |
| 占用队列 steer/followup/drop | `policy/execution-queue.ts` |
| admit / pause / cancel / resume / complete / continue claim / async-wait 阶段栅栏 | `state/mutations/*`、`state/repository/async-wait-*`、`state/continuation-ticket.ts` |

---

## 5. → policy（纯判定）迁入目标 — 行为锁定，非文件搬家

迁前须锁定：**同输入下的有效策略、限制、policyHash**（尤其 `compileEffectiveCollaborationPolicy`）。迁后证明行为等价；**不是**按文件搬迁了事。

| 建议目标路径 | 现文件（约行） | 抽什么 |
| --- | --- | --- |
| `policy/collaboration/system-invariants.ts` | `effective-policy.ts` (~440) | `SYSTEM_INVARIANTS`、`OBSERVER_PERMISSIONS`、`MODE_TEMPLATES`、相关类型与 L1 硬常量 |
| `policy/collaboration/compile-effective.ts` | `policy-compiler.ts` (~443) + `L1_DEFAULT` | `compileEffectiveCollaborationPolicy`：L2 不可 widen L1、clamp、provenance；**同输入同 policyHash** |
| `policy/collaboration/board-transitions.ts` | `claim-contract.ts` 状态机守卫 | published→…→accepted/cancelled 合法边；`oralDispatchCreatesBoardFact=false`；空提交不算成功 |
| `policy/collaboration/submit-versioning.ts` | `submit-review-versioning.ts` (~197) | artifactVersion、`pendingSubmissionMatches`、`acceptanceCriteriaFullyChecked`、空/重复正文 |
| `policy/collaboration/peer-review.ts` | `peer-review-gate.ts` 判定部分 | `requirePeerReview` 时 accept 前 ≥1 非作者评审；`drivesAdmission=false` |
| `policy/collaboration/plan-gate.ts` | `plan-gate-exec.ts` (~360) | `evaluateDeliveryExecGate` / `boardTodolistDeliveryMapping`；markInProgress 须 confirmed todolist |
| `policy/collaboration/governance.ts` | `governance-gate.ts` (~141) | `evaluateGovernanceGate`：finalize / publish_proposal / self_advance |
| `policy/collaboration/handoff.ts` | `handoff-contract.ts` 分类函数 | `classifyHandoffApplyAgainstLive`、角色/审批要求（纯） |

**组合根：** `resolve-effective-policy.ts` 的「唯一组合根」接口可在迁移期留 Gateway/command 薄壳；算法与 hash 进 policy；宿主只喂 `operatingState` / overlay。

---

## 6. → state / 群 store 迁入目标 — 锁边界保留

迁前锁定事务中的 **读取 → 校验 → 写入**；**fan-out 保持锁外**。

| 建议目标 | 现文件（约行） | 事务 |
| --- | --- | --- |
| `state/group-board/*` 或 collab store | `claim-contract.ts` (~2676) | publish / claim / apply / markInProgress / submit / accept / return / block / unblock / cancel；`withRoundLock` + revision |
| `state/executor-todolist/*` | `executor-private-todolist.ts` (~1101) | propose / confirm / revise / superseded；**非**群共享板子记录 |
| `state/peer-review/*` | `peer-review-gate.ts` 写路径 | append `peer_review`；accept 前读门闩 |
| `state/handoff/*` | `handoff-contract.ts` (~1155) | propose/apply 锁内写；责任快照更新 |

与 SessionTaskBoard：仅共享 §4 所述**能力**；准入与契约关闭仍归群回合/ClaimContract。

---

## 7. 迁移期暂留 vs 最终归属

下列在**迁移期**可暂留现宿主（今日多在 Gateway / `collaboration-dispatch`）；验收时标注「暂留」，并对照 §3.2 最终归属，避免写成永久职责。

| 暂留内容（迁移期） | 最终应归 |
| --- | --- |
| `decision-engine` / `round-runtime` / 回合编排 | command 协作领域组件 |
| `wake-*` / `floor-*` / `postClaimFanoutWake` / `boardKickoffMultiParticipant`（**锁外** side-effect） | command（编排）+ 必要时 delivery；fan-out 仍锁外 |
| `delivery-exec-prompt` / `discussion-turn-prompt` | context（投影） |
| `human-attention-*` / cards / chat send | delivery |
| `policy-lane-*` / `cheap-gate` | 纯判断逐步下沉 policy；副作用留 command/adapter |
| `loadConfig` 读 `collaboration.task.*` flag、gray allowlist、`RuntimeAuthority` 路径 | Gateway adapter + 配置边界；**不借迁移统一改默认** |
| 请求入口、连接与事件转接 | Gateway adapter |

---

## 8. 建议切片顺序（开工时；保留行为）

> **提醒：** 盘点建议，**不宜原样当实施指令**。每切片须：行为等价、正确消费者、唯一实现、失败可收口。

| 切片 | 内容 | 约束（修订） |
| --- | --- | --- |
| S0 | `SYSTEM_INVARIANTS` + OBSERVER + MODE_TEMPLATES → policy；旧处 re-export | 行为字节等价；**保留迁移前默认值/配置/启用行为** |
| S1 | submit-review-versioning 纯函数 → policy；claim-contract 改 import | **不统一把 flag 改成 OFF**；保留迁移前默认/配置/启用行为 |
| S2 | governance-gate / peer-review 判定 → policy；写路径仍宿主或薄 state | peer review 不驱动 Admission |
| S3 | plan-gate-exec 纯门闩 → policy；todolist confirm 事务边界划清 | 与 SessionTaskBoard 分离；核准 binding |
| S4 | ClaimContract 状态转移表 → policy；`mutateBoardClaimItem` 收口 state/群 store | 锁内「读→校验→写」；**锁外 fan-out 不变** |
| S5 | `compileEffectiveCollaborationPolicy` + hash → policy；resolve-* 留薄壳 | **同输入同有效策略/限制/policyHash** |

全程：测试随迁；不碰 LIVE/Floor（除非另授权）；不 push/PR 除非另授权；**不与个体 I 切片混提同一变更集**。

与全局收尾顺序对齐（个体文 §7）：协作事务为第 5 步「逐项收口，保持三种状态作用域及现有锁边界」；最后再清兼容门面。

---

## 9. 明确不做

- 不把 ClaimContract 并进 SessionTaskBoard
- 不把 ExecutorPrivateTodolist 做成群共享板
- 不让 peer review 驱动 Admission
- 口头「已派工」不成板事实
- 不要求协作成员额外创建个人任务；不让个人看板关闭群契约
- 不因目录齐全宣布协作机制已迁完
- **不把 Gateway 暂留写成最终领域归属**
- **不统一把 flag 改成 OFF** 冒充「安全迁移」
- **不把本盘点文档原样当实施指令**
- 不与个体完成态/I1 分类器整包迁移混提

---

## 10. 专家验收检查点（修订）

1. 是否承认：**盘点依据 ≠ 可原样实施指令**；「留 Gateway」已改为迁移期暂留 + §3.2 最终归属表？
2. 「共用 SessionTaskBoard」是否已区分为共享能力 vs 准入权威，且逐入口核准 binding？
3. `compileEffectiveCollaborationPolicy` 迁后是否同输入同 policyHash / 有效策略 / 限制？
4. 群板写是否只经一条 store 事务（读→校验→写），fan-out 仍在锁外？
5. Session / Claim / Todolist 三板边界是否在代码与文档中仍可分离论证？
6. 迁移是否**保留**迁移前默认值、已有配置及启用行为（而非统一 OFF）？
7. Gateway/command 是否仍可编排，但迁完后不再私藏 L1 硬不变量实现为「最终归属」？
8. 每切片是否证明：唯一实现、正确消费者、行为等价、失败可收口？

---

## 11. 遗留问题（诚实）

1. **架构债：** EffectivePolicy 编译链与 ClaimContract 全状态机仍在 gateway（相关核心约 7k+ 行量级）；迁往 command/policy/state 需多批且保持行为。
2. **双权威风险：** 迁入过程中若 re-export 不严，易出现第二判定副本。
3. **个体缺口并行：** 见配套个体文档（I1 拆分、I4 提前）；勿与本清单混提同一 PR。
4. **Package6 / completion-gates：** 源码迁移阶段可关闭 ≠ 旧执行器全部退役 ≠ 生产终验通过。
5. **暂留清理：** 迁移期 Gateway 宿主清单须有退出条件（消费者归零 + 恢复资产核准），否则「暂留」会变成事实终态。

— 执行器迁移 / 2026-11-09（修订：纳入专家评审 t37u）
