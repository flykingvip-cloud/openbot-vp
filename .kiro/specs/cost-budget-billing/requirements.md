# Requirements Document

> 中文名：成本与预算（Cost & Budget Billing）— 双端 SaaS 计费系统重建

## Introduction

本规格定义将企业端「成本与预算」模块从**纯前端派生的展示视图**重建为**真实的双端 SaaS 计费系统**。

**被替换的现状（Current State）：**

- 当前「成本与预算」对应企业端 `enterpriseUsage` 路由，由 `ui/src/ui/ports/enterprise/views/enterprise-usage-surface.ts` 渲染，没有任何真实计费能力。
- 成本/令牌数据由两个通用 RPC（`sessions.usage`、`usage.cost`）派生，经 `ui/src/ui/ports/enterprise/semantic/enterprise-read-model.ts` 聚合为 totalCost/totalTokens/missingCostEntries 等只读指标。
- 「预算控制工作区」面板项是静态占位，点击仅跳转到设置页；网关 `src/gateway/` 中**没有任何设置/持久化预算的写 API**。
- `budgetLimit` 是 `deriveBudgetLimit()` 的启发式派生值，而非用户配置；权限项 `usage:budget` 存在但**没有任何后端功能支撑**。
- 没有日期范围筛选、没有趋势、没有按模型/渠道的成本拆分、没有租户隔离（用量是全局的，未按 tenantId 过滤）。

**不在本规格范围内（边界澄清）：** 另一个独立模块「能力应用管理」（`enterpriseUsageManagement` 路由，由 `enterprise-usage.*` RPC 驱动，见 `src/gateway/server-methods/enterprise-usage.ts`）关注能力执行与治理，**不是**计费模块，本规格不得与其混淆或改动其逻辑。

**目标架构（Target Architecture）：「平台端定义规则 + 企业端消费规则」**

参照 Stripe（计费引擎）+ Salesforce（企业订阅）模型，形成数据闭环：

```
平台端定义 套餐/定价/计费规则
        ↓ 下发
企业端 订阅(Subscription) → 分配 Seat/Bot → 产生 使用(Usage)
        ↓ 回传
使用数据 + 账单 → 企业查看成本 → 调整资源
```

- **平台端（Platform Console）= 规则定义方**：套餐、定价、计费规则的唯一真相来源；企业无法修改价格。
- **企业端（Enterprise Console）= 规则消费方**：只做「分配」（Seat/Bot）与「控制」（预算）。

**设计原则（作为强约束 / 非功能性需求）：**

1. 定价仅由平台定义（Pricing = Platform Only）——企业不能更改价格。
2. 企业只能分配 Seat 和控制预算。
3. 所有计费数据必须可追溯——不覆盖数据，必须保留历史（append-only）。
4. 成本必须可预测——企业必须能看到预计月底费用。

**开发优先级（仅用于需求分组 / MoSCoW 提示，非设计约束）：**

- Phase 1 基础计费：Plan 管理、Subscription、Seat 计费
- Phase 2 用量：Usage 采集、Usage 计费
- Phase 3 企业控制：成本与预算模块、实时看板
- Phase 4 优化：预算控制、预测系统

**微服务拆分方向（后续设计阶段细化，本规格作为约束方向提及，保持实现无关 implementation-agnostic）：** 以 Billing_Service 为核心，按变更频率与计费耦合度拆分为独立关注点：

- **Subscription_Service（低频变更）**：仅负责套餐订阅生命周期（`plan_id`、`plan_version_id`、start/end、status），不负责 Seat。
- **Seat_Service（高频变更 + 强计费耦合，独立服务）**：负责 Seat 分配、角色变更与 `seat_history` 时间区间模型。**Seat 不并入 Subscription_Service**，因为席位是高频变更且与计费强耦合，混入低频的订阅服务会造成服务膨胀与计费复杂化。
- **Usage_Service（用量采集，需幂等去重）**、**Resource_Service（Bot/配额）**、**Budget_Service（预算控制，独立）**，并预留 **Payment/Wallet（余额/支付/扣费）** 服务。

**服务协同采用「同步查询 + 异步事件」：** 价格查询、角色查询等读操作可同步；而成本累计必须事件驱动——Usage_Service / Seat_Service / Resource_Service 发布事件（`UsageReportedEvent` / `SeatChangedEvent` / `BotCreatedEvent`），Billing_Service 异步消费，**系统 SHALL NOT 要求 Usage_Service 到 Billing_Service 的同步 API 调用来完成成本计算**，避免强耦合、性能瓶颈与丢数据风险。本规格不规定具体部署拓扑、存储选型或通信协议。

**企业端模块信息架构（7 个子页，参照 Microsoft 365 Admin + Stripe Billing Dashboard）：**

```
成本与预算（Cost & Budget）
├── 总览（Overview）          —— KPI / 成本构成 / 趋势 / 超预算预警 / 预计月底
├── 套餐与订阅（Subscription） —— 当前套餐 / 可选套餐 / 升级切换
├── Seat 与权限（Seats & Roles）—— 用户角色分配 / 按比例计费 / 角色统计
├── 资源与配额（Resources）    —— Bot 使用 / 用户 Bot 分布 / 限制与扩容
├── 使用量分析（Usage）        —— 按用户 / 按类型 / 时间筛选 / 用户排行
├── 账单与明细（Billing）      —— 账单列表 / 明细拆解 / 下载
└── 预算与控制（Budget Control）—— 预算阈值 / 提醒 / 自动限流
```

**贯穿全局的关键交互（强约束）：** ①成本预测（所有页面顶部展示预计月底费用）；②成本归因/可解释（点击费用可逐层钻取：总费用 → Seat/Usage → 用户）；③实时刷新（用量变化实时更新成本）。

## Glossary

### 系统与服务（EARS 中允许出现的系统名）

- **Platform_Console（平台控制台）**：平台端，计费规则（套餐/定价）的唯一定义方与下发源。
- **Plan_Management（套餐管理服务）**：平台端负责 Plan 的创建、更新、查询的逻辑单元。
- **Pricing_Service（定价配置服务）**：平台端负责 Plan_Pricing 定价规则维护与价格查询的逻辑单元。
- **Plan_Version_Lifecycle（套餐版本生命周期服务）**：平台控制平面（Control Plane）的核心，负责 PlanVersion 的状态机（`draft → active → deprecated`）、单一 active 不变量、激活/废弃流转与状态变更审计；是计费规则的唯一权威来源。
- **Subscription_Service（订阅服务）**：负责企业订阅（Subscription）创建与生命周期管理的逻辑单元（仅 `plan_id`、`plan_version_id`、生命周期状态）；**不负责 Seat**；对应微服务拆分方向中的 Subscription 服务。
- **Seat_Service（席位服务）**：独立服务，负责 Seat 分配、角色变更与 `seat_history` 时间区间模型维护；高频变更且与计费强耦合，故从 Subscription_Service 中拆出。
- **Usage_Service（用量服务）**：负责采集与计量企业用量（Usage_Record）的逻辑单元；对应微服务拆分方向中的 Usage 服务。发布 `UsageReportedEvent`。
- **Billing_Service（计费服务）**：负责成本计算、账单（Bill）与成本快照（Cost_Snapshot）生成的逻辑单元；对应微服务拆分方向中的 Billing 服务。支持实时增量计算（估算值）与周期性结算计算（最终值）两种模式，异步消费 `UsageReportedEvent` / `SeatChangedEvent` / `BotCreatedEvent`。
- **Budget_Service（预算服务）**：负责预算（Budget）设置、用量上限与预算检查告警的逻辑单元。
- **Cost_Budget_Module（成本与预算模块）**：企业端核心模块，重建后替代现有 `enterpriseUsage` 展示视图，聚合订阅、Seat、预算、看板、成本控制五项能力。
- **Cost_Dashboard（实时成本看板）**：Cost_Budget_Module 的看板子页，展示当前累计费用、Seat 成本、Usage 成本、预计月底费用。
- **Cost_Control_Service（成本控制服务）**：负责执行企业端资源控制（限制 AI 调用、限制 Bot 创建、可选自动降级）的逻辑单元。
- **Resource_Service（资源服务）**：负责 Bot 创建/删除、配额校验与超额检测的逻辑单元。
- **Usage_Analytics（使用量分析）**：Cost_Budget_Module 的用量分析子页，按用户、按类型、按时间窗口解释用量来源。
- **Billing_Ledger（账单与明细）**：Cost_Budget_Module 的账单子页，提供账单列表、明细拆解与下载。
- **Migration_Process（迁移流程）**：将现有启发式预算展示视图替换为平台定义定价 + 企业配置预算的持久化迁移过程。
- **Enterprise_Admin（企业管理员）**：企业端 Cost_Budget_Module 的操作主体角色。
- **Platform_Admin（平台管理员）**：Platform_Console 套餐与定价的操作主体角色。

### 核心数据结构（作为对外契约）

- **Plan（套餐）**：平台定义的定价模板，企业不可修改。字段：`{ id, name, billing_cycle, base_price }`，并关联各角色 Seat 配额、Bot 配额、用量价格。
- **Plan_Pricing（定价规则）**：`{ id, plan_id, type, key, price }`，其中 `type ∈ {seat, usage, extra}`，`key` 形如 `viewer | creator | ai_token | ...`。示例：`seat/viewer=10`、`seat/creator=30`、`usage/ai_token=0.002`、`extra/overage=...`。
- **Subscription（订阅）**：`{ id, enterprise_id, plan_id, plan_version_id, start_time, end_time, status }`；企业 + 套餐 = 订阅。`plan_version_id` 锁定订阅生效时的定价版本，用于历史账单可复算。
- **Seat（席位）**：企业为成员分配的席位，含角色（role）与可分配的 Bot 配额；计费采用**时间区间模型**（Seat_History：`{ user_id, enterprise_id, role, start_time, end_time }`）以支持按比例计费（Proration）。
- **Budget（预算）**：`{ id, enterprise_id, monthly_limit, alert_threshold }`，`alert_threshold` 默认 80%。
- **Cost_Snapshot（成本快照）**：`{ id, enterprise_id, date, snapshot_type, seat_cost, usage_cost, total_cost }`，用于展示与历史。`snapshot_type ∈ {estimated, final}`：`estimated` 为实时增量估算，`final` 为周期结算后的最终值。
- **Usage_Record（用量记录）**：企业在订阅周期内产生的可计量用量明细（如 AI token / task / storage），含 `enterprise_id`、`user_id`、`event_id`（幂等键）、计量类型 key、数量、发生时间；采集须支持**幂等去重**（同一 `event_id` 不重复计费）。
- **Bot_Resource（Bot 资源）**：企业创建的 Bot 实例 `{ id, enterprise_id, owner_user_id }`，受 Plan 的 Bot 配额约束。
- **Bill（账单）**：某计费周期内企业的费用结算结果，含若干 Bill_Item（`type ∈ {seat, usage, extra}`、`amount`、`detail`），覆盖 Seat 成本、Usage 成本、超额（overage）成本与总额。

### 领域事件（异步协同契约）

- **UsageReportedEvent**：Usage_Service 在写入一条 Usage_Record 后发布，携带 `enterprise_id`、`user_id`、`event_id`、计量类型 key、数量、发生时间（可选携带 `agent_id`、`org_seat_id` 以支撑岗位 × 机器人归因）；Billing_Service 异步消费以进行实时增量成本更新。事件日志为唯一真相，故 `user_id` 必须随事件携带，使「总费用 → Seat/Usage → 用户」归因可由事件重放复原（R9.1 / R18 / R21）。
- **SeatChangedEvent**：Seat_Service 在 Seat 分配或角色变更后发布，携带 `enterprise_id`、`seat_id`、变更前后角色与生效时间；Billing_Service 异步消费以更新 Seat 成本。
- **BotCreatedEvent**：Resource_Service 在 Bot 创建/删除后发布，携带 `enterprise_id`、`bot_id`、`owner_user_id`；Billing_Service 与 Resource_Service 据此更新配额与超额。
- **PlanVersionStatusChangeEvent**：Plan_Version_Lifecycle 在 PlanVersion 状态流转后发布并以 append-only 方式记录，**完整字段** `{ id, planId, versionId, from: PlanVersion_Status|null, to: PlanVersion_Status, requestId, changedByUserId, occurredAt }`——记录「状态变化」而非仅「结果」，以支撑审计、重放与并发问题排查。`requestId` 兼作激活幂等键。

### 计费核心逻辑（作为对外契约）

- **价格获取（get_price）**：`get_price(plan_id, type, key) ⇒ Plan_Pricing[plan_id][type][key]`。
- **成本计算（单一入口）**：`total_cost = seat_cost + usage_cost + extra_cost`。
- **预算检查**：`if total_cost > budget_limit: trigger_alert()`。

### 术语

- **Billing_Cycle（计费周期）**：Plan 定义的费用结算周期（如 monthly），决定账单生成与成本快照的时间边界。
- **Overage（超额费用）**：用量或席位数超过套餐配额后，按 Plan_Pricing 中 `type=extra` 规则计算的额外费用。
- **Predicted_Month_End_Cost（预计月底费用）**：基于当前累计费用与剩余周期的日均消耗速率推算的本计费周期结束时预计总费用。
- **Tenant_Isolation（租户隔离）**：所有计费数据（订阅、预算、用量、账单、快照）必须按 `enterprise_id`（tenantId）隔离，企业之间不可见。
- **Append_Only（追加写入）**：计费数据只新增、不修改、不删除既有记录，以保证可追溯性。
- **Proration（按比例计费）**：当 Seat 角色或订阅在计费周期内发生变更时，按生效时间区间占比精确计费（按天或按秒切片）。
- **Idempotent_Usage（用量幂等）**：同一用量事件即便被多次上报，也只计费一次。
- **Cost_Attribution（成本归因）**：将总费用逐层钻取到 Seat/Usage 维度，再到具体用户的可解释能力。
- **Estimated_Cost（估算成本）**：由实时增量计算得出的临时成本，标记为 `estimated`，用于看板即时展示，可能与最终账单存在差异。
- **Final_Cost（最终成本）**：计费周期结束时以完整数据全量重算得出的成本，标记为 `final`，覆盖该周期的估算结果，作为账单依据。
- **Cost_Control_Gatekeeper（成本控制闸口）**：所有受控资源调用（AI 调用、Bot 创建）在执行前必须经过 Cost_Control_Service 校验，预算超限时在执行前拒绝（reject BEFORE execution），而非事后提醒。
- **Weighted_Moving_Average（加权移动平均）**：成本预测的可选增强算法，对近期日消耗赋予更高权重，缓解 AI 用量突发（burst）导致的预测失真。
- **Plan_Version（套餐版本）**：Plan 与 Plan_Pricing 每次变更产生的版本，含不可变定价快照 `pricing`（immutable）、单调递增的 `versionNumber`（供 UI 展示 v1/v2/v3 与排序）、可变但被审计的 `status ∈ {draft, active, deprecated}`，以及 `activatedAt`/`deprecatedAt` 时间线字段。订阅锁定某一 `plan_version_id` 以保证历史账单可复算。`pricing` 一经创建不可改；`status` 仅可经合法流转变更，且每次变更记录 PlanVersionStatusChangeEvent。
- **PlanVersion_Status（版本状态）**：`draft`（草稿，可编辑定价、不可被订阅）→ `active`（生效，唯一可被订阅、定价冻结）→ `deprecated`（**终态**，不可被新订阅、既有订阅继续按其快照计费）。状态机**单向不可逆**：禁止 `draft → deprecated`（未激活直接废弃）、`deprecated → active`（复活旧版本）、`deprecated → draft`。
- **PricingDiff（定价差异）**：由后端纯函数 `comparePlanVersions(fromVersion, toVersion)` 计算的两版本定价差异结构（新增/删除/调价的 `type/key/oldPriceCents/newPriceCents`），供平台 UI 展示「激活前后改了什么」，避免 UI 端自行 diff 导致不一致。
- **Single_Active_Invariant（单一 active 不变量）**：同一 Plan 在任意时刻至多有一个 `status=active` 的版本；激活新版本时原 active 版本须同时降级为 deprecated（原子流转）。并发激活下仍须保持单一 active。
- **Resolved_From_Plan_Id（按套餐解析标记）**：当订阅请求只给 `plan_id`（仅 UI 便捷路径）时，系统解析为该 Plan 当前 active 版本并在订阅上记录 `resolvedFromPlanId=true` 供审计；API/内部标准路径须显式给 `plan_version_id`。
- **Idempotency_Key（幂等键 / `event_id`）**：用量事件的唯一标识，在 `enterprise_id` 维度唯一；重复上报相同 `event_id` 只计费一次。
- **Legacy_Heuristic_Budget（旧启发式预算）**：现有 `deriveBudgetLimit()` 产生的派生 budgetLimit，本规格落地后须被持久化、平台定义定价 + 企业配置预算取代。

## Requirements

### Requirement 1: 套餐管理（平台端定义）

**User Story:** 作为平台管理员，我希望创建、更新和查询套餐（Plan），以便为企业提供可订阅的定价模板，并作为计费规则的唯一真相来源。

#### Acceptance Criteria

1. WHEN Platform_Admin 提交创建套餐请求（含 name、billing_cycle、base_price、各角色 Seat 配额、Bot 配额）, THE Plan_Management SHALL 创建一条 Plan 记录并返回唯一 `plan_id`。
2. WHEN Platform_Admin 提交更新套餐请求并指定已存在的 `plan_id`, THE Plan_Management SHALL 以追加新版本的方式记录变更，并保留该 Plan 的历史版本。
3. WHEN Platform_Admin 请求查询套餐列表, THE Plan_Management SHALL 返回所有 Plan 记录，每条包含 `id`、`name`、`billing_cycle`、`base_price`。
4. IF 创建套餐请求缺少 `name`、`billing_cycle` 或 `base_price` 中任一必填字段, THEN THE Plan_Management SHALL 拒绝该请求并返回描述性错误。
5. IF 创建套餐请求中 `base_price` 为负数, THEN THE Plan_Management SHALL 拒绝该请求并返回描述性错误。
6. THE Plan_Management SHALL 为每个 Plan 暴露平台端写 API：创建套餐、更新套餐、查询套餐列表（语义对应 `POST /platform/plans`、`PUT /platform/plans/{id}`、`GET /platform/plans`）。

### Requirement 2: 定价配置（平台端定义，企业不可变更）

**User Story:** 作为平台管理员，我希望为套餐配置按角色的 Seat 价格、按量的 Usage 价格和超额价格，以便精确表达计费规则。

#### Acceptance Criteria

1. WHEN Platform_Admin 为某 `plan_id` 配置定价规则（指定 `type`、`key`、`price`）, THE Pricing_Service SHALL 创建一条 Plan_Pricing 记录，其中 `type ∈ {seat, usage, extra}`。
2. THE Pricing_Service SHALL 支持按角色的 Seat 价格配置（如 `seat/viewer`、`seat/creator`）、按量的 Usage 价格配置（如 `usage/ai_token`）和超额（overage）价格配置（`type=extra`）。
3. WHEN Billing_Service 请求 `get_price(plan_id, type, key)`, THE Pricing_Service SHALL 返回该 `plan_id` 下匹配 `type` 与 `key` 的 `price`。
4. IF `get_price` 请求的 `plan_id`、`type` 或 `key` 在 Plan_Pricing 中不存在匹配记录, THEN THE Pricing_Service SHALL 返回未找到价格的描述性错误，且不返回隐式默认价格。
5. IF Plan_Pricing 的 `price` 为负数, THEN THE Pricing_Service SHALL 拒绝该定价配置请求并返回描述性错误。
6. WHEN Enterprise_Admin 通过任意企业端入口尝试修改 Plan 或 Plan_Pricing, THE Pricing_Service SHALL 拒绝该请求并返回「定价仅由平台定义」的描述性错误。
7. THE Pricing_Service SHALL 对企业端仅暴露定价规则的只读查询，不暴露任何定价写入接口。

### Requirement 3: 计费规则下发

**User Story:** 作为平台管理员，我希望已定义的套餐与定价规则能下发给企业端，以便企业在订阅时获取到当前生效的规则。

#### Acceptance Criteria

1. WHEN 企业订阅或查看可选套餐, THE Subscription_Service SHALL 提供来自 Platform_Console 的当前生效 Plan 与 Plan_Pricing 的只读视图。
2. WHEN Platform_Admin 更新某 Plan 的定价, THE Subscription_Service SHALL 在企业端只读视图中反映该更新对应的版本，且不改变已生效订阅已锁定的计费规则版本。
3. WHILE 企业持有一个有效订阅, THE Billing_Service SHALL 使用该订阅 `plan_version_id` 所锁定的 Plan 与 Plan_Pricing 版本进行成本计算，以保证历史账单可复算。
4. THE Subscription_Service SHALL 确保企业端获取到的套餐与定价视图为只读，企业不能通过该视图写回或覆盖平台定义的规则。

### Requirement 4: 套餐订阅（企业端功能 1）

**User Story:** 作为企业管理员，我希望选择一个套餐并创建订阅，以便启动计费并开始使用平台资源。

#### Acceptance Criteria

1. WHEN Enterprise_Admin 提交订阅请求并指定有效的 `plan_id`, THE Subscription_Service SHALL 创建一条 Subscription 记录 `{ id, enterprise_id, plan_id, plan_version_id, start_time, end_time, status }`，将 `status` 置为生效状态，并将 `plan_version_id` 锁定为订阅生效时的当前定价版本。
2. WHEN Subscription 创建成功, THE Billing_Service SHALL 以该订阅的 `start_time` 作为计费起点开始计费。
3. IF 订阅请求指定的 `plan_id` 在 Platform_Console 中不存在, THEN THE Subscription_Service SHALL 拒绝该请求并返回描述性错误；即使描述性错误信息生成失败，THE Subscription_Service SHALL 仍然拒绝该请求。
4. IF 某企业已存在一个处于生效状态的 Subscription 且再次提交订阅请求, THEN THE Subscription_Service SHALL 拒绝重复订阅并返回描述性错误，提示先变更或取消现有订阅。
5. WHERE 某企业当前没有任何生效状态的 Subscription, THE Subscription_Service SHALL 允许其提交订阅请求并创建新订阅。
6. THE Subscription_Service SHALL 暴露企业端订阅写 API（语义对应 `POST /enterprise/{id}/subscribe`），其操作主体限定为 Enterprise_Admin。
7. WHERE 企业订阅状态变更（生效、暂停、到期、取消）, THE Subscription_Service SHALL 以追加记录方式保留订阅状态变更历史。

### Requirement 5: Seat 管理（企业端功能 2）

**User Story:** 作为企业管理员，我希望分配席位、设置席位角色并分配 Bot 配额，以便把已订阅的资源分发给成员。

#### Acceptance Criteria

1. WHEN Enterprise_Admin 提交分配席位请求, THE Seat_Service SHALL 在当前订阅下创建一个 Seat 并关联其角色（role），同时以时间区间模型（seat_history）记录该 Seat 的生效起始时间。
2. WHEN Enterprise_Admin 提交修改席位角色请求并指定有效 Seat, THE Seat_Service SHALL 关闭该 Seat 当前角色区间并以新角色追加一个新的生效区间（按比例计费 Proration 的基础）。
3. WHEN Enterprise_Admin 为某 Seat 分配 Bot 配额, THE Seat_Service SHALL 在不超过当前订阅 Plan 的 Bot 配额上限的前提下记录该分配。
4. IF 为某 Seat 分配的 Bot 配额为负数, THEN THE Seat_Service SHALL 拒绝该请求并返回描述性错误。
5. IF 新增 Seat 会使某角色的已分配席位数超过当前 Plan 对该角色的 Seat 配额, THEN THE Seat_Service SHALL 拒绝该分配并返回超出配额的描述性错误。
6. THE Seat_Service SHALL 暴露企业端 Seat 写 API（语义对应 `POST /seats`、`PUT /seats/{id}/role`），其操作主体限定为 Enterprise_Admin。
7. WHEN 某 Seat 被分配或其角色发生变更, THE Seat_Service SHALL 发布 `SeatChangedEvent`，且 THE Billing_Service SHALL 异步消费该事件，在后续成本计算中按各角色生效区间分别应用对应的 `seat/{role}` 价格并按区间占比计算 Seat 成本。
8. THE Seat_Service SHALL 作为独立于 Subscription_Service 的逻辑单元承载 Seat 的高频变更，Subscription_Service SHALL NOT 直接管理 Seat 记录。

### Requirement 6: 预算管理（企业端功能 3，新增核心能力）

**User Story:** 作为企业管理员，我希望设置月度预算、用量上限和超额提醒阈值，以便主动控制企业的费用支出。

#### Acceptance Criteria

1. WHEN Enterprise_Admin 提交设置预算请求（含 `monthly_limit`）, THE Budget_Service SHALL 创建或更新该企业的 Budget 记录 `{ id, enterprise_id, monthly_limit, alert_threshold }`。
2. WHERE Enterprise_Admin 未显式指定 `alert_threshold`, THE Budget_Service SHALL 将 `alert_threshold` 默认设置为 80%。
3. IF 设置预算请求中 `monthly_limit` 为负数, THEN THE Budget_Service SHALL 拒绝该请求并返回描述性错误。
4. IF 设置预算请求中 `alert_threshold` 不在 0% 到 100% 区间内, THEN THE Budget_Service SHALL 拒绝该请求并返回描述性错误。
5. WHEN 某企业的累计 `total_cost` 达到或超过 `monthly_limit × alert_threshold`, THE Budget_Service SHALL 触发预算提醒（trigger_alert）。
6. WHEN 某企业的累计 `total_cost` 超过 `monthly_limit`, THE Budget_Service SHALL 触发预算超限提醒并记录超限事件。
7. THE Budget_Service SHALL 将预算的设置与变更以追加方式保留历史，不覆盖既有 Budget 记录值。
8. THE Budget_Service SHALL 暴露受 `usage:budget` 权限保护的企业端预算写 API，替代当前仅存在权限项但无后端功能的现状。

### Requirement 7: 实时成本看板（企业端功能 4）

**User Story:** 作为企业管理员，我希望在一个看板上看到当前累计费用、Seat 成本、Usage 成本和预计月底费用，以便随时掌握成本结构并预测支出。

#### Acceptance Criteria

1. WHEN Enterprise_Admin 打开 Cost_Dashboard, THE Cost_Dashboard SHALL 展示当前计费周期的累计总费用、Seat 成本、Usage 成本三项金额。
2. THE Cost_Dashboard SHALL 展示当前计费周期的预计月底费用（Predicted_Month_End_Cost），其默认计算方式为基于当前累计费用与已过周期天数推算的日均消耗速率乘以周期总天数；THE Cost_Dashboard SHOULD 支持以加权移动平均（Weighted_Moving_Average）作为可选预测算法，以缓解 AI 用量突发导致的预测失真。
3. WHEN 当前累计 `total_cost` 已达到 `monthly_limit × alert_threshold`, THE Cost_Dashboard SHALL 展示预算提醒状态并标示当前用量占预算的百分比。
4. THE Cost_Dashboard SHALL 展示当前订阅所用 Plan 的名称、计费周期与预算上限，使成本数据可被解释。
5. WHERE 当前计费周期内无任何 Usage_Record 与 Seat 分配, THE Cost_Dashboard SHALL 展示金额为 0 的空状态，而非加载失败。
6. WHEN Cost_Dashboard 展示成本数据, THE Cost_Dashboard SHALL 仅展示当前企业（按 `enterprise_id` 隔离）的成本，不展示其他企业数据。
7. THE Cost_Dashboard SHALL 支持按日期范围筛选成本数据，替代现状中无日期范围筛选的限制。

### Requirement 8: 成本控制（企业端功能 5，进阶）

**User Story:** 作为企业管理员，我希望在接近或超过预算时限制 AI 调用、限制 Bot 创建，并可选地自动降级，以便在预算约束内保障服务可控。

#### Acceptance Criteria

1. WHEN 某企业累计 `total_cost` 超过 `monthly_limit` 且 Enterprise_Admin 已启用 AI 调用限制, THE Cost_Control_Service SHALL 拒绝该企业新的 AI 调用请求并返回预算超限的描述性提示。
2. WHEN 某企业已分配的 Bot 数量达到当前 Plan 的 Bot 配额上限, THE Cost_Control_Service SHALL 拒绝该企业新的 Bot 创建请求并返回配额已满的描述性提示。
3. WHERE Enterprise_Admin 启用自动降级（可选）, THE Cost_Control_Service SHALL 在累计 `total_cost` 超过 `monthly_limit` 时按预设降级策略降低资源供给等级。
4. WHILE 某企业的 AI 调用限制处于启用且预算超限状态, THE Cost_Control_Service SHALL 持续拒绝该企业新的 AI 调用，直至预算被调整或新计费周期开始。
5. IF Enterprise_Admin 未启用任何成本控制项, THEN THE Cost_Control_Service SHALL 仅触发提醒，且 SHALL NOT 拒绝该企业的 AI 调用或 Bot 创建请求。

### Requirement 9: 用量采集与计费（运行时闭环）

**User Story:** 作为系统，我需要采集企业运行时产生的用量并按定价规则计费，以便用量真实转化为成本。

#### Acceptance Criteria

1. WHEN 企业运行时产生可计量用量（如 AI token 消耗）, THE Usage_Service SHALL 以追加方式记录一条 Usage_Record，含 `enterprise_id`、`user_id`、`event_id`、计量类型 key、数量与发生时间。
2. THE Usage_Service SHALL 为每条 Usage_Record 记录唯一的 `event_id`，并保证 `event_id` 在 `enterprise_id` 维度唯一。
3. IF 同一 `event_id`（在同一 `enterprise_id` 下）被重复提交, THEN THE Usage_Service SHALL 仅记录一次并忽略后续重复请求，且对应计费结果 SHALL NOT 因重复上报而增加。
4. WHEN 一条新的 Usage_Record 被成功写入, THE Usage_Service SHALL 发布 `UsageReportedEvent`（携带 `enterprise_id`、`user_id`、`event_id`、计量类型 key、数量、发生时间；可选携带 `agent_id`、`org_seat_id`）。
5. WHEN Billing_Service 计算某企业的 Usage 成本, THE Billing_Service SHALL 对每条 Usage_Record 调用 `get_price(plan_id, "usage", key)` 并以 `数量 × 单价` 累加得到 `usage_cost`。
6. THE Usage_Service SHALL 按 `enterprise_id` 隔离用量记录，确保某企业的用量不计入其他企业。
7. WHEN 某计费周期内的用量超过当前 Plan 对应配额, THE Billing_Service SHALL 对超出部分按 `get_price(plan_id, "extra", key)` 计算 Overage 并计入 `extra_cost`；即使该周期基础用量配额内消耗为 0，只要存在超出配额的用量，THE Billing_Service SHALL 仍按超出量计算 Overage。
8. IF 某 Usage_Record 的计量类型 key 在 Plan_Pricing 中无匹配价格, THEN THE Billing_Service SHALL 将该记录标记为缺失价格并在成本结果中可见，而非静默计为 0；即使「标记为缺失价格」这一步失败，THE Billing_Service SHALL 仍以可见的缺失价格状态继续完成成本计算。

### Requirement 10: 成本计算与账单生成（运行时闭环）

**User Story:** 作为系统，我需要通过单一入口计算成本并生成账单，以便成本结果一致且可结算。

#### Acceptance Criteria

1. WHEN Billing_Service 计算某企业某计费周期的总成本, THE Billing_Service SHALL 通过单一计算入口按 `total_cost = seat_cost + usage_cost + extra_cost` 求和。
2. WHEN 计算 `seat_cost`, THE Billing_Service SHALL 对每个生效 Seat 调用 `get_price(plan_id, "seat", role)` 并按生效时长累加。
3. WHEN 一个 Billing_Cycle 结束, THE Billing_Service SHALL 以完整数据全量重算（full recomputation）生成一条 Bill，包含该周期的 `seat_cost`、`usage_cost`、`extra_cost` 与 `total_cost`，该结果标记为 `final` 并覆盖该周期的实时估算结果作为最终账单。
4. WHEN Billing_Service 完成一次周期内成本结算, THE Billing_Service SHALL 生成或更新当日的 Cost_Snapshot `{ id, enterprise_id, date, snapshot_type, seat_cost, usage_cost, total_cost }` 供看板与历史展示，其中实时增量计算产生的快照标记为 `estimated`，周期结算产生的快照标记为 `final`。
5. THE Billing_Service SHALL 确保对相同输入（相同订阅、Seat、Usage_Record 集合与定价版本）的成本计算结果是确定且可重现的。

### Requirement 11: 可追溯性与 append-only 历史（设计原则 3）

**User Story:** 作为企业管理员与平台管理员，我希望所有计费数据都可追溯且不被覆盖，以便审计费用来源与历史变化。

#### Acceptance Criteria

1. THE Billing_Service SHALL 以追加写入（Append_Only）方式记录所有 Bill 与 Cost_Snapshot，不修改或删除既有记录。
2. THE Subscription_Service SHALL 以追加写入方式记录订阅状态变更历史，THE Seat_Service SHALL 以追加写入方式记录 Seat 分配与角色变更历史（seat_history），既有区间记录不被覆盖。
3. THE Pricing_Service SHALL 以追加新版本方式记录 Plan 与 Plan_Pricing 的变更，保留历史版本。
4. WHEN 任意成本数据被展示, THE Billing_Service SHALL 可追溯该成本对应的订阅、定价版本、Seat 与 Usage_Record 来源。
5. IF 任意组件尝试覆盖或删除既有计费历史记录, THEN THE Billing_Service SHALL 拒绝该操作并返回违反追溯性约束的描述性错误。

### Requirement 12: 成本可预测性（设计原则 4）

**User Story:** 作为企业管理员，我希望系统能稳定预测本周期月底费用，以便提前规划预算调整。

#### Acceptance Criteria

1. THE Cost_Budget_Module SHALL 为每个有生效订阅的企业提供 Predicted_Month_End_Cost。
2. WHEN 当前累计费用或日均消耗速率变化, THE Cost_Budget_Module SHALL 在数据刷新后更新 Predicted_Month_End_Cost。
3. IF 当前计费周期已过天数为 0（周期首日且无历史数据）, THEN THE Cost_Budget_Module SHALL 将 Predicted_Month_End_Cost 展示为「数据不足以预测」占位，而非除零错误。
4. WHEN Predicted_Month_End_Cost 超过 `monthly_limit`, THE Cost_Budget_Module SHALL 标示预计将超预算的提示。

### Requirement 13: 租户隔离

**User Story:** 作为平台管理员，我希望每个企业的计费数据彼此隔离，以便满足多租户安全与合规要求。

#### Acceptance Criteria

1. THE Billing_Service SHALL 按 `enterprise_id`（tenantId）隔离所有订阅、预算、用量、账单与成本快照数据。
2. WHEN Enterprise_Admin 查询成本数据, THE Cost_Budget_Module SHALL 仅返回该管理员所属企业的数据。
3. IF 某请求尝试访问不属于其 `enterprise_id` 的计费数据, THEN THE Billing_Service SHALL 同时拒绝该请求并返回无权限的描述性错误（拒绝与错误信息须同时提供）；且该拒绝 SHALL NOT 中断 Enterprise_Admin 当前会话对其自身合法数据的后续响应。
4. THE Cost_Budget_Module SHALL 修正现状中用量数据未按 tenantId 过滤、为全局视图的缺陷。

### Requirement 14: 权限模型

**User Story:** 作为平台管理员，我希望平台端定价权限与企业端预算/分配权限彼此隔离，以便强制执行「定价仅平台、控制仅企业」的边界。

#### Acceptance Criteria

1. THE Plan_Management SHALL 将套餐与定价的创建/更新限定为 Platform_Admin 角色。
2. WHEN 持有 `usage:budget` 权限的 Enterprise_Admin 提交预算设置请求, THE Budget_Service SHALL 允许该操作。
3. IF 未持有 `usage:budget` 权限的用户提交预算设置或成本控制变更请求, THEN THE Cost_Budget_Module SHALL 拒绝该请求并返回无权限提示。
4. THE Cost_Budget_Module SHALL 为现有权限项 `usage:budget` 提供真实后端功能支撑，替代当前权限项存在但无功能的现状。
5. THE Cost_Budget_Module SHALL NOT 向 Enterprise_Admin 暴露任何修改 Plan 或 Plan_Pricing 的操作入口。

### Requirement 15: 迁移（替换启发式展示视图）

**User Story:** 作为开发者，我需要将现有启发式预算展示视图迁移到持久化的平台定价 + 企业配置预算模型，以避免数据语义冲突。

#### Acceptance Criteria

1. THE Migration_Process SHALL 以 Budget_Service 中持久化的、由 Enterprise_Admin 配置的 Budget 取代 `enterprise-read-model.ts` 中 `deriveBudgetLimit()` 的启发式 budgetLimit。
2. THE Migration_Process SHALL 以 Billing_Service 计算的成本取代当前由 `sessions.usage` 与 `usage.cost` 派生的 totalCost/totalTokens 作为成本与预算模块的成本来源。
3. WHEN 某企业尚未配置 Budget 或尚未订阅, THE Cost_Budget_Module SHALL 展示引导其订阅或设置预算的空状态，而非展示启发式派生的预算值。
4. WHERE 某企业已配置 Budget 但其订阅变为非生效状态, THE Cost_Budget_Module SHALL 仍使用该企业已配置的 Budget 数据展示持久化的预算视图。
5. THE Migration_Process SHALL 保持现有 `enterpriseUsageManagement`（能力应用管理）模块不受影响，不修改其 `enterprise-usage.*` RPC 逻辑。
6. THE Migration_Process SHALL 替换现状中「预算控制工作区」面板项仅跳转设置页的静态占位行为，使其连接到真实的 Budget_Service 写操作。

### Requirement 16: 微服务分解方向约束

**User Story:** 作为架构师，我希望需求保持实现无关但承认 Billing/Usage/Subscription 的分解方向，以便后续设计阶段顺利落地。

#### Acceptance Criteria

1. THE Cost_Budget_Module SHALL 在职责划分上区分 Subscription（订阅生命周期）、Seat（席位与角色，高频变更、独立于 Subscription）、Usage（用量采集与计量）、Billing（成本计算、账单、定价应用）四类关注点。
2. THE Cost_Budget_Module SHALL 通过明确定义的接口契约（Plan、Plan_Pricing、Subscription、Seat、Usage_Record、Bill、Budget、Cost_Snapshot）与领域事件（UsageReportedEvent、SeatChangedEvent、BotCreatedEvent）在上述关注点之间传递数据。
3. THE Billing_Service SHALL 通过异步消费领域事件进行成本累计，系统 SHALL NOT 要求 Usage_Service 到 Billing_Service 的同步 API 调用来完成成本计算。
4. THE Cost_Budget_Module SHALL 保持需求层面实现无关，不在本规格中规定具体的服务部署拓扑、数据库选型或通信协议，这些由后续设计阶段决定。

### Requirement 17: 套餐升级与切换（订阅页交互）

**User Story:** 作为企业管理员，我希望在订阅页查看当前套餐与可选套餐并发起升级或切换，以便按业务增长调整资源，并清楚了解差价与生效时间。

#### Acceptance Criteria

1. THE Subscription_Service SHALL 在订阅页展示当前套餐的名称、各角色 Seat 价格、Bot 配额与用量价格，以及来自 Platform_Console 的可选套餐列表。
2. WHEN Enterprise_Admin 对某可选套餐发起升级或切换, THE Subscription_Service SHALL 展示二次确认，包含与当前套餐的差价以及生效时间选项（立即生效或下一计费周期生效）。
3. WHEN Enterprise_Admin 确认立即生效的套餐变更, THE Subscription_Service SHALL 以追加方式结束当前订阅区间并创建新订阅区间，且 THE Billing_Service SHALL 按 Proration 对变更当期费用按比例计算。
4. WHERE Enterprise_Admin 选择下一计费周期生效, THE Subscription_Service SHALL 记录待生效的套餐变更，并在下一周期起点应用新套餐。
5. IF 套餐变更请求指定的目标 `plan_id` 不存在或不可用, THEN THE Subscription_Service SHALL 拒绝该请求并返回描述性错误。

### Requirement 18: 使用量分析（Usage 子页）

**User Story:** 作为企业管理员，我希望按用户、按类型和按时间查看用量与对应费用，以便解释「钱花在哪」。

#### Acceptance Criteria

1. WHEN Enterprise_Admin 打开 Usage_Analytics, THE Usage_Analytics SHALL 展示当前计费周期的总用量与对应 Usage 费用。
2. THE Usage_Analytics SHALL 支持按用户维度展示用量排行，按计量类型（如 AI token、task）拆分用量，以及按时间窗口筛选。
3. WHEN Enterprise_Admin 调整时间窗口筛选, THE Usage_Analytics SHALL 在数据刷新后重新计算并展示对应窗口内的用量与费用。
4. THE Usage_Analytics SHALL 仅展示当前企业（按 `enterprise_id` 隔离）的用量数据。
5. WHERE 所选时间窗口内无任何 Usage_Record, THE Usage_Analytics SHALL 展示「暂无使用数据」空状态。

### Requirement 19: 账单与明细（Billing 子页）

**User Story:** 作为企业管理员（及财务），我希望查看历史账单列表、逐条钻取明细并下载账单，以便财务核对。

#### Acceptance Criteria

1. WHEN Enterprise_Admin 打开 Billing_Ledger, THE Billing_Ledger SHALL 按计费周期倒序展示该企业的历史账单列表，每条含周期与总额。
2. WHEN Enterprise_Admin 点击某条账单, THE Billing_Ledger SHALL 展示该账单的明细拆解，按 Bill_Item 分类（seat / usage / extra）并可下钻到对应用户与条目。
3. WHEN Enterprise_Admin 请求下载某条账单, THE Billing_Ledger SHALL 提供该账单的可下载导出。
4. THE Billing_Ledger SHALL 仅展示当前企业（按 `enterprise_id` 隔离）的账单数据。
5. THE Billing_Ledger SHALL 展示的账单明细之和 SHALL 等于该账单的总额。

### Requirement 20: 资源与配额（Resources 子页）

**User Story:** 作为企业管理员，我希望查看 Bot 使用情况与用户 Bot 分布并限制用户可创建的 Bot 数量，以便控制资源占用。

#### Acceptance Criteria

1. WHEN Enterprise_Admin 打开资源子页, THE Resource_Service SHALL 展示当前已用 Bot 数与当前 Plan 的 Bot 配额上限及占用比例。
2. THE Resource_Service SHALL 展示各用户的 Bot 分布数量。
3. WHEN Enterprise_Admin 设置某用户可创建 Bot 数量上限, THE Resource_Service SHALL 记录该上限并在后续 Bot 创建校验中应用。
4. WHEN 某用户已创建 Bot 数量达到其上限或企业整体达到 Plan 配额, THE Resource_Service SHALL 拒绝新的 Bot 创建请求并返回配额已满的描述性提示。
5. IF 设置的用户 Bot 数量上限为负数, THEN THE Resource_Service SHALL 拒绝该请求并返回描述性错误。

### Requirement 21: 成本归因与可解释钻取（跨页面）

**User Story:** 作为企业管理员，我希望从任意费用数字逐层钻取到来源，以便每一分钱都可解释。

#### Acceptance Criteria

1. WHEN Enterprise_Admin 在任意成本展示位置点击某项费用, THE Cost_Budget_Module SHALL 支持逐层钻取：总费用 → Seat 成本 / Usage 成本 / Extra 成本 → 具体用户。
2. THE Cost_Budget_Module SHALL 在每个子页顶部一致展示当前计费周期的预计月底费用（Predicted_Month_End_Cost）。
3. WHEN 底层 Usage_Record 或 Seat 数据发生变化, THE Cost_Budget_Module SHALL 在数据刷新后使钻取视图反映更新后的成本归因。
4. THE Cost_Budget_Module SHALL 确保任意展示的费用都可追溯至其对应的订阅、定价版本、Seat 区间或 Usage_Record 来源。

### Requirement 22: 计费触发与计算模式（实时估算 vs 周期结算）

**User Story:** 作为系统，我需要明确定义计费何时触发、由谁触发、是实时还是批处理，以便看板与账单数据一致、避免实时与结算冲突、避免性能爆炸。

#### Acceptance Criteria

1. THE Billing_Service SHALL 支持两种计算模式：(a) 实时增量计算（用于看板，产出 Estimated_Cost）；(b) 周期性结算计算（用于账单，产出 Final_Cost）。
2. WHEN 一条 Usage_Record 被写入并触发 `UsageReportedEvent`, THE Billing_Service SHALL 通过消费该事件进行增量成本更新，并将更新后的成本标记为 `estimated`。
3. WHEN 一个 Billing_Cycle 结束, THE Billing_Service SHALL 以该周期完整数据进行全量重算（full recomputation），并将该结果标记为 `final`。
4. WHEN 周期结算的 Final_Cost 生成, THE Billing_Service SHALL 以 Final_Cost 作为该周期最终账单，覆盖（以追加新 `final` 记录而非修改既有记录的方式）该周期的实时估算结果。
5. THE Billing_Service SHALL 将实时成本标记为 `estimated`、将账单结果标记为 `final`，且 THE Cost_Dashboard SHALL 在展示估算成本时明确标示其为估算值。
6. IF 同一周期的 Final_Cost 与先前 Estimated_Cost 存在差异, THEN THE Billing_Service SHALL 保留两者历史记录（append-only），以最近的 `final` 记录作为权威账单值，且 SHALL NOT 删除既有 `estimated` 记录。

### Requirement 23: 成本控制闸口（执行前拦截）

**User Story:** 作为企业管理员，我希望预算控制是真正能拦截调用的强控制点，而不仅是事后提醒，以便预算超限时 AI 调用与 Bot 创建在执行前被拒绝。

#### Acceptance Criteria

1. THE Cost_Control_Service SHALL 作为受控资源的闸口（gatekeeper）：所有 AI 调用与 Bot 创建请求在执行前 SHALL 经过 Cost_Control_Service 校验。
2. WHEN 某企业预算已超限且对应控制项已启用, THE Cost_Control_Service SHALL 在请求执行之前（BEFORE execution）拒绝该 AI 调用或 Bot 创建请求，而非在执行之后提醒。
3. IF 受控资源调用未经过 Cost_Control_Service 校验, THEN THE Cost_Budget_Module SHALL 视为控制点缺失的设计缺陷，受控调用路径 SHALL 强制经过该闸口。
4. WHEN Cost_Control_Service 拒绝某请求, THE Cost_Control_Service SHALL 返回包含拒绝原因（预算超限 / 配额已满）的描述性提示。
5. WHILE 某企业的控制项处于启用且预算超限状态, THE Cost_Control_Service SHALL 持续在执行前拒绝受控请求，直至预算被调整或新计费周期开始。
6. WHERE Enterprise_Admin 未启用任何成本控制项, THE Cost_Control_Service SHALL 放行受控请求并仅触发提醒，SHALL NOT 在执行前拒绝。

### Requirement 24: 套餐版本生命周期状态机（平台控制平面）

**User Story:** 作为平台管理员，我希望套餐版本有明确的 draft/active/deprecated 状态机，以便系统化管理定价规则的发布与下线，并保证历史可追溯。

#### Acceptance Criteria

1. THE Plan_Version_Lifecycle SHALL 为每个 PlanVersion 维护 `status ∈ {draft, active, deprecated}`。
2. THE Plan_Version_Lifecycle SHALL 仅允许以下状态流转：`draft → active`、`active → deprecated`；其余流转（含 `draft → deprecated`、`deprecated → active`、`active → draft`、`deprecated → draft`）SHALL 被拒绝并返回非法流转的描述性错误。
3. THE Plan_Version_Lifecycle SHALL 将 PlanVersion 的 `pricing` 视为不可变（immutable）：一经创建，`pricing` SHALL NOT 被修改；仅 `status` 可经合法流转变更。
4. WHEN PlanVersion 的 `status` 发生流转, THE Plan_Version_Lifecycle SHALL 以 append-only 方式记录一条 PlanVersionStatusChangeEvent（含 `from_status`、`to_status`、`request_id`、操作者、发生时间），不修改既有审计记录。
5. IF 任意请求尝试修改一个非 draft 版本的 `pricing`, THEN THE Plan_Version_Lifecycle SHALL 拒绝该请求并返回不可变约束的描述性错误。
6. THE Plan_Version_Lifecycle SHALL 仅允许在 draft 状态下编辑该版本的 `pricing`。

### Requirement 25: 单一 active 不变量与激活/废弃流转

**User Story:** 作为平台管理员，我希望每个套餐在任意时刻至多有一个生效版本，并能安全地激活新版本或废弃旧版本，即使并发操作也不破坏一致性。

#### Acceptance Criteria

1. THE Plan_Version_Lifecycle SHALL 保证同一 Plan 在任意时刻至多有一个 `status=active` 的 PlanVersion（Single_Active_Invariant）。
2. WHEN Platform_Admin 激活某 Plan 的某 draft 版本, THE Plan_Version_Lifecycle SHALL 在同一原子操作内将该 Plan 既有 active 版本降级为 deprecated，并将目标版本置为 active。
3. THE Plan_Version_Lifecycle SHALL 以 **Plan 级别（`plan_id`）串行锁** 执行激活/废弃：在锁内「读取该 Plan 全部版本 → `reduceVersionStatuses` 归约 → 整体写回 → 追加事件」，SHALL NOT 使用版本级（单条 version）局部更新，以杜绝两个版本同时 active 或 `currentVersionId` 不一致。
4. WHEN Platform_Admin 以相同 `request_id` 重复发起同一激活请求, THE Plan_Version_Lifecycle SHALL 在 store 层基于已存在的同 `request_id` 状态变更事件做幂等短路（返回首次结果），不重复降级 active 或产生重复流转。
5. WHILE 多个激活请求并发到达同一 Plan, THE Plan_Version_Lifecycle SHALL 经 Plan 级锁串行化处理，并在全部完成后仍保持至多一个 active 版本。
6. WHEN Platform_Admin 废弃某 active 版本, THE Plan_Version_Lifecycle SHALL 将其置为 deprecated；既有引用该版本的订阅 SHALL 继续按其锁定的定价快照计费（不受影响）。
7. THE Plan_Version_Lifecycle SHALL 视 `deprecated` 为终态（不可逆）：SHALL NOT 允许 `deprecated → active` 或 `deprecated → draft`；废弃后若需恢复定价，须新建 draft 版本再激活。
8. WHEN Plan_Version_Lifecycle 执行激活, THE Plan_Version_Lifecycle SHALL 在目标版本上记录 `activatedAt`；执行废弃时记录 `deprecatedAt`，供时间线与审计。
9. IF 激活请求指向的版本不存在或不属于该 Plan, THEN THE Plan_Version_Lifecycle SHALL 拒绝该请求并返回描述性错误。

### Requirement 26: 订阅必须绑定 active 版本（版本级约束）

**User Story:** 作为系统，我需要订阅强制绑定到一个 active 的 PlanVersion，以便计费依据明确且可追溯。

#### Acceptance Criteria

1. THE Subscription_Service SHALL 要求每个 Subscription 绑定一个 `plan_version_id`（必填）。
2. WHEN Enterprise_Admin 通过标准路径（API/内部）订阅并显式提供 `plan_version_id`, THE Subscription_Service SHALL 校验该版本 `status=active` 后创建订阅；非 active（draft/deprecated）SHALL 被拒绝并返回描述性错误。
3. WHERE 订阅请求仅提供 `plan_id`（UI 便捷路径）, THE Subscription_Service SHALL 解析为该 Plan 当前 active 版本、在订阅上记录 `resolvedFromPlanId=true`，并据此锁定 `plan_version_id`。
4. WHEN 某 Plan 的 active 版本在订阅创建后发生切换, THE Billing_Service SHALL 继续使用该订阅已锁定的 `plan_version_id` 进行成本计算，新 active 版本 SHALL NOT 影响既有订阅的历史账单。
5. THE Billing_Service SHALL 仅通过 `plan_version_id` 读取定价快照计费；SHALL NOT 依赖 `plan_id` 解析价格用于计费路径。
6. IF 计费路径输入中出现以 `plan_id` 充当定价依据的情形, THEN THE Billing_Service SHALL 视为违规并拒绝，返回「计费路径不接受 planId」的描述性错误。
7. THE Billing_Service SHALL 在成本计算入口断言所锁定版本的定价快照可用；WHERE 该版本已 deprecated, THE Billing_Service SHALL 仍按其锁定快照计费（deprecated 仅阻止新订阅，不影响既有订阅复算）。

### Requirement 27: 旧数据兼容与计费路径不变量

**User Story:** 作为开发者，我需要在引入版本生命周期后通过一次性迁移兼容既有数据，并通过不变量断言防止数据污染静默失败（运行时不做隐式回退）。

#### Acceptance Criteria

1. WHERE 既有 PlanVersion 缺少 `status` 字段, THE Migration_Process SHALL 在加载/迁移时归一化：匹配 Plan `currentVersionId` 的版本置为 active，其余置为 deprecated。
2. THE Migration_Process SHALL 通过**一次性迁移脚本**为既有缺少 `plan_version_id` 的 Subscription 绑定其订阅创建时点对应的版本（无法精确判定时绑定迁移时的 active 版本并标记 `migratedBinding=true`）。
3. IF 运行时（非迁移）遇到缺少 `plan_version_id` 的 Subscription 进入计费路径, THEN THE Billing_Service SHALL 抛出 DataIntegrityError 并拒绝计费，SHALL NOT 在运行时隐式回退绑定到当前 active 版本（避免把旧订阅错误绑定到新价格）。
4. WHEN Billing_Service 进入成本计算, THE Billing_Service SHALL 断言 `subscription.plan_version_id` 与 `version.pricing` 均已定义；若任一缺失，SHALL 返回明确错误而非静默计为 0。
5. THE Migration_Process SHALL 确保版本生命周期的引入不改变既有订阅已锁定 `plan_version_id` 对应的历史账单结果。

> _A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do._

属性测试范围严格限定为纯计算逻辑：成本计算不变量、价格查询、预算检查边界、追溯性（append-only）不变量、成本计算确定性与租户隔离。展示逻辑（金额格式化、空状态文案、看板布局）使用单元/快照测试，不使用 PBT。涉及外部服务、运行时采集链路与部署配置的行为使用集成测试的代表性样例，不使用 PBT。

### Property 1：成本计算单一入口求和不变量

_For any_ 一组生效 Seat、Usage_Record 集合与额外费用项，`Billing_Service` 计算出的 `total_cost` SHALL 恒等于 `seat_cost + usage_cost + extra_cost`。三个分量的任一拆分顺序或累加顺序 SHALL NOT 改变 `total_cost` 结果（求和满足结合律与交换律）。

**Validates: Requirements 10.1, 10.2, 9.2, 9.4**

### Property 2：价格查询确定性与缺失处理

_For any_ `(plan_id, type, key)`，若 Plan_Pricing 中存在匹配记录，`get_price` SHALL 返回该记录的 `price`；若不存在匹配记录，`get_price` SHALL 返回未找到价格的错误，且 SHALL NOT 返回隐式默认价或 0。对相同输入连续调用 `get_price` SHALL 返回相同结果。

**Validates: Requirements 2.3, 2.4, 9.5**

### Property 3：预算检查边界

_For any_ `monthly_limit ≥ 0`、`alert_threshold ∈ [0%, 100%]` 与累计 `total_cost ≥ 0`：当 `total_cost ≥ monthly_limit × alert_threshold` 时 `Budget_Service` SHALL 触发提醒；当 `total_cost < monthly_limit × alert_threshold` 时 SHALL NOT 触发提醒；当 `total_cost > monthly_limit` 时 SHALL 触发超限提醒。阈值边界（恰等于阈值）SHALL 被判定为触发提醒。

**Validates: Requirements 6.5, 6.6**

### Property 4：成本计算确定性（可重现）

_For any_ 固定的订阅、Seat 集合、Usage_Record 集合与锁定的定价版本，连续两次调用 `Billing_Service` 的成本计算 SHALL 返回完全相同的 `seat_cost`、`usage_cost`、`extra_cost` 与 `total_cost`。

**Validates: Requirements 10.5, 3.3**

### Property 5：Append-only 追溯性不变量

_For any_ 既有的 Bill、Cost_Snapshot、Subscription 状态变更与 Plan/Plan_Pricing 版本记录，任何写操作 SHALL 仅新增记录，记录总数 SHALL 单调不减，且既有记录的字段值 SHALL 保持不变。尝试修改或删除既有记录的操作 SHALL 被拒绝。

**Validates: Requirements 11.1, 11.2, 11.3, 11.5**

### Property 6：租户隔离

_For any_ 两个不同的 `enterprise_id` A 与 B 及其各自的计费数据集合，以 A 的身份查询所返回的订阅、预算、用量、账单与快照集合 SHALL 与 B 的数据集合无交集。以 A 的身份访问 B 的数据 SHALL 被拒绝。

**Validates: Requirements 13.1, 13.2, 13.3**

### Property 7：Seat 与 Usage 配额及超额计算

_For any_ Plan 配额、已分配 Seat 数与周期用量：当分配量或用量不超过配额时 `extra_cost` 对应分量 SHALL 为 0；当超过配额时，超出部分 SHALL 按 `get_price(plan_id, "extra", key)` 计入 `extra_cost`，且 `extra_cost` 随超出量单调不减。

**Validates: Requirements 5.5, 9.4, 8.2, 20.4**

### Property 8：账单明细求和一致性

_For any_ 一条 Bill 及其 Bill_Item 集合，所有 Bill_Item 的 `amount` 之和 SHALL 等于该 Bill 的 `total_amount`，且按 `type` 聚合后的 `seat / usage / extra` 分量之和 SHALL 等于 `total_cost`。

**Validates: Requirements 10.3, 19.5**

### Property 9：用量采集幂等性（按 event_id 去重）

_For any_ 同一个用量事件（相同 `event_id`，同一 `enterprise_id`）被上报一次或多次，`Usage_Service` 记录的 Usage_Record 数量 SHALL 恰为 1，可计费用量 SHALL 与仅上报一次时相同，对应计费结果 SHALL NOT 因重复上报而增加。`event_id` 在 `enterprise_id` 维度 SHALL 唯一。

**Validates: Requirements 9.1, 9.2, 9.3, 9.6**

### Property 10：Seat 角色变更按比例计费（Proration）

_For any_ 在一个计费周期内发生角色变更的 Seat，其 `seat_cost` SHALL 等于各角色生效时间区间占周期比例与对应 `seat/{role}` 价格乘积之和；当周期内无角色变更时，结果 SHALL 等同于该单一角色价格按全周期计费。各区间占比之和 SHALL 等于 1。

**Validates: Requirements 5.2, 5.7, 10.2, 17.3**

### Property 11：估算成本与最终成本的收敛与标记

_For any_ 同一计费周期，给定固定的 Usage_Record 集合、Seat 区间与锁定的定价版本：当全部用量事件均被处理后，周期结算的 Final_Cost SHALL 等于以相同输入直接全量计算的结果；实时增量累计的 Estimated_Cost 在处理完全部事件后 SHALL 收敛到该 Final_Cost。所有实时成本记录 SHALL 标记为 `estimated`，所有结算成本记录 SHALL 标记为 `final`，且二者历史记录 SHALL 同时保留（append-only）。

**Validates: Requirements 22.1, 22.2, 22.3, 22.4, 22.6**

### Property 12：成本控制闸口拦截不变量

_For any_ 企业的预算状态与控制项开关组合：当且仅当（控制项启用 AND 预算超限）时，经过 Cost_Control_Service 的受控请求（AI 调用 / Bot 创建）SHALL 在执行前被拒绝；当控制项未启用时，受控请求 SHALL 被放行（最多触发提醒）。被拒绝的请求 SHALL NOT 产生新的可计费用量。

**Validates: Requirements 23.1, 23.2, 23.5, 23.6, 8.5**

### Property 13：版本状态机合法流转

_For any_ PlanVersion 的当前状态与目标状态：状态流转 SHALL 当且仅当属于 `{draft→active, active→deprecated}` 时被接受；其余任意 `(from, to)` 组合（含自反、`draft→deprecated`、`deprecated→active`、`deprecated→draft`、向 draft 回退）SHALL 被拒绝。`deprecated` 为终态。合法流转序列从 draft 起最多经过 `draft→active→deprecated`，不可逆。

**Validates: Requirements 24.1, 24.2, 25.7**

### Property 14：单一 active 不变量（含并发与幂等）

_For any_ 一个 Plan 上任意顺序与并发的「创建草稿 / 激活 / 废弃」操作序列（经 Plan 级串行锁）：操作完成后该 Plan 的 `status=active` 版本数 SHALL ≤ 1。激活某版本 SHALL 原子地把原 active 降级为 deprecated（整体读-归约-写回，非局部更新）。以相同 `requestId` 重复激活 SHALL 幂等（结果与单次相同，不重复降级）。

**Validates: Requirements 25.1, 25.2, 25.3, 25.4, 25.5**

### Property 15：版本锁定计费不可变性

_For any_ 已绑定 `plan_version_id` 的订阅，与该订阅创建后该 Plan 任意的 active 版本切换/废弃序列：使用该订阅锁定的 `plan_version_id` 复算的历史账单结果 SHALL 与版本切换无关（恒定，即使锁定版本已 deprecated）。计费路径 SHALL 仅经 `plan_version_id` 读取定价快照；任何以 `plan_id` 充当计费依据的输入 SHALL 被拒绝。

**Validates: Requirements 26.4, 26.5, 26.6, 26.7, 27.5**

### Property 16：版本定价快照不可变

_For any_ 一个 PlanVersion，其 `pricing` 快照在创建后 SHALL 保持不变；仅当版本处于 draft 时才允许编辑 `pricing`；对非 draft 版本的 `pricing` 修改尝试 SHALL 被拒绝。`status` 的每次合法流转 SHALL 产生一条完整字段（from/to/requestId）的 append-only PlanVersionStatusChangeEvent。

**Validates: Requirements 24.3, 24.4, 24.5, 24.6**
