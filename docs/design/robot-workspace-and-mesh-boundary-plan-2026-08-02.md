# 员工端「我的机器人 / 协作小组」与企业端「机巢治理」职责边界方案

Date: 2026-08-02  
Updated: 2026-08-02（纳入专家差距诊断与实施建议）  
Status: **Phase 0–4 已验收 · Strong Separation 主线关闭（图谱子页可另立项）**  
验收清单:

- Phase 0: `docs/design/robot-workspace-mesh-phase-0-acceptance-2026-08-02.md`
- Phase 1: `docs/design/robot-workspace-mesh-phase-1-acceptance-2026-08-02.md`
- Phase 2: `docs/design/robot-workspace-mesh-phase-2-acceptance-2026-08-02.md`
- Phase 3: `docs/design/robot-workspace-mesh-phase-3-acceptance-2026-08-02.md`
- Phase 4: `docs/design/robot-workspace-mesh-phase-4-acceptance-2026-08-02.md`  
  Scope: 产品定位、页内信息架构、权限边界、读模型拆分、命令面分桶、分阶段实施  
  Non-goal: **不调整入口归属位置**

---

## 0. 入口位置约束（硬约束）

本方案**不改变**现有导航归属，仅在现有入口内落实三层强分离：

| 端     | 入口位置（保持不变）              | Tab / Route                             | 产品定位（专家定稿）    |
| ------ | --------------------------------- | --------------------------------------- | ----------------------- |
| 员工端 | 系统设置 → **我的机器人**         | `workbenchSystemSettingsTab = "robots"` | 我的 AI 助手（My Bots） |
| 员工端 | 系统设置 → **我的协作小组**       | `workbenchSystemSettingsTab = "groups"` | 协作关系管理            |
| 企业端 | **机巢治理** → 文案收敛为「机巢」 | `enterpriseMesh`                        | 企业 AI 运营平台        |

> 不搬家、不升一级导航。边界通过**页内结构、权限、读模型、命令面、文案**落实。

**更正（2026-10-01，`mesh-naming-truth-sync`）**：「机巢治理 → 机巢」的文案收敛没有落地，§9 Phase 1 中相关的改名与术语勾选也没有对应改动。2026-10-01 决定：企业端模块名保持「机巢治理」/ "Mesh Governance"，以 locale 中的 `nav.items.enterpriseMesh` 与 `tabs.enterpriseMesh` 为准，改名需要另行产品决定。详见 `docs/design/robot-workspace-mesh-phase-1-acceptance-2026-08-02.md` 文首更正。§8 术语表中机巢禁用「能力配置 / 成长路径」的规则不变，现存用法的清理见 `.kiro/specs/mesh-naming-truth-sync/tasks.md`。

---

## 1. 产品原则（Strong Separation · 长期不变）

### 1.1 审核焦点

真正需要守住的不是 UI 样式，而是**职责边界是否稳定**。  
所有页面、数据模型、权限都**不要跨层**。

### 1.2 三层管理体系

```text
Enterprise（企业 / 机巢）
        │
        │ 管理（运营 · 绩效）
        ▼
Employee（员工）
        │
        │ 创建与培养
        ▼
Bot（机器人 / 我的 AI 助手）
        │
        │ 参与（只读展示参与关系）
        ▼
Collaboration Group（协作群 / 我的协作小组）
```

| 层                  | 入口                    | 回答的问题                                   |
| ------------------- | ----------------------- | -------------------------------------------- |
| 员工 · 我的机器人   | 系统设置 → 我的机器人   | **我如何更好地使用和培养我的机器人？**       |
| 员工 · 我的协作小组 | 系统设置 → 我的协作小组 | **我们如何更好地完成共同任务？**             |
| 企业 · 机巢         | 机巢                    | **企业的 AI 劳动力是否健康、高效、可治理？** |

数据可以共享，**职责绝不能混淆**。

### 1.3 反膨胀原则（最高优先级）

**禁止**：

- 在「我的机器人」做企业资产台账 / 运行监控中心
- 在「我的机器人」编辑协作群
- 在「机巢」做机器人 Prompt / 人设编辑台
- 用同一套详情页同时服务员工培养与企业治理

---

## 2. 现状功能画像与差距诊断（代码走读 · 专家反馈）

### 2.1 员工端 · 系统设置 → 我的机器人

| 项   | 现状                                                        |
| ---- | ----------------------------------------------------------- |
| 入口 | 无独立 URL；`workbenchSystemSettingsTab = "robots"`         |
| 渲染 | `ui/src/ui/ports/employee/views/workbench-stage-module.ts`  |
| 数据 | `buildWorkbenchSettingsRobotEntries()` in `render-model.ts` |
| 类型 | `WorkbenchSettingsRobotEntry` in `workbench-types.ts`       |

| 维度     | 现状                                                             |
| -------- | ---------------------------------------------------------------- |
| 列表     | 拥有 / 参与 / 近期活跃统计 + 扁平清单                            |
| 展示字段 | 名称、emoji、来源、最近活跃、工作区路径、health 徽标、活动状态   |
| 主操作   | 进入工作台/会话、安装能力、查看相关能力、配置运营身份、删除      |
| 能力管理 | 在 assistant 模块 `robot-capability-tab.ts`，不在 settings       |
| Growth   | 类型有 `growthStatus`，仅对 `activeRobotGrowth` 填充，列表未展示 |
| 协作群   | 无「参与群只读列表」                                             |
| 详情页   | **无六块结构化详情**                                             |

边界风险（与方案冲突）：

1. 副标题含「身份治理」——与「培养 AI 助手、非治理后台」冲突（`workbench-stage-module.ts` / i18n）
2. 列表直接展示 `agents.runtime-health` 完整健康态（就绪 + 渠道连通）——有向企业监控语义漂移风险
3. Persona 与运营身份混在同一操作区：`renderRobotOperationalIdentities()` 未与 Identity/Persona 拆分
4. CTA 未分层：5–6 个按钮并列；缺「查看详情」主路径

### 2.2 员工端 · 系统设置 → 我的协作小组

| 已有                                 | 缺失                                                  |
| ------------------------------------ | ----------------------------------------------------- |
| 左列表 + 右详情双栏                  | 成员结构化表格（身份 / 职责 / 贡献度 / 最近活跃）     |
| 使命展示/编辑、成员管理入口          | 群规则块未按四块 IA 组织                              |
| 保密等级、生命周期、群主/coordinator | 部分字段已在 `WorkbenchSettingsGroupEntry`，UI 未归位 |

### 2.3 企业端 · 机巢

| 表面   | 文件                                                                      | 路由                     |
| ------ | ------------------------------------------------------------------------- | ------------------------ |
| Active | `enterprise-workforce-governance-surface.ts` → `<governance-assets-page>` | ✅ 已挂 `enterpriseMesh` |
| Legacy | `enterprise-mesh-governance-surface.ts` (~2700 LOC)                       | ❌ 未挂路由              |
| orphan | `ranking-page.ts` / `actions-page.ts`                                     | ❌ 无路由                |

Active：资产列表 + 治理队列 + 筛选；偏 Assets/Gov，**非「运营 + 绩效」**。  
Legacy：四维排行、归属转移、深链、KPI 头——能力更全但未释放。  
后端：`mesh.ownership.*` / `mesh.governance.*`（配置审计偏内存）/ `governance.*`；`governance-engine.ts` 未接 Active。

### 2.4 核心差距矩阵

| 方案要求   | 员工 robots                  | 员工 groups           | 企业 mesh               |
| ---------- | ---------------------------- | --------------------- | ----------------------- |
| 产品定位   | ❌ 清单+治理入口             | ⚠️ 部分符合           | ❌ 资产治理台           |
| 页内 IA    | ❌ 无六块详情                | ⚠️ 有编辑，缺四块骨架 | ❌ 非运营+绩效          |
| 权限边界   | ⚠️ runtime-health 过深       | ✅ 基本 OK            | ⚠️ 缺 Prompt 只读约束   |
| 读模型拆分 | ❌ 复用 agents/sessions 直拼 | ⚠️ 直接用 spaces      | ⚠️ readModel 混合投影   |
| 命令面分桶 | ❌ `robot.workspace.*` 未建  | ⚠️ 散落 spaces RPC    | ⚠️ mesh/governance 双轨 |
| 单表面     | —                            | —                     | ❌ Active/Legacy 双轨   |

---

## 3. 第一层：系统设置 → 我的机器人（My Bots）

### 3.1 定位

- **是**：我的 AI 助手 / 个人 AI 资产工作区
- **不是**：机器人管理后台、企业台账、运行监控中心

### 3.2 页内六块（专家定稿）

#### ① 身份（Identity）

名称、头像、定位、一句介绍、角色、人格、所属模型、简略状态、创建时间。

#### ② 能力（Capabilities）— 最重要

直接展示能力名 + 熟练度星级，再进详情。来源可标注，重点是使用与培养。

#### ③ 身份扮演（Persona）— ≠ Capability

可扮演身份列表（市场经理 / 咨询顾问等）。  
运营身份（Operational Identity）降为 Configuration 子项，**绝不与 Capabilities / Persona 混表**。

#### ④ 成长（Growth）

等级、最近成长事件、成长来源（个人学习 / 群组学习 / 技能升级）。仅自己的机器人。

#### ⑤ 协作（Collaboration）— 只展示参与

参与群只读列表；点击跳转「我的协作小组」同设置页。**禁止在此编辑群**。

#### ⑥ 数据（Data）

记忆容量、长期记忆、知识库、最近学习、最近能力提升。  
**不含** Token / GPU / 企业日志 / Runtime 主机。

### 3.3 列表 CTA（分层）

| 优先级 | 动作                       |
| ------ | -------------------------- |
| 主     | 进入工作区                 |
| 次     | 查看详情（右侧抽屉）       |
| 更多 ⋮ | 安装能力、运营身份、删除等 |

### 3.4 UI 形态（已拍板）

**右侧抽屉（约 640px）+ 块内 accordion**。  
与 groups 左列表右详情一致；不新增一级导航；移动端可全屏 drawer。

### 3.5 员工 Runtime 展示上限（已拍板）

仅三色简略态：`online` / `degraded` / `offline`。  
**不展示** hostId、渠道明细、GPU。完整 Runtime 仅在机巢运营 Tab。

---

## 4. 第二层：系统设置 → 我的协作小组

### 4.1 定位

协作关系管理——不是机器人详情，不是企业机巢。

### 4.2 页内四块

1. **基本信息**：头像、名称、定位、生命周期、群主、协调机器人
2. **使命**：Mission、Success Criteria、当前任务
3. **成员**：身份、职责、贡献度、最近活跃（非纯名单）
4. **群治理**（协作层规则，非机巢）：开放讨论、最大回复数、保密等级、学习/共享策略、归档

文案须标明「协作层治理，非企业机巢」。

---

## 5. 第三层：企业端 → 机巢

### 5.1 定位

企业 AI 运营平台。不是机器人详情页，不是 Prompt 编辑器。

### 5.2 两大能力

| Tab      | 内容                                                                                  |
| -------- | ------------------------------------------------------------------------------------- |
| **运营** | 在线/异常/离线、运行状态、异常处置、Runtime 主机、归属转移                            |
| **绩效** | 机器人/协作效率、任务完成率、平均响应、质量、成长速度（企业统计）、成本/Token、排行榜 |

### 5.3 单表面技术路径（已拍板：Legacy 吸编 Active）

```text
enterprise-mesh-governance-surface.ts（Legacy 壳 + 路由/深链/KPI）
        ↓ 吸收
governance-assets-page（资产表/队列/抽屉动作）
        ↓ 吸收
governance-engine.ts + ranking-page + actions-page
        ↓
单一 enterpriseMesh 表面，IA =「运营 | 绩效」双 Tab
```

理由：Legacy 已有深链/排行/归属/KPI；Active 资产表 UX 较新可嵌入运营子区；避免两套读模型消费路径。

目标 IA：

```text
机巢（enterpriseMesh）
├── 运营 Tab
│   ├── KPI：在线 / 异常 / 离线 / 待处置
│   ├── 异常列表 + 处置抽屉
│   ├── Runtime 主机列表（员工不可见）
│   ├── 资产视图（嵌入 governance-assets-page）
│   └── 归属转移
└── 绩效 Tab
    ├── 效率 / 完成率 / 响应 / 质量
    ├── 成本 / Token
    ├── 成长速度（企业统计口径）
    └── 排行榜（/mesh/performance/ranking）
```

深链：

- `/mesh/agents/:id` → 运营 Tab + **只读** Agent 抽屉（非 Prompt 编辑）
- `/mesh/groups/:id` → 运营 Tab + Group 抽屉
- `/mesh/incidents/:id` → 运营 Tab + 事件详情

---

## 6. 两端权限矩阵（专家定稿 · 固定）

| 功能                       | 员工端       | 企业端（机巢）     |
| -------------------------- | ------------ | ------------------ |
| 创建机器人                 | ✅           | 可授权             |
| 编辑机器人身份（Identity） | ✅           | ❌                 |
| 编辑机器人 Prompt          | ✅           | ❌（除企业模板）   |
| 能力查看                   | ✅           | ✅                 |
| 能力统计                   | ❌           | ✅                 |
| 协作群创建                 | ✅（权限内） | 可限制             |
| 群成员管理                 | 群主         | 企业管理员（治理） |
| 群规则                     | 群主         | 企业策略覆盖       |
| 成本                       | ❌           | ✅                 |
| 在线状态                   | 简略         | 完整               |
| Runtime                    | ❌           | ✅                 |
| Token                      | ❌           | ✅                 |
| 日志                       | 个人         | 企业全局           |
| 成长                       | 自己的机器人 | 企业统计           |
| 能力图谱                   | 简版         | 完整图谱           |
| 协作图谱                   | 自己参与     | 企业全局           |

> 新增功能先对表归层；PR 须勾选跨层检查（见 §9 Phase 0）。

---

## 7. 统一数据架构与读模型契约

```text
                 Domain Truth（单真相源）
            Bot · Participation · Group · Learning
                           │
         ┌─────────────────┴─────────────────┐
         │                                   │
 Employee Read Models                    Mesh Read Model
  ├ My Bots 投影                          ├ Operations
  │  Identity / Capabilities              ├ Performance
  │  Persona / Growth                     ├ Cost / Runtime / Logs
  │  Collaboration(参与只读)               └ Graphs（完整）
  │  Data
  └ Collaboration Group 投影
     Basic / Mission / Members / GroupRules
```

### 7.1 员工读模型（新建/扩展于 `ui/src/ui/ports/employee/semantic/`）

```ts
// EmployeeMyBotReadModel — 仅供 robots Tab
type MyBotProjection = {
  identity: {
    name: string;
    avatar: string | null;
    positioning: string | null;
    intro: string | null;
    role: string | null;
    personaTraits: string | null;
    model: string | null;
    status: "online" | "degraded" | "offline" | "unknown";
    createdAt: string | null;
  };
  capabilities: Array<{
    name: string;
    stars: number; // 1–5
    source: "personal" | "group" | "enterprise" | "marketplace";
    relationId: string;
  }>;
  personas: Array<{ id: string; label: string; description?: string }>; // ≠ capabilities
  growth: {
    level: number;
    recentEvents: Array<{ text: string; at?: string }>;
    sources: Array<"personal" | "group" | "skill_upgrade">;
  };
  collaborations: Array<{ groupId: string; title: string; sessionKey: string }>; // 只读
  data: {
    memorySize?: number;
    longTermCount?: number;
    kbCount?: number;
    recentLearning: Array<{ text: string; at?: string }>;
  };
};

// EmployeeCollaborationGroupReadModel — 仅供 groups Tab
type CollaborationGroupProjection = {
  basic: Record<string, unknown>;
  mission: Record<string, unknown>;
  members: Array<{
    name: string;
    identity: string | null;
    duty: string | null;
    contribution: number | null;
    lastActiveAt: number | null;
  }>;
  rules: Record<string, unknown>;
};
```

**禁止**：Employee 投影引用 `totalCost` / `runtimeHosts` / 渠道明细等 Mesh 字段。

列表层摘要扩展（`WorkbenchSettingsRobotEntry`）：

```ts
detailAvailable: boolean;
capabilityCount?: number;
growthLevel?: number;
participatingGroupCount?: number;
```

懒加载：列表仅摘要；打开 drawer 时 `robot.workspace.get(agentId)` 一次返回六块。

### 7.2 命令面分桶（Gateway RPC 命名空间）

| 桶                      | 建议 RPC                                                           | 复用现有                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `robot.workspace.*`     | `.get` / `.updateIdentity` / `.listPersonas` / `.delete`           | 包装 `agents.*` + `robot-capability.*` + `employee-install.*`                                                                    |
| `collaboration.space.*` | `.get` / `.updateBasic` / `.updateMission` / `.updateRules`        | 包装现有 `spaces.*`                                                                                                              |
| `mesh.operations.*`     | `.listOnline` / `.listAnomalies` / `.intervene`                    | 合并 `mesh.governance.*` + `governance.assets.action`                                                                            |
| `mesh.performance.*`    | `.summary` / `.ranking` / `.growthSummary` / `.groupGrowthSummary` | 合并 `governance.ranking.*` + `governance.metrics.*` + `growth.aggregate` / `growth.groupAggregate`（tenant-scoped，2026-08-04） |
| `mesh.ownership.*`      | 保持                                                               | 归属转移                                                                                                                         |

企业模板 Prompt 为管理员例外通道，不替代员工日常 Prompt 编辑。

### 7.3 Persona vs 运营身份（已拍板）

| 概念                                 | 存储                                     | UI 位置                             |
| ------------------------------------ | ---------------------------------------- | ----------------------------------- |
| Persona（可扮演角色人格）            | `agent.personas[]` 或 workspace metadata | My Bots ③                           |
| Operational Identity（渠道执行账号） | 现有 `user-operational-identity.*`       | My Bots 详情 → Configuration 子菜单 |

API 与 UI **绝不混表**。

### 7.4 Capabilities 星级口径（默认，可产品微调）

```text
stars = round(successRate * 5)   // 基于 skill health.successRate
```

`robot-capability-tab.ts` 已有 `health.successRate`，Phase 2 先 UI 映射；后续可统一后端 `proficiency` 字段。备选：growth capability dims 的 level→星级。

### 7.5 成员贡献度口径（Phase 3 v1）

```text
contribution = sessionCount / totalSessions * 100
```

v2（已落地）：独立 `contributionScore` =
`0.5 * sessionShare + 0.3 * recency + 0.2 * roleWeight`（0–100；保留 `contributionSessionShare`）。

---

## 8. 术语表（强制）

| 概念                      | 正确位置                            | 说明                                                |
| ------------------------- | ----------------------------------- | --------------------------------------------------- |
| Identity                  | 我的机器人 ①                        | 机器人是谁                                          |
| Capabilities              | 我的机器人 ②                        | 会做什么 + 星级                                     |
| Persona                   | 我的机器人 ③                        | 可扮演身份；≠ Capability                            |
| Growth                    | 我的机器人 ④ / 机巢绩效「成长速度」 | 个体 vs 企业统计                                    |
| Collaboration（机器人侧） | 我的机器人 ⑤                        | 仅参与列表                                          |
| Data                      | 我的机器人 ⑥                        | 记忆/知识                                           |
| 群治理                    | 我的协作小组 ④                      | 群规则，非机巢                                      |
| 运营 / 绩效               | 机巢双 Tab                          | 企业资产视角                                        |
| 能力配置 / 成长路径       | —                                   | **机巢禁用** → 改为「能力统计」「成长速度（企业）」 |

---

## 9. 分阶段实施计划（含文件级动作）

### Phase 0 — 边界冻结（约 1 周）— **已提交验收**

- [x] 专家原则定稿（§1 / §3–§6）
- [x] 机巢单表面路径拍板：**Legacy 吸编 Active**（§5.3）
- [x] My Bots UI 形态拍板：右侧抽屉 640px + accordion（§3.4）
- [x] Persona / 运营身份拆分拍板（§7.3）
- [x] Runtime 员工上限拍板（§3.5）
- [x] 落地员工读模型类型文件（§7.1）→ `ui/src/ui/ports/employee/semantic/`
- [x] Gateway 命令面命名空间骨架（§7.2）→ `robot.workspace.*` / `collaboration.space.*` / `mesh.operations.*` / `mesh.performance.*`
- [x] `.github/pull_request_template.md` 增加跨层检查 checkbox（对照 §6）
- [x] 专家初审「批准但需修改」→ 必须修改点 #1/#2 已补齐（见验收清单 §5.2）
- [x] **专家确认补丁** → 解锁 Phase 1

### Phase 1 — 止血（1–2 周，低风险快赢）— **已提交验收**

**我的机器人**

| 动作         | 具体改动                                                                | 文件                                    |
| ------------ | ----------------------------------------------------------------------- | --------------------------------------- |
| 文案收敛     | subtitle →「管理你的 AI 助手：身份、能力与成长」；去除「治理」          | `workbench-stage-module.ts`, `zh-CN.ts` |
| CTA 分层     | 主：进入工作区；次：查看详情（占位 drawer）；更多 ⋮：安装/删除/运营身份 | `workbench-stage-module.ts`             |
| 弱化 Runtime | health pill → 三级简略态；hover 不展示渠道明细                          | `renderRobotHealthPill()`               |
| 去除越界入口 | 「查看相关能力」移入详情 Capabilities；列表层移除                       | 同上                                    |

- [x] 文案 / CTA / health / 列表越界入口（见上表）
- [x] 六块「查看详情」占位骨架（Phase 2 接数据）

**我的协作小组**

- [x] 详情区加四块 `<section>` 标题骨架；现有表单挂入对应块
- [x] 去除成本/Token 类字段（个人消费仅留 AI 模型 Tab）

**机巢**

- [x] 标题「机巢治理」→「机巢」；子 Tab 骨架：运营 / 绩效（2026-10-01 核对：标题未改，见 §0 更正；运营 / 绩效 Tab 已存在）
- [x] 禁用员工语义：「成长路径」「能力配置」→「运营导航 / 能力统计」等（2026-10-01 核对：未落地，见 §0 更正）
- [x] 修复深链：解析 `/mesh/agents/:id` 等，打开**只读**详情抽屉
- [x] 只读抽屉声明：禁止 Identity/Prompt 编辑与 Skill 安装/启停
- [x] **专家确认 Phase 1 验收清单** → 解锁 Phase 2（2026-08-02，见 Phase 1 验收清单 §5）

### Phase 2 — 我的机器人六块落地（2–3 周）— **已提交验收**

| 块              | 数据源                                           | 复用/新建                                                     |
| --------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| ① Identity      | agents + identity                                | `my-bot-workspace-drawer.ts` Identity accordion；owner 可编辑 |
| ② Capabilities  | `listRobotSkillAssets` via `robot.workspace.get` | 星级映射 +「探索更多能力」→ install/my-accumulation           |
| ③ Persona       | `personas.json`（agentDir）                      | 与 `user-operational-identity.*` 拆分展示                     |
| ④ Growth        | `readRobotGrowthStatus`                          | 等级 / 事件 / 来源                                            |
| ⑤ Collaboration | `listGatewayCollaborationSpaces` 过滤            | 只读 + `onMyBotOpenGroup` → groups tab                        |
| ⑥ Data          | `listAgentMemoryEntries`                         | 轻量指标；不含 Token                                          |

- [x] `robot.workspace.get` 一次返回六块（`phase: 2`）
- [x] `robot.workspace.updateIdentity` 落地（config + IDENTITY.md）
- [x] 640px 右侧抽屉 + accordion
- [x] `my-accumulation` / 安装能力 → Capabilities「探索更多能力」入口
- [x] **专家确认 Phase 2 验收清单** → 解锁 Phase 3（2026-08-02，见 Phase 2 验收清单 §5）

### Phase 3 — 我的协作小组四块落地（约 2 周）— **已提交验收**

| 列       | 数据来源建议                                                          |
| -------- | --------------------------------------------------------------------- |
| 身份     | `memberRoleMap.governanceRole` / owner/admin                          |
| 职责     | `collaborationRole` / coordinator / `currentTask`                     |
| 贡献度   | v1：`sessionCount / totalSessions * 100`（`collaboration.space.get`） |
| 最近活跃 | bot presence + sessions 聚合                                          |

- [x] `collaboration.space.get` → `phase: 3` 成员/规则完整投影
- [x] `collaboration.space.updateBasic|Mission|Rules` facade → `collaboration.spaces.members.update`
- [x] 成员四列表格 UI（身份 / 职责 / 贡献度 / 最近活跃）
- [x] 群规则字段归入「群治理 · 协作规则」（开放讨论 / 最大回复 / 归档）
- [x] robots Collaboration → `onMyBotOpenGroup` → groups tab + selectedGroupId
- [x] **专家确认 Phase 3 验收清单** → 解锁 Phase 4（2026-08-02，见 Phase 3 验收清单 §5）

### Phase 4 — 机巢运营 + 绩效成型（3–4 周）

合并步骤：

1. 恢复 `enterprise-mesh-governance-surface.ts` 为路由入口（KPI 头 + 运营/绩效 Tab）
2. 将 `governance-assets-page` 嵌入「运营 → 资产视图」
3. `governance-engine.ts` 驱动运营 KPI（替代纯 readModel 推导）
4. `mesh.governance.getConfig` 持久化到 `~/.openbot/organization/governance-config.json`（或现有 org store 等价路径）
5. 退役重复渲染逻辑；`ranking-page` 挂绩效子路由

- [x] Legacy 壳恢复为 `enterpriseMesh` 路由入口（Ops/Perf + 嵌入 Active）
- [x] `governance-assets-page` embedMode 挂运营 Tab
- [x] `governance-engine` 驱动 KPI 计数
- [x] `mesh.governance.*Config` 落盘 `organization/governance-config.json`
- [x] `governance-ranking-page` 挂绩效 Tab
- [x] Cost / Token / Runtime / 全局日志仅企业可见（员工端未引入）
- [x] （后续清理）运营/绩效 Tab 内 Legacy 重复 UI 已移除；图谱挂绩效 Tab
- [x] （后续）贡献度 v2 独立计分
- [x] （后续）`method-scopes` 未分类方法已补齐
- [x] **专家确认 Phase 4 验收清单** → 关闭 Strong Separation 主线（2026-08-02，见 Phase 4 验收清单 §5）

### 9.1 避免重复建设

| 已有资产                                | 归位                           |
| --------------------------------------- | ------------------------------ |
| `robot-capability-tab.ts`               | → My Bots Capabilities（迁移） |
| `workbench-stage-growth-prelude.ts`     | → My Bots Growth               |
| `my-accumulation.ts`                    | → Capabilities「探索更多」     |
| `governance-engine.ts`                  | → 机巢运营异常检测             |
| `enterprise-mesh-governance-surface.ts` | → 机巢壳层（吸编后保留）       |

### 9.2 排期建议

```text
Week 1–2   Phase 0 + Phase 1（边界冻结 + 止血）
Week 3–5   Phase 2（My Bots 六块 + robot.workspace.get）
Week 6–7   Phase 3（协作小组四块 + 贡献度 v1）
Week 8–11  Phase 4（Legacy 吸编 + 配置持久化 + 绩效 Tab）
```

---

## 10. 关键代码锚点

### 员工端

| 区域                 | 路径                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| 设置壳 robots/groups | `ui/src/ui/ports/employee/views/workbench-stage-module.ts`                         |
| 类型                 | `ui/src/ui/ports/employee/views/workbench-types.ts`                                |
| 列表组装             | `ui/src/ui/ports/employee/render-model.ts`（`buildWorkbenchSettingsRobotEntries`） |
| 读模型（新建）       | `ui/src/ui/ports/employee/semantic/`（MyBot / CollaborationGroup 投影）            |
| 能力                 | `ui/src/ui/views/robot-capability-tab.ts`                                          |
| Growth               | `ui/src/ui/ports/employee/views/workbench-stage-growth-prelude.ts`                 |
| 运营身份             | `ui/src/ui/controllers/user-operational-identity.ts`                               |
| i18n                 | `ui/src/i18n/locales/zh-CN.ts`                                                     |

### 企业端

| 区域               | 路径                                                                     |
| ------------------ | ------------------------------------------------------------------------ |
| 路由挂载           | `ui/src/ui/ports/enterprise/views/enterprise-surfaces-core.ts`           |
| Active（将被吸编） | `ui/src/ui/capability/ai-workforce-governance/pages/assets-page.ts`      |
| Legacy（目标壳）   | `ui/src/ui/ports/enterprise/views/enterprise-mesh-governance-surface.ts` |
| 治理引擎           | `ui/src/ui/ports/enterprise/governance/governance-engine.ts`             |
| Read Model         | `ui/src/ui/ports/enterprise/semantic/enterprise-read-model.ts`           |
| Gateway            | `src/gateway/server-methods/mesh-governance.ts`、`governance.ts`         |
| 导航               | `ui/src/ui/navigation.ts`                                                |

---

## 11. 验收对照

| 验收项                            | 状态                                                   |
| --------------------------------- | ------------------------------------------------------ |
| My Bots 六块齐全                  | ✅ Phase 2                                             |
| 无成本/Runtime 企业指标（员工）   | ✅ Phase 1–2                                           |
| 协作块不可编辑群                  | ✅ Phase 2                                             |
| 协作小组四块 + 成员贡献度         | ✅ Phase 3                                             |
| 机巢仅运营+绩效                   | ✅ Phase 4（Legacy 壳 + Ops/Perf Tab）                 |
| 机巢不可编辑 Identity/Prompt      | ✅ Phase 1–4 只读约束                                  |
| 单表面（路由级）                  | ✅ Phase 4（Legacy 吸编 Active；Tab 内重复 UI 已清理） |
| §6 权限矩阵                       | ✅ PR 跨层清单 + 分阶段边界 enforced                   |
| 入口仍在系统设置 / enterpriseMesh | ✅ 全程保持                                            |

---

## 12. 决策日志

### 已拍板

1. 三层 Strong Separation 与三句产品问题
2. My Bots 六块；Persona ≠ Capability；协作只读参与
3. 协作小组四块
4. 机巢两大能力：运营 + 绩效
5. §6 权限矩阵长期固定
6. 入口位置不变更
7. **机巢单表面：Legacy 吸编 Active**
8. **My Bots UI：右侧抽屉 ~640px + accordion**
9. **Persona / 运营身份存储与 UI 拆分**
10. **员工 Runtime：三色简略态，无 host/渠道/GPU**
11. **Capabilities 星级默认：`round(successRate * 5)`**
12. **贡献度 v1：session 比例**

### 主线关闭后可选后续

- [x] 运营/绩效 Tab 内 Legacy 重复 UI 清理
- [x] 贡献度 v2 独立计分
- [x] 能力/协作图谱（绩效 Tab 只读面板；完整交互式图谱可再增强）
- [x] `method-scopes` 未分类方法补齐
- 星级是否后续改为后端 `proficiency`
- 图谱边从 ownership/成员名册精确连线（当前为归属推导）

---

## 13. 一句话结论

> **入口不动。Phase 0–4 已验收，Strong Separation 主线关闭；后续清理项已收口。**  
> My Bots 抽屉六块、Groups 四块、机巢 Legacy 吸编、贡献度 v2、图谱只读面板、`method-scopes` 补齐均已落地。  
> 数据共享、职责不跨层；交互式图谱与精确成员边可再增强，不回退边界。

---

## 附录 A · 文档关系

- 对齐专家：Bot → Collaboration Group → Enterprise Mesh 强分离
- 本轮增量：现状差距矩阵、Legacy 吸编路径、读模型/RPC 契约、文件级 Phase 动作、排期
- **前端展现规划（页型 + 布局草图 + 试点精修）**：`docs/design/robot-workspace-presentation-plan-2026-08-02.md`
- 约束：`docs/design/ai-workforce-governance-design.md`
- 参考：`.kiro/specs/mesh-governance-redesign/*`
- 视觉标准：`.cursor/rules/ui-secondary-page-refinement.mdc`

## 附录 B · 相对历史版本变更摘要

| 项           | 变化                                        |
| ------------ | ------------------------------------------- |
| 机巢合并路径 | 待选 → **Legacy 吸编 Active**               |
| My Bots UI   | 待选 → **右侧抽屉 + accordion**             |
| 现状章节     | 新增代码走读差距画像与矩阵                  |
| Phase 计划   | 从原则清单细化为文件级动作 + Week 1–11 排期 |
| 读模型/RPC   | 从示意升级为可落地契约草稿                  |
