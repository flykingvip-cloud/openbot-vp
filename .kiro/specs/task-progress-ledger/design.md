# Design Document

> Feature: Task Progress Ledger
> Requirements: `./requirements.md`

## Overview

Progress Ledger 把长程任务的**真实执行状态**投影给用户。它不替代商业占槽、Supervisor、Pi runner、Turn Contract 或工作台 pending-tasks。

冻结原则：

- Events 不可变；Ledger 由 fold 重建；Projection 只读。
- Evidence 白名单；禁止 LLM 自述。
- `executed` ≠ `verified` ≠ `completed`。
- Acceptance Criteria ≠ Execution Steps；主分数是验收进度。
- Turn Contract `mode` + `blockingGate` 与 Ledger 进度正交。
- `quiet` 不推 UI，但事件可继续追加。
- Re-plan 只追加 `planVersion`，不覆盖历史。
- I1–I8 违规不得上屏乐观进度。

```
Task / Mission
│
├── Goal
├── Acceptance Criteria          // 完成没完成
├── Execution Ledger             // 正在做什么（事实）
│     ├── Step { status, startedAt, completedAt, evidence, failure }
│     └── Replan Events
├── Turn Contract                // 本轮该干什么（正交）
│     ├── mode
│     ├── blockingGate
│     └── openWork
└── Progress Projection          // 只读
      ├── Conversation UI        // 一层 + 二层
      ├── Cron list / detail
      ├── API / 通知 / 管理后台
      └── Task Detail            // 三层 + 证据 + 日志 + 重规划
```

## Architecture

### 1. Execution Ledger（事实源）

绑定对象：`cronJobId` 或未来 `missionId` / `conversationTaskId`。跨 tick 同一条，不随单次 run 丢弃。

#### Acceptance item

```ts
type AcceptanceStatus = "unknown" | "met" | "unmet" | "blocked";

type AcceptanceItem = {
  id: string;
  text: string;
  status: AcceptanceStatus;
  evidence?: ProgressEvidence;
  satisfiedByStepIds: string[];
  updatedAtMs: number;
};
```

`met` 必须有 evidence。无 evidence 不得投影为验收通过。

#### Execution step

```ts
type StepStatus = "pending" | "in_progress" | "completed" | "failed" | "blocked";

type ExecutionStep = {
  id: string;
  planVersion: number;
  title: string;
  status: StepStatus;
  acceptanceIds: string[];
  startedAtMs?: number;
  completedAtMs?: number;
  evidence?: ProgressEvidence;
  failure?: { code: string; message: string };
};
```

写入规则：

- `completed` / `failed` / `blocked` 只由运行时根据工具结果、闸口、校验器写入。
- 模型独白、assistant 文本、tool card 标题不得写 status。
- `tool success` 最多把对应 step 标完成；不得把未关联的验收项标 `met`。

#### Evidence

```ts
type ProgressEvidence = {
  atMs: number;
  source?: string; // CRM / 内部价表 / 会话
  recordCount?: number;
  ruleVersion?: string;
  verification?: "passed" | "failed" | "skipped";
  artifactRef?: string;
  note?: string;
};
```

#### Replan event

```ts
type ReplanEvent = {
  id: string;
  atMs: number;
  fromVersion: number;
  toVersion: number;
  reason: string;
  addedStepIds: string[];
  retiredStepIds: string[]; // 退役，不是删除历史
};
```

发现缺口时追加 v2 步骤；v1 步骤与 status / evidence 保留。Audit 解释「为何从 5 步变成 7 步」。

#### Ledger header

```ts
type ExecutionLedger = {
  schemaVersion: 1;
  taskId: string;
  goal: string;
  lastUpdatedAtMs: number;
  staleAfterMs: number; // default 72h
  acceptance: AcceptanceItem[];
  steps: ExecutionStep[];
  replans: ReplanEvent[];
  currentPlanVersion: number;
};
```

`stale` 是投影标志：`now - lastUpdatedAtMs > staleAfterMs`。不改写 step status。

### 2. Turn Contract（本轮，正交）

复用既有 Turn Contract，不在本模块重写调度。

| mode      | 用户第一层文案               | 对 Ledger                                         |
| --------- | ---------------------------- | ------------------------------------------------- |
| `deliver` | 正在执行 / 本轮交付          | 可推进 step                                       |
| `ask`     | 等你确认：{blockingGate}     | 当前 step 可为 `blocked`                          |
| `wait`    | 等待 {外部条件}              | 不打扰；可保持 `blocked`/`in_progress`            |
| `quiet`   | 不展示对话条、不通知、无动画 | **Ledger 仍可写**                                 |
| `repair`  | 正在修复上次失败             | 失败 step 可重入 `in_progress`，保留失败 evidence |

`mode` 不能替代 `2/5`。投影必须同时带进度分数与当前状态。

### 3. Progress Projection（只读）

纯函数：`(ledger, turnContract, now) → view`。

```ts
type ProgressView = {
  headline: string; // 第一层
  completedAcceptance: number;
  totalAcceptance: number; // 第二层
  stale: boolean;
  lastUpdatedAtMs: number;
  currentStepId?: string;
  blockingQuestion?: string;
  nodes: Array<{
    id: string;
    title: string;
    tone: "done" | "current" | "pending" | "failed" | "blocked";
  }>; // 第三层，可超过 7
  collapsedSummary?: { done: number; current: number; remaining: number };
};
```

默认节点选取：优先当前焦点 ± 相邻验收/步骤，总数 3–7。`nodes.length > 7` 时带 `collapsedSummary`。系统语义不以 7 切 Ledger。

`quiet`：`headline` 可算，但 Conversation / 通知 **不推送**。Cron 详情与下次打开的列表仍用最新 view。

### 4. UI 三层

对话（轻量感知）：

```
Q2 竞品价格巡检
2 / 5 · 等你确认
等你确认：含税 / 活动价口径
查看详情 →
```

步骤默认折叠。禁止 working strip。

Cron 列表：任务名 + `2/5` 或「等你确认」+ 可选 stale「3 天前」。

Task Detail（深度可观测）：目标、验收（含 evidence）、当前 mode、步骤全量、阻塞项、运行日志、Replan 历史。

工作台「待办」：只放对人的闸（ack / 提问）。不把 Execution Step 混入该卡。

### 5. 与现有栈的边界

| 现有模块                                         | 本规格                               |
| ------------------------------------------------ | ------------------------------------ |
| `personal-cron-task-meta` goal / acceptanceRules | 初始 Acceptance Criteria             |
| Turn Contract collect / project                  | 本轮 mode / gate；不写 Ledger status |
| cron run log                                     | 详情页日志；可引用为 evidence        |
| workbench pending-tasks                          | 仅人闸；不是步骤列表                 |
| Supervisor / billing / Pi runner                 | 不改职责                             |
| 普通单轮 chat.send                               | 默认不建 Ledger                      |

### 6. 写入路径（防漂移）

```
runtime event (tool result / gate / validator / cron tick)
        ↓
ledger writer（校验：status 迁移合法、completed 必有 evidence）
        ↓
Execution Ledger
        ↓
projectProgress(ledger, turnContract, now)
        ↓
surfaces
```

禁止：模型在 assistant 消息里列出 A/B/C → 前端直接渲染为步骤状态。

允许：模型提议 Replan（标题草案）→ 写入 `Replan Event` + 新 `pending` steps → 状态仍只等 runtime。

### 7. Feature gate

默认关闭，形态对齐 Turn Contract：`gateway.progressLedger.enabled` / `OPENBOT_PROGRESS_LEDGER_ENABLED`。

关闭时：不建 Ledger、不投影、既有 Cron / Chat 路径不变。

打开顺序：P0 Schema + invariants → P1 纯投影 → P2 runtime writer（真实事件）→ P3 UI。  
run 摘要猜测不是 canonical，不得作为用户面真实进度。详情见 `execution-plan.md`。

## Invariants

见 `execution-plan.md` §7。实现必须机检：I1 LLM 不写 status；I2 completed ⇒ executed∧verified；I3 met ⇒ 合法 evidence；I4 task.completed ⇒ 全部 required met；I5 replan 不改历史；I6 projection 只读；I7 quiet 可写事件；I8 投影不得强于账本。

## Risks

| 风险               | 缓解                                                   |
| ------------------ | ------------------------------------------------------ |
| 换皮 Todo          | 协议禁 `todo*`；评审看 writer 是否只接受 runtime event |
| 用 7 切执行模型    | 7 只在 Projection；Ledger 不限步数                     |
| 验收 = 步骤        | 双列表 + 关联；完成只看 acceptance.met                 |
| quiet 被理解成冻结 | 规范写明 Ledger 可写、UI 不推送                        |
| 缓存旧投影         | Projection 不持久化；读时按 Ledger 现算                |
