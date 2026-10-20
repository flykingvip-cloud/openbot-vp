# 员工端 Agent 成长操作系统（Agent Growth OS）设计方案

> 状态：**v3** · Engineering Planning Review 就绪  
> 范围：员工端 Agent / 协作小组的激活、培养、运营与长期演进  
> 关联：`ui/src/ui/ports/employee/`、`src/gateway/collaboration-learning/`、`src/gateway/server-methods/agents.ts`

---

## 评审记录（专家团队 v3）

| 维度         | 评分 | 说明                                      |
| ------------ | ---- | ----------------------------------------- |
| 产品战略     | 9.5  | 已从体验优化升级为 Agent Product OS 雏形  |
| 生命周期设计 | 9.5  | v3 解耦 LifecycleState 与 GrowthDimension |
| 技术架构     | 9.0  | Growth 为一等公民：UI ← 状态机 ← 数据     |
| 企业场景适配 | 9.5  | Capability Readiness + AgentTemplate      |
| 数据运营能力 | 9.0  | 漏斗 + Activated + businessImpact         |
| 可扩展性     | 9.0  | activationScore / operationalScore 双轨   |

**结论：** 具备进入 **Engineering Planning Review（工程排期评审）** 的条件。

**v3 相对 v2 的五项必补（已纳入本文）：**

1. LifecycleState 与 GrowthDimension **解耦**
2. ActivationScore 与 OperationalScore **解耦**
3. Alignment = **Role + Workflow**（非仅角色分配）
4. **Activated ≠ Created**（`isActivated`）
5. Capability Readiness 基于 **AgentTemplate / RoleBlueprint**

---

## 0. 产品定位

本方案不是 Onboarding，也不是单次「欢迎页优化」，而是 **Agent Growth OS**——支撑激活、运营、分析、治理与自动化培养的统一基础设施。

```
传统：
  Create → 配置完成 → 聊天

OpenBot：
  Create → Birth → Growing → Mission Ready → Activated → Evolution
           ↑ 四维/五维 GrowthDimension 并行推进（非线性 stage 混用）
```

**架构铁律：**

```text
UI  ←  状态机  ←  数据

而非：状态机 ← UI
```

**Growth 一等公民结构：**

```text
Growth
├── State          （LifecycleState + GrowthDimension）
├── Readiness      （activationScore + operationalScore + capabilityReadiness）
├── Milestone      （漏斗时间戳 + isActivated）
├── Analytics      （事件 + 维度聚合）
├── Evolution      （Growth Report + businessImpact）
└── UI             （Prelude / Stepper / Badge — 表现层，依赖上层）
```

**核心认知：**

| 旧                          | 新                                                                       |
| --------------------------- | ------------------------------------------------------------------------ |
| Agent 是聊天窗口            | Agent 是**可培养的数字资产**                                             |
| Created = 有用              | **Created ≠ Activated**                                                  |
| Bootstrap 完成 = 上线       | Bootstrap ≠ Growth；Mission Ready ≠ 真能干活                             |
| readinessScore 一个数打天下 | **activationScore**（配置完成度）与 **operationalScore**（实战表现）分离 |

---

## 1. 背景与问题

### 1.1 创建后流失

```
创建成功 → 空白 Agent → 不知下一步 → 流失（含大量「测试1/测试2」僵尸 Agent）
```

### 1.2 企业真实失败模式

失败往往不是没有知识，而是 **没有权限 / 不能执行**：

- Persona + 知识库 + SOP 齐全，Salesforce OAuth 未授权 → 表面 Readiness 满分，实际无法工作。

因此需要 **Capability Readiness** 作为 Mission Ready 硬门槛，且 `requiredCapabilities` 必须由 **AgentTemplate** 定义（§5）。

---

## 2. 现状诊断（代码）

| 场景               | 现状                             | 缺口                             |
| ------------------ | -------------------------------- | -------------------------------- |
| 机器人创建         | `closeCreator()` 结束            | 无 auto session、无 GrowthStatus |
| 小组创建           | `switchEmployeeWorkbenchSession` | 空聊天、无 Alignment 检查        |
| `onboardingStatus` | = group_bootstrap                | 应更名为 `bootstrapStatus`       |
| Daibai prelude     | `threadPrelude` 模式             | 可复用表现层，非状态层           |

关键文件：`render-model-workbench-actions.ts`、`render-actions.ts`、`app-render.ts`、`operating-state-types.ts`、`agents.ts`。

---

## 3. 双状态体系：BootstrapStatus 与 GrowthStatus

### 3.1 命名（禁止 onboarding 描述用户引导）

| 旧                         | 新                            | 含义                                   |
| -------------------------- | ----------------------------- | -------------------------------------- |
| `onboardingStatus`         | **`bootstrapStatus`**         | 技术初始化：章程、记忆、workspace 骨架 |
| —                          | **`growthStatus`**            | 产品层：生命周期、维度、评分、里程碑   |
| UI `onboardingInitialized` | **`bootstrapArtifactsReady`** | bootstrap 产物是否存在                 |

### 3.2 BootstrapStatus

```ts
type BootstrapStatus = {
  initialized: boolean;
  bootstrappedAtMs?: number | null;
  bootstrapMemoryId?: string | null;
  charterCapsuleId?: string | null;
  workspaceInitialized?: boolean;
};
```

### 3.3 GrowthStatus（v3 核心模型 — 解耦）

**v2 问题：** 将 `identity / capability / knowledge / habits`（成长**维度**）与 `birth / growing / mission_ready / evolution`（生命**周期**）混在同一 `stage` 枚举，导致：

- Identity=100%、Habits=30% 时，无法回答「当前处于哪一 stage」
- 运营统计「处于 Capability 阶段的 Agent 数量」无法解释

**v3 拆为两套正交模型：**

```ts
/** 生命周期：时间轴上的阶段，互斥 */
type LifecycleState =
  | "birth" // 刚创建，首次觉醒
  | "growing" // 配置中，activationScore < 阈值 或 capabilityReadiness 未满足
  | "mission_ready" // 可接任务（配置侧达标）
  | "activated" // 已完成首个有效任务（实战激活）
  | "evolution"; // 长期运行，进入成长报告周期

/** 成长维度：0–100 并行进度，非互斥 */
type GrowthDimension = {
  identity: number; // 0–100
  capability: number; // 0–100（含 skill + 权限）
  knowledge: number; // 0–100
  habits: number; // 0–100
  alignment?: number; // 0–100，仅协作小组
};

type GrowthStatus = {
  lifecycleState: LifecycleState;
  dimensions: GrowthDimension;
  birthAtMs: number;

  // —— 双评分（§4）——
  activationScore: number; // 0–100，配置完成度（原 readinessScore 的产品语义）
  operationalScore?: number | null; // 0–100，实战表现（P2 起算，P0 预留 null）
  capabilityReadiness: boolean; // Mission Ready 硬门槛

  // —— 激活判定 ——
  isActivated: boolean; // 完成首个有效任务后为 true
  activatedAtMs?: number | null;

  // —— 模板绑定 ——
  templateId?: string | null; // AgentTemplate / RoleBlueprint id
  templateVersion?: string | null;

  // —— UI 控制 ——
  awakeningShownAtMs?: number | null;
  preludeDismissedAtMs?: number | null;

  milestones: GrowthMilestones;
  growthReport?: GrowthReportSnapshot;
};
```

**Lifecycle 推导规则（纯函数，非手写 stage）：**

```ts
function deriveLifecycleState(g: GrowthStatus): LifecycleState {
  if (g.isActivated && g.growthReport) return "evolution"; // 或按天数启发式
  if (g.isActivated) return "activated";
  if (g.activationScore >= 78 && g.capabilityReadiness) return "mission_ready";
  if (g.lifecycleState === "birth" && !g.milestones.sessionOpenedAtMs) return "birth";
  return "growing";
}
```

**UI Stepper 展示：** 用 `dimensions` 五项进度条 + `lifecycleState` 徽章，**不用**单一 `stage` 字段。

---

## 4. 双评分：ActivationScore 与 OperationalScore

### 4.1 刷分风险

四维各 25% 凑满 100 分，可能仅上传 3 个无关 PDF → **配置满分，实战为零**。

因此：

| 分数                 | 语义                                                                 | 用途                                 |
| -------------------- | -------------------------------------------------------------------- | ------------------------------------ |
| **activationScore**  | 是否完成**配置**（Identity/Capability/Knowledge/Habits[/Alignment]） | Birth 卡片进度条、Mission Ready 门槛 |
| **operationalScore** | 是否**真能完成工作**                                                 | Evolution、运营治理、降级/培养       |

**operationalScore 信号（P2 起算，P0 预留字段）：**

- 任务成功率
- 工具调用成功率
- 用户满意度 / 反馈
- 人工接管率（越高分越低）

**告警规则（P2）：** `activationScore >= 90 && operationalScore < 30` → 标记「虚假就绪」，触发培养建议。

### 4.2 activationScore 计算

**机器人默认权重：**

| 维度       | 权重 | 计入 `dimensions.*` | 计分要点                             |
| ---------- | ---- | ------------------- | ------------------------------------ |
| Identity   | 25%  | `identity`          | SOUL/IDENTITY 非模板；职责/服务对象  |
| Capability | 25%  | `capability`        | 模板 required 项 + OAuth granted     |
| Knowledge  | 25%  | `knowledge`         | **角色相关**知识绑定质量，非文件数量 |
| Habits     | 25%  | `habits`            | 汇报/审批/输出格式/cron              |

**小组权重：** Identity 20% · Alignment 20% · Capability 20% · Knowledge 20% · Habits 20%。

```ts
activationScore = weightedSum(dimensions); // 0–100
```

**Mission Ready 条件：**

```text
activationScore >= 78
&& capabilityReadiness === true
&& alignmentComplete === true   // 仅小组：role + workflow
→ lifecycleState = mission_ready
```

### 4.3 Capability Readiness（Mission Ready Gate）

```ts
capabilityReadiness =
  dimensions.identity >= templateMinIdentity && // 通常 >= 60
  requiredSkillsInstalled(template) &&
  requiredPermissionsGranted(template);
```

**`required*` 来源：** `AgentTemplate.requiredCapabilities`（§5），无模板时用 `generic_worker` 降级模板。

> **评审决策（P0A 信号口径）：** capabilityReadiness 信号采用三态——`requiredSkillsInstalled: boolean` 与 `requiredPermissionsGranted: true | false | "unknown"`（**不可用 optional boolean**）。P0A 仅真实接入 **Skill 状态**；OAuth 恒为 `"unknown"`，不计分、不扣分、不阻塞。因此 P0A 的 Mission Ready 暂定为 `activationScore >= threshold && requiredSkillsInstalled`，P0B/P1 再追加 `requiredPermissionsGranted === true`。详见 tasks.md RISK-007。

---

## 5. AgentTemplate / RoleBlueprint

### 5.1 问题：`required` 谁定义？

合同审查机器人 vs 销售机器人所需能力完全不同。没有模板，Capability Readiness 无法计算。

### 5.2 模型

```ts
type CapabilityRequirement = {
  key: string; // e.g. "crm", "contract_db", "approval_system"
  kind: "skill" | "oauth" | "knowledge_binding" | "workflow";
  label: string;
  required: boolean; // false = 加分项
};

type AgentTemplate = {
  templateId: string;
  version: string;
  displayName: string; // e.g. "合同审查机器人"
  roleBlueprint?: string; // 可选自然语言角色说明

  dimensionWeights: {
    identity: number;
    capability: number;
    knowledge: number;
    habits: number;
    alignment?: number;
  };

  requiredCapabilities: CapabilityRequirement[];

  knowledgeExpectations?: {
    minBindings: number;
    preferredTags: string[]; // 用于 knowledge 维度质量分，防刷文件
  };

  missionReadyThreshold: number; // 默认 78
};

type TeamTemplate = AgentTemplate & {
  defaultCollaborationRoles: string[]; // coordinator, researcher, writer, reviewer
  defaultWorkflowSteps: WorkflowStep[]; // 见 §6 Alignment
};
```

**创建流程绑定：**

- 创建向导增加「从模板创建」（P1 UI；P0 默认 `generic_worker`）
- `agents.create` / space create 写入 `growthStatus.templateId`

**存储：** `src/gateway/agent-growth/templates/*.json` 或租户级 catalog（对接 resource-catalog 扩展）。

---

## 6. Alignment：Role + Workflow

### 6.1 v2 不足

仅 `roleAssigned`（Coordinator/Researcher/Writer/Reviewer 已填）不够——**大家都有角色，不知道如何协作**。

### 6.2 v3 完成条件

```ts
alignmentComplete =
  rolesAssigned && // 每个 active bot 有 collaborationRole；coordinator 已指定
  workflowDefined; // 协作协议存在

type WorkflowStep = {
  role: string; // e.g. "researcher"
  action: string; // e.g. "产出调研摘要"
  handsOffTo?: string; // e.g. "writer"
};

type TeamWorkflow = {
  steps: WorkflowStep[];
  // 示例：Researcher → Writer → Reviewer → Coordinator
};
```

**workflowDefined heuristic（P0 最小）：**

- `systemInstructions` 含顺序性协作描述；或
- `TeamWorkflow` 显式写入 group capabilities / charter；或
- governance 中确认默认流程模板

**dimensions.alignment 计分：**

- 角色分配完整：0–50
- 工作流定义完整：0–50

---

## 7. Created ≠ Activated（isActivated）

### 7.1 问题

企业用户常创建 `测试1/测试2/测试3` 后永不使用。运营若把 Create 当激活，数据失真。

### 7.2 定义

```ts
isActivated = milestones.firstMissionSuccessAtMs != null;
// 或：首个 deliverable done / 首个有效任务（可配置口径）
```

**漏斗升级：**

```text
Create
  ↓
Open Session
  ↓
Birth Prelude Shown
  ↓
…（配置里程碑）…
  ↓
Mission Ready          （activationScore + capabilityReadiness）
  ↓
First Mission Sent
  ↓
Activated              （isActivated = true，首个有效任务成功）
  ↓
Evolution
```

**运营北极星建议：**

- 创建数（Created）
- 激活数（Activated）— **核心**
- 激活率 = Activated / Created
- 任务成功率（驱动 operationalScore）

---

## 8. Birth Prelude（表现层，依赖状态层）

### 8.1 自我认知卡片（非纯 CTA）

数据来自 `growthStatus` + `AgentTemplate`：

```text
我是【合同审查机器人】（template.displayName）
我将帮助【法务团队】审核合同

激活进度（activationScore）：42%
  Identity     ████████░░  80%
  Capability   ████░░░░░░  40%
  Knowledge    ██░░░░░░░░  20%
  Habits       ░░░░░░░░░░   0%

暂未具备（来自 template.requiredCapabilities）：
  □ CRM OAuth
  □ 合同知识库 binding
  □ 审批系统 skill

距离 Mission Ready：还差 3 项
```

### 8.2 复访问候

| lifecycleState      | 体验                       |
| ------------------- | -------------------------- |
| `birth` / `growing` | 自我认知卡片（可 dismiss） |
| `mission_ready`     | 「今天有什么任务？」       |
| `activated`         | 简短工作状态问候           |
| `evolution`         | Growth Report 摘要（§9）   |

---

## 9. Growth Report 与 businessImpact

### 9.1 问题

`toolInvocations: 842` 对管理者价值低。需要 **业务影响** 表达。

### 9.2 GrowthReportSnapshot（v3）

```ts
type ImpactMetric = {
  key: string;
  value: number;
  unit?: string;
  description: string; // e.g. "减少人工审核"
};

type GrowthReportSnapshot = {
  periodDays: number;
  generatedAtMs: number;

  // 活动量
  tasksCompleted: number;
  hoursSavedEstimate?: number | null;
  learningMaterialsCount: number;
  toolInvocations: number;
  collaborationMemberCount?: number | null;

  // 实战分（回填 operationalScore）
  taskSuccessRate?: number | null;
  toolSuccessRate?: number | null;
  humanTakeoverRate?: number | null;

  // 业务影响（核心）
  businessImpact: ImpactMetric[];

  topInsights?: string[];
  suggestedWorkflows?: string[];
};
```

**businessImpact 示例：**

```json
[
  { "key": "manual_review_avoided", "value": 37, "description": "减少人工审核" },
  { "key": "risk_contracts_flagged", "value": 12, "description": "提前发现风险合同" },
  { "key": "customer_auto_replies", "value": 286, "description": "自动回复客户" }
]
```

P0：schema + 空数组；P2：按 Agent 模板 industry 插件聚合。

---

## 10. 成长漏斗与埋点

### 10.1 事件（在 v2 基础上增补）

| 事件                                      | 说明                         |
| ----------------------------------------- | ---------------------------- |
| `agent_growth.activated`                  | `isActivated` 首次 true      |
| `agent_growth.activation_score_changed`   | 维度变化导致分数跨阈值       |
| `agent_growth.operational_score_computed` | P2                           |
| `agent_growth.false_ready_detected`       | activation 高 operational 低 |

### 10.2 GrowthMilestones（增补）

```ts
type GrowthMilestones = {
  createdAtMs: number;
  sessionOpenedAtMs?: number | null;
  birthPreludeShownAtMs?: number | null;
  firstCtaClickedAtMs?: number | null;
  identityCompletedAtMs?: number | null;
  firstSkillInstalledAtMs?: number | null;
  firstPermissionGrantedAtMs?: number | null;
  firstKnowledgeUploadedAtMs?: number | null;
  rolesAssignedAtMs?: number | null; // 小组
  workflowDefinedAtMs?: number | null; // 小组
  alignmentCompletedAtMs?: number | null;
  missionReadyAtMs?: number | null;
  firstMissionSentAtMs?: number | null;
  firstMissionSuccessAtMs?: number | null; // → isActivated
  activatedAtMs?: number | null;
};
```

---

## 11. 技术架构

### 11.1 分层

```text
P1  UI           Prelude / Stepper / Badge
                 ↑ read-only
P0  Growth Core  lifecycle + dimensions + scores + milestones + templates
                 ↑
     Bootstrap   bootstrapStatus（技术 init，无关 Growth）
```

### 11.2 模块划分（便于 P0A/P0B 并行）

```text
src/gateway/agent-growth/
├── types.ts              # GrowthStatus, LifecycleState, GrowthDimension
├── templates/            # AgentTemplate, TeamTemplate, generic_worker.json
├── readiness.ts          # activationScore, capabilityReadiness, dimension heuristics
├── lifecycle.ts          # deriveLifecycleState, isActivated
├── milestones.ts         # record + funnel
├── operational-score.ts  # P2 stub
└── impact-metrics.ts     # P2 stub

src/gateway/server-methods/agent-growth.ts   # RPC
```

### 11.3 RPC

| RPC                                      | 阶段                |
| ---------------------------------------- | ------------------- |
| `agents.get-growth-status`               | P0A                 |
| `agents.recompute-growth`                | P0A                 |
| `agents.record-growth-milestone`         | P0A                 |
| `agents.list-templates`                  | P0A（至少 generic） |
| `collaboration.spaces.get-growth-status` | P0A                 |
| `collaboration.spaces.recompute-growth`  | P0A                 |

存储：

- 机器人：`~/.openbot/agents/{id}/growth-status.json`
- 小组：`operating-state.json` → `growthStatus`

---

## 12. 实施路线图（P0A / P0B / P1 / P2）

### P0A — 基础设施（可独立合并）

- [ ] `BootstrapStatus` / `GrowthStatus` 类型与持久化
- [ ] **LifecycleState + GrowthDimension 解耦**（§3.3）
- [ ] `activationScore` + `capabilityReadiness` 计算 v1
- [ ] `operationalScore` / `businessImpact` **字段预留**
- [ ] `AgentTemplate` + `generic_worker` 默认模板（§5）
- [ ] `GrowthMilestones` + `isActivated` 逻辑（§7）
- [ ] Alignment：`rolesAssigned` + `workflowDefined` heuristic（§6）
- [ ] RPC + readiness/lifecycle 单测
- [ ] 迁移：`onboardingStatus` → `bootstrapStatus` 别名期

**P0A 验收：** 任意 Agent 可 `get-growth-status`；维度与生命周期可独立读写；模板驱动 required 列表。

### P0B — 激活路径（依赖 P0A，可与 P0A 后半并行）

- [ ] 机器人创建后 `switchEmployeeWorkbenchSession`
- [ ] 创建时 `lifecycleState=birth`、`milestones.createdAtMs`
- [ ] Telemetry：§10 事件写入 milestones
- [ ] `agents.create` / space create 绑定 `templateId`
- [ ] UI 仅只读展示 activationScore（简单文本/badge，无 Prelude 也可）

**P0B 验收：** 创建后 3 秒内进会话；漏斗事件可追溯；Created 与 Activated 统计可分离。

### P1 — 表现层

- [ ] `workbench-stage-growth-prelude.ts` 自我认知卡片
- [ ] 五维 Stepper + lifecycle 徽章
- [ ] CTA → skills / composer / governance / workflow 编辑
- [ ] Dismiss、`preludeDismissedAtMs`
- [ ] 侧栏：「成长中 42%」/「待激活」/「已激活」
- [ ] 创建向导选模板（可选）
- [ ] i18n + snapshot 测试

### P2 — 智能化与运营闭环

- [ ] LLM Awakening Turn（`growthBirthTurn`）
- [ ] `operationalScore` 计算与 false-ready 告警
- [ ] Growth Report UI + `businessImpact` 填充
- [ ] Knowledge 质量分（标签/模板匹配，防刷文件）
- [ ] 租户模板 catalog + CO Flow「Agent 成长」step

### P3 — 暂缓

- 跨 Agent 成长大盘；Autopilot 培养闭环

---

## 13. Engineering Planning Review 检查清单

| #   | 项                                  | 状态       |
| --- | ----------------------------------- | ---------- |
| 1   | Bootstrap 与 Growth 语义隔离        | ✅ v3      |
| 2   | LifecycleState ⊥ GrowthDimension    | ✅ v3 §3.3 |
| 3   | activationScore vs operationalScore | ✅ v3 §4   |
| 4   | capabilityReadiness + AgentTemplate | ✅ v3 §4–5 |
| 5   | Alignment = Role + Workflow         | ✅ v3 §6   |
| 6   | isActivated ≠ Created               | ✅ v3 §7   |
| 7   | 漏斗 + milestones P0                | ✅ v3 §10  |
| 8   | businessImpact schema               | ✅ v3 §9   |
| 9   | P0A/P0B 可并行排期                  | ✅ v3 §12  |
| 10  | UI 依赖状态层，非反向驱动           | ✅ v3 §0   |

---

## 14. 长期核心资产（五项）

1. **BootstrapStatus 与 GrowthStatus 双状态体系**
2. **activationScore + capabilityReadiness 双判定**（+ operationalScore 演进）
3. **Alignment**（小组：Role + Workflow）
4. **Growth Funnel**（含 Activated 层级）
5. **Growth Report**（含 businessImpact）

---

## 15. 风险与缓解

| 风险                           | 缓解                                                                                                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Readiness 刷分                 | knowledge 质量分 + operationalScore 对照                                                                                                                                                                        |
| required 无定义                | P0 强制 `generic_worker` 模板；P1 行业模板                                                                                                                                                                      |
| v2 stage 混用技术债            | 新代码只用 `lifecycleState` + `dimensions`；不新增混合 stage                                                                                                                                                    |
| 试验 Agent 污染指标            | 运营看 Activated 而非 Created                                                                                                                                                                                   |
| P0 范围膨胀                    | 严格 P0A 无 UI / P0B 最小路径                                                                                                                                                                                   |
| RISK-007：Readiness 仅接 Skill | P0A `capabilityReadiness` 仅基于 Skill；OAuth=`"unknown"` 不计分不阻塞。Mission Ready = Internal Readiness ≠ External Operability；后续接 Permission Registry + OAuth Projection 收紧（详见 tasks.md RISK-007） |

---

## 16. 改动文件清单

| 层级            | 文件                                                      |
| --------------- | --------------------------------------------------------- |
| 类型与计算      | 新建 `src/gateway/agent-growth/*`                         |
| RPC             | 新建 `src/gateway/server-methods/agent-growth.ts`         |
| 小组 state      | `operating-state-types.ts`、`shared.ts`                   |
| 机器人创建      | `agents.ts`（attach templateId + init growth）            |
| 创建 UI         | `render-model-workbench-actions.ts`                       |
| 状态映射        | `render-model.ts`                                         |
| Prelude         | 新建 `workbench-stage-growth-prelude.ts`、`app-render.ts` |
| 埋点 controller | 新建 `ui/src/ui/controllers/agent-growth.ts`              |
| 测试            | `agent-growth/*.test.ts`、`render-model.node.test.ts`     |

---

## 17. 总结

v3 将方案从「Agent 引导系统」推进为 **Agent Growth OS**：

- **Growth** 是一等公民：State · Readiness · Milestone · Analytics · Evolution · UI
- **LifecycleState** 与 **GrowthDimension** 解耦，支撑可解释的运营统计
- **activationScore** 管配置，**operationalScore** 管实战，避免虚假就绪
- **AgentTemplate** 定义 `requiredCapabilities`，使 Capability Readiness 可计算
- **Alignment** = 角色 + 协作工作流
- **Created ≠ Activated**，漏斗与北极星对齐真实价值
- **businessImpact** 让 Growth Report 对管理者有意义

**排期建议：P0A ∥ P0B（后半）→ P1 → P2。**

---

## 附录 A：类型速查

```ts
// 生命周期（互斥）
type LifecycleState = "birth" | "growing" | "mission_ready" | "activated" | "evolution";

// 维度（并行 0–100）
type GrowthDimension = {
  identity: number;
  capability: number;
  knowledge: number;
  habits: number;
  alignment?: number;
};

// 核心状态
type GrowthStatus = {
  lifecycleState: LifecycleState;
  dimensions: GrowthDimension;
  activationScore: number;
  operationalScore?: number | null;
  capabilityReadiness: boolean;
  isActivated: boolean;
  templateId?: string | null;
  milestones: GrowthMilestones;
  growthReport?: GrowthReportSnapshot;
};
```

## 附录 B：与 RuntimeLifecycle 边界

| 概念               | 层                          |
| ------------------ | --------------------------- |
| `RuntimeLifecycle` | 运维（deployed/draining/…） |
| `bootstrapStatus`  | 技术初始化                  |
| `growthStatus`     | 产品激活与成长              |
| `AgentTemplate`    | 角色能力蓝图                |

## 附录 C：旧字段迁移

| 旧                         | 新                              |
| -------------------------- | ------------------------------- |
| `onboardingStatus`         | `bootstrapStatus`               |
| `growthStatus.stage`（v2） | `lifecycleState` + `dimensions` |
| `readinessScore`（v2）     | `activationScore`               |
| UI `onboardingInitialized` | `bootstrapArtifactsReady`       |

## 附录 D：参考先例

- Daibai prelude：`workbench-stage-assistant.ts`
- Group bootstrap：`shared.ts`
- Operational identity OAuth
- Robot skills：`robot-skills.ts`
- Resource catalog（模板扩展锚点）

## 附录 E：专家团队二次反馈逐项对照（EPR 用）

> 以下对照表用于 Engineering Planning Review 会议逐项确认。**当前 design.md 为 v3，二次反馈所列九项均已纳入正文，无待补缺口。**

| #   | 专家意见摘要                                                   | v3 落点                                | 状态      |
| --- | -------------------------------------------------------------- | -------------------------------------- | --------- |
| 一  | Growth 为一等公民；`UI ← 状态机 ← 数据`                        | §0 架构铁律、Growth 六层结构           | ✅ 已纳入 |
| 二  | Capability Readiness 作为 Mission Ready Gate                   | §4.3、`capabilityReadiness` 硬门槛     | ✅ 已纳入 |
| 三  | 解耦 LifecycleState 与 GrowthDimension，废弃混合 `stage`       | §3.3、`deriveLifecycleState()`         | ✅ 已纳入 |
| 四  | readinessScore 刷分风险；拆 activationScore / operationalScore | §4 双评分、false-ready 告警（P2）      | ✅ 已纳入 |
| 五  | Growth Report 缺 businessImpact                                | §9 `ImpactMetric` + `businessImpact[]` | ✅ 已纳入 |
| 六  | Alignment = roleAssigned **且** workflowDefined                | §6 `alignmentComplete` 双条件          | ✅ 已纳入 |
| 七  | Created ≠ Activated；`isActivated` + 漏斗 Activated 层         | §7、`lifecycleState: activated`        | ✅ 已纳入 |
| 八  | P0 拆 P0A（基础设施）/ P0B（激活路径）                         | §12 路线图                             | ✅ 已纳入 |
| 九  | `required` 由 AgentTemplate / RoleBlueprint 定义               | §5 `requiredCapabilities`              | ✅ 已纳入 |

**五项长期核心资产（专家结论）与文档章节：**

| 核心资产                                                                         | 章节    |
| -------------------------------------------------------------------------------- | ------- |
| BootstrapStatus 与 GrowthStatus 双状态体系                                       | §3      |
| Readiness 双判定（activationScore + capabilityReadiness；operationalScore 演进） | §4      |
| Alignment（小组 Role + Workflow）                                                | §6      |
| Growth Funnel（含 Activated）                                                    | §7、§10 |
| Growth Report（含 businessImpact）                                               | §9      |

**EPR 配套文档：**

| 文档                                 | 状态                                 |
| ------------------------------------ | ------------------------------------ |
| [requirements.md](./requirements.md) | ✅ 17 项需求 + NFR + 追溯矩阵        |
| [tasks.md](./tasks.md)               | ✅ P0A–P2 任务拆分、合并门、排期建议 |

**版本说明：** 专家二次反馈与 v3 正文为同一轮评审结论；设计冻结于 v3，实施以 `requirements.md` + `tasks.md` 为准。
