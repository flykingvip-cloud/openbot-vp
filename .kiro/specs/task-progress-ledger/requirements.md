# Requirements Document

> Feature: Task Progress Ledger（任务进度账本）
> 产品原则：OpenBot 不向用户展示「AI 想做什么」，而向用户展示「数字员工已经完成什么、正在执行什么、为什么停下，以及距离验收还缺什么」。

## Introduction

长程任务（定时续跑、心跳 tick、跨会话 Mission）需要跨时间的进度可见性。本规格把该能力定义为 **Progress Ledger**：把真实的 Task / Mission 执行状态投影成用户可理解的进度。

本规格**不是** Chat Agent 的 Todo List，也不是工作台「待办」卡（人的任务 / 治理 / 邀请）。

它建立在已有事实上：

- 定时任务已有 `goal` + `acceptanceRules`（`personal-cron-task-meta`）。
- Turn Contract 已规划 / 部分落地：只读投影 `mode` / `blockingGate` / `openWork`，热路径禁止 LLM 判闸，默认关闭。
- 工作台 pending-tasks 是**对人的闸**，不是 agent 执行步骤。
- 对话忙碌态已收敛为工具卡片 + 单一停止，禁止恢复 working strip。

## Glossary

| 术语                     | 定义                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| **Execution Events**     | 不可变审计事实。只追加。status 变化必须能追到事件。                                              |
| **Progress Ledger**      | 由事件 fold 出的当前状态。可重建，不是唯一审计源。                                               |
| **Progress Projection**  | 只读表现。把 Ledger + Turn Contract 收成 Chat / Cron / Detail 视图。                             |
| **Acceptance Criterion** | 必须为真的完成条件。决定「任务完成没完成」。                                                     |
| **Execution Step**       | Agent 正在做的动作。描述「正在做什么」。一步可支撑多条验收，一条验收可对应多步。                 |
| **Turn Contract**        | 本轮该干什么：`deliver` / `ask` / `wait` / `quiet` / `repair`。与 Ledger 进度正交。              |
| **Replan Event**         | 计划变更的追加事件。禁止覆盖历史步骤。                                                           |
| **stale**                | `now - lastMeaningfulChangeAtMs` 超过阈值（默认 72h）。心跳造成的 `lastUpdatedAt` 不参与 stale。 |

## Product principle

> OpenBot 不向用户展示「AI 想做什么」，而向用户展示「数字员工已经完成什么、正在执行什么、为什么停下，以及距离验收还缺什么」。

禁止链路：`User Goal → LLM Todo → UI`。
必选链路：`User Goal → Acceptance Rules → Task/Mission → Execution Events → Progress Ledger → Progress Projection → UI`。

## Requirements

### Requirement 1: 统一术语，禁止 Todo 产品面

**User Story:** 作为产品与实现，我希望代码、协议、文案都叫进度账本，避免再演变成换皮 Todo。

#### Acceptance Criteria

1. 用户可见文案不得使用「Todo / 待办清单」指代本能力。工作台「待办」卡保持原义（人的待处理）。
2. 协议与模块名使用 `progressLedger` / `executionLedger` / `progressProjection`，不新增 `todoList` 类型。
3. 模型输出的「我计划做 A/B/C」不得直接成为 UI 步骤状态。

### Requirement 2: Ledger 是事实，Projection 是表现

**User Story:** 作为企业用户，我看到的进度必须能对上真实执行，而不是模型独白。

#### Acceptance Criteria

1. Execution Ledger 是唯一事实源；Chat / Cron 列表 / 任务详情 / API / 通知 / 管理后台只消费 Progress Projection。
2. 步骤 `status` 只能由执行运行时根据工具结果、闸口、验收判定写入；LLM 文本不得写入 `completed`。
3. 热路径禁止用 LLM 判闸（继承 Turn Contract）。Projection 是纯函数，无 I/O、无模型。
4. `tool success ≠ task success`：工具成功只推进 Execution Step；任务完成只看 Acceptance Criteria 是否全部成立。

### Requirement 3: 验收条件与执行步骤正交

**User Story:** 作为用户，我写的验收规则应决定「做完了没」，而不是被压成 7 个执行动作。

#### Acceptance Criteria

1. Ledger 同时记录 Acceptance Criteria 与 Execution Steps，二者用引用关联，不得等同。
2. UI 默认展示的「关键节点」可以取验收标题或当前执行焦点，但完成判定只看验收项 evidence。
3. UI 默认展示 3–7 个关键节点；Ledger 步数不受 7 限制。超过时投影为「已完成 N · 进行中 1 · 剩余 M」，展开后看全部。

### Requirement 4: Turn Contract 与 Ledger 进度正交

**User Story:** 作为用户，我既要知道「现在发生了什么」，也要知道「走到第几步」。

#### Acceptance Criteria

1. `mode` 不得单独承担全部 UX。必须同时投影：进度（如 `2/5`）+ 当前状态一句。
2. `ask` + `blockingGate` → 「等你确认：…」；`wait` → 「等待 …」；`deliver` → 「正在执行 / 已完成」；`quiet` → 不主动打扰。
3. `quiet` **不产生**通知、对话条带、动画；**允许** Ledger 继续更新。用户下次打开任务时，Projection 必须反映最新 Ledger（例如 quiet 期间 3、4 步完成 → 打开见 `4/5`）。
4. 禁止恢复 working strip 或「正在思考 / 马上完成」类 Activity Theater。

### Requirement 5: Evidence 是一等公民

**User Story:** 作为企业用户，点开「已完成」必须看到可验证证据，而不是一个勾。

#### Acceptance Criteria

1. 每个到达终态的 Execution Step 与每条已判定的 Acceptance Criterion 必须带 `evidence`（时间、数据源、记录数、规则版本、校验结果、失败原因，按可得字段）。
2. 对话层只展示一句状态；「查看详情」进入 Task Detail：目标、验收、进度、步骤、证据、阻塞项、运行日志、重规划历史。
3. 缺少 evidence 的 `completed` 不得对用户显示为验收通过。

### Requirement 6: 跨 tick 连续性与 stale

**User Story:** 作为用户，周一做到一半、周四打开，必须看到同一条任务进度。

#### Acceptance Criteria

1. Progress Ledger 是长程任务的跨 tick continuity layer，绑定 Task / Mission / cron job，而不是单次 chat turn。
2. 普通单轮 Chat 不强制展示 Progress Ledger。
3. 每条 Ledger 记录 `lastUpdatedAt`。超过阈值（默认 72h，可配）投影为 `stale`，UI 至少显示「上次更新：N 天前」。
4. `stale` 不自动改写步骤状态；只标记时效。

### Requirement 7: Re-plan 是事件，禁止覆盖历史

**User Story:** 作为审计方，我需要知道计划为何从 5 步变成 7 步。

#### Acceptance Criteria

1. 模型可以提议步骤标题与新计划，但只能追加 `Replan Event`（原因、时间、旧计划版本、新计划版本）。
2. 禁止原地覆盖或删除已记录步骤的历史 status / evidence。
3. Task Detail 必须能展开重规划历史。

### Requirement 8: 三层信息架构

**User Story:** 作为用户，默认不被 5–7 行步骤压住，需要时能展开。

#### Acceptance Criteria

1. 第一层：当前状态一句（等你确认 / 正在做 X / 等待 Y）。
2. 第二层：进度分数（验收已成立数 / 验收总数，或等价投影）。
3. 第三层：步骤列表，默认折叠。
4. 对话 Layer1 = 验收分数 + mode；Layer2 = 当前焦点 / blockingGate；Layer3 = 展开步骤。详情再下钻 evidence / log / validation。
5. 主分数必须写成「N/M 项验收已满足」，不得用裸 `2/5` 同时表示步骤与验收。

### Requirement 9: Event 驱动与 Evidence 类型

**User Story:** 作为审计方，我要能回答「为什么这步变成 completed」，而不是「库里现在是 completed」。

#### Acceptance Criteria

1. 底层采用 Event → State：不可变 Execution Events 经 fold 得到 Ledger。
2. Evidence 必须带允许的 `EvidenceType`；`assistant_text` / `model_claim` / `planner_claim` / `llm_self_report` / `run_summary_guess` 不得入账。
3. Step 状态区分 `executed`（工具已跑）/ `verified`（校验通过）/ `completed`（二者都成立且有合法 evidence）。`TOOL_SUCCEEDED` 不得直接 `completed`。
4. Blocking 必须细分到 `blocked_user|authorization|external|data|policy|system`，并投影可行动文案。
5. stale 使用 `lastMeaningfulChangeAtMs`，不用心跳刷新的 `lastUpdatedAtMs`。
6. `run` 摘要猜测若存在，只能标 `legacy_best_effort`，不得作为用户面「真实进度」。

### Requirement 10: Ledger Invariants

实现与投影必须持续满足 I1–I8，见 `design.md` 与 `execution-plan.md`。违规拒绝写入或投影降级，禁止乐观进度。
