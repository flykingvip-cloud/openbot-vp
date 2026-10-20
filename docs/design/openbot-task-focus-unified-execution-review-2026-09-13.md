# OpenBot 任务聚焦与执行一体化：现状分析与改造执行方案

> **Status:** v0.4.6 — Phase 0 **通过**；Phase 1b **范围冻结继续**；[Phase 2 合同 v0.4.6](./openbot-task-focus-unify-phase2-shared-objective-amendment-2026-09-13.md)；[shadow 计划 v0.1](./openbot-task-focus-unify-phase2-shadow-implementation-plan-2026-09-13.md) **已签收**；[PR #1107](https://github.com/gmood2008/openbot/pull/1107) 实现 **已批准合入，进入观测期**；Phase 3a/3b/4/5 **仍不批准**
> **Branch:** `cursor/task-focus-unify-phase0`
> **Date:** 2026-09-13
> **关联规范:** `.kiro/specs/conversation-task-runtime/execution-plan.md`、`.kiro/specs/task-progress-ledger/design.md`
> **Harmful WIP 位置:** 仅 **共享 dirty tree**（`openbot/` @ `a79cc5309e`）— **禁止 replay** 到本分支

---

## 0. 文档控制

| 字段                         | 内容                                                                  |
| ---------------------------- | --------------------------------------------------------------------- |
| **审核结论**                 | Phase 0 **通过**；v0.4.5 I25 未进入增补权威表 → **v0.4.6 待最终签收** |
| **Phase 1a**                 | **N/A**                                                               |
| **Phase 1b**                 | **已批准、范围冻结**：Cron L2 prompt only、默认 OFF、零 alignment     |
| **Phase 2 合同**             | v0.4.6 待最终签收（通过后结束设计审查）                               |
| **Phase 2 shadow / Phase 3** | 实现已批准合入、进入观测期；**不得**进入 3a/3b/4/5                    |

### 0.1 专家组审核历程

| 审核项                                                 | 结论                                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| 总架构（单内核、多 shell、Objective/Completion 合同）  | 认可                                                                   |
| I1–I15                                                 | 原则通过                                                               |
| I16–I21（Shared Objective / Work Unit / Contribution） | v0.4 方向通过；类型不足，v0.4.1 修订                                   |
| I22（lease fencing / CAS）                             | v0.4.2 slot 级 generation 已认可                                       |
| I23（原子 claim + ActiveLeasePointer）                 | v0.4.4 冻结方案 A                                                      |
| I24（distinct contributors）                           | v0.4.4 新增                                                            |
| I25（Contribution 实际覆盖）                           | v0.4.6 纳入增补权威表，与主方案逐字一致                                |
| Objective ingress allowlist + revision freeze          | 通过                                                                   |
| Phase 1a 回滚 PR                                       | **N/A**                                                                |
| Phase 1b 纯 L2 prompt                                  | **可继续**；范围冻结                                                   |
| Phase 0                                                | **最终通过**（提交 / Loom / clean / trailers / `diff --check` 已闭合） |

### 0.2 Phase 0 签收清单

- [x] §5.1 Ledger 污染及 remediation
- [x] §9 I1–I15
- [x] Objective allowlist → [交付物 §4](./openbot-task-focus-unify-phase0-deliverables-2026-09-13.md#4-objective-allowlistphase-0-定稿)
- [x] Phase 1a **N/A**；Phase 1b 独立批准
- [x] Ingress 分类 → [交付物 §3](./openbot-task-focus-unify-phase0-deliverables-2026-09-13.md#3-ingress-完整分类phase-0-定稿)
- [x] Git commits（6 commits，trailers 齐全；签收 tip 见交付物 §9.2）
- [x] `git diff --check origin/main...HEAD` exit 0
- [x] Loom `task-focus-unified-execution:cursor-task-focus-unify` + tasks.md
- [x] worktree clean + attribution 0 dirty

---

## 1. 执行摘要

OpenBot **已具备统一 Agent 执行内核**（Embedded：`runEmbeddedPiAgent`；CLI：`runCliAgent`）。总架构方向：**单内核、多 shell、统一 Objective/Completion 合同**。

**v0.4.6 要点：**

1. Phase 0 通过；Phase 1b 继续且不扩大。
2. I16–I25 在主方案 §9 与增补 §4 **同一权威表、I25 逐字一致**。测试 #32–#34 证明 I25。
3. Phase 5：review/synthesis 的 Contribution 实际覆盖并集包含 Definition 声明；不得只看声明。
4. Shadow 仍只观测 Objective + 拟议 Definition。实施计划已提交：[shadow 计划 v0.1](./openbot-task-focus-unify-phase2-shadow-implementation-plan-2026-09-13.md)。签收前不得实现。
5. 合同全文：[Phase 2 增补 v0.4.6](./openbot-task-focus-unify-phase2-shared-objective-amendment-2026-09-13.md)。

---

## 2. 事故摘要

| 现象                  | 根因                                                                      |
| --------------------- | ------------------------------------------------------------------------- |
| Cron 跑「中医诊断学」 | L2 无 authoritative 契约                                                  |
| Gateway 标成功        | L4 过宽（summary≥40 字）                                                  |
| 在途「修复」          | 引入 Ledger 伪造 evidence + L4 alignment 回归（**仅 dirty shared tree**） |

---

## 3. 现状：执行系统

### 3.1 五层模型

```text
L0 Ingress → L1 Dispatch → L2 Run Shell → L3 Kernel (Pi/CLI) → L4 Post-Run → L5 Projection
横切：CommandLane | Session Store | Progress Ledger
```

### 3.2 L3 内核（I1）

| 组件        | 路径                                   |
| ----------- | -------------------------------------- |
| Embedded Pi | `src/agents/pi-embedded-runner/run.ts` |
| CLI Pi      | `src/agents/cli-runner.ts`             |

### 3.3 核心 Ingress 映射

| Ingress                    | L2 Shell                            | lane     |
| -------------------------- | ----------------------------------- | -------- |
| `chat.send`                | `get-reply-run` → `runReplyAgent`   | main     |
| 协作 round                 | `runGroupBotDiscussionTurn`         | main     |
| Cron isolated              | `isolated-agent/run.ts`             | nested   |
| Heartbeat / Cron main      | `heartbeat-runner`                  | main     |
| Gateway agent / CLI / HTTP | `agentCommandFromIngress`           | main     |
| Subagent                   | child session + extraSystemPrompt   | subagent |
| ACP                        | `tryDispatchAcpReply` → ACP runtime | main     |

### 3.4–3.5 CommandLane 与 Ingress 扩展

CommandLane：`src/process/lanes.ts`。
**完整 Ingress 分类表**（channels、extensions、nested callers、hooks）：[交付物 §3](./openbot-task-focus-unify-phase0-deliverables-2026-09-13.md#3-ingress-完整分类phase-0-定稿)。

---

## 4. 三套「目标」与执行路径

| 体系               | 存储           | 执行                   | Ledger                  |
| ------------------ | -------------- | ---------------------- | ----------------------- |
| task-context-store | workspace JSON | 无独立执行             | 无                      |
| ConversationTask   | SQLite         | activation 不 dispatch | seed（规范：tool 驱动） |
| Cron meta          | job + payload  | CronService → isolated | 完整 tool 路径          |

**dirty shared tree P0：** `reply-completion` + `ledger-binding` 用 assistant reply 伪造 evidence（**trunk 无此代码**）。

---

## 5. L4 与 Ledger

### 5.1 Ledger 冻结不变式（I7）

禁止 assistant 自述 / run summary 作为 canonical evidence（`.kiro/specs/task-progress-ledger/design.md:13,83`；CTR execution-plan §9）。

### 5.2 dirty tree 在途问题（**不 replay**）

`src/conversation-task/ledger-binding.ts` 构造 `source: "conversation_reply"` → `STEP_EXECUTED` / validation `passed` — **仅存在于共享 WIP**，trunk 无 `completeConversationTaskLedgerOnReply`。

---

## 8. 目标态架构

### 8.3 Objective Resolver

Ingress **allowlist**（非全局 linear precedence）；`ResolvedObjective` 含 `objectiveId`、`revision`、`source`、可选 `conflict` — 详见 [交付物 §4](./openbot-task-focus-unify-phase0-deliverables-2026-09-13.md#4-objective-allowlistphase-0-定稿)。

**v0.4.6：** Resolver 冻结 snapshot。I25 覆盖规则在主方案与增补权威表逐字一致。

### 8.4 Alignment 三态

```ts
type AlignmentVerdict = "aligned" | "misaligned" | "indeterminate";
```

Phase 4 前 **零** alignment 调用改变 run 结果（I6/I14）。

### 8.5 Content / Delivery（I15）

```text
contentOutcome   = f(execution, validation, enabledAlignmentGate)
deliveryOutcome  = g(deliveryAttempt, deliveryResult)
delivery-only ok ⇔ contentOutcome successful AND deliveryOutcome failed
```

高置信 misaligned ⇒ content 失败 ⇒ **不得**因 delivery 失败而整体 ok。

### 8.6 Shared Objective 模型（v0.4.6）

| 层                 | 合同                                                              | 排他 / 写入                                        |
| ------------------ | ----------------------------------------------------------------- | -------------------------------------------------- |
| Shared Objective   | 同组共享 `objectiveId` + `revision`                               | **禁止** 全局 exclusive claim（I16）               |
| Participation      | 协作 `groupId` 必填；`participationEpoch` 进入 Lease/Contribution | 离组/换 epoch 后旧 lease 不得写                    |
| WorkUnitDefinition | 分工合同；`createdBy` 按 §2.2.3 矩阵。**不是** Ledger step        | policy 不可变（I17）                               |
| WorkUnitLease      | 历史 append-only；current active = `ActiveLeasePointer`（方案 A） | 每 slot 一行 pointer；authoritative clock 判断过期 |
| Contribution       | fence + actor + **coversWorkUnitIds**（I25）                      | 实际覆盖驱动 Phase 5；单条不得关闭 Objective       |

全文：[Phase 2 增补 v0.4.6](./openbot-task-focus-unify-phase2-shared-objective-amendment-2026-09-13.md)。

**Orchestrator（Phase 8，I21）：** 只分解、分配、协调（含创建/修订 Definition）；不得生成 Ledger evidence、替代 validator、或直接判定 acceptance met。

---

## 9. 不变式 I1–I25

| ID  | 摘要                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I1  | 仅 Pi/CLI 内核                                                                                                                                                                                   |
| I2  | Cron isolated 保留                                                                                                                                                                               |
| I3  | 协作 round-runtime 保留                                                                                                                                                                          |
| I4  | 显式 CommandLane                                                                                                                                                                                 |
| I5  | completion 按 workType 参数化                                                                                                                                                                    |
| I6  | 新行为 flag 默认 OFF                                                                                                                                                                             |
| I7  | 禁止 reply/summary 作 Ledger evidence                                                                                                                                                            |
| I8  | alignment 三态                                                                                                                                                                                   |
| I9  | run 冻结 objective revision                                                                                                                                                                      |
| I10 | ingress allowlist + 租户校验                                                                                                                                                                     |
| I11 | 投影不得强于 Ledger                                                                                                                                                                              |
| I12 | 错误分 execution/alignment/validation/delivery                                                                                                                                                   |
| I13 | shadow 达标后才 gate                                                                                                                                                                             |
| I14 | flag OFF 不写 Ledger/不改状态                                                                                                                                                                    |
| I15 | content/delivery 分离评估                                                                                                                                                                        |
| I16 | 协作 Objective 允许多 participant 共同绑定；禁止对共享 Objective 全局 exclusive claim                                                                                                            |
| I17 | 排他只作用于 `workUnitId`；`coordinationPolicy` 属于不可变 WorkUnitDefinition（exclusive \| shared）；ContributionKind 正交。Lease 不得覆盖 policy                                               |
| I18 | Contribution 必须携带 objectiveId、revision、definitionEpoch、workUnitId、writer、contributionKind、coversWorkUnitIds、可解析 evidenceRefs、leaseId、leaseGeneration、slotId；append-only + 幂等 |
| I19 | 协作 Objective 只能由 round completion policy 按 required WorkUnitDefinition 聚合后完成；单个成员不得直接 closed                                                                                 |
| I20 | 所有 participant / definition / lease / contribution 必须使用同一冻结 Objective revision；旧 revision 不得写入新 revision                                                                        |
| I21 | Orchestrator 只分解、分配、协调；不得生成 Ledger evidence、替代 validator、或直接判定 acceptance met                                                                                             |
| I22 | 写 Contribution 必须 CAS：该 **slot** 的 `(leaseId, leaseGeneration)` 仍 active，且 definitionEpoch /（协作）participationEpoch 匹配。回收一个 slot **不得**使其他有效 lease 失效                |
| I23 | `claimWorkUnit` 必须在单一事务/CAS 内完成。每 slot 的 current active 只由 `ActiveLeasePointer` 表示。过期用 `storeNowMs()`。同一 executor 每 Work Unit 最多一个 active slot                      |
| I24 | `minContributors` 比较 distinct writer identity（当前 revision + definitionEpoch + 同 contributionKind）。同一 participant 多条/跨 generation/离组重入仍计 1                                     |
| I25 | execute/research 的 coversWorkUnitIds 必须为空；review/synthesis 必须非空且为 Definition 子集。completion 使用 Contribution 实际覆盖并集                                                         |

---

## 10. 分阶段方案

### Phase 0 — 基线与合同 ✅ **最终通过**

隔离 worktree；docs 提交；门禁 23/23；**无生产代码变更**。见 [交付物](./openbot-task-focus-unify-phase0-deliverables-2026-09-13.md)。

### Phase 1a — **N/A**

clean `origin/main` 无 harmful WIP。证据：`git diff origin/main...HEAD`（docs 前为空）；`rg assessTaskOutputAlignment` 无匹配。
**禁止：** replay harmful 代码再回滚。

### Phase 1b — Cron L2 focus prompt（**已批准，范围冻结**）

**范围（不得扩大）：** 仅 Cron L2 task-focus prompt；flag 默认 OFF；**零** alignment。
**禁止夹带：** Objective Lease、协作调度、Ledger 改造、I16–I25 运行时。
**禁止：** 从 dirty tree replay 含 L4 的 `task-focus` / `run.ts` 补丁。

### Phase 2 — Objective Resolver shadow（合同 v0.4.6；[计划 v0.1](./openbot-task-focus-unify-phase2-shadow-implementation-plan-2026-09-13.md) **已签收**；[PR #1107](https://github.com/gmood2008/openbot/pull/1107) **已批准合入，进入观测期**）

实现位于 `src/objective-shadow/**`：`OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW` **默认 OFF**；ON 时只写脱敏 shadow JSONL；接线忽略返回值。**不创建** Participation、持久化 WorkUnitDefinition、Lease、ActiveLeasePointer、Contribution 或 Ledger；**不改变**任何运行结果。**不是 Phase 3a/3b。** 合同见 [增补 v0.4.6](./openbot-task-focus-unify-phase2-shared-objective-amendment-2026-09-13.md)。

观测期仍须单独验收：窗口运行证据；source conflict / allowlist / inherit violation 指标；forbidden-write 恒为 0；7 天或 N=500 窗口关闭证据。Phase 3a/3b 接入设计、Phase 4 alignment、Phase 5 completion gate **当前均未批准**。

### Phase 3 — ingress 接入 Objective DTO

- **3a：** 单聊、Cron、Subagent 接入 Objective snapshot。
- **3b：** 协作组接入 Shared Objective、Participation、WorkUnitDefinition。
- **禁止** 把单聊 exclusive 模型复用到协作组。
- **3a / 3b 分别验收**，不随 Phase 2 合同或 shadow 自动放行。

### Phase 4 — Alignment shadow（唯一引入 alignment 调用）

分别评估：(1) Contribution ↔ 自己的 Work Unit；(2) Work Unit 仍属于冻结 revision；(3) synthesis 忠实覆盖各 Contribution。**不得**用成员局部分工对完整 Objective 做关键词重叠（会误报漂移）。

### Phase 5 — Completion gate（I13 + 签收）

协作完成至少：每个 required WorkUnitDefinition satisfied AND acceptanceIds 有已解析证据 AND review/synthesis 的 Contribution 实际覆盖并集包含 Definition 声明 AND 无未解依赖 AND revision/fence 有效。不得只看 Definition 声明。

### Phase 6 — 存储链接与 role 降级

### Phase 7 — Chat Ledger tool 观测（独立）

### Phase 8 — Orchestrator live（**独立批准，不自动继承**）

只允许：创建/修订 WorkUnitDefinition（policy 写在定义上）、分配 participant、检测重复领取 / policy 覆盖 / stale revision 与 epoch、触发 review/synthesis 单元、聚合状态。
禁止：生成 evidence、把 assistant 自述写成 Ledger 事实、直接设置 acceptance met、绕过协作 round completion policy（I21）。

---

## 13. 验证

### 13.1 Phase 0 门禁命令

```bash
cd /Users/daniel/AI项目/openbot-task-focus-unify
git fetch origin && test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git status --short
bun scripts/agent-attribution.ts

OPENBOT_TEST_PROFILE=low pnpm test \
  src/cron/isolated-agent.uses-last-non-empty-agent-text-as.test.ts \
  src/conversation-task/ledger-binding.test.ts
```

### 13.2 场景期望

| 场景                                 | 期望                     |
| ------------------------------------ | ------------------------ |
| trunk Cron 回归                      | 23 passed, 0 failed      |
| Phase 1b prompt 单测                 | 含目标锚点；无 alignment |
| Phase 5 content fail + delivery fail | error                    |
| Phase 5 content ok + delivery fail   | ok (delivery-only)       |

### 13.3 Phase 2+ 测试矩阵（实现前冻结；见增补 §9）

v0.4.6 冻结 34 条（增补 §9）。#32–#34 证明 I25。

---

## 附录 B — Completion 矩阵

| workType         | ingress       | alignment         | delivery 失败                       |
| ---------------- | ------------- | ----------------- | ----------------------------------- |
| l0_chat          | chat          | skip → Ph4 shadow | N/A                                 |
| l2_long          | chat          | Ph4 → Ph5         | N/A                                 |
| scheduled_action | cron_isolated | Ph4 → Ph5         | delivery-only **仅 content 已成功** |
| collaboration    | collaboration | Ph4 shadow        | N/A                                 |

---

## 修订历史

| 版本                | 说明                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------- |
| 0.1–0.2             | 初稿与首轮专家修订                                                                           |
| 0.3                 | 二轮专家修订；1b 纯 L2；I15；Ph7/8 拆分                                                      |
| **0.3.1**           | 三轮整改：Phase 1a N/A；禁止 harmful replay；worktree 洁净性；Git 提交证据                   |
| **0.4**             | 合同增补初版。专家：方向正确，类型不足以防重复执行与 stale writer → 修订后再审               |
| **0.4.1**           | WorkUnitDefinition + 全局 leaseEpoch。专家：shared 误杀合法同伴等 4 个 fencing 缺口 → 再修订 |
| **0.4.2**           | slot 级 fencing。专家：创建者规则自相矛盾；claim 非原子 → v0.4.3                             |
| **0.4.3**           | 授权矩阵 + 原子 claim。专家：generation UNIQUE 不能保证单 active；minContributors 按行数虚增 |
| **0.4.4**           | 方案 A + distinct contributors。专家：Contribution 无法记录实际覆盖                          |
| **0.4.5**           | 覆盖规则写入叙述，但增补权威表未按序收录 I25                                                 |
| **0.4.6**           | 增补 §4 = I16–I25；I25 与主方案逐字一致；#32–#34 证明 I25；Phase 5 措辞对齐                  |
| **shadow 计划 0.1** | 独立实施计划提交；不改合同；实现 / 3a / 3b 仍不批准                                          |
