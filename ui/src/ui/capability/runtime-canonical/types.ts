/**
 * Runtime Canonical Model — Platform Agent Runtime Center 的运行时数据真理源（Truth Source）。
 *
 * 架构定位：
 * - 三层架构中 Platform Runtime Layer 的标准模型，是企业端 (`EnterpriseHealthStatus`、
 *   `InstallRelation`、`AssetLifecycle`) 与员工端 (`CapabilityHealthLabel`、
 *   `CapabilityUsageBrief`) 的**唯一**上游数据源。
 * - 下游层只能通过 `projection.ts` 中定义的纯投影函数消费本模块的类型，
 *   严禁反向修改 Runtime 字段。
 *
 * 强约束：
 * - 不引入任何业务字段（贡献绩效、企业价值、部门覆盖、复用价值评分等业务概念
 *   归属企业端 `enterprise-capability` 模块）。
 * - 不引入任何员工语言字段（"我的能力""机器人会做什么"等归属员工端
 *   `employee-capability` 模块）。
 * - Agent 概念在本层统一称作 Agent Runtime，禁止使用"机器人"业务称呼；
 *   Capability 概念保持中性技术称呼。
 *
 * 设计准则：
 * - 仅导出 `type` 别名（除可被运行时枚举的状态机/常量数组外），不使用 `interface`，
 *   保证可与字面量对象自由组合。
 * - 状态枚举使用字面量联合 + `as const` 数组双导出形式，方便类型系统与运行时迭代共用。
 * - 不依赖任何外部模块（包括项目内其他 capability 模块），保证纯类型层可独立编译复用。
 */

// ─────────────────────────────────────────────────────────────────────────
// Runtime Lifecycle — Agent Runtime 的部署生命周期
// ─────────────────────────────────────────────────────────────────────────

/**
 * Agent Runtime 的部署生命周期状态。
 *
 * 与企业端 `AssetLifecycle`（submitted/reviewing/approved/published/deprecated/retired）
 * **完全独立**：本枚举描述运行时实例的生死状态，前者描述能力资产的审批状态。
 * 即便存在同名值（如 `deprecated`），其语义、状态机与触发条件均不一致。
 *
 * 状态语义：
 * - `deployed`     运行中，正常接受请求
 * - `draining`     排空中，不接受新请求，等待存量请求完成
 * - `suspended`    已排空，完全暂停（资源释放但保留实例元信息）
 * - `deprecated`   即将下线，仍接受请求但已不推荐
 * - `archived`     正式下线，不再接受任何请求
 */
export type RuntimeLifecycle = "deployed" | "draining" | "suspended" | "deprecated" | "archived";

export const RUNTIME_LIFECYCLES: readonly RuntimeLifecycle[] = [
  "deployed",
  "draining",
  "suspended",
  "deprecated",
  "archived",
] as const;

/**
 * Runtime Lifecycle 合法状态转换路径（穷尽列举）。
 *
 * 转换语义：
 * - deployed → draining：开始排空
 * - draining → suspended：排空完成
 * - suspended → deployed：从暂停恢复服务
 * - suspended → archived：从暂停直接归档
 * - deployed → deprecated：标记为即将下线
 * - deprecated → archived：从即将下线归档
 *
 * 末态 `archived` 不可再转换。任何不在本表中的转换组合必须被 lifecycle 状态机拒绝
 * （由 `lifecycle-state-machine.ts` 的 `canTransition` / `validateTransition` 强制实施）。
 */
export const RUNTIME_LIFECYCLE_TRANSITIONS: Readonly<
  Record<RuntimeLifecycle, readonly RuntimeLifecycle[]>
> = {
  deployed: ["draining", "deprecated"],
  draining: ["suspended"],
  suspended: ["deployed", "archived"],
  deprecated: ["archived"],
  archived: [],
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Runtime Health — 运行时健康状态
// ─────────────────────────────────────────────────────────────────────────

/**
 * Runtime 健康状态。是企业端 `EnterpriseHealthStatus` 与员工端
 * `CapabilityHealthLabel` 的**唯一**上游来源；下游层只能通过
 * `projection.ts` 中的投影函数消费本枚举。
 *
 * 计算逻辑由 `health-calculator.ts` 的 `calculateRuntimeHealth` 提供，
 * 默认基于 7 日成功率与平均延迟阈值映射。
 *
 * 状态语义：
 * - `healthy`      正常运行
 * - `degraded`     存在劣化（延迟变长 / 间歇性失败），仍可服务
 * - `unhealthy`    显著降级（持续失败超过阈值），已影响业务
 * - `unavailable`  完全不可用（实例离线 / 关键依赖宕机）
 */
export type RuntimeHealth = "healthy" | "degraded" | "unhealthy" | "unavailable";

export const RUNTIME_HEALTH_STATUSES: readonly RuntimeHealth[] = [
  "healthy",
  "degraded",
  "unhealthy",
  "unavailable",
] as const;

// ─────────────────────────────────────────────────────────────────────────
// Capability Binding — Agent × Capability 的运行时绑定
// ─────────────────────────────────────────────────────────────────────────

/**
 * 绑定来源/类别。区分该绑定是如何进入 Agent Runtime 的，用于审计、Projection
 * 与治理决策。
 *
 * 类别语义：
 * - `tenant-installed`  企业租户安装（员工端"安装到机器人"或企业端"批量推送"的最终落点）
 * - `platform-default`  平台默认绑定（平台预装能力，在 Agent 部署时建立）
 * - `dynamic-runtime`   运行时动态绑定（Phase 3 Canary / 智能编排注入）
 * - `fallback`          降级绑定（主绑定不可用时的备选）
 */
export type BindingType = "tenant-installed" | "platform-default" | "dynamic-runtime" | "fallback";

export const BINDING_TYPES: readonly BindingType[] = [
  "tenant-installed",
  "platform-default",
  "dynamic-runtime",
  "fallback",
] as const;

/**
 * 能力加载策略。
 *
 * - `eager`      Agent 启动时立即加载（适用于核心能力）
 * - `lazy`       首次调用时加载（默认，节约启动资源）
 * - `on-demand`  按需触发加载并在空闲后释放（适用于稀疏调用场景）
 */
export type LoadStrategy = "eager" | "lazy" | "on-demand";

export const LOAD_STRATEGIES: readonly LoadStrategy[] = ["eager", "lazy", "on-demand"] as const;

/**
 * 绑定运行状态。区别于 Agent 整体的 `RuntimeLifecycle`，本枚举描述单条 Binding
 * 在某个 Agent 上的可用性。
 *
 * 状态语义：
 * - `active`    正常工作
 * - `warming`   预热中（懒加载首次激活、版本切换中）
 * - `degraded`  仍在工作但已劣化（投影到企业端时仍展示为"正常运行"）
 * - `disabled`  已禁用（管理员关闭 / 健康降级到 unavailable / Capability 已 retired）
 */
export type BindingState = "active" | "warming" | "degraded" | "disabled";

export const BINDING_STATES: readonly BindingState[] = [
  "active",
  "warming",
  "degraded",
  "disabled",
] as const;

/**
 * 绑定策略配置。
 *
 * - `sandbox`        沙箱标识符（语义由部署平台定义，例如 `"strict"` / `"network-allowlist"`）
 * - `resourceQuota`  资源配额标识符（语义由部署平台定义，例如 `"small"` / `"gpu-1"`）
 * - `hotReloadable`  Capability 版本变更时是否可不重启 Agent 即生效；为 false 时
 *                     Phase 3 升级流程必须经历 draining→suspended→deployed
 */
export type BindingPolicy = {
  sandbox: string;
  resourceQuota: string;
  hotReloadable: boolean;
};

/**
 * 绑定调用指标。仅承载本绑定（runtimeAgentId × capabilityId × capabilityVersion）
 * 的最近 7 日运行数据，是健康状态、治理判定与企业端复用统计的原始口径。
 */
export type BindingInvocationMetrics = {
  /** 7 日总调用次数 */
  calls7d: number;
  /** 7 日成功率，归一化到 [0, 1] */
  successRate7d: number;
  /** 7 日平均延迟（毫秒） */
  avgLatencyMs: number;
  /** 7 日 p95 延迟（毫秒） */
  p95LatencyMs: number;
  /** 7 日错误次数 */
  errorCount7d: number;
  /** 7 日 token 消耗 */
  tokenConsumption7d: number;
};

/**
 * 租户安装来源细分。用于区分 `tenant-installed` 绑定具体是如何进入 Agent Runtime 的。
 *
 * 与 `BindingType` 的关系：
 * - `BindingType = "tenant-installed"` 表示"由租户侧发起安装"这一大类
 * - `TenantInstallSource` 进一步细分安装发起的具体路径（员工从平台市场安装、
 *   员工从企业分发安装、员工外部/本地安装、Da Bai 代理请求、机器人自装、管理员推送）
 *
 * 本字段属于运行时技术溯源字段，不直接暴露给业务端；业务端通过投影层消费。
 */
export type TenantInstallSource =
  | "platform-marketplace"
  | "enterprise-distributed"
  | "external-local"
  | "dabai-proxy"
  | "robot-self";

export const TENANT_INSTALL_SOURCES: readonly TenantInstallSource[] = [
  "platform-marketplace",
  "enterprise-distributed",
  "external-local",
  "dabai-proxy",
  "robot-self",
] as const;

/**
 * 配置状态。描述该绑定是否需要额外配置才能正常工作，与 `bindingState`
 *（运行时可用性状态）和 `governanceState`（治理状态）**严格分离**。
 */
export type ConfigurationState = "not-required" | "pending" | "complete";

export const CONFIGURATION_STATES: readonly ConfigurationState[] = [
  "not-required",
  "pending",
  "complete",
] as const;

/**
 * 治理状态。描述该绑定在企业/平台治理视角下的处置状态，与 `bindingState`
 *（运行时可用性状态）和 `configurationState`（配置状态）**严格分离**。
 */
export type GovernanceState = "none" | "restricted" | "review-required" | "disabled";

export const GOVERNANCE_STATES: readonly GovernanceState[] = [
  "none",
  "restricted",
  "review-required",
  "disabled",
] as const;

/**
 * Runtime Capability Binding — 运行时能力绑定。
 *
 * 这是整个 Agent Runtime Center 的**核心实体**。一个 Agent Runtime 可装载多个
 * Capability，一个 Capability 可被多个 Agent Runtime 装载，二者多对多关系即由
 * 本类型表达。
 *
 * 与企业端 `InstallRelation` 的关系：
 * `InstallRelation` 是本类型经 `projectBindingToInstallRelation` 投影后的业务视图，
 * 仅暴露"能力名/机器人名/安装时间/来源/状态"等业务字段，剥离 routingPriority、
 * loadStrategy、policy、fallbackBindingId 等 Runtime 内部字段。
 */
export type RuntimeCapabilityBinding = {
  /** 绑定唯一标识 */
  bindingId: string;
  /** 所属 Agent Runtime */
  runtimeAgentId: string;
  /** 绑定的 Capability 标识（与 capability-governance-runtime 共享） */
  capabilityId: string;
  /** 锁定的 Capability 版本号（语义版本字符串，例如 `"1.4.2"`） */
  capabilityVersion: string;
  /** 绑定来源类别 */
  bindingType: BindingType;
  /**
   * 租户安装来源细分。仅当 `bindingType === "tenant-installed"` 时有意义；
   * 其它 `BindingType` 下可为 `undefined`。
   */
  tenantInstallSource?: TenantInstallSource;
  /**
   * 路由优先级。同一 Agent 上多个 Capability 同时匹配请求时，按本字段降序选择
   * （Phase 3 智能编排）。
   */
  routingPriority: number;
  /** 能力加载策略 */
  loadStrategy: LoadStrategy;
  /** 绑定运行状态（细粒度的 active/warming/degraded/disabled） */
  bindingState: BindingState;
  /** 绑定健康状态（粗粒度，源于 RuntimeTelemetry → RuntimeHealth 的映射结果） */
  healthStatus: RuntimeHealth;
  /** 配置状态（与 bindingState/governanceState 严格分离） */
  configurationState?: ConfigurationState;
  /** 治理状态（与 bindingState/configurationState 严格分离） */
  governanceState?: GovernanceState;
  /** 关联的安装请求 ID（用于追溯安装链路） */
  installRequestId?: string;
  /** 7 日运行指标 */
  invocationMetrics: BindingInvocationMetrics;
  /** 绑定策略配置（沙箱、配额、热更新） */
  policy: BindingPolicy;
  /**
   * 降级绑定指针。该绑定不可用时的备选绑定标识；当备选绑定本身不可用时，
   * 治理检测器会发出 `fallback-chain-broken` 问题。
   */
  fallbackBindingId: string | null;
  /** 创建时间（毫秒时间戳） */
  createdAt: number;
  /** 最近更新时间（毫秒时间戳） */
  updatedAt: number;
};

// ─────────────────────────────────────────────────────────────────────────
// Runtime Agent — Agent Runtime 实例
// ─────────────────────────────────────────────────────────────────────────

/**
 * Agent Runtime 的资源使用快照。本字段不进入企业端投影；仅用于平台运维。
 */
export type RuntimeResourceUsage = {
  /** CPU 占用百分比，归一化到 [0, 100] */
  cpuPercent: number;
  /** 内存占用百分比，归一化到 [0, 100] */
  memoryPercent: number;
  /** Token 预算消耗百分比，归一化到 [0, 100] */
  tokenBudgetUsedPercent: number;
};

/**
 * Runtime Agent — Agent Runtime 实例。
 *
 * 本类型是平台运行时层对 Agent 的标准描述。所有运维视图（Runtime Catalog、
 * Capability Bindings、Runtime Health、Deployment Lifecycle、Governance & Policy）
 * 均基于本类型与 {@link RuntimeCapabilityBinding} 渲染。
 *
 * 与员工端"机器人"和企业端"能力安装目标"的关系：三者通过 `runtimeAgentId`
 * 关联，但下游层不可见 `runtimeVersion`、`resourceUsage` 等运行时字段。
 */
export type RuntimeAgent = {
  /** Agent Runtime 唯一标识（贯穿三端的稳定 ID） */
  runtimeAgentId: string;
  /** 显示名称（中性技术称呼，可与员工端业务名称保持一致） */
  name: string;
  /** Runtime 实例运行的版本号（语义版本字符串） */
  runtimeVersion: string;
  /** 部署生命周期 */
  lifecycle: RuntimeLifecycle;
  /** 整体健康状态 */
  health: RuntimeHealth;
  /** 已覆盖的租户 ID 列表 */
  tenantCoverage: string[];
  /** 已绑定能力总数 */
  boundCapabilityCount: number;
  /** 当前活跃会话数 */
  activeSessionCount: number;
  /** 资源使用 */
  resourceUsage: RuntimeResourceUsage;
  /** 部署时间（毫秒时间戳） */
  deployedAt: number;
  /** 最近活跃时间（毫秒时间戳） */
  lastActiveAt: number;
};

// ─────────────────────────────────────────────────────────────────────────
// Runtime Telemetry — 运行时遥测
// ─────────────────────────────────────────────────────────────────────────

/**
 * Runtime Telemetry — 运行时遥测样本。
 *
 * 本类型聚合了 Agent / Binding 的实时运行指标，是 `calculateRuntimeHealth`
 * 计算 RuntimeHealth 的主要输入。
 *
 * 字段语义：
 * - `runtimeAgentId`        所属 Agent；Agent 级遥测时使用
 * - `capabilityId`          可选；非空时表示本样本聚合到具体 Binding 维度
 * - `calls7d / errorCount7d / successRate7d`  调用计数（与 Binding 指标一致）
 * - `avgLatencyMs / p95LatencyMs`             延迟分位
 * - `tokenConsumption7d`    Token 消耗
 * - `queueDepth`            队列堆积深度（瞬时值）；高值预示降级
 * - `memoryPressure`        内存压力指数 [0, 1]；高值预示 unhealthy
 * - `lastSampleAt`          采样时间戳
 */
export type RuntimeTelemetry = {
  runtimeAgentId: string;
  capabilityId: string | null;
  calls7d: number;
  successRate7d: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  tokenConsumption7d: number;
  errorCount7d: number;
  queueDepth: number;
  memoryPressure: number;
  lastSampleAt: number;
};

// ─────────────────────────────────────────────────────────────────────────
// Governance Issue — 运行时治理问题
// ─────────────────────────────────────────────────────────────────────────

/**
 * 运行时治理问题分类。仅覆盖 Runtime 层关心的问题，**不**包含业务治理类别
 * （后者由企业端 `enterprise-capability` 模块处理）。
 *
 * 类别语义：
 * - `zombie-binding`        BindingState=active 但长期无调用
 * - `resource-overcommit`   Agent 总配额超过可用资源
 * - `capability-conflict`   同 Agent 上能力 taxonomy 重叠
 * - `sandbox-violation`     运行时行为超出 SandboxPolicy 边界
 * - `version-drift`         同 Capability 在不同 Agent 上版本不一致
 * - `fallback-chain-broken` 降级链中的备选绑定本身已 unhealthy
 * - `orphaned-agent`        Agent 无任何绑定且长期无活跃
 */
export type RuntimeGovernanceIssueCategory =
  | "zombie-binding"
  | "resource-overcommit"
  | "capability-conflict"
  | "sandbox-violation"
  | "version-drift"
  | "fallback-chain-broken"
  | "orphaned-agent";

export const RUNTIME_GOVERNANCE_ISSUE_CATEGORIES: readonly RuntimeGovernanceIssueCategory[] = [
  "zombie-binding",
  "resource-overcommit",
  "capability-conflict",
  "sandbox-violation",
  "version-drift",
  "fallback-chain-broken",
  "orphaned-agent",
] as const;

/** 治理问题严重程度。 */
export type RuntimeGovernanceIssueSeverity = "critical" | "high" | "medium" | "low";

export const RUNTIME_GOVERNANCE_ISSUE_SEVERITIES: readonly RuntimeGovernanceIssueSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
] as const;

/**
 * 运行时治理问题。由 `governance-detector.ts` 的检测器纯函数生成。
 *
 * 问题对象至少关联一个 `runtimeAgentId` 或 `bindingId`（或二者皆有）；
 * `evidence` 是结构化证据数据，**禁止**承载业务字段或原始错误堆栈。
 */
export type RuntimeGovernanceIssue = {
  /** 问题 ID（同一问题在不同检测周期保持稳定，便于 acknowledge 持久化） */
  id: string;
  /** 问题分类 */
  category: RuntimeGovernanceIssueCategory;
  /** 严重程度 */
  severity: RuntimeGovernanceIssueSeverity;
  /** 关联的 Agent（不适用时为 null） */
  runtimeAgentId: string | null;
  /** 关联的 Binding（不适用时为 null） */
  bindingId: string | null;
  /** 问题描述（运维语言） */
  description: string;
  /** 影响范围描述 */
  impact: string;
  /** 结构化证据数据（计数 / 时间戳 / 阈值等） */
  evidence: Record<string, unknown>;
  /** 建议运维操作 */
  suggestedAction: string;
  /** 检测时间戳 */
  detectedAt: number;
  /** Acknowledge 操作人；尚未 ack 时为 null */
  acknowledgedBy: string | null;
  /** Acknowledge 时间戳；尚未 ack 时为 null */
  acknowledgedAt: number | null;
};
