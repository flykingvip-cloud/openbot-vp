# OpenBot 四端信息架构与重组实施计划

Date: 2026-04-12

## Purpose

本文档用于把四端职责、角色映射、问题升级链、统一对象模型、跨端 Context、权限边界，以及当前代码基线上的重组实施计划收敛成一份可执行蓝图。

它有六个目标：

1. 固化 Platform / Enterprise / Ops / Builder / Employee 的职责边界。
2. 给产品、设计、前端、网关和运维提供统一口径。
3. 约束当前 UI 重构，避免平台端、企业端、控制台继续混层。
4. 作为后续路由、状态、组件和 capability 分端迁移的执行依据。
5. 明确跨端问题升级链和动作责任边界。
6. 在实现前冻结 semantic/read-model 原则，避免新一轮 ViewModel 杂糅。

## 1. 五类角色与主工作台映射

| 角色                | 主工作台   | 可升级进入           | 不应作为主工作台                      | 主要目标                                 |
| ------------------- | ---------- | -------------------- | ------------------------------------- | ---------------------------------------- |
| 员工 / 业务终端用户 | 员工端     | 无                   | Enterprise / Platform / Ops / Builder | 使用 AI、协作、知识工作流、完成任务      |
| 企业管理员          | Enterprise | Ops（诊断下钻）      | Platform / Builder                    | 管组织、企业 Agent、机巢、企业成本与配置 |
| 平台运营            | Platform   | Enterprise、Ops      | Builder、员工端                       | 管租户、能力生态、平台策略、平台资产     |
| 运维工程师 / SRE    | Ops        | Platform、Enterprise | 员工端                                | 诊断、恢复、故障处理、稳定性保障         |
| 技能 / Agent 开发者 | Builder    | Platform             | Enterprise、员工端、Ops               | 构建能力、发布版本、维护供给             |

## 2. 五个端的正式定义

### 2.1 Employee Port

面向对象：员工 / 业务终端用户

核心职责：

- 承担 AI 使用、协作与知识工作流执行。
- 提供助手、协作空间、知识宇宙和个人使用设置。
- 作为任务与协作执行面，而不是轻量治理台。

首责动作：

- 发起任务与对话
- 进入协作空间
- 消费知识与成果
- 调用助手完成工作流

不该做什么：

- 不承接治理职责。
- 不暴露平台、企业、运维主控制语义。
- 不承接 Agent 配置、模型策略、租户经营、运行恢复。
- 不应默认暴露 Enterprise / Platform / Ops / Builder 入口；跨端入口仅在明确授权与明确场景下出现。

### 2.2 Enterprise Port

面向对象：企业管理员

核心职责：

- 承担单租户内部的组织治理、Agent 配置、机巢与业务运行管理。
- 是企业内部业务运行与使用治理责任面。
- 负责组织、成员、Agent 使用、机巢、企业使用与成本、企业配置。

首责动作：

- 管理 users / teams / groups
- 分配与配置 enterprise agents
- 检查 mesh 健康与企业运行状态
- 审阅 tenant 内 usage / cost / alerts

不该做什么：

- 不看跨租户经营。
- 不承担底层恢复动作。
- 不承接平台级能力分发与平台资产运营。

### 2.3 Platform Port

面向对象：平台运营

核心职责：

- 承担跨租户的平台运营、能力分发、策略管理与平台资产治理。
- 负责发现问题、观察趋势、制定策略、协调下钻。
- 负责租户、能力生态、模型策略、平台资产和高级聚合控制。

首责动作：

- 发现 tenant 异常
- 启用/禁用 capability
- 调整模型策略
- 查看跨租户覆盖、健康、成本与资产状态

不该做什么：

- 不进入单租户内部运营细节。
- 不承接运行态诊断闭环。
- 不作为恢复执行面。
- 不成为单租户内部问题处理台。

### 2.4 Ops Port

面向对象：运维 / SRE

核心职责：

- 承担系统运行态监控、故障诊断、恢复与稳定性保障。
- 负责 incidents、runtime、logs、diagnostics、recovery。
- 作为系统故障的首责端和恢复执行面。

首责动作：

- 检查 runtime / logs / traces
- 重试 / 重启 / 回滚
- 执行恢复动作
- 处理系统级 incidents

不该做什么：

- 不承担租户经营决策。
- 不承担企业内部组织治理。
- 不做能力构建。
- 不作为终端用户或企业管理员的主工作台。

### 2.5 Builder Port

面向对象：开发者 / 平台技术

核心职责：

- 承担能力供给侧的构建、测试、发布与版本维护。
- 负责 Skills / Agents / Tools / Models / Releases 的供给链路。
- 与 Platform 形成供给与分发的职责分离。

首责动作：

- 编辑、测试并发布 capability
- 管理 agent artifacts / configs / templates
- 管理 provider bindings 与 model integration
- 维护 release 版本链

不该做什么：

- 不承接终端使用。
- 不承接租户经营。
- 不作为能力启用与分发的主运营入口。

## 3. 常见混淆概念与归属

| 概念              | 正确归属   | 解释                                                                                         | 典型误判                             |
| ----------------- | ---------- | -------------------------------------------------------------------------------------------- | ------------------------------------ |
| 机巢控制台        | Enterprise | 面向单租户内部的人、Agent、Group 运行态观察与干预，不是平台级运行总控台                      | 被误当成平台级运行总控台             |
| Platform Agents   | Platform   | 关注平台拥有和可分发什么                                                                     | 被误当成企业实际使用页               |
| Enterprise Agents | Enterprise | 关注企业实际配置和使用什么                                                                   | 被误当成平台资产目录                 |
| Runtime 故障      | Ops        | Enterprise 可见影响，Ops 负责定位与恢复                                                      | 被误以为 Enterprise 完全不能看运行态 |
| Tenant 异常发现   | Platform   | Platform 负责发现哪个租户异常；Enterprise 负责看该租户内部哪里异常；Ops 负责看底层为什么异常 | 被误让 Platform 直接做修复           |
| Builder           | Builder    | 造能力、测能力、发版本                                                                       | 被误当成用户端或运营端               |
| Platform Models   | Platform   | 管模型策略、默认选择、平台分发                                                               | 被误认为 provider 接入配置面         |
| Builder Models    | Builder    | 管模型接入与供给                                                                             | 被误认为平台默认策略面               |

## 4. 问题升级链

| 问题层级                         | 首责端     | 升级到                         | 说明                                      |
| -------------------------------- | ---------- | ------------------------------ | ----------------------------------------- |
| 员工任务使用问题                 | 员工端     | Enterprise                     | 不会用、协作受阻、任务无法推进            |
| 企业内部组织、Agent、机巢问题    | Enterprise | Ops                            | 先看企业内部哪个人 / Agent / Group 出问题 |
| 跨租户异常、租户经营与覆盖问题   | Platform   | Enterprise / Ops               | Platform 负责发现与协调，不做底层修复     |
| 执行失败、Runtime 异常、恢复动作 | Ops        | Builder（若涉及版本/能力缺陷） | Ops 对系统运行负责                        |
| 技能、工具、Agent 版本或实现缺陷 | Builder    | Platform（发布后运营观察）     | Builder 负责造与修，Platform 负责运营观察 |

## 5. 沟通版与正式版一句话定义

### 5.1 沟通版

- 员工端负责用。
- Enterprise 负责单租户内部怎么用。
- Platform 负责跨租户怎么运营和分发。
- Ops 负责系统怎么诊断和恢复。
- Builder 负责能力怎么构建和发布。

### 5.2 正式版

- 员工端承担 AI 使用、协作与知识工作流执行。
- Enterprise 承担单租户内部的组织治理、Agent 配置与业务运行管理。
- Platform 承担跨租户的平台运营、能力分发、策略管理与平台资产治理。
- Ops 承担系统运行态监控、故障诊断、恢复与稳定性保障。
- Builder 承担能力供给侧的构建、测试、发布与版本维护。

## 6. 四端功能蓝图

### 6.1 Platform Port

一级导航：

- Dashboard
- Tenants
- Capabilities
- Models
- Agents
- Advanced

二级结构：

- Dashboard
  - Overview
  - Health
  - Cost
  - Attention
- Tenants
  - Directory
  - Coverage
  - Activity
- Capabilities
  - Catalog
  - Installed
  - Setup Health
- Models
  - Model Pool
  - Policies
  - Recommendations
  - Overrides
- Agents
  - Fleet
  - Directory
  - Workspaces
- Advanced
  - Channels
  - Instances
  - Usage
  - Domains

约束：

- Platform 负责发现“哪个租户/能力/资产有问题”。
- Platform 不承担单租户内部的主操作，也不承担恢复动作。
- `Advanced` 只承接“高级可见性与下钻入口”，不承接完整运维动作与诊断闭环。
- `Advanced` 不是独立能力域，而是平台高级控制面集合，不参与平台主价值叙事。

### 6.2 Enterprise Port

一级导航：

- Overview
- Organization
- Agents
- Mesh
- Usage
- Settings

二级结构：

- Overview
  - Activity
  - Agent Usage
  - Cost Snapshot
  - Alerts
- Organization
  - Users
  - Teams / Groups
  - Roles & Permissions
- Agents
  - My Agents
  - Team Agents
  - Templates
- Mesh
  - Overview
  - Agents
  - People
  - Groups
  - Runtime
  - Incidents
- Usage
  - Overview
  - Breakdown
  - History
- Settings
  - Integrations
  - API Keys
  - Policies

约束：

- Enterprise 是单租户业务运行责任面。
- Mesh 是 Enterprise 的核心差异模块，不是 Platform 资产目录，也不是 Ops 总控台。
- Enterprise 可见运行影响，但不负责底层恢复。

三块核心模块的主问题定义：

- `Agents` = 配置面：企业拥有哪些 Agent、如何配置与分配。
- `Mesh` = 运行面：这些 Agent 与 User / Group / Runtime 如何实际运行。
- `Usage` = 结果面：这些运行带来了多少消耗、活跃和成本。

Mesh 核心关系图：

- `User × Group × Agent × Runtime × Execution`

说明：

- Mesh 围绕这张关系图展开，不是简单“运行监控页”。

### 6.3 Ops Port

一级导航：

- Incidents
- Runtime
- Logs
- Diagnostics
- Recovery

二级结构：

- Incidents
  - Active Incidents
  - History
  - Alerts
- Runtime
  - Instances
  - Sessions
  - Channels
  - Presence
- Logs
  - Query Logs
  - Execution Logs
  - Errors
- Diagnostics
  - Trace
  - Performance
  - Bottlenecks
- Recovery
  - Retry Tasks
  - Restart Runtime
  - Rollback Config

约束：

- Ops 是系统稳定性责任面。
- Enterprise 可见症状和摘要，但真正的恢复动作只能落在 Ops。
- Ops 不承担租户经营决策，也不承担企业内部组织治理。

### 6.4 Builder Port

一级导航：

- Skills
- Agents
- Tools
- Models
- Releases

二级结构：

- Skills
  - My Skills
  - Editor
  - Testing
- Agents
  - Agent Builder
  - Configs
  - Templates
- Tools
  - Integrations
  - APIs
  - Connectors
- Models
  - Providers
  - Configs
  - Bindings
- Releases
  - Versions
  - Deployments
  - Changelog

约束：

- Builder 负责供给，不负责分发运营。
- Platform 负责让这些能力被看见、被启用、被运营。
- `Builder.Models` 管“模型接入与供给”；`Platform.Models` 管“模型策略与平台分发”。
- 发布后应回流 `Platform.Capabilities`，由 Platform 观察 adoption/setup/issue；若存在实现缺陷，再升级回 Builder 修复。

## 7. Canonical Object Model

四端共享统一对象身份；页面只呈现不同视图，不允许在端内重定义对象。

### 7.1 Core Objects

```ts
type Tenant = {
  tenantId: string;
  name: string;
  primaryDomain?: string;
  orgId?: string;
  plan?: "free" | "pro" | "enterprise";
  status: "active" | "inactive" | "suspended";
  createdAt: number;
};

type Agent = {
  agentId: string;
  name: string;
  ownerType: "platform" | "tenant";
  ownerId: string;
  templateId?: string;
  status: "active" | "inactive";
  createdAt: number;
};

type Capability = {
  capabilityId: string;
  name: string;
  type: "skill" | "tool" | "integration";
  status: "available" | "installed" | "misconfigured";
  version: string;
};

type Runtime = {
  runtimeId: string;
  type: "instance" | "session";
  status: "running" | "failed" | "stopped";
  region?: string;
  startedAt: number;
  tenantId?: string;
  agentId?: string;
};

type User = {
  userId: string;
  tenantId: string;
  name: string;
  role: string;
  status: "active" | "inactive";
};

type Group = {
  groupId: string;
  tenantId: string;
  name: string;
  type: "team" | "workflow";
};
```

说明：

- `Tenant` 是跨端统一主索引对象，`domain / org / account / runtime` 不得替代 `tenantId` 作为主识别键。
- `Group.type = team | workflow` 必须保持语义区别：
  - `team`：组织归属单元
  - `workflow`：协作运行单元
- `Runtime` 在语义层必须能够映射回 `tenant scope` 与 `execution scope`，否则 Enterprise / Ops 关联会断裂。

### 7.2 Linking Objects

```ts
type AgentExecution = {
  executionId: string;
  agentId: string;
  runtimeId: string;
  triggeredBy: {
    type: "user" | "group" | "system";
    id: string;
  };
  status: "running" | "success" | "failed";
  startedAt: number;
};

type CapabilityBinding = {
  agentId: string;
  capabilityId: string;
  enabled: boolean;
};

type TenantUsage = {
  tenantId: string;
  period: string;
  tokens: number;
  cost: number;
};

type RuntimeSession = {
  sessionId: string;
  runtimeId: string;
  agentId: string;
  active: boolean;
};
```

### 7.3 Policy Objects

```ts
type ModelPolicy = {
  policyId: string;
  subject: "platform" | "agent" | "tool";
  model: string;
  scope: {
    tenantIds?: string[];
    agentIds?: string[];
  };
};

type AccessPolicy = {
  policyId: string;
  subjectType: "tenant" | "user" | "group" | "agent";
  subjectId: string;
  rules: string[];
};
```

统一规则：

1. `tenantId / agentId / capabilityId / runtimeId / executionId` 必须全局唯一。
2. 不允许 `Platform Agent !== Enterprise Agent` 这种端内重定义。
3. 所有页面必须消费 `viewModel`，不得直接消费 controller 或 transport payload。

## 8. Semantic Layer / Read Model 原则

这是本方案必须新增的中间层约束。

所有端口页面不直接拼装 controller 返回；应先经过端口语义层聚合成 read model，再产出 view model。

统一管线：

```text
controller / transport
→ semantic aggregators
→ port-specific read model
→ view model
→ UI
```

目标：

- 避免 `Platform Dashboard` 直接拼 `usage/channels/agents` controller。
- 避免 `Enterprise Mesh` 直接拼 `spaces/collaboration/runtime` controller。
- 避免 `ViewModel` 再次演化成“大杂烩”。

建议目录：

```text
ui/src/ui/semantic/
```

或者：

```text
ui/src/ui/domain/platform/
ui/src/ui/domain/enterprise/
ui/src/ui/domain/ops/
ui/src/ui/domain/builder/
```

要求：

- Semantic 层负责“对象如何被这个端解释”。
- Port Read Model 层负责“这个端当前页面需要哪些稳定聚合数据”。
- ViewModel 只负责视图渲染，不再承接业务解释。

## 9. Cross-Port Context 与路由规范

### 9.1 统一跨端上下文对象

```ts
export type CrossPortContext = {
  tenantId?: string;
  agentId?: string;
  capabilityId?: string;
  runtimeId?: string;
  executionId?: string;
  incidentId?: string;
  userId?: string;
  groupId?: string;
  sourcePort?: "platform" | "enterprise" | "ops" | "builder";
  sourcePage?: string;
};
```

原则：

- 传对象身份，不传页面内部 UI 状态。
- 主对象放 path，辅助上下文放 query。
- 不跨端传递 `tab=2`、`expanded=true`、`panelOpen=1` 等页面实现细节。

### 9.2 推荐路由结构

```text
/platform/...
/enterprise/:tenantId/...
/ops/...
/builder/...
```

推荐示例：

```text
/platform/tenants/:tenantId
/platform/capabilities/:capabilityId
/platform/agents/:agentId

/enterprise/:tenantId/overview
/enterprise/:tenantId/organization/users
/enterprise/:tenantId/agents/:agentId
/enterprise/:tenantId/mesh
/enterprise/:tenantId/mesh/executions/:executionId
/enterprise/:tenantId/usage
/enterprise/:tenantId/settings

/ops/incidents/:incidentId
/ops/runtime/instances/:runtimeId
/ops/runtime/executions/:executionId
/ops/logs
/ops/diagnostics
/ops/recovery

/builder/skills/:capabilityId
/builder/agents/:agentId
/builder/tools
/builder/models
/builder/releases
```

### 9.3 Tenant Context Resolver

`/enterprise` 不是“兜底空页”，而是独立模块：`Tenant Context Resolver`。

职责：

- 显示当前可访问 tenant 列表
- 最近访问 tenant
- 搜索 tenant
- 恢复最近上下文
- 无权限时给出说明

要求：

- Enterprise 缺失 `tenantId` 时，必须落回 resolver，而不是空白页。
- Resolver 必须支持刷新恢复与分享链接失败兜底。

### 9.4 跨端跳转规范

- Platform → Enterprise
  - 最小上下文：`tenantId`
  - 例：`/platform/tenants/t_123 -> /enterprise/t_123/overview`
- Platform → Ops
  - 主对象：`incidentId / executionId / runtimeId`
  - 辅助上下文建议：`tenantId`
- Enterprise → Ops
  - 主对象：`executionId` 或 `runtimeId`
  - 辅助上下文建议：`tenantId + agentId`
- Builder ↔ Platform
  - 主对象：`capabilityId` 或 `agentId`

### 9.5 丢失上下文时的兜底策略

- Enterprise 缺失 `tenantId`
  - 回退到 `/enterprise` 的 tenant resolver。
- `executionId` 不存在
  - 页面可打开，但提示对象已过期；保留 `tenantId / agentId` 继续排查。
- `capabilityId` 不存在
  - 回退到 capability overview，并提示对象已归档。

## 10. 权限矩阵与动作矩阵

### 10.1 角色 × 端口权限矩阵

| 角色                | Platform     | Enterprise      | Ops                | Builder      | Employee |
| ------------------- | ------------ | --------------- | ------------------ | ------------ | -------- |
| 平台运营            | view / edit  | drill-down      | limited view       | no           | no       |
| 企业管理员          | no           | view / edit     | limited drill-down | no           | optional |
| SRE                 | view         | contextual view | full control       | no           | no       |
| 开发者              | limited view | no              | no                 | full control | no       |
| 员工 / 业务终端用户 | no           | no              | no                 | no           | full use |

### 10.2 动作矩阵

| 动作                                         | 首责端     | 说明                           |
| -------------------------------------------- | ---------- | ------------------------------ |
| restart runtime                              | Ops only   | 底层恢复动作                   |
| rollback config                              | Ops only   | 恢复执行面                     |
| inspect runtime trace                        | Ops        | 诊断闭环                       |
| assign enterprise agent                      | Enterprise | 企业内部配置动作               |
| manage users / groups                        | Enterprise | 企业治理动作                   |
| inspect mesh health                          | Enterprise | 企业运行责任面                 |
| enable / disable capability                  | Platform   | 平台分发与启用                 |
| adjust model policy                          | Platform   | 平台策略与默认选择             |
| inspect advanced summaries                   | Platform   | 高级可见性与下钻，不做恢复闭环 |
| publish skill version                        | Builder    | 供给侧发布动作                 |
| manage provider bindings                     | Builder    | 模型供给与接入                 |
| create / edit skill                          | Builder    | 能力构建动作                   |
| start task / collaborate / consume knowledge | Employee   | 终端使用动作                   |

## 11. 当前代码基线评估

### 11.1 已有基础

当前仓库已经具备以下基础设施，可作为四端重组的承接层：

- 路由与端口骨架：`ui/src/ui/navigation.ts`
- 顶层壳层：`ui/src/ui/app-render.ts`
- 员工端真实 port：`ui/src/ui/ports/employee/**`
- 控制面适配层：`ui/src/ui/app-console-port-state.ts`
- capability seams：`ui/src/ui/capability/**`
- 现有通用控制视图：
  - `ui/src/ui/views/overview.ts`
  - `ui/src/ui/views/channels.ts`
  - `ui/src/ui/views/instances.ts`
  - `ui/src/ui/views/sessions.ts`
  - `ui/src/ui/views/usage.ts`
  - `ui/src/ui/views/cron.ts`
  - `ui/src/ui/views/nodes.ts`
  - `ui/src/ui/views/debug.ts`
  - `ui/src/ui/views/logs.ts`
  - `ui/src/ui/views/agents.ts`
  - `ui/src/ui/views/skills.ts`

### 11.2 当前缺口

当前尚未恢复到按端完整重组的状态，主要缺口有：

1. 只有 Employee Port 存在真实目录与真实视图实现。
2. Enterprise / Platform / Ops / Builder 尚未形成独立 port 目录与 port state adapter。
3. `app-render.ts` 仍承担四端的大量装配逻辑。
4. 当前 Platform / Enterprise 页面仍大量复用通用控制视图，尚未恢复成端专属治理视图。
5. 当前路由尚未完全 tenant-bound，也不符合最终跨端上下文规范。
6. 现阶段缺少稳定 semantic/read-model 层，若直接继续拼 view model，重组会回到混层。

## 12. 当前代码模块归属与迁移建议

本节不讨论目标蓝图，而是直接对照当前仓库里的可复用模块，判断它们应归属于哪个端，以及迁移方式。

### 12.1 当前壳层与路由

| 当前文件                                   | 当前作用                                                        | 目标归属             | 处理建议                                                              |
| ------------------------------------------ | --------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------- |
| `ui/src/ui/navigation.ts`                  | 当前集中维护 employee / enterprise / platform / ops tab 与 path | 四端共享路由层       | 保留为共享路由表，但按最终 URL 规范重写，Enterprise 改为 tenant-bound |
| `ui/src/ui/app-render.ts`                  | 当前承担多端混合装配与视图选择                                  | 仅保留为根路由分发层 | 按阶段拆为四个 port shell，不再直接装配页面细节                       |
| `ui/src/ui/app-console-port-state.ts`      | 控制台/运维面的窄状态适配层                                     | Ops Port             | 演进为 `adaptOpsPortState()`，并继续缩字段                            |
| `ui/src/ui/app-port-state.ts`              | 员工端 workbench 的窄状态适配层                                 | Employee Port        | 保留并进一步缩边界                                                    |
| `ui/src/ui/app-view-state-shell-slices.ts` | shell state slices 定义                                         | 四端共享状态层       | 保留，后续拆成 `platform/enterprise/ops/builder` 专属 slices          |

### 12.2 Employee Port 现有实现

| 当前文件/目录                   | 当前作用                                    | 目标归属                      | 判断                                           |
| ------------------------------- | ------------------------------------------- | ----------------------------- | ---------------------------------------------- |
| `ui/src/ui/ports/employee/**`   | 员工端 workbench 与协作链路                 | Employee                      | 已是当前最完整的端口实现，作为其它端的参考模板 |
| `ui/src/ui/views/frontstage.ts` | personas / contacts / groups 等前台关系视图 | Employee                      | 可保留，但要去掉向 control 的叙事泄漏          |
| `ui/src/ui/views/chat.ts`       | 通用对话面                                  | Employee 为主，其他端按需嵌入 | 作为跨端共享对话组件，而不是单独的产品端       |

### 12.3 Enterprise Port 候选复用模块

| 当前文件/目录                                                     | 当前作用                       | Enterprise 目标位置                        | 处理建议                                                            |
| ----------------------------------------------------------------- | ------------------------------ | ------------------------------------------ | ------------------------------------------------------------------- |
| `ui/src/ui/views/platform-auth-panel.ts`                          | 企业注册/登录/成员/invite 面板 | Settings / Organization                    | 作为企业身份与成员治理子面板，不再承担整端入口                      |
| `ui/src/ui/controllers/platform-auth.ts`                          | 平台认证控制器                 | Enterprise auth/member flows               | 保留，但语义要从“control-ui auth”转成 enterprise tenant auth        |
| `ui/src/ui/views/overview.ts`                                     | 当前混合总览卡片               | Overview / Mesh / Usage 的语义聚合来源之一 | 不直接复用成企业首页，先拆 enterprise-specific semantic/read model  |
| `ui/src/ui/views/agents.ts`                                       | 当前 agent 管理页              | Agents / Mesh.Agents                       | 拆成企业 Agent 使用视图和平台资产视图两份 semantic + view model     |
| `ui/src/ui/views/usage.ts`                                        | 当前全局 usage                 | Usage                                      | 做 tenant-scoped 版本                                               |
| `ui/src/ui/ports/employee/views/workbench-stage-collaboration.ts` | 协作空间与治理交互             | Mesh / Organization / Groups               | 复用其 group/member/governance 视图能力，但不要继续挂在员工端语义里 |
| `ui/src/ui/controllers/spaces.ts`                                 | spaces 载入与管理              | Mesh / Groups                              | 可直接复用为 Enterprise Mesh 数据源                                 |
| `ui/src/ui/controllers/collaboration-learning.ts`                 | 协作学习治理状态               | Mesh / Incidents                           | 可作为机巢洞察与异常来源                                            |

### 12.4 Platform Port 候选复用模块

| 当前文件/目录                     | 当前作用             | Platform 目标位置                               | 处理建议                                             |
| --------------------------------- | -------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| `ui/src/ui/views/usage.ts`        | 当前 usage 工作区    | Dashboard.Cost / Tenants.Activity               | 做跨租户聚合视图                                     |
| `ui/src/ui/views/agents.ts`       | 当前 agents 管理页   | Agents.Fleet / Agents.Directory                 | 做平台资产视图，不暴露企业使用态语义                 |
| `ui/src/ui/views/skills.ts`       | 当前 skills 管理页   | Capabilities.Catalog / Installed / Setup Health | 直接可复用，但要改文案和分组                         |
| `ui/src/ui/views/channels.ts`     | 当前 channels 管理页 | Advanced.Channels                               | 保留为平台高级控制摘要视图                           |
| `ui/src/ui/views/instances.ts`    | 当前 instances       | Advanced.Instances                              | 保留为平台高级控制摘要视图                           |
| `ui/src/ui/views/overview.ts`     | 当前 overview        | Dashboard.Overview / Health / Attention         | 拆聚合模型，不让 platform 首页继续显示企业或运维细节 |
| `ui/src/ui/controllers/usage.ts`  | usage 数据控制器     | Platform Dashboard / Tenants                    | 保留并加 tenant/platform scope 语义                  |
| `ui/src/ui/controllers/skills.ts` | skills 控制器        | Capabilities                                    | 保留                                                 |
| `ui/src/ui/controllers/agents.ts` | agents 控制器        | Agents                                          | 保留，但补 platform asset read model                 |

### 12.5 Ops Port 候选复用模块

| 当前文件/目录                       | 当前作用            | Ops 目标位置                  | 处理建议                                             |
| ----------------------------------- | ------------------- | ----------------------------- | ---------------------------------------------------- |
| `ui/src/ui/views/sessions.ts`       | 原始会话治理        | Runtime.Sessions              | 直接归 Ops                                           |
| `ui/src/ui/views/nodes.ts`          | 节点/设备/审批      | Runtime / Recovery            | 直接归 Ops                                           |
| `ui/src/ui/views/logs.ts`           | 日志                | Logs                          | 直接归 Ops                                           |
| `ui/src/ui/views/debug.ts`          | 调试                | Diagnostics                   | 直接归 Ops                                           |
| `ui/src/ui/views/cron.ts`           | 定时任务/自动化执行 | Recovery / Runtime automation | 归 Ops，企业或平台只保留摘要入口                     |
| `ui/src/ui/views/config.ts`         | 配置与原始系统面板  | Recovery / System config      | 归 Ops                                               |
| `ui/src/ui/views/instances.ts`      | 实例视图            | Runtime.Instances             | 与 Platform Advanced 共享组件，但 Ops 是主责任端     |
| `ui/src/ui/views/channels.ts`       | 连接运行态          | Runtime.Channels              | 与 Platform Advanced 共享组件，但 Ops 可执行更深动作 |
| `ui/src/ui/controllers/logs.ts`     | logs 控制器         | Ops                           | 保留                                                 |
| `ui/src/ui/controllers/debug.ts`    | debug 控制器        | Ops                           | 保留                                                 |
| `ui/src/ui/controllers/nodes.ts`    | nodes 控制器        | Ops                           | 保留                                                 |
| `ui/src/ui/controllers/sessions.ts` | sessions 控制器     | Ops                           | 保留                                                 |
| `ui/src/ui/controllers/cron.ts`     | cron 控制器         | Ops                           | 保留                                                 |

### 12.6 Builder Port 候选复用模块

| 当前文件/目录                                          | 当前作用                          | Builder 目标位置  | 处理建议                        |
| ------------------------------------------------------ | --------------------------------- | ----------------- | ------------------------------- |
| `ui/src/ui/views/skills.ts`                            | 技能管理                          | Skills            | 做 Builder 主入口之一           |
| `ui/src/ui/views/agents-panels-tools-skills.ts`        | tools / skills / catalog 复合面板 | Skills / Tools    | 适合拆成 Builder 视图簇         |
| `ui/src/ui/views/agents-panels-status-files.ts`        | agent 文件/状态面板               | Agents / Releases | 拆成 Agent Builder 与版本工件面 |
| `ui/src/ui/controllers/agent-files.ts`                 | agent 文件控制器                  | Agents            | 保留                            |
| `ui/src/ui/controllers/agent-identity.ts`              | agent identity 控制器             | Agents            | 保留                            |
| `ui/src/ui/controllers/agent-skills.ts`                | agent-skills 控制器               | Agents / Skills   | 保留                            |
| `ui/src/ui/controllers/skills.ts`                      | 技能控制器                        | Skills            | 保留                            |
| `ui/src/ui/views/config.ts` 中 provider/model 配置片段 | 供应商接入配置                    | Models            | 拆到 Builder.Models             |

## 13. 建议目录结构

建议在当前 `ui/src/ui/ports/employee/**` 模式上，补齐四个端口目录。

```text
ui/src/ui/ports/
  employee/
  enterprise/
  platform/
  ops/
  builder/
```

每个端建议最小结构：

```text
ports/<port>/
  render-model.ts
  render-actions.ts
  port-state.ts
  semantic/
  view-model.ts
  views/
```

推荐新增共享层：

```text
ui/src/ui/routing/
ui/src/ui/context/
ui/src/ui/domain/
ui/src/ui/semantic/
```

## 14. 文件级实施任务分解

### 14.1 Phase A：冻结 IA / Object / Context / Semantic 原则

目标：先冻结蓝图、对象与语义层，不再继续摇摆导航与术语。

任务：

1. 确认本文件为四端蓝图基线。
2. 确认 canonical object model 与 cross-port context 作为统一规范。
3. 确认 semantic/read-model 原则为强约束。
4. 不再新增模糊 tab 名或混层概念。

交付物：

- 四端 IA 蓝图
- 角色映射表
- 问题升级链
- canonical object model
- cross-port context 规范
- semantic/read-model 原则

### 14.2 Phase B：落地共享对象与跨端 context 类型

目标：先把“同一个对象、同一个 ID、同一套上下文”落到代码。

建议新增：

- `src/shared/domain/tenant.ts`
- `src/shared/domain/agent.ts`
- `src/shared/domain/capability.ts`
- `src/shared/domain/runtime.ts`
- `src/shared/domain/user.ts`
- `src/shared/domain/group.ts`
- `src/shared/domain/execution.ts`
- `src/shared/domain/policies.ts`
- `ui/src/ui/routing/cross-port-context.ts`

约束：

- 先建类型和最小 adapter，不先重写业务逻辑。

### 14.3 Phase C：先改路由与 Enterprise Tenant Resolver

目标：让路由先符合最终产品结构，并把 tenant-bound 体验落地。

任务：

1. 把主路由收敛为：
   - `/platform/...`
   - `/enterprise/:tenantId/...`
   - `/ops/...`
   - `/builder/...`
2. 增加 `/enterprise` 的 tenant resolver。
3. 保留兼容 alias，但不再让 alias 继续主导信息架构。
4. Enterprise 默认 tenant-bound。

关键文件：

- `ui/src/ui/navigation.ts`
- `ui/src/ui/app-settings.ts`
- `ui/src/ui/controllers/control-ui-bootstrap.ts`

### 14.4 Phase D：拆四个 Port Shell

目标：不再由 `app-render.ts` 承担四端混合装配。

新增目录建议：

```text
ui/src/ui/ports/platform/
ui/src/ui/ports/enterprise/
ui/src/ui/ports/ops/
ui/src/ui/ports/builder/
```

每个端至少包含：

- `render-model.ts`
- `render-actions.ts`
- `semantic/`
- `views/`
- `view-types.ts`

并新增 adapter：

- `adaptPlatformPortState`
- `adaptEnterprisePortState`
- `adaptOpsPortState`
- `adaptBuilderPortState`

### 14.5 Phase E：先独立 Ops Port

原因：当前 control/console 能力最成熟，最适合先抽成独立端。

迁移归属：

- `overview` → Ops / Incidents 或 Runtime summary adapter
- `sessions` → Ops / Runtime
- `nodes` → Ops / Runtime
- `debug` → Ops / Diagnostics
- `logs` → Ops / Logs
- `cron` → Ops / Recovery 或 Runtime automation
- `config` → Ops / Recovery 或 system config

目标：

- 把“系统怎么稳”从 Platform / Enterprise 中剥离出去。

### 14.6 Phase F：Platform Port 重组

目标：让 Platform 只承载跨租户运营与分发。

复用能力：

- `usage.ts` → Dashboard / Cost
- `channels.ts` / `instances.ts` / `domains` → Advanced
- `agents.ts` → Platform Agents/Fleet
- `skills.ts` → Capabilities / Installed 或 Setup Health
- `overview.ts` → Platform Dashboard semantic/read-model

要求：

- Platform 不再直接承载底层故障修复视图。
- Platform 进入 Enterprise / Ops 必须通过对象上下文下钻。
- Platform Advanced 只做摘要、筛选、跳转。

### 14.7 Phase G：Enterprise Port 恢复

目标：恢复单租户内部治理与机巢。

一级导航：

- Overview
- Organization
- Agents
- Mesh
- Usage
- Settings

复用来源：

- 历史 enterprise view state 契约
- `platform-auth-panel.ts`
- 员工端协作治理与 group/members snapshot
- usage、accounts、domains 的企业化视图裁剪

关键原则：

- Enterprise 可见运行影响，但不负责底层恢复。
- Mesh 是 Enterprise 的核心，而不是 Platform 或 Ops 的替身。
- `Agents = 配置面`，`Mesh = 运行面`，`Usage = 结果面`。

### 14.8 Phase H：Builder Port 成立

目标：把供给侧从 Platform 中独立出来。

优先复用：

- `agents-panels-tools-skills.ts`
- `agent-files.ts`
- `agent-identity.ts`
- `agent-skills.ts`
- `skills.ts`
- models/provider config 相关能力

最低可用版本：

- Skills
- Agents
- Tools
- Models
- Releases（只读版本视图可先行）

### 14.9 Phase I：清理旧混层与兼容 alias

目标：在四端运行稳定后，逐步删除旧混层入口。

内容：

- 清理旧 control/dashboard 混名
- 缩减直接落到控制页的 legacy aliases
- 收口旧产品词汇和页面叙事

兼容 alias 退出策略：

- alias 只保留到对应 phase 完成后。
- 所有 alias 必须打点埋点。
- 当主路由稳定且访问占比下降后清退。

### 14.10 Phase J：权限矩阵与动作收口验收

目标：防止结构正确但权限错乱。

任务：

1. 把角色 × 端口 × 权限矩阵落到实现与测试。
2. 把动作矩阵落到按钮级权限和 API 授权。
3. 验证跨端跳转仅传上下文，不越权执行动作。

## 15. 实施顺序建议

按风险和收益，建议顺序为：

1. Phase A：冻结 IA / Object / Context / Semantic 原则
2. Phase B：统一对象与上下文类型
3. Phase C：统一路由规范与 Enterprise Tenant Resolver
4. Phase E：先独立 Ops
5. Phase F：重组 Platform
6. Phase G：恢复 Enterprise
7. Phase H：成立 Builder
8. Phase I：清理 legacy 混层
9. Phase J：权限矩阵与动作收口验收

## 16. 验收标准

### 16.1 架构验收

- 四端均有独立 port shell。
- `app-render.ts` 不再承担四端混装。
- 页面只消费 `viewModel`，不直接消费 raw controller / transport payload。
- 页面读取路径统一为：`controller / transport -> semantic -> read model -> view model -> UI`。
- 同一对象在四端共享统一 ID 与上下文规则。

### 16.2 产品验收

- 员工端不再暴露治理和运维词汇。
- Enterprise 只承接单租户治理与机巢。
- Platform 只承接跨租户运营与分发。
- Ops 成为唯一恢复执行面。
- Builder 成为唯一供给构建面。
- `/enterprise` tenant resolver 可作为上下文恢复入口正常工作。

### 16.3 交互验收

- Platform 可下钻到 Enterprise / Ops，但不能替代它们的主操作。
- Enterprise 可升级到 Ops，但不能直接承接底层恢复动作。
- Builder 与 Platform 之间围绕 `capabilityId / agentId` 建立稳定往返链路。
- Advanced 与 Ops 在交互上能被清楚区分：前者是摘要与下钻，后者是诊断与恢复。

### 16.4 权限验收

- 角色 × 端口 × 动作矩阵全部有显式实现。
- 非首责端不得执行越权动作。
- 跨端跳转不会自动放大权限。

## 17. 结尾判断

这份方案已经从“是否这么做”的阶段进入“可以按它实施，但必须加治理约束”的阶段。

当前最关键的四条落地前提是：

1. 先冻结 Semantic Layer / Read Model 原则。
2. 先补权限矩阵与动作矩阵。
3. 先补 Enterprise Tenant Resolver 设计。
4. 先补 Platform Advanced 与 Ops Runtime 的硬边界。

只有在这些约束先落地后，Platform、Enterprise、Ops、Builder 才会成为同一对象模型上的四个稳定视角，而不是一组共享页面的不同皮肤。

## 20. 与 Collaboration SDK 的对齐原则

当前四端重组不能绕开 `packages/collaboration-*`，否则会再次产生 UI 私有对象模型。

关联文档：

- `docs/design/openbot-collaboration-sdk-next-stage-decision-2026-04-09.md`
- `docs/design/openbot-collaboration-sdk-closeout-2026-04-09.md`
- `docs/design/openbot-collaboration-learning-governance-implementation-plan-2026-04-03.md`

### 20.1 当前可依赖结论

基于已有文档与实现，当前已经成立：

1. `@openbot/collaboration-core` 是稳定的领域类型与状态机来源。
2. `@openbot/collaboration-runtime` 是可复用的运行时编排与投影来源。
3. OpenBot 主仓中的 UI，不应再自己发明第二套 `space/group/member/task/review/decision` 主模型。
4. 四端中的协作相关能力，应优先围绕 collaboration SDK 产生的对象进行视图映射。

### 20.2 四端对 collaboration 的消费原则

- Employee
  - 消费协作运行结果与协作空间视图。
  - 不承担协作治理对象的定义权。
- Enterprise
  - 是 collaboration 的主要治理视图承载端。
  - `Mesh`、`Organization`、`Groups`、`Incidents` 需要以 collaboration 对象为一等公民。
- Platform
  - 只看聚合后的 adoption / coverage / health / risk。
  - 不直接承接协作对象的细粒度治理动作。
- Ops
  - 只消费与 execution/runtime/failure 相关的协作执行投影。
  - 不负责协作业务对象本身的配置与运营。
- Builder
  - 不直接定义 collaboration 业务对象。
  - 只负责 capability / agent / tool 供给，供 collaboration runtime 消费。

### 20.3 明确禁止事项

以下做法在四端重组中应视为禁令：

1. 在 `ui/src/ui/ports/*` 内重新定义另一套 `Task / Deliverable / Review / Decision / Group` 主语义。
2. 继续把 `workspaceTeamObjects / workspaceTeamOrder` 当作协作主数据源。
3. 直接把 `sessions/channels/presence` 的临时拼装结果当作长期业务对象。
4. 让 Platform / Ops 页面直接控制 collaboration 业务对象的创建与修改。

### 20.4 推荐落点

建议把以下对象类型逐步统一收口到 shared/domain 或 collaboration adapter：

- `Group`
- `CollaborationSpace`
- `Member`
- `Task`
- `Deliverable`
- `Review`
- `Decision`
- `ExecutionIncident`
- `GovernanceProjection`

UI 端只做：

- domain object -> semantic read model -> view model

而不是：

- raw controller snapshot -> ad hoc page state

## 21. 第一阶段执行清单（Phase 1）

Phase 1 的目标不是一次性做完四端，而是先把“结构不会继续长歪”的基础打稳。

### 21.1 Phase 1 范围

本阶段只做四件事：

1. 固化 canonical object model 与 cross-port context。
2. 把路由切到最终四端规范。
3. 抽出 Ops Port。
4. 为 Platform / Enterprise / Builder 建立空壳 port shell 与最小 state adapter。

### 21.2 不在 Phase 1 做的事

1. 不全量重写 Platform / Enterprise / Builder 页面。
2. 不在这一阶段做完整视觉重构。
3. 不在这一阶段清理所有 legacy alias。
4. 不在这一阶段重做 collaboration 领域模型。
5. 不在这一阶段做 Builder 的完整发布链。

### 21.3 Phase 1 任务表

| ID    | 任务                         | 主要文件                                  | 结果                                                       |
| ----- | ---------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| P1-1  | 新增 shared domain types     | `src/shared/domain/**`                    | 四端共享对象类型固定                                       |
| P1-2  | 新增 cross-port context 类型 | `ui/src/ui/routing/cross-port-context.ts` | 跨端传递规则固定                                           |
| P1-3  | 重写路由规范                 | `ui/src/ui/navigation.ts`                 | `/platform` `/enterprise/:tenantId` `/ops` `/builder` 生效 |
| P1-4  | 抽出 Ops Port shell          | `ui/src/ui/ports/ops/**`                  | Ops 可独立承接运行态页面                                   |
| P1-5  | 新增 Platform Port 空壳      | `ui/src/ui/ports/platform/**`             | Platform 有自己的 shell 与 adapter                         |
| P1-6  | 新增 Enterprise Port 空壳    | `ui/src/ui/ports/enterprise/**`           | Enterprise 有自己的 shell 与 adapter                       |
| P1-7  | 新增 Builder Port 空壳       | `ui/src/ui/ports/builder/**`              | Builder 有自己的 shell 与 adapter                          |
| P1-8  | 缩减 `app-render.ts`         | `ui/src/ui/app-render.ts`                 | 根渲染只做分端路由与挂载                                   |
| P1-9  | 建立跨端深链恢复测试         | `ui/src/ui/navigation*.test.ts`           | URL 刷新后上下文可恢复                                     |
| P1-10 | 建立端口边界测试             | `ui/src/ui/ports/*/*.test.ts`             | 新 port 不再直接吃全量 state                               |

### 21.4 Phase 1 推荐顺序

1. `P1-1` + `P1-2`
2. `P1-3`
3. `P1-4`
4. `P1-5` + `P1-6` + `P1-7`
5. `P1-8`
6. `P1-9` + `P1-10`

## 22. Phase 1 验收矩阵

### 22.1 路由验收

| 验收项          | 标准                                                            |
| --------------- | --------------------------------------------------------------- |
| Platform 路由   | `/platform/...` 深链可恢复                                      |
| Enterprise 路由 | `/enterprise/:tenantId/...` 缺 `tenantId` 时回退选择上下文      |
| Ops 路由        | `/ops/...` 可携带 `tenantId / agentId / executionId` 辅助上下文 |
| Builder 路由    | `/builder/...` 以 `capabilityId / agentId` 作为主对象           |

### 22.2 端口边界验收

| 验收项     | 标准                       |
| ---------- | -------------------------- |
| Employee   | 不新增治理与运维主语义     |
| Enterprise | 不直接执行恢复动作         |
| Platform   | 不直接承接单租户内部主操作 |
| Ops        | 不承接租户经营与组织治理   |
| Builder    | 不承接能力分发运营         |

### 22.3 数据与对象验收

| 验收项        | 标准                                                                   |
| ------------- | ---------------------------------------------------------------------- |
| 对象 ID       | `tenantId / agentId / capabilityId / runtimeId / executionId` 全局统一 |
| 上下文        | 跨端仅传业务对象，不传 UI 本地状态                                     |
| ViewModel     | 页面只依赖 semantic/view model，不直接依赖 raw controller payload      |
| Collaboration | 不再新增 UI 私有协作主对象                                             |

## 23. 下一份文档建议

在本蓝图基础上，下一份应直接产出“文件级实施任务卡”，建议文件名：

- `docs/design/openbot-four-port-phase1-execution-checklist-2026-04-12.md`

其内容应进一步细化为：

1. 每个任务对应的改动文件列表
2. 每个任务的前置依赖
3. 每个任务的最小可交付定义
4. 每个任务对应的测试清单
5. 明确哪些任务可以并行，哪些必须串行

## 24. 最终判断

当前这份蓝图已经足以作为四端重组的架构与执行总纲。

但真正让项目进入可执行状态的前提是：

1. 把 shared object model 固化到代码。
2. 把路由切到统一规范。
3. 先把 Ops 从当前混层壳体中独立出来。
4. 用 port shell + adapter 模式，逐步恢复 Platform / Enterprise / Builder。

在这些步骤之前，继续在当前混合控制台里加页面，只会加速职责再次污染。
