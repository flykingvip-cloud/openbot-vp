# Task Progress Ledger 执行方案

> 状态：编码前冻结（评审 9.2/10 + 二次补约束）  
> 规格：`requirements.md` · `design.md` · `tasks.md`  
> 原则：OpenBot 不向用户展示「AI 想做什么」，而向用户展示「数字员工已经完成什么、正在执行什么、为什么停下，以及距离验收还缺什么」。

本文是实现手册：先冻合同，再按 P0→P6 闭环落地。**未完成 P0 invariant 单测前，禁止写 UI。**

---

## 0. 产品定位

Progress Ledger 不是 UX 装饰，而是 **数字员工执行过程的可观察状态层**：

```
Task State → Turn Contract → Execution Events → Evidence → Acceptance → Audit → Progress Projection → 用户控制
```

禁止：

```
User Goal → LLM Todo / run 摘要猜测 → UI「真实进度」
```

必选：

```
USER GOAL
    ↓
ACCEPTANCE CRITERIA
    ↓
TASK / MISSION
    ↓
┌───────────────┬───────────────┐
│ Execution     │ Replan        │
│ Events        │ Events        │
└───────┬───────┴───────┬───────┘
        └───────┬───────┘
                ▼
        PROGRESS LEDGER（状态投影，可重建）
                │
     ┌──────────┼──────────┐
     ▼          ▼          ▼
 Step State  Evidence  Acceptance
     └──────────┼──────────┘
                ▼
        PROGRESS PROJECTION（只读）
                │
     ┌──────────┼──────────┐
     ▼          ▼          ▼
   Chat       Cron     Task Detail
```

普通单轮 `chat.send` 默认不建账本。长程对象（cron / heartbeat Mission / ConversationTask）才建。

---

## 1. 编码前必须冻结的四件事

| #   | 冻结项                                                                            | 不冻的后果                                                       |
| --- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| F1  | 底层 **Event → State**。不可变 Execution Events 是审计源；Ledger 状态由 fold 得到 | 只能回答「库里现在是 completed」，不能回答「为何变成 completed」 |
| F2  | Evidence **分类型 + 可信来源**。禁止 LLM 自述                                     | `{ evidence: "agent said ok" }` 换皮自述                         |
| F3  | `executed` / `verified` / `completed` 分层。tool success ≠ 业务完成               | E3 算完但校验失败仍显示 completed                                |
| F4  | Ledger Invariants I1–I8，投影不得强于账本                                         | UI 出现「即将完成」而 Ledger 是 blocked                          |

二次评审另外 6 条一并写入合同（见 §2–§6）。其中 **F1、F2 必须在写第一行业务代码前解决**。

---

## 2. 合同：Event → Ledger State

### 2.1 谁是事实

| 层                      | 角色                                         | 可变性   |
| ----------------------- | -------------------------------------------- | -------- |
| **Execution Events**    | 审计事实。只追加，禁止改写、禁止删除         | 不可变   |
| **Progress Ledger**     | 当前状态。由事件 fold 得到，可从事件日志重建 | 可重建   |
| **Progress Projection** | UI/API 表现。纯函数，零写入                  | 不持久化 |

写路径只收 **runtime 事件**，不收 assistant 文本。

### 2.2 事件类型（P0 冻结）

```ts
type ExecutionEventType =
  | "PLAN_SEEDED"
  | "STEP_STARTED"
  | "TOOL_SUCCEEDED"
  | "TOOL_FAILED"
  | "EVIDENCE_RECORDED"
  | "VALIDATION_PASSED"
  | "VALIDATION_FAILED"
  | "ACCEPTANCE_MET"
  | "ACCEPTANCE_UNMET"
  | "STEP_EXECUTED"
  | "STEP_VERIFIED"
  | "STEP_COMPLETED"
  | "STEP_FAILED"
  | "STEP_BLOCKED"
  | "STEP_UNBLOCKED"
  | "GATE_RAISED"
  | "GATE_CLEARED"
  | "REPLAN_APPENDED"
  | "MEANINGFUL_PROGRESS";

type ExecutionEvent = {
  id: string;
  atMs: number;
  type: ExecutionEventType;
  taskId: string;
  stepId?: string;
  acceptanceId?: string;
  planVersion: number;
  payload: Record<string, unknown>;
  actor: "runtime" | "validator" | "human" | "system";
};
```

示例（合法）：

```
09:10 STEP_STARTED        E3 计算奖金
09:11 TOOL_SUCCEEDED      calculator 返回 1284 行
09:11 EVIDENCE_RECORDED   type=tool_result
09:12 VALIDATION_FAILED   制度版本不是 v3.2
09:12 STEP_BLOCKED        reason=blocked_policy
```

由此 fold 出的状态是 `executed + verification=failed + status=blocked`，**不是** `completed`。

### 2.3 状态机

**Execution Step**

```
pending
  → in_progress          (STEP_STARTED)
  → executed             (TOOL_SUCCEEDED / STEP_EXECUTED)
  → verified             (VALIDATION_PASSED / STEP_VERIFIED，且 evidence 合法)
  → completed            (STEP_COMPLETED；前提 executed ∧ verified ∧ 合法 evidence)

任意非终态
  → blocked_*            (STEP_BLOCKED / GATE_RAISED)
  → failed               (TOOL_FAILED / STEP_FAILED)

blocked_* → in_progress  (STEP_UNBLOCKED / GATE_CLEARED)
failed    → in_progress  (repair；保留失败 evidence)
```

禁止：

- `pending → completed` 跳过 executed/verified
- `executed → completed` 跳过 verified
- `completed` 仅因 `TOOL_SUCCEEDED`

**Acceptance Criterion**

```
unknown → met     (ACCEPTANCE_MET + 合法 evidence)
unknown → unmet   (ACCEPTANCE_UNMET + 合法 evidence)
unknown → blocked (所依赖 step blocked)
met 不可被 LLM 改回 unknown；纠错只能追加新事件
```

**Task / Mission**

```
task.completed ⇔ 全部 required acceptance = met（各有合法 evidence）
```

部分 step `completed` 而验收未全 met → 任务仍未完成。

### 2.4 Blocking 细分

```ts
type BlockingReason =
  | "blocked_user" // 等人确认
  | "blocked_authorization" // 等人授权
  | "blocked_external" // 等外部系统
  | "blocked_data" // 数据缺失 / 未就绪
  | "blocked_policy" // 策略禁止自动继续
  | "blocked_system"; // 运行时/配额/内部错误
```

UI 必须回答「为什么、我能做什么」：

| reason                  | 文案方向                       |
| ----------------------- | ------------------------------ |
| `blocked_user`          | 等你确认：价差按含税还是活动价 |
| `blocked_authorization` | 等待你授权 CRM 读取            |
| `blocked_external`      | 等待 CRM 同步完成              |
| `blocked_data`          | 缺少本周价表，无法继续         |
| `blocked_policy`        | 按发布策略，暂不允许自动发布   |
| `blocked_system`        | 执行中断，可重试或升级         |

Turn Contract `blockingGate` 与此对齐，不得只投影「已阻塞」。

---

## 3. 合同：Evidence

### 3.1 允许的类型

```ts
type EvidenceType =
  | "tool_result" // 工具结构化返回
  | "data_snapshot" // 查询快照（源、行数、版本）
  | "artifact" // 可打开的产物
  | "external_receipt" // 外部回执（message_id 等）
  | "validation_result" // 校验器结果
  | "human_confirmation" // 人在 UI/协议上的明确动作
  | "system_observation"; // 运行时可复现观察（心跳就绪、文件存在）
```

### 3.2 禁止作为 Evidence

```ts
type ForbiddenEvidenceType =
  | "assistant_text"
  | "model_claim"
  | "planner_claim"
  | "llm_self_report"
  | "run_summary_guess";
```

「我已经成功发送邮件」**不是** evidence。

合法示例：

```json
{
  "type": "external_receipt",
  "atMs": 1724333532000,
  "source": "email_send",
  "receiptId": "provider_message_id=xxx",
  "recipient": "finance@example.com",
  "verification": "passed"
}
```

### 3.3 Evidence 不变量

- `ACCEPTANCE_MET` / `STEP_COMPLETED` / `STEP_VERIFIED` 的 payload **必须**含至少一条允许类型的 evidence。
- writer 收到禁止类型 → **拒绝事件**，不写 Ledger。
- 投影层若看到 `met` 而无合法 evidence → 降级为 `unknown` 并打 invariant 失败日志；**不得**显示验收通过。

---

## 4. 合同：进度语义（验收 vs 执行）

Projection **必须**同时给出两套计数，禁止一个裸 `2/5` 不说明含义。

```ts
type ProgressCounts = {
  acceptance: { met: number; total: number };
  execution: { completed: number; total: number; inProgress: number; remaining: number };
};
```

默认对用户：

- 主分数：**「2/5 项验收已满足」**（acceptance.met / acceptance.total）
- 步骤过多时辅文案：**「已完成 7 · 进行中 1 · 剩余 3」**（execution）

列表一枚徽章用验收分数，tooltip / 详情写全称。禁止把 step completed 数画成验收分数。

---

## 5. 合同：Turn Contract 三元组

Projection 输入输出必须显式带齐：

```ts
{
  progress: { met: 2, total: 5 },
  mode: "ask",
  blockingGate: {
    type: "user_confirmation",
    reason: "blocked_user",
    question: "价差按含税价还是活动价？"
  }
}
```

`mode` 不单独承担 UX。`quiet` 仍计算上述结构，但 **不推送** Chat / 通知 / 动画。

---

## 6. 合同：时间与 stale

```ts
lastUpdatedAtMs; // 任意写入（含心跳、polling）
lastMeaningfulChangeAtMs; // 仅 MEANINGFUL_PROGRESS：step/acceptance/gate/replan 变化
staleAfterMs; // 默认 72h，相对 lastMeaningfulChangeAtMs
```

用户文案：「已 3 小时没有新的执行进展」，不是「最后更新 10:03」（心跳刷新）。

`stale` 只标时效，不改 step status。

---

## 7. Ledger Invariants（不可违反）

实现为 `assertLedgerInvariants(events, ledger)`，writer 与 fold 之后必跑；测试用反例钉死。

| ID  | 不变量                                                                   |
| --- | ------------------------------------------------------------------------ |
| I1  | LLM 不得直接 mutate status                                               |
| I2  | `completed` ⇒ 该 step 已 `executed` 且 `verified`                        |
| I3  | `acceptance.met` ⇒ 存在允许类型的 evidence                               |
| I4  | `task.completed` ⇒ 全部 required acceptance = `met`                      |
| I5  | replan 不得 mutate 历史 planVersion 的步骤记录                           |
| I6  | projection 不得 mutate ledger / events                                   |
| I7  | `quiet` 不得阻止 ledger / events 追加                                    |
| I8  | UI/Projection 不得暗示强于 ledger 的状态（blocked 不得显示「即将完成」） |

违规：拒绝写入，或投影降级 + 错误计数。不得静默显示乐观进度。

---

## 8. 视觉层级（实现时对照）

对话默认：

```
┌────────────────────────────┐
│ Q2 竞品价格巡检             │
│ 2/5 项验收已满足 · 等你确认 │  ← Layer 1  进度 + mode
│ 确认价差口径                │  ← Layer 2  当前焦点 / gate
│ [查看执行进度]              │  ← Layer 3  展开步骤
└────────────────────────────┘
```

展开步骤后，再下钻：Step → Evidence → Execution log → Validation。

禁止 working strip、禁止「正在思考 / 马上完成」。

工作台「待办」只进人闸（`blocked_user` / `blocked_authorization`），不进 Execution Step。

---

## 9. 模块与文件（建议落点）

当前树无 `src/auto-reply/turn-contract/` 时，本规格仍独立建模块；Turn Contract 复用处写 adapter，不重写调度。

```
src/progress-ledger/
  types.ts                 // Event / Ledger / Evidence / Gate / Replan
  invariants.ts            // I1–I8
  fold.ts                  // events → ledger state
  project.ts               // (ledger, turnContract, now) → ProgressView
  evidence.ts              // 类型白名单 / 禁止类型
  feature.ts               // flag，默认 off
  store.ts                 // append-only events + 缓存的 folded ledger
  writer.ts                // runtime 入站，校验后 append
  index.ts
  *.test.ts

ui/ 仅 P4 之后：
  对话条 / Cron 徽章 / Task Detail
```

配置：

- `gateway.progressLedger.enabled` / `OPENBOT_PROGRESS_LEDGER_ENABLED`（默认 `false`）
- 关闭：不建账本、不投影、既有路径不变

---

## 10. 分期执行（技术依赖，不是产品愿望）

评审要求：**先 Schema，再 Projection，再 Writer，最后 UI。**  
「P2 Cron 只读 + run 摘要猜测」**不是** canonical 进度，禁止当真实进度上屏。

### P0 — Schema / Contract（编码第一刀，无 UI）

**目标：** 类型、状态机、evidence 白名单、invariants 全部可单测。

| 工作项          | 完成标准                                                                   |
| --------------- | -------------------------------------------------------------------------- |
| 冻结 `types.ts` | Event / Step / Acceptance / Evidence / BlockingGate / ReplanEvent / Ledger |
| `evidence.ts`   | 允许/禁止类型；禁止类型 `recordEvidence` 抛错                              |
| `invariants.ts` | I1–I8 正反例                                                               |
| `fold.ts`       | 给定事件序列，状态可重建且与再 fold 一致                                   |
| 状态机单测      | 禁止 skip verified；tool success ≠ completed；met 无 evidence 失败         |

**出口：** `pnpm test src/progress-ledger` 绿。无 UI、无 cron 接线。

### P1 — Projection Engine（仍无 UI）

**目标：** `projectProgress(ledger, turnContract, now) → ProgressView` 纯函数。

| 工作项     | 完成标准                                                       |
| ---------- | -------------------------------------------------------------- |
| 双进度字段 | `acceptanceProgress` + `executionProgress`                     |
| 三元组     | progress + mode + blockingGate                                 |
| quiet      | 算出 view，`emitToChat=false` `emitNotification=false`         |
| stale      | 用 `lastMeaningfulChangeAtMs`                                  |
| 节点折叠   | >7 出 `collapsedSummary`；Ledger 不切步                        |
| I8         | ledger.blocked → view 不得 `tone=success` / 文案含「即将完成」 |

**出口：** 投影单测覆盖上表。仍无 writer 之外的伪造数据源。

### P2 — Runtime Writer（闭环开始）

**目标：** 运行时开始追加事件，Ledger 不再是空库。

| 工作项                 | 完成标准                                                                     |
| ---------------------- | ---------------------------------------------------------------------------- |
| `writer.append(event)` | 校验类型、状态迁移、evidence、I1–I5、I7                                      |
| 首批事件源             | 工具成功/失败、闸口升起/解除、校验器、人工确认协议                           |
| 禁止入口               | assistant 文本、planner claim、run summary 不得进 writer                     |
| 存储                   | append-only JSONL 或等价；fold 可重放                                        |
| 绑定                   | 先接 **长程 cron job**（有 goal/acceptanceRules 的任务），不接普通 chat.send |

**出口：** 一次真实（或夹具）cron 长程跑能写出 `STEP_*` / `EVIDENCE_*` / `ACCEPTANCE_*`，重放 fold 与在线状态一致。

### P3 — Canonical UI

**目标：** 只渲染 Projection，不渲染事件或猜测。

| 表面        | 内容                                                                 |
| ----------- | -------------------------------------------------------------------- |
| Chat        | Layer1 验收分数+mode；Layer2 焦点/gate；「查看执行进度」；quiet 不推 |
| Cron 列表   | 「2/5 项验收已满足」或阻塞短句；stale「已 N 小时无进展」             |
| Task Detail | 目标、验收+evidence、步骤全量、gate、日志、planVersion 历史          |
| 工作台待办  | 仅 `blocked_user` / `blocked_authorization`                          |

**出口：** flag off 像素级无变更；flag on 仅长程任务出条。无 working strip。

### P4 — Replan 产品化

- `planVersion` / `replanReason` / `createdAt` / `triggeredBy`
- 详情：「任务曾于 09:32 重新规划（CRM 数据缺失）」
- 模型只可提议 → `REPLAN_APPENDED`；历史 step 只退役不删除

### P5 — 人闸与通知

- 人闸进 pending-tasks
- quiet 不发通知
- 非 quiet 的 `blocked_user` 可通知

### P6 — 观测与治理

- invariant 违规指标
- 管理后台只读同一 Projection
- 文档：数字员工可观察 / 可验证 / 可治理

---

## 11. 明确禁止的过渡方案

| 做法                                   | 定性                                   | 处理                                                                               |
| -------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| 用 cron run 摘要「尽力推断」进度并上屏 | **legacy / best-effort，非 canonical** | 若内部调试需要，必须 `projectionKind: "legacy_best_effort"`，UI 不得标「真实进度」 |
| 模型输出 checklist 当步骤              | 禁止                                   | writer 拒绝                                                                        |
| 把 7 步写进 fold                       | 禁止                                   | 7 只在 project.ts                                                                  |
| 为了列表好看合并验收与步骤             | 禁止                                   | 双计数                                                                             |

P3 上线 canonical UI 前，用户面 **零进度条**。空 Ledger 优于假进度。

---

## 12. 验收清单（整条链）

1. 同一事件日志 fold 两次，Ledger 字节级一致。
2. 伪造 `assistant_text` evidence → writer 拒绝，UI 无 completed。
3. `TOOL_SUCCEEDED` 且无 `VALIDATION_PASSED` → step 最多 `executed`，验收不得 `met`。
4. 4 条验收只 met 3 条 → `task.completed = false`。
5. replan v1→v2 后仍能读 v1 步骤与 evidence。
6. quiet 期间完成 E3/E4 → 无 Chat 推送；打开详情为最新 execution/acceptance 计数。
7. `blocked_user` 文案含问题与行动；不得只显示「已阻塞」。
8. 主分数文案含「验收」；步骤计数另起一句。
9. Projection 单测不得 import writer/store 的写接口（I6）。
10. flag off：Cron / Chat 现有测试不增加失败。

---

## 13. 建议工期与人手（实现时）

| 阶段  | 预估   | 角色                                                           |
| ----- | ------ | -------------------------------------------------------------- |
| P0    | 1–2 日 | 一人：类型 + fold + invariants                                 |
| P1    | 1 日   | 同人：project.ts                                               |
| P2    | 2–3 日 | 需碰 cron / tool 结果管道；与 Turn Contract 对齐 gate          |
| P3    | 2–3 日 | UI：对话条 + Cron 徽章 + 详情（可并行两人，只消费 Projection） |
| P4–P6 | 按容量 | Replan / 待办 / 指标                                           |

P0+P1 未绿，不排 UI。P2 未写出真实事件，不上 canonical 进度。

---

## 14. 实现时的决策记录

| 决策             | 选择                                              |
| ---------------- | ------------------------------------------------- |
| 账本形态         | Event sourced；Ledger 为 fold 结果                |
| 完成语义         | 验收全 met + 合法 evidence；非步骤走完            |
| 默认 UI 分数     | 验收进度，文案写明                                |
| 旧 run 摘要      | 不算 canonical，不上「真实进度」                  |
| Todo 一词        | 协议、模块、用户文案禁用（工作台人待办除外）      |
| 与 Turn Contract | adapter 读取 mode/gate/openWork；本模块不重写调度 |

---

## 15. 开工命令（P0）

```text
1. 建 src/progress-ledger/{types,evidence,invariants,fold,project,feature}.ts 及 *.test.ts
2. 只提交该目录 + 本规格；不改 UI、不改 cron 行为
3. OPENBOT_TEST_PROFILE=low pnpm test src/progress-ledger
4. 出口：I1–I8 与 evidence 白名单全绿
```

P0 出口通过后，再开 P1 投影，然后 P2 writer。不跳步。
