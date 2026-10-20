# 需求文档：员工端 Agent 成长操作系统（Agent Growth OS）

## 简介

本 spec 在员工端构建 **Agent Activation & Growth System**（亦称 Agent Growth OS）：将「创建机器人 / 协作小组」从配置终点升级为 **激活起点**，通过持久化成长状态、Readiness 评分、成长漏斗与成长报告，支撑首次体验、长期运营与治理。

### 与 design.md 的关系

- **design.md（v3）**：架构、类型模型、产品原则、EPR 对照 — **规范性设计**
- **本文档**：可测试验收条目 — **需求契约**
- **tasks.md**：工程任务拆分与依赖 — **实施计划**

### 核心不变量（全程不得突破）

1. **Bootstrap ≠ Growth**：`bootstrapStatus` 仅表示技术初始化；`growthStatus` 表示产品激活与成长。禁止用 bootstrap 完成态冒充用户引导完成。
2. **Lifecycle ⊥ Dimension**：`lifecycleState`（互斥生命周期）与 `dimensions`（并行 0–100 维度）不得再合并为单一 `stage` 枚举。
3. **UI ← 状态机 ← 数据**：Prelude / Stepper / Badge 只读 `growthStatus`；禁止用 UI localStorage 作为唯一真相源（P0 可临时缓存 dismiss，必须以 gateway 为准）。
4. **Mission Ready 双门槛**：`activationScore >= threshold` **且** `capabilityReadiness === true`（模板驱动 required 项）；小组另需 `alignmentComplete`。
5. **Created ≠ Activated**：`isActivated` 仅在首个**有效任务成功**后为 true；运营北极星以 Activated 为主。
6. **与 RuntimeLifecycle 分离**：`deployed/draining/…` 是运维层；本 spec 不修改 RuntimeLifecycle 语义。

### 现状锚点

| 维度                       | 现状                       | 本 spec 处置                                  |
| -------------------------- | -------------------------- | --------------------------------------------- |
| 机器人创建后               | `closeCreator()`，不进会话 | P0B：auto `switchEmployeeWorkbenchSession`    |
| 小组创建后                 | 进会话，空聊天             | P1：Prelude；P0B：init growth + telemetry     |
| `onboardingStatus`         | = group_bootstrap          | 更名为 `bootstrapStatus`；新增 `growthStatus` |
| UI `onboardingInitialized` | 已映射未消费               | 改为 `bootstrapArtifactsReady`                |
| Daibai prelude             | `threadPrelude` 模式       | P1 复用样式，独立 growth prelude              |
| Agent 模板                 | 无                         | P0A：`generic_worker` 默认模板                |
| Readiness                  | 无                         | P0A：activationScore + capabilityReadiness    |

### 实施阶段

| 阶段    | 范围                                                      |
| ------- | --------------------------------------------------------- |
| **P0A** | Growth 内核：类型、持久化、Readiness、模板、RPC、单测     |
| **P0B** | 激活路径：创建挂钩、进会话、milestones、最小 UI badge     |
| **P1**  | 表现层：自我认知 Prelude、Stepper、CTA、i18n              |
| **P2**  | 智能化：LLM Awakening、operationalScore、Growth Report UI |
| **P3**  | 暂缓：跨 Agent 大盘、Autopilot 闭环                       |

---

## 术语表

| 术语                     | 定义                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------- |
| **BootstrapStatus**      | 技术初始化状态（章程、记忆、workspace 骨架）                                            |
| **GrowthStatus**         | 产品成长状态（生命周期、维度、评分、里程碑）                                            |
| **LifecycleState**       | 互斥生命周期：`birth` \| `growing` \| `mission_ready` \| `activated` \| `evolution`     |
| **GrowthDimension**      | 并行维度进度 0–100：`identity`、`capability`、`knowledge`、`habits`；小组含 `alignment` |
| **activationScore**      | 配置完成度 0–100，由加权 `dimensions` 得出                                              |
| **operationalScore**     | 实战表现 0–100（P2 起算；P0 字段预留 `null`）                                           |
| **capabilityReadiness**  | 模板 required 项（skill + OAuth）是否满足；Mission Ready 硬门槛                         |
| **alignmentComplete**    | 小组：`rolesAssigned && workflowDefined`                                                |
| **isActivated**          | 完成首个有效任务成功后为 true                                                           |
| **AgentTemplate**        | 角色蓝图，含 `requiredCapabilities`、`dimensionWeights`、`missionReadyThreshold`        |
| **GrowthMilestones**     | 漏斗时间戳集合                                                                          |
| **GrowthReportSnapshot** | 成长报告，含 `businessImpact: ImpactMetric[]`                                           |
| **generic_worker**       | P0 默认模板，无行业 required 项时的降级蓝图                                             |

---

## 需求

### 需求 1：BootstrapStatus 与 GrowthStatus 双状态体系（P0A）

**用户故事：** 作为平台开发者，我需要将技术 bootstrap 与用户成长状态彻底分离，以便产品、运营与统计口径一致。

#### 验收标准

1. THE Gateway SHALL 为协作小组在 operating state 中暴露 `bootstrapStatus` 与 `growthStatus` 两个独立对象（可与旧 `onboardingStatus` 只读别名并存一期）。
2. THE Gateway SHALL 为机器人将 `growthStatus` 持久化至 `~/.openbot/agents/{agentId}/growth-status.json`（或等效 agent 目录路径）。
3. WHEN `bootstrapStatus.initialized === true` AND `growthStatus.isActivated === false`, THE System SHALL NOT 向用户展示「已完全就绪可上岗」类文案（除非 `lifecycleState === mission_ready`）。
4. THE UI SHALL 将原 `onboardingInitialized` 重命名为 `bootstrapArtifactsReady`，且仅用于 bootstrap 相关展示，不用于 Growth 进度。
5. THE System SHALL NOT 在新代码中引入 `onboarding` 命名描述用户引导（文档、类型、RPC、UI 文案均适用）。

---

### 需求 2：LifecycleState 与 GrowthDimension 解耦（P0A）

**用户故事：** 作为数据分析师，我需要独立查询 Agent 生命周期阶段与各维度进度，以便运营统计可解释。

#### 验收标准

1. THE `GrowthStatus` type SHALL 包含 `lifecycleState: LifecycleState` 与 `dimensions: GrowthDimension`，SHALL NOT 使用混合 `stage` 字段（如 `identity` 与 `birth` 同枚举）。
2. THE System SHALL 提供纯函数 `deriveLifecycleState(growthStatus)` 根据 `activationScore`、`capabilityReadiness`、`isActivated`、`milestones` 推导 `lifecycleState`，而非允许调用方任意手写生命周期。
3. WHEN `dimensions.identity === 100` AND `dimensions.habits === 30` AND `activationScore < 78`, THE `lifecycleState` SHALL be `growing`（非 `habits` 或 `identity`）。
4. THE RPC `agents.get-growth-status` / `collaboration.spaces.get-growth-status` SHALL 返回完整 `dimensions` 与 `lifecycleState`。
5. THE System SHALL 提供单元测试覆盖：birth → growing → mission_ready → activated → evolution 推导路径。

---

### 需求 3：AgentTemplate 与 generic_worker 默认模板（P0A）

**用户故事：** 作为产品工程师，我需要通过角色模板定义 `requiredCapabilities`，以便 Capability Readiness 可计算。

#### 验收标准

1. THE System SHALL 提供至少一个内置模板 `generic_worker`，含 `templateId`、`version`、`dimensionWeights`、`missionReadyThreshold`（默认 78）、`requiredCapabilities`（可为空或仅基础项）。
2. WHEN 创建机器人未指定模板, THE System SHALL 绑定 `templateId: "generic_worker"` 至 `growthStatus`。
3. THE RPC `agents.list-templates` SHALL 返回可用模板列表（P0 至少含 `generic_worker`）。
4. THE `AgentTemplate` SHALL 支持 `requiredCapabilities[]`，每项含 `key`、`kind`（`skill` \| `oauth` \| `knowledge_binding` \| `workflow`）、`label`、`required`。
5. THE System SHALL 允许 P1 扩展行业模板（如 `contract_reviewer`），无需修改 `GrowthStatus` 核心 schema。

---

### 需求 4：activationScore 与 capabilityReadiness 计算（P0A）

**用户故事：** 作为员工用户，我需要看到真实的「距离上岗还差什么」，而不是装个无关插件就显示可上岗。

#### 验收标准

1. THE System SHALL 计算 `activationScore` 为 `dimensions` 按模板权重的加权总和（0–100）；机器人默认 Identity/Capability/Knowledge/Habits 各 25%。
2. THE System SHALL 计算 `capabilityReadiness` 为：`dimensions.identity >= templateMinIdentity`（默认 60）AND 所有 `required: true` 的 skill 已安装 AND 所有 `required: true` 的 oauth 已授权。
   - **P0A 口径（评审决策）**：信号三态化 —— `requiredSkillsInstalled: boolean`、`requiredPermissionsGranted: true | false | "unknown"`。P0A 仅真实接入 **skill**；OAuth 恒为 `"unknown"`，**不计分、不扣分、不阻塞**。P0A `capabilityReadiness = (identity >= templateMinIdentity) AND requiredSkillsInstalled`；OAuth 真值门槛留 P0B/P1（参见 tasks.md RISK-007）。
3. WHEN `activationScore >= 78` AND `capabilityReadiness === false`, THE `lifecycleState` SHALL remain `growing`，且缺口列表 SHALL 包含未满足的 required 项。
4. WHEN 仅安装与模板无关的 skill（如天气插件）且上传任意单个文件, THE System SHALL NOT 将 `lifecycleState` 设为 `mission_ready`（除非 `generic_worker` 无 required 且其他维度人为刷满 — P0 测试用 mock 验证阈值逻辑）。
5. THE RPC `agents.recompute-growth` / `collaboration.spaces.recompute-growth` SHALL 在 skill 变更、OAuth 完成、identity 文件更新后重算 `dimensions`、`activationScore`、`capabilityReadiness`、`lifecycleState`。
6. THE `GrowthStatus` SHALL 预留 `operationalScore: number | null`（P0 恒为 `null`）。

---

### 需求 5：协作小组 Alignment（Role + Workflow）（P0A）

**用户故事：** 作为小组群主，我需要确认成员不仅有角色，还有协作工作流，团队才能真正开始协作。

#### 验收标准

1. THE System SHALL 将 `alignmentComplete` 定义为 `rolesAssigned && workflowDefined`。
2. `rolesAssigned` SHALL 满足：存在 `coordinatorBotId`；每个 active bot 有非空 `collaborationRole`。
3. `workflowDefined` SHALL 满足以下至少一项：显式 `TeamWorkflow.steps` 已写入 group capabilities；或 `systemInstructions` 含顺序性协作描述（P0 heuristic）；或 governance 确认默认流程模板。
4. WHEN `alignmentComplete === false`, THE 小组 `activationScore` 中 alignment 维度 SHALL 反映未完成；且 SHALL NOT 进入 `mission_ready`（即使其他维度满分）。
5. THE `GrowthMilestones` SHALL 分别记录 `rolesAssignedAtMs` 与 `workflowDefinedAtMs`。

---

### 需求 6：isActivated 与 Created 分离（P0A）

**用户故事：** 作为运营人员，我需要区分「创建了试验机器人」与「真正激活并完成任务」，以便北极星指标准确。

#### 验收标准

1. THE `GrowthStatus.isActivated` SHALL 默认为 `false`。
2. WHEN 首个有效任务成功（`firstMissionSuccessAtMs` 写入，口径：deliverable done 或可配置 gateway 事件）, THE System SHALL 设 `isActivated = true`、`activatedAtMs`，且 `lifecycleState` 推导为 `activated`（除非已进入 evolution 规则）。
3. THE 漏斗统计 SHALL 支持独立计数：Created（`milestones.createdAtMs`）vs Activated（`isActivated`）。
4. WHEN 用户仅创建「测试1」类机器人且从未发送任务, THE `isActivated` SHALL remain `false` indefinitely。

---

### 需求 7：GrowthMilestones 与成长漏斗事件（P0A / P0B）

**用户故事：** 作为产品经理，我需要完整成长漏斗埋点，以便定位用户卡在哪一步。

#### 验收标准

1. THE `GrowthMilestones` SHALL 包含：`createdAtMs`、`sessionOpenedAtMs`、`birthPreludeShownAtMs`、`firstCtaClickedAtMs`、`identityCompletedAtMs`、`firstSkillInstalledAtMs`、`firstPermissionGrantedAtMs`、`firstKnowledgeUploadedAtMs`、`rolesAssignedAtMs`、`workflowDefinedAtMs`、`alignmentCompletedAtMs`、`missionReadyAtMs`、`firstMissionSentAtMs`、`firstMissionSuccessAtMs`、`activatedAtMs`。
2. THE RPC `agents.record-growth-milestone` / 小组等价 RPC SHALL 支持幂等写入上述时间戳（同 milestone 重复调用不覆盖更早的有效值，或保留 first-write-wins 语义并文档化）。
3. WHEN 机器人创建成功, THE System SHALL 写入 `createdAtMs` 并发出 `agent_growth.create` 事件（或等效 `publish_event`）。
4. WHEN 进入 `mission_ready`, THE System SHALL 写入 `missionReadyAtMs` 并发出 `agent_growth.mission_ready`。
5. WHEN `isActivated` 首次为 true, THE System SHALL 发出 `agent_growth.activated`。
6. P0 SHALL NOT 要求完整 BI 大盘，但 milestones MUST 可通过 `get-growth-status` 读取以供调试与后续分析。

---

### 需求 8：Growth RPC 与 method-scopes（P0A）

**用户故事：** 作为员工端开发者，我需要稳定的 Gateway RPC 读写 Growth 状态。

#### 验收标准

1. THE Gateway SHALL 实现 `agents.get-growth-status`、`agents.recompute-growth`、`agents.record-growth-milestone`、`agents.list-templates`。
2. THE Gateway SHALL 实现 `collaboration.spaces.get-growth-status`、`collaboration.spaces.recompute-growth`（milestones 可复用 record RPC 或 space 专用变体）。
3. THE 上述 RPC SHALL 注册至 `server-methods-list.ts` 与 `method-scopes.ts`（员工可读/写 scope 与现有 agents/spaces 一致）。
4. WHEN RPC 参数 `agentId` / `groupId` 不存在, THE Gateway SHALL 返回标准错误而非空对象。
5. THE Gateway SHALL 提供 `agent-growth/*.test.ts` 覆盖 readiness、lifecycle 推导、capabilityReadiness 门槛。

---

### 需求 9：GrowthReportSnapshot 预留（P0A）

**用户故事：** 作为架构师，我需要在 P0 预留成长报告 schema，以便 P2 填充数据而不破坏性迁移。

#### 验收标准

1. THE `GrowthReportSnapshot` SHALL 包含：`periodDays`、`generatedAtMs`、`tasksCompleted`、`hoursSavedEstimate`、`learningMaterialsCount`、`toolInvocations`、`collaborationMemberCount`、`taskSuccessRate`、`toolSuccessRate`、`humanTakeoverRate`、`businessImpact: ImpactMetric[]`、`topInsights`、`suggestedWorkflows`。
2. THE `ImpactMetric` SHALL 包含 `key`、`value`、`unit?`、`description`。
3. WHEN P0 无运营数据, THE `growthReport` MAY 为 `undefined` 或空壳；字段 MUST 在类型定义中存在。
4. P2 之前 UI SHALL NOT 依赖 `businessImpact` 非空展示。

---

### 需求 10：机器人创建后自动进入会话（P0B）

**用户故事：** 作为员工，我在创建机器人后应立刻进入该机器人会话，而不是面对空白导航栏不知下一步。

#### 验收标准

1. WHEN `onCreateAgent` 成功, THE UI SHALL 调用 `switchEmployeeWorkbenchSession` 进入该机器人会话（与小组创建行为对称）。
2. THE 进入会话 SHALL 在创建成功 **3 秒内**完成（本地网关，不含网络极端情况）。
3. WHEN 进入会话, THE System SHALL 写入 `milestones.sessionOpenedAtMs`（若尚未写入）。
4. WHEN 进入会话, THE `growthStatus.lifecycleState` SHALL 为 `birth` 或 `growing`（由 `deriveLifecycleState` 决定），SHALL NOT 跳过初始化。
5. THE 大白（Daibai）内置 steward 会话 SHALL NOT 被本逻辑错误劫持。

---

### 需求 11：创建流程绑定 templateId 与 init growth（P0B）

**用户故事：** 作为系统，我需要在 agents.create / space create 时初始化完整 Growth 记录。

#### 验收标准

1. WHEN `agents.create` 成功, THE Gateway SHALL 初始化 `growth-status.json`：`lifecycleState=birth`、`templateId=generic_worker`（或请求指定）、`isActivated=false`、`milestones.createdAtMs=now`。
2. WHEN 协作小组首次 persist（members update / space create）, THE Gateway SHALL 初始化 `growthStatus` 于 operating state（若不存在）。
3. THE `agents.create` 响应 MAY 包含 `growthStatus` 摘要供 UI 乐观更新。
4. THE 创建失败回滚 SHALL NOT 留下孤立 `growth-status.json`（与 agents 目录生命周期一致）。

---

### 需求 12：P0B 最小 UI 反馈（P0B）

**用户故事：** 作为员工，在 P1 Prelude 未上线前，我仍应看到成长进度信号。

#### 验收标准

1. THE 员工端导航或 stage 标题区 SHALL 展示只读 `activationScore` 或「成长中 N%」badge（当 `lifecycleState` 为 `birth` 或 `growing`）。
2. WHEN `lifecycleState === mission_ready`, THE badge SHALL 显示「待首任务」或等价文案。
3. WHEN `isActivated === true`, THE badge SHALL 显示「已激活」。
4. THE P0B UI SHALL NOT 要求完整 Prelude 卡片即可验收。

---

### 需求 13：Birth 自我认知 Prelude（P1）

**用户故事：** 作为员工，我希望新 Agent 主动展示自我认知与缺口清单，而不是冷冰冰的 CTA 列表。

#### 验收标准

1. THE UI SHALL 在机器人 / 小组会话 `threadPrelude` 渲染自我认知卡片：角色叙事、`activationScore` 进度条、各 `dimensions` 分项、模板 `requiredCapabilities` 缺口列表（✓/□）。
2. THE 卡片 SHALL 提供 CTA：定义身份、安装能力、上传知识、设置习惯（机器人）；设计组织架构、分配角色、配置流程（小组）。
3. WHEN 用户点击 CTA, THE System SHALL 导航至对应表面（skills tab、composer prefill、governance drawer 等）并记录 `firstCtaClickedAtMs`（若首次）。
4. WHEN 用户 dismiss prelude, THE System SHALL 写入 `preludeDismissedAtMs`；同 session 刷新 SHALL NOT 重复展示完整 Birth 卡片（除非 `lifecycleState` 回退或强制重置）。
5. THE 小组 prelude SHALL 使用「我们组建完成了」集体叙事，SHALL NOT 使用单 bot「我出生了」表述；协调者发言规则见 design §6。
6. THE Daibai prelude SHALL 保持独立逻辑，互不覆盖。

---

### 需求 14：Stepper、侧栏与 i18n（P1）

**用户故事：** 作为员工，我需要持续看到成长阶段与维度进度。

#### 验收标准

1. THE UI SHALL 展示 `lifecycleState` 徽章与 `dimensions` 五维 Stepper（小组含 alignment）。
2. THE 侧栏机器人/小组条目 SHALL 显示成长 badge（成长中 % / 待首任务 / 已激活）。
3. THE 文案 SHALL 支持 zh-CN 与 en（`ui/src/i18n/locales`）。
4. THE `workbench-stage` / `render-model` SHALL 有 snapshot 或 node 测试覆盖 prelude 渲染与 dismiss。

---

### 需求 15：创建向导模板选择（P1，可选）

**用户故事：** 作为员工，我希望从「合同审查」「销售助理」等模板创建，以获得正确的 required 清单。

#### 验收标准

1. THE 创建机器人向导 MAY 提供模板选择；默认仍为 `generic_worker`。
2. WHEN 用户选择模板, THE `growthStatus.templateId` SHALL 更新并重算 readiness。
3. IF 首期仅 `generic_worker`, THE 向导 SHALL 仍可验收（本需求标记为 P1 可选增强）。

---

### 需求 16：LLM Awakening 与 operationalScore（P2）

**用户故事：** 作为员工，我希望 Agent 用自然语言完成诞生问候；作为运营，我需要识别「配置满分但实战很差」的虚假就绪。

#### 验收标准

1. THE Gateway MAY 支持 `chat.send` 扩展 `growthBirthTurn: true`，注入创建上下文生成首条 assistant 消息（不重复 wizard 已填字段）。
2. WHEN `activationScore >= 90` AND `operationalScore < 30`（P2 有数据时）, THE System SHALL 标记 false-ready 并建议培养（事件 `agent_growth.false_ready_detected`）。
3. THE `operationalScore` SHALL 由任务成功率、工具成功率、满意度、人工接管率加权（权重 P2 文档化）。
4. P2 之前 `operationalScore` 保持 `null`，SHALL NOT 阻塞 P0/P1 发布。

---

### 需求 17：Growth Report 与 businessImpact UI（P2）

**用户故事：** 作为管理者，我需要看到业务影响（如「减少人工审核 37 次」），而不只是工具调用次数。

#### 验收标准

1. WHEN `lifecycleState === evolution` 且有 `growthReport`, THE UI SHALL 展示报告摘要， prominently 包含 `businessImpact` 列表。
2. THE Gateway SHALL 提供聚合逻辑填充 `GrowthReportSnapshot`（任务、工时估算、工具调用、impact metrics）。
3. THE `businessImpact` 示例指标 MAY 包括：`manual_review_avoided`、`risk_contracts_flagged`、`customer_auto_replies`（可扩展）。
4. THE Evolution 问候文案 SHALL 优先引用 `businessImpact`，其次才是 `toolInvocations`。

---

## 非功能需求

### NFR-1：性能

- `get-growth-status` P95 < 100ms（本地 gateway，无 recompute）。
- `recompute-growth` P95 < 500ms（含 skill list + oauth 状态读取）。

### NFR-2：兼容性

- 旧 `onboardingStatus` 读取路径保持一版本兼容；新 UI 只写 `bootstrapStatus` / `growthStatus`。

### NFR-3：测试

- P0A 合并门：`pnpm test` 包含 `src/gateway/agent-growth/**/*.test.ts` 全绿。
- P0B 合并门：`render-model.node.test.ts` 覆盖创建后 switchSession。
- P1 合并门：`workbench-stage` snapshot 测试通过。

### NFR-4：多 Agent 安全

- 实施前在 `tasks.md` Agents 块签名；提交带 `Task:` / `Agent:` trailers（per AGENTS.md）。

---

## 需求追溯矩阵（摘要）

| 需求                   | P0A | P0B | P1  | P2      |
| ---------------------- | --- | --- | --- | ------- |
| R1 双状态              | ✓   |     |     |         |
| R2 Lifecycle⊥Dimension | ✓   |     |     |         |
| R3 AgentTemplate       | ✓   | ✓   | opt |         |
| R4 activationScore     | ✓   |     |     |         |
| R5 Alignment           | ✓   |     |     |         |
| R6 isActivated         | ✓   |     |     |         |
| R7 Milestones          | ✓   | ✓   |     |         |
| R8 RPC                 | ✓   |     |     |         |
| R9 GrowthReport 预留   | ✓   |     |     | P2 填充 |
| R10 auto session       |     | ✓   |     |         |
| R11 create init        |     | ✓   |     |         |
| R12 最小 badge         |     | ✓   |     |         |
| R13 Prelude            |     |     | ✓   |         |
| R14 Stepper/i18n       |     |     | ✓   |         |
| R15 模板向导           |     |     | opt |         |
| R16 LLM/operational    |     |     |     | ✓       |
| R17 Report UI          |     |     |     | ✓       |
