# 需求文档：平台端 Agent Runtime Center（AI 代理运行时治理中心）

## 简介

本 spec 是对平台端"代理资产"模块的重新定义，基于三层架构专家团队的反馈，将其从"业务资产管理"彻底转向 **Runtime Infrastructure Layer** 的职责定位。

### 核心定位变更

- **旧定位**：AI 代理资产治理中心（偏业务资产视角）
- **新定位**：AI Agent Runtime Governance（纯运行时基础设施视角）

### 架构原则

1. **Platform = Runtime Truth**：平台端是唯一的运行时真实数据源，企业端和员工端都是 Projection
2. **Agent = Runtime Execution Container**：平台层统一使用 "Agent Runtime" 概念，不使用"机器人""AI 助手"等业务语言
3. **Capability Binding ≠ Install Relation**：平台端维护的是 `RuntimeCapabilityBinding`（运行时绑定），企业端看到的 `InstallRelation` 是其业务投影
4. **Runtime Lifecycle ≠ Asset Lifecycle**：平台端有独立的运行时生命周期（deployed/draining/suspended/deprecated/archived），与企业端的资产生命周期（submitted/reviewing/published/deprecated/retired）完全分离
5. **去业务化**：平台端不涉及企业价值、组织绩效、业务贡献、部门覆盖等业务概念

### 三层 Projection Architecture

```
Platform Runtime Layer (Canonical Truth)
├── RuntimeAgent
├── RuntimeCapabilityBinding
├── RuntimeTelemetry
├── RuntimeLifecycle
│
├──→ Enterprise Projection (Business Governance)
│     ├── EnterpriseCapabilityAsset
│     ├── InstallRelation
│     ├── EnterpriseHealthStatus
│     └── AssetLifecycle
│
└──→ Employee Projection (Experience)
      ├── RobotCapabilityProfile
      ├── CapabilityHealthLabel
      ├── CapabilityUsageBrief
      └── CapabilityUpdateRecap
```

### 与现有 spec 的关系

- **skill-lifecycle-asset-system**（员工端）：本 spec 是其 `CapabilityHealthLabel`、`CapabilityUsageBrief` 的上游数据源
- **enterprise-capability-asset-library**（企业端）：本 spec 是其 `EnterpriseHealthStatus`、`InstallRelation` 的上游数据源
- **capability-governance-runtime**（平台能力中心）：本 spec 与其平行，管 Agent Runtime；能力中心管 Capability Registry/Governance

### 实施阶段

- **Phase 1：Runtime Catalog + Capability Bindings + Runtime Health**
- **Phase 2：Deployment Lifecycle + Governance & Policy**
- **Phase 3：Runtime Intelligence（动态编排、热更新、Canary、Agent Mesh）**

## 术语表

### 平台运行时层概念（本 spec 核心）

- **Agent_Runtime**：运行时执行容器，是 Capability 的运行载体。平台层唯一标识为 `runtimeAgentId`。不使用"机器人""AI 助手"等业务语言。一个 Agent Runtime 可装载多个 Capability，一个 Capability 可被多个 Agent Runtime 装载
- **RuntimeCapabilityBinding**：Agent Runtime 与 Capability 之间的运行时绑定关系。包含绑定类型、路由优先级、加载策略、运行状态、健康状态、调用指标、策略配置。这是整个系统的 Runtime Binding Layer 核心
- **RuntimeTelemetry**：运行时遥测数据，包含延迟、吞吐、成功率、错误率、Token 消耗、队列深度、内存压力等运行时指标
- **RuntimeLifecycle**：Agent Runtime 的运行时生命周期，枚举为 `deployed | draining | suspended | deprecated | archived`，与企业端 AssetLifecycle 完全独立
- **RuntimeHealth**：运行时健康状态，枚举为 `healthy | degraded | unhealthy | unavailable`，是企业端 `EnterpriseHealthStatus` 和员工端 `CapabilityHealthLabel` 的唯一上游数据源
- **BindingType**：绑定类型，枚举为 `tenant-installed | platform-default | dynamic-runtime | fallback`
- **LoadStrategy**：能力加载策略，枚举为 `eager | lazy | on-demand`
- **BindingState**：绑定运行状态，枚举为 `active | warming | degraded | disabled`
- **RoutingPriority**：路由优先级，数值类型，决定同一 Agent 上多个能力的调用优先级
- **SandboxPolicy**：沙箱策略，定义能力运行时的隔离级别和资源限制
- **ResourceQuota**：资源配额，定义能力运行时的 CPU/内存/Token/并发限制
- **HotReloadable**：是否支持热更新，布尔值，决定能力版本更新时是否需要重启 Agent
- **FallbackBinding**：降级绑定，当主绑定不可用时的备选能力绑定
- **RuntimeCatalog**：Agent Runtime 目录，平台上所有 Agent Runtime 实例的注册表
- **TenantCoverage**：租户覆盖，一个 Agent Runtime 服务的租户范围
- **CapabilityVersion**：能力版本，绑定中锁定的能力运行时版本号

### 三层命名统一

| 层级   | Agent 称呼    | Capability 称呼 | 绑定关系称呼             | 健康状态称呼           | 生命周期称呼     |
| ------ | ------------- | --------------- | ------------------------ | ---------------------- | ---------------- |
| 员工端 | 机器人        | 能力            | "正在被哪些机器人使用"   | CapabilityHealthLabel  | —                |
| 企业端 | 能力安装目标  | 能力资产        | InstallRelation          | EnterpriseHealthStatus | AssetLifecycle   |
| 平台端 | Agent Runtime | Capability      | RuntimeCapabilityBinding | RuntimeHealth          | RuntimeLifecycle |

### Projection 映射规则

| 平台 Runtime 源                | 企业端投影       | 员工端投影   |
| ------------------------------ | ---------------- | ------------ |
| RuntimeHealth = healthy        | 效果稳定         | 运行稳定     |
| RuntimeHealth = degraded       | 偶尔结果不理想   | 偶尔异常     |
| RuntimeHealth = unhealthy      | 建议重新整理     | 需要重新整理 |
| RuntimeHealth = unavailable    | 已不适合继续推广 | —            |
| RuntimeLifecycle = deployed    | 已发布           | —            |
| RuntimeLifecycle = draining    | —                | —            |
| RuntimeLifecycle = suspended   | —                | —            |
| RuntimeLifecycle = deprecated  | 即将下线         | 即将下线     |
| RuntimeLifecycle = archived    | 已下线           | 已下线       |
| BindingType = tenant-installed | 员工自主安装     | —            |
| BindingType = platform-default | 管理员推送       | —            |
| BindingState = active          | 正常运行         | —            |
| BindingState = disabled        | 已暂停           | —            |

## 需求

### 需求 1：Runtime Canonical Model 建立

**用户故事：** 作为平台架构师，我需要建立 Runtime Canonical Model 作为三端唯一真实数据源，以便企业端和员工端通过 Projection 获取一致的运行时状态。

#### 验收标准

1. THE Platform SHALL 定义 `RuntimeAgent` 类型作为 Agent Runtime 的唯一标准模型，包含字段：`runtimeAgentId`、`name`、`runtimeVersion`、`lifecycle`（RuntimeLifecycle）、`health`（RuntimeHealth）、`tenantCoverage`（租户 ID 列表）、`boundCapabilityCount`、`activeSessionCount`、`resourceUsage`、`deployedAt`、`lastActiveAt`
2. THE Platform SHALL 定义 `RuntimeCapabilityBinding` 类型作为能力绑定的唯一标准模型，包含字段：`bindingId`、`runtimeAgentId`、`capabilityId`、`capabilityVersion`、`bindingType`（BindingType）、`routingPriority`、`loadStrategy`（LoadStrategy）、`bindingState`（BindingState）、`healthStatus`（RuntimeHealth）、`invocationMetrics`、`policy`（含 sandbox/resourceQuota/hotReloadable）、`fallbackBindingId`、`createdAt`、`updatedAt`
3. THE Platform SHALL 定义 `RuntimeTelemetry` 类型作为运行时遥测的唯一标准模型，包含字段：`runtimeAgentId`、`capabilityId`（可选）、`calls7d`、`successRate7d`、`avgLatencyMs`、`p95LatencyMs`、`tokenConsumption7d`、`errorCount7d`、`queueDepth`、`memoryPressure`、`lastSampleAt`
4. THE Platform SHALL 确保所有 Runtime Canonical Model 类型定义中不包含任何业务语言字段（如"贡献绩效""部门覆盖""企业价值""复用价值评分"等）
5. THE Platform SHALL 提供 `projectToEnterprise(runtime: RuntimeCanonical): EnterpriseProjection` 投影函数，将 Runtime 数据转换为企业端可消费的业务视图
6. THE Platform SHALL 提供 `projectToEmployee(runtime: RuntimeCanonical): EmployeeProjection` 投影函数，将 Runtime 数据转换为员工端可消费的体验视图
7. THE Platform SHALL 确保投影函数是纯函数，不依赖外部状态，可独立测试

### 需求 2：Runtime Catalog（Agent Runtime 目录）

**用户故事：** 作为平台运维工程师，我需要查看所有 Agent Runtime 实例的运行状态、能力装载数量、租户覆盖和资源使用情况，以便进行运维决策。

#### 验收标准

1. THE Platform SHALL 在 Runtime Catalog 标签页以表格形式展示所有 Agent Runtime 实例，每行包含：Agent 名称、Runtime Version、RuntimeLifecycle 状态、RuntimeHealth 状态、已绑定能力数、租户覆盖数、活跃会话数、资源使用率、最近活跃时间
2. THE Platform SHALL 在 Runtime Catalog 表格中使用纯运行时语言：RuntimeLifecycle 展示为 `deployed | draining | suspended | deprecated | archived`，RuntimeHealth 展示为 `healthy | degraded | unhealthy | unavailable`，不使用业务语言
3. THE Platform SHALL 在页面顶部展示 Runtime KPI 卡片：Agent Runtime 总数（按 lifecycle 分组）、总绑定能力数（平均每 Agent N 个）、Runtime 健康率（healthy 占比）、租户覆盖总数、活跃会话总数
4. THE Platform SHALL 支持按 RuntimeLifecycle、RuntimeHealth、租户 ID 筛选 Agent Runtime 列表
5. THE Platform SHALL 支持按名称关键词搜索 Agent Runtime
6. WHEN 平台工程师点击某个 Agent Runtime 行, THE Platform SHALL 展示该 Agent 的详情面板，包含：基本信息、已绑定能力列表（含每个绑定的 BindingState 和 invocationMetrics）、租户覆盖列表、资源使用详情、遥测时间线
7. IF Runtime Catalog 为空, THEN THE Platform SHALL 展示空状态提示："尚无 Agent Runtime 实例。从供给构建端发布代理，或通过 API 注册新的 Agent Runtime。"

### 需求 3：Capability Bindings（运行时能力绑定）

**用户故事：** 作为平台运维工程师，我需要查看和管理所有 Agent Runtime 与 Capability 之间的运行时绑定关系，以便进行能力编排、路由调整和故障排查。

#### 验收标准

1. THE Platform SHALL 在 Capability Bindings 标签页以矩阵或表格形式展示所有 `RuntimeCapabilityBinding`，每条记录包含：Agent Runtime 名称、Capability 名称、Capability Version、BindingType、RoutingPriority、LoadStrategy、BindingState、RuntimeHealth、7日调用数、7日成功率、平均延迟
2. THE Platform SHALL 支持按 Agent Runtime、Capability、BindingType、BindingState、RuntimeHealth 筛选绑定列表
3. THE Platform SHALL 支持修改绑定的 BindingState（active ↔ disabled），修改后立即生效并记录操作日志
4. THE Platform SHALL 支持修改绑定的 RoutingPriority，修改后影响同一 Agent 上多能力的调用优先级
5. THE Platform SHALL 支持修改绑定的 LoadStrategy（eager/lazy/on-demand），修改后影响能力的加载行为
6. WHEN 绑定的 RuntimeHealth 为 unhealthy 且存在 fallbackBindingId, THE Platform SHALL 在该绑定行展示降级指示器，说明当前正在使用 fallback 能力
7. THE Platform SHALL 在绑定详情中展示完整的 `RuntimeCapabilityBinding` 字段，包含 policy（sandbox/resourceQuota/hotReloadable）和 invocationMetrics 详情
8. THE Platform SHALL 在绑定列表顶部展示绑定统计：总绑定数、active 数、degraded 数、disabled 数、按 BindingType 分布
9. WHEN 企业端执行"安装到机器人"操作, THE Platform SHALL 自动创建对应的 `RuntimeCapabilityBinding`，bindingType 为 `tenant-installed`，loadStrategy 默认为 `lazy`，bindingState 默认为 `active`
10. WHEN 平台管理员创建新绑定, THE Platform SHALL 要求指定 runtimeAgentId、capabilityId、capabilityVersion、bindingType、loadStrategy，其余字段使用默认值

### 需求 4：Runtime Health（运行时健康）

**用户故事：** 作为平台运维工程师，我需要实时监控所有 Agent Runtime 和 Capability Binding 的运行时健康状态，以便及时发现和处理故障。

#### 验收标准

1. THE Platform SHALL 在 Runtime Health 标签页展示运行时健康全景，按严重程度分组：unavailable（红色）、unhealthy（橙色）、degraded（黄色）、healthy（绿色）
2. THE Platform SHALL 为每个非 healthy 的 Agent Runtime 或 Binding 展示健康问题详情，包含：问题类型、影响范围（受影响租户数/会话数）、持续时间、遥测证据（延迟/错误率/超时率）
3. THE Platform SHALL 基于 RuntimeTelemetry 自动计算 RuntimeHealth，映射规则为：
   - successRate7d ≥ 95% 且 avgLatencyMs < 阈值 且无连续失败 → `healthy`
   - successRate7d 70%–94% 或 avgLatencyMs 超阈值但服务可用 → `degraded`
   - successRate7d 50%–69% 或连续失败超过 3 次 → `unhealthy`
   - successRate7d < 50% 或 Runtime 离线或关键依赖不可用 → `unavailable`
4. THE Platform SHALL 确保 RuntimeHealth 是企业端 EnterpriseHealthStatus 和员工端 CapabilityHealthLabel 的唯一上游数据源，通过 Projection 函数映射
5. THE Platform SHALL 在健康面板中展示以下运行时指标（不展示业务指标）：延迟（avg/p95/p99）、吞吐量（calls/s）、错误率、超时率、Token 消耗率、队列深度、内存压力、依赖可用性
6. THE Platform SHALL 支持按时间范围（1h/6h/24h/7d/30d）查看健康趋势图
7. WHEN RuntimeHealth 从 healthy 变为 degraded/unhealthy/unavailable, THE Platform SHALL 记录健康事件并触发告警（告警通道配置在系统设置中）
8. THE Platform SHALL 不在健康面板中展示任何业务指标（如"覆盖部门数""企业价值""贡献绩效"等）

### 需求 5：Deployment Lifecycle（运行时部署生命周期）

**用户故事：** 作为平台运维工程师，我需要管理 Agent Runtime 的部署生命周期，以便安全地进行版本更新、灰度发布和下线操作。

#### 验收标准

1. THE Platform SHALL 定义 RuntimeLifecycle 状态机，合法流转路径为：
   - `deployed` → `draining`（开始排空，不接受新请求）
   - `draining` → `suspended`（排空完成，完全暂停）
   - `suspended` → `deployed`（恢复服务）
   - `deployed` → `deprecated`（标记为即将下线，仍接受请求但不推荐）
   - `deprecated` → `archived`（正式下线，不再接受任何请求）
   - `suspended` → `archived`（从暂停直接归档）
2. THE Platform SHALL 在 Deployment Lifecycle 标签页按 RuntimeLifecycle 分组展示所有 Agent Runtime，每组展示数量和列表
3. THE Platform SHALL 支持平台管理员执行生命周期状态转换操作，转换前展示影响评估：受影响的绑定数、活跃会话数、租户数
4. WHEN Agent Runtime 从 deployed 转为 deprecated, THE Platform SHALL 通过 Projection 触发企业端展示"即将下线"提示、员工端展示"即将下线"提示
5. WHEN Agent Runtime 从 deprecated 转为 archived, THE Platform SHALL 自动将该 Agent 上所有 RuntimeCapabilityBinding 的 bindingState 设为 disabled，并通过 Projection 触发企业端展示"已下线"、员工端展示"已下线"
6. THE Platform SHALL 确保 RuntimeLifecycle 与企业端 AssetLifecycle 完全独立：两者不共用枚举、不共用状态机、不互相依赖
7. THE Platform SHALL 在生命周期操作中记录审计日志：操作人、操作时间、源状态、目标状态、影响范围

### 需求 6：Governance & Policy（治理与策略）

**用户故事：** 作为平台运维工程师，我需要自动检测运行时治理问题（僵尸绑定、资源超配、安全违规、能力冲突），以便在问题影响业务前主动干预。

#### 验收标准

1. THE Platform SHALL 在 Governance & Policy 标签页展示自动检测到的运行时治理问题，按严重程度分组
2. THE Platform SHALL 检测以下运行时治理问题类别：
   - `zombie-binding`：BindingState = active 但 30 天内 invocationCount = 0
   - `resource-overcommit`：Agent Runtime 的总 resourceQuota 超过可用资源
   - `capability-conflict`：同一 Agent 上存在功能重叠的 Capability 绑定（基于 Capability taxonomy 判断）
   - `sandbox-violation`：Capability 运行时行为超出 SandboxPolicy 定义的边界
   - `version-drift`：同一 Capability 在不同 Agent 上绑定了不同版本
   - `fallback-chain-broken`：fallbackBindingId 指向的绑定本身也是 unhealthy
   - `orphaned-agent`：Agent Runtime 无任何绑定且 30 天内无活跃会话
3. THE Platform SHALL 为每个治理问题提供：问题描述、影响范围、证据数据、建议操作
4. THE Platform SHALL 支持平台管理员确认（acknowledge）治理问题，确认后问题不再在首页告警中展示，但仍保留在治理列表中
5. THE Platform SHALL 不在治理面板中展示任何业务治理问题（如"能力复用价值低""贡献不活跃"等），这些属于企业端职责
6. THE Platform SHALL 支持配置治理策略：zombie-binding 检测阈值（默认 30 天）、resource-overcommit 告警阈值、version-drift 容忍范围

### 需求 7：Projection 层正确性保证

**用户故事：** 作为平台架构师，我需要确保 Projection 层的映射正确性可通过属性测试验证，以便在任何代码变更后自动检测三端数据一致性。

#### 验收标准

1. THE Platform SHALL 提供 `projectToEnterprise` 函数，将 RuntimeHealth 映射为 EnterpriseHealthStatus：healthy → "效果稳定"、degraded → "偶尔结果不理想"、unhealthy → "建议重新整理"、unavailable → "已不适合继续推广"
2. THE Platform SHALL 提供 `projectToEmployee` 函数，将 RuntimeHealth 映射为 CapabilityHealthLabel：healthy → "运行稳定"、degraded → "偶尔异常"、unhealthy → "需要重新整理"、unavailable → 不展示（能力已不可用）
3. THE Platform SHALL 提供 `projectBindingToInstallRelation` 函数，将 RuntimeCapabilityBinding 映射为企业端 InstallRelation：bindingType=tenant-installed → source="员工自主安装"、bindingType=platform-default → source="管理员推送"、bindingState=active → status="正常运行"、bindingState=disabled → status="已暂停"
4. THE Platform SHALL 确保所有 Projection 函数满足以下属性：
   - 幂等性：对同一输入多次调用返回相同结果
   - 完备性：Runtime 枚举的每个值都有对应的投影结果
   - 纯净性：投影输出中不包含任何 Runtime 层原始枚举或字段名
5. THE Platform SHALL 通过属性测试验证：对任意 RuntimeCapabilityBinding 输入，`projectBindingToInstallRelation` 的输出中不包含 `bindingId`、`routingPriority`、`loadStrategy`、`sandboxPolicy`、`resourceQuota`、`hotReloadable`、`fallbackBindingId` 等 Runtime 内部字段
6. THE Platform SHALL 确保 Projection 是单向的：企业端和员工端不能反向修改 Runtime Canonical Model，只能通过平台端 API 操作

### 需求 8：与能力中心（Capability Governance）的边界

**用户故事：** 作为平台架构师，我需要明确 Agent Runtime Center 与 Capability Center 的职责边界，以便两个模块不产生功能重叠。

#### 验收标准

1. THE Platform SHALL 确保 Agent Runtime Center 管理的对象是 Agent Runtime 实例和 RuntimeCapabilityBinding，不管理 Capability 定义本身
2. THE Platform SHALL 确保 Capability Center（capability-governance-runtime spec）管理的对象是 Capability 注册、版本、治理、分发策略，不管理 Agent Runtime 实例
3. THE Platform SHALL 在 Agent Runtime Center 的 Capability Bindings 视图中，为每个 Capability 提供"前往能力中心查看定义"的跳转链接
4. THE Platform SHALL 在 Capability Center 的 Distribution 视图中，为每个已分发的 Capability 提供"查看 Runtime 绑定状态"的跳转链接到 Agent Runtime Center
5. THE Platform SHALL 确保两个模块共享 `capabilityId` 作为关联键，但各自维护独立的状态（Capability Center 维护 CapabilityLifecycleState，Agent Runtime Center 维护 BindingState）
6. THE Platform SHALL 确保当 Capability Center 将某个 Capability 标记为 retired 时，Agent Runtime Center 自动将所有引用该 Capability 的 Binding 标记为 disabled 并触发 Projection 通知

### 需求 9：信息架构约束与术语规范

**用户故事：** 作为产品设计者，我需要确保平台端 Agent Runtime Center 的术语和视觉严格符合 Runtime Infrastructure 视角，不被业务语言污染。

#### 验收标准

1. THE Platform SHALL 在 Agent Runtime Center 所有界面中禁止出现以下业务术语：`企业价值`、`贡献绩效`、`部门覆盖`、`复用价值`、`业务场景`、`使用场景`、`适用对象`、`能力成熟度`（企业端概念）、`机器人`、`我的能力`、`能力积累`（员工端概念）
2. THE Platform SHALL 在 Agent Runtime Center 所有界面中使用以下 Runtime 术语：`Agent Runtime`、`Capability Binding`、`Runtime Health`、`Deployment Lifecycle`、`Binding State`、`Load Strategy`、`Routing Priority`、`Sandbox Policy`、`Resource Quota`、`Telemetry`、`Invocation Metrics`
3. THE Platform SHALL 使用深色/中性色调的运维工程师视觉风格，与企业端（白/蓝商务风格）和员工端（暗色工作台风格）形成明确区分
4. THE Platform SHALL 在导航中将模块标题从"代理资产"更改为"Agent Runtime"（或保留中文"代理运行时"），副标题为"Runtime Governance · Binding / Health / Lifecycle / Policy"
5. THE Platform SHALL 确保 Agent Runtime Center 的标签页命名为：Runtime Catalog、Capability Bindings、Runtime Health、Deployment Lifecycle、Governance & Policy

### 需求 10：数据流与事件驱动

**用户故事：** 作为平台开发者，我需要明确 Runtime Canonical Model 的数据流方向和事件触发机制，以便实现三端数据一致性。

#### 验收标准

1. THE Platform SHALL 定义以下数据流方向（单向）：
   - RuntimeHealth 变更 → 触发 Projection → 更新企业端 EnterpriseHealthStatus + 员工端 CapabilityHealthLabel
   - RuntimeLifecycle 变更 → 触发 Projection → 更新企业端/员工端的下线提示
   - RuntimeCapabilityBinding 创建/删除 → 触发 Projection → 更新企业端 InstallRelation + 员工端 CapabilityUsageBrief
2. THE Platform SHALL 定义以下反向触发（企业端操作 → 平台端响应）：
   - 企业端"安装到机器人" → 平台端创建 RuntimeCapabilityBinding（bindingType=tenant-installed）
   - 企业端"卸载能力" → 平台端将对应 Binding 的 bindingState 设为 disabled
   - 企业端"标记为已不适合继续推广" → 平台端将对应 Binding 的 bindingState 设为 disabled
3. THE Platform SHALL 确保所有状态变更通过事件总线传播，事件格式为：`{ eventType, source: "platform" | "enterprise" | "employee", timestamp, payload }`
4. THE Platform SHALL 确保企业端和员工端不能直接修改 RuntimeHealth、RuntimeLifecycle、BindingState 等 Runtime 字段，只能通过定义好的操作接口间接触发
5. THE Platform SHALL 在事件传播失败时保证最终一致性：记录失败事件到重试队列，定期重试直到 Projection 同步完成

</content>
