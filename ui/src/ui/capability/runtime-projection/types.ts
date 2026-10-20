/**
 * Runtime Projection Types — 企业端「能力使用管理」模块的业务语言类型定义。
 *
 * 模块定位：
 * 本文件是 `enterprise-capability-usage-management`（路由 tab `enterpriseUsageManagement`）
 * 的纯类型层，承载企业端面向 Enterprise_Admin 的业务对象（Robot / 安装关系 /
 * 使用视图 / 治理问题）。这些类型经由 `Runtime_Projection_Layer`
 * （`./projection.ts`）从 `platform-agent-runtime-center` 暴露的运行时类型
 * （`../runtime-canonical/types.ts` 中的 `RuntimeAgent` / `RuntimeCapabilityBinding`
 * / `RuntimeTelemetry` / `RuntimeHealth`）单向投影而来，再供 4 个子页（机器人能力
 * 视图 / 能力安装管理双视角 / 使用效果分析 / 使用治理）渲染消费。
 *
 * 三端语义边界（强制约束）：
 * - 员工端：机器人（Robot）— 使用 AI
 * - 企业端（本模块）：能力使用（Capability Usage）— 管理"能力如何被机器人使用"
 * - 平台端：代理（Agent / Runtime）— 运行"怎么执行"
 *
 * 字段纯净性（落实 Requirement 8.5、9.1、Property 3）：
 * 本模块所有业务类型在 TypeScript 编译期**不存在**以下任何运行时字段——
 * `runtimeAgentId`、`runtimeVersion`、`bindingId`、`bindingType`、`bindingState`、
 * `loadStrategy`、`routingPriority`、`fallbackBindingId`、`policy`、`hotReloadable`、
 * `cpu`、`memory`、`nodeId`、`presence`、`templateId`、`provider`、`modelRouting`、
 * `workflowJson`、`toolchain`、`qps`、`tps`、`latency`、`p95`、`p99`。
 * 投影函数（`./projection.ts`）必须以 `Pick<>` / 显式字段构造对象，禁止使用
 * `...spread` 透传运行时对象，确保新增运行时字段不会无意渗透到企业端。
 *
 * 设计准则（与 `enterprise-capability/types.ts` 保持一致的项目惯例）：
 * - 仅导出 `type` 别名，不使用 `interface`，便于与字面量对象自由组合
 * - 状态枚举使用字面量联合 + `as const` 数组双导出，方便类型系统与运行时迭代共用
 * - 不从本目录外引入任何依赖，保证纯类型层可独立编译复用
 * - 健康状态枚举仅允许 4 个业务效果文本 + 渲染期降级值 `"暂无数据"`，禁止
 *   出现 `healthy` / `degraded` / `unhealthy` / `unavailable` 等运行时原始枚举
 *
 * 关联文档：
 * - `.kiro/specs/enterprise-capability-usage-management/requirements.md`
 *   （Requirements 4.4 / 5.10 / 8.5 / 9.1 / 9.7 + Properties 1–10）
 * - `.kiro/specs/enterprise-capability-usage-management/design.md`
 *   §「Data Models」与「投影层禁止字段」
 */

// ─────────────────────────────────────────────────────────────────────────
// Health Status — 业务效果语言枚举（企业端唯一允许的健康状态文本）
// ─────────────────────────────────────────────────────────────────────────

/**
 * 健康状态（业务效果语言）。企业端**唯一**允许出现的 4 个文本枚举值。
 *
 * 与平台端 `RuntimeHealth` 的映射关系（落实 Requirement 8.2、Property 2）：
 * - `healthy`     → `"效果稳定"`
 * - `degraded`    → `"偶尔不理想"`
 * - `unhealthy`   → `"建议优化"`
 * - `unavailable` → `"已停用"`
 *
 * 任何未知 / null / undefined 平台值在投影层降级为渲染期占位 {@link HEALTH_STATUS_NO_DATA}，
 * 该占位**不**属于本枚举的合法成员（它仅用于 UI 兜底渲染，不参与业务计算）。
 */
export type HealthStatus = "效果稳定" | "偶尔不理想" | "建议优化" | "已停用";

/**
 * 渲染期降级占位文本。当上游运行时数据缺失或返回未知枚举值时，由投影层降级
 * 输出此文本（落实 Requirement 8.6、10.5、10.6、Property 2）。
 *
 * 严格区分：此值**不是** {@link HealthStatus} 的合法成员，仅在 UI 视图层使用，
 * 业务计算（如治理检测器、统计聚合）应将持有该值的记录视为"未知 / 无数据"。
 */
export const HEALTH_STATUS_NO_DATA = "暂无数据" as const;

/** {@link HEALTH_STATUS_NO_DATA} 的字面量类型，便于在联合类型中复用。 */
export type HealthStatusNoData = typeof HEALTH_STATUS_NO_DATA;

/**
 * `HealthStatus` 字面量数组（便于运行时迭代，例如下拉选项渲染、属性测试枚举）。
 * 顺序与产品文案中"由好到差再到停用"的展示约定保持一致。
 */
export const HEALTH_STATUSES = [
  "效果稳定",
  "偶尔不理想",
  "建议优化",
  "已停用",
] as const satisfies readonly HealthStatus[];

// ─────────────────────────────────────────────────────────────────────────
// Robot — 企业端机器人业务对象
// ─────────────────────────────────────────────────────────────────────────

/**
 * 机器人（Robot）— 企业端唯一展示的能力载体业务对象。
 *
 * 与平台端 `RuntimeAgent` 的关系（落实 Requirement 9.7）：
 * - `Robot.robotId === RuntimeAgent.runtimeAgentId`（贯穿三端的稳定 ID，类型一致）
 * - `Robot.robotName ← RuntimeAgent.name`
 * - `Robot.healthStatus ← projectRuntimeHealthToEnterprise(RuntimeAgent.health)`
 * - `Robot.lastActiveAt ← RuntimeAgent.lastActiveAt`
 *
 * 严格不存在以下运行时字段：`runtimeAgentId` / `runtimeVersion` /
 * `lifecycle` / `tenantCoverage` / `boundCapabilityCount` / `activeSessionCount` /
 * `resourceUsage`（包含 `cpu` / `memory` / `tokenBudgetUsedPercent`）/
 * `deployedAt`。
 */
export type Robot = {
  /** 机器人业务 ID（与 `RuntimeAgent.runtimeAgentId` 同值不同名） */
  robotId: string;
  /** 机器人显示名称 */
  robotName: string;
  /** 健康状态（4 业务文本之一，或上游缺失时降级为 `"暂无数据"`） */
  healthStatus: HealthStatus | HealthStatusNoData;
  /** 最近活跃时间（毫秒时间戳） */
  lastActiveAt: number;
};

// ─────────────────────────────────────────────────────────────────────────
// Install Relation Enhanced — 能力安装管理双视角共用的安装关系
// ─────────────────────────────────────────────────────────────────────────

/**
 * 安装关系业务来源。来自 `RuntimeCapabilityBinding.bindingType` 的业务投影：
 * - `tenant-installed`  → `"员工沉淀"`
 * - `platform-default`  → `"企业发布"`
 *
 * 平台端的 `dynamic-runtime` / `fallback` 不投影到企业端（属于运行时内部决策，
 * 业务管理员不感知）。
 */
export type InstallRelationBusinessSource = "员工沉淀" | "企业发布";

export const INSTALL_RELATION_BUSINESS_SOURCES = [
  "员工沉淀",
  "企业发布",
] as const satisfies readonly InstallRelationBusinessSource[];

/**
 * 安装关系业务状态。来自 `RuntimeCapabilityBinding.bindingState` 与
 * `healthStatus` 的复合投影：
 * - `active` + `healthy` / `degraded`  → `"正常"`
 * - `active` + `unhealthy`             → `"待优化"`
 * - `disabled` / `unavailable`         → `"已停用"`
 *
 * 平台端的 `warming` 视为过渡态，对外展示为 `"正常"`（避免暴露热加载等运行时细节）。
 */
export type InstallRelationStatus = "正常" | "待优化" | "已停用";

export const INSTALL_RELATION_STATUSES = [
  "正常",
  "待优化",
  "已停用",
] as const satisfies readonly InstallRelationStatus[];

/**
 * 安装关系 30 日使用统计。仅承载业务层关心的两项指标：调用量与成功率。
 *
 * 严格不存在以下运行时指标字段：`avgLatencyMs` / `p95LatencyMs` / `errorCount7d` /
 * `tokenConsumption7d` / `qps` / `tps` / `latency` / `p95` / `p99`。
 */
export type InstallRelationUsageStats = {
  /** 最近 30 天调用次数（成功 + 失败合计） */
  executions30d: number;
  /** 最近 30 天成功率，归一化到 [0, 1]（展示层负责格式化为百分比） */
  successRate: number;
};

/**
 * 安装关系（增强版）— 「能力安装管理」双视角子页共用的数据结构。
 *
 * 与平台端 `RuntimeCapabilityBinding` 的关系（落实 Requirement 5.10、9.1）：
 * - `id` 等价于 `binding.bindingId`（不在 UI 上展示，仅作 React key / 卸载请求）
 * - `source` ← `bindingType` 的业务投影
 * - `status` ← `bindingState` × `healthStatus` 的复合投影
 * - `usageStats` ← `invocationMetrics` / `RuntimeTelemetry` 的业务指标投影
 *
 * 严格不存在以下运行时字段：`bindingId` 暴露字段（仅内部 `id`）/ `bindingType` /
 * `bindingState` / `loadStrategy` / `routingPriority` / `fallbackBindingId` /
 * `policy`（包含 `hotReloadable` / `sandbox` / `resourceQuota`）/
 * `capabilityVersion` / `runtimeAgentId`。
 */
export type InstallRelationEnhanced = {
  /** 关系唯一标识（内部使用，不在视图上以"binding"等运行时术语暴露） */
  id: string;
  /** 关联能力 ID（与企业能力中心 `EnterpriseCapabilityAsset.id` 同值） */
  capabilityId: string;
  /** 关联能力名称 */
  capabilityName: string;
  /** 关联机器人 ID（与 `Robot.robotId` 同值） */
  robotId: string;
  /** 关联机器人名称 */
  robotName: string;
  /** 安装时间（毫秒时间戳） */
  installedAt: number;
  /** 业务来源（员工沉淀 / 企业发布） */
  source: InstallRelationBusinessSource;
  /** 30 日使用统计（仅业务指标） */
  usageStats: InstallRelationUsageStats;
  /** 业务状态（正常 / 待优化 / 已停用） */
  status: InstallRelationStatus;
};

// ─────────────────────────────────────────────────────────────────────────
// Robot Capability Usage View — 机器人能力视图主表格行
// ─────────────────────────────────────────────────────────────────────────

/**
 * 机器人能力视图行 — 「机器人能力视图」子页主表格的展示数据。
 *
 * 字段聚合规则（落实 Requirement 4.4、Property 4）：
 * - `capabilityCount` = 该机器人下 `status ∈ {"正常", "待优化"}` 的安装关系中
 *   去重 `capabilityId` 数量（`"已停用"` 状态不计入）
 * - `monthlyExecutions` = 该机器人本月所有安装关系调用量之和
 * - `employeeCoverage` = 最近 30 天通过该机器人发起过 ≥ 1 次会话的去重员工数
 * - `successRate` = 最近 30 天成功调用次数 / 总调用次数（[0, 1]）
 * - `topCapabilities` = 按本月调用量降序排列的能力名称，最多 3 个
 *
 * 通过 `Pick<>` 复用 {@link Robot} 中已经过投影的业务字段，确保 `robotId` /
 * `robotName` 与机器人详情面板等其它视图的字段定义保持单一真理源；同时
 * `Pick<>` 的允许列表机制保证将来在 `Robot` 上无意添加的字段不会自动出现在本类型中。
 */
export type RobotCapabilityUsageView = Pick<Robot, "robotId" | "robotName"> & {
  /** 已安装能力数（去重，且 `status ∈ {"正常", "待优化"}`） */
  capabilityCount: number;
  /** 本月调用量 */
  monthlyExecutions: number;
  /** 覆盖员工数（最近 30 天去重） */
  employeeCoverage: number;
  /** 成功率，归一化到 [0, 1] */
  successRate: number;
  /** 健康状态（4 业务文本之一，或降级为 `"暂无数据"`） */
  healthStatus: HealthStatus | HealthStatusNoData;
  /** Top 3 能力名称（按本月调用量降序，最多 3 个） */
  topCapabilities: string[];
};

// ─────────────────────────────────────────────────────────────────────────
// Robot Detail — 机器人详情面板数据
// ─────────────────────────────────────────────────────────────────────────

/**
 * 详情面板·能力列表行。
 *
 * 严格不存在以下运行时字段：`capabilityVersion` / `bindingId` / `bindingState` /
 * `loadStrategy` / `policy` / `runtimeAgentId`。
 */
export type RobotDetailCapability = {
  capabilityId: string;
  capabilityName: string;
  monthlyExecutions: number;
  /** 成功率，归一化到 [0, 1] */
  successRate: number;
};

/**
 * 详情面板·30 天调用趋势。仅承载业务展示所需的日期 + 当日调用量序列；
 * 严格不存在以下运行时指标：`avgLatencyMs` / `p95LatencyMs` / `errorCount` /
 * `tokenConsumption` / `qps` / `tps` / `latency` / `p95` / `p99`。
 */
export type RobotDetailTrend30d = {
  /** 日期序列（ISO 字符串，长度 = 30） */
  dates: string[];
  /** 每日调用量（长度与 `dates` 一致） */
  dailyExecutions: number[];
};

/**
 * 机器人详情（落实 Requirement 4.7、4.8）。
 *
 * 通过 `Pick<>` 自 {@link Robot} 取"基础信息"分区的全部字段，**严格**避免引入
 * `runtimeVersion` / `cpu` / `memory` / `nodeId` / `runtimeAgentId` / `templateId` /
 * `provider` / `modelRouting` / `workflowJson` / `toolchain` 等任何运行时字段
 * （这些字段在 {@link Robot} 类型上本就不存在，`Pick<>` 又再加一层显式允许列表，
 * 实现编译期 + 设计期双重保证）。
 */
export type RobotDetail = Pick<Robot, "robotId" | "robotName" | "healthStatus" | "lastActiveAt"> & {
  /** 能力列表分区：该机器人当前安装的全部能力（含每条能力的本月调用量与成功率） */
  capabilities: RobotDetailCapability[];
  /** 使用统计·近 30 天调用趋势 */
  trend30d: RobotDetailTrend30d;
  /** 使用统计·覆盖员工数（最近 30 天去重） */
  employeeCoverage: number;
  /** 使用统计·Top 3 能力名称（按本月调用量降序，最多 3 个） */
  topCapabilities: string[];
};

// ─────────────────────────────────────────────────────────────────────────
// Governance — 使用治理（低效 / 未使用 / 冲突 三类问题）
// ─────────────────────────────────────────────────────────────────────────

/**
 * 治理问题类型（业务语言三类）。
 *
 * 严格不展示以下平台层治理类型（归属 `platform-agent-runtime-center`）：
 * `runtime overcommit` / `orphaned agent` / `version drift` /
 * `fallback chain broken` / `zombie binding` / `sandbox violation` /
 * `capability conflict`（运行时层定义）。
 */
export type GovernanceIssueType = "低效能力" | "未使用能力" | "冲突能力";

export const GOVERNANCE_ISSUE_TYPES = [
  "低效能力",
  "未使用能力",
  "冲突能力",
] as const satisfies readonly GovernanceIssueType[];

/**
 * 治理问题建议操作（业务语言）。
 * - `卸载`              → 触发 `enterprise-capability.uninstall`
 * - `重新整理能力`      → 跳转至能力详情页
 * - `转移到其他机器人`  → 展示机器人选择对话框
 */
export type GovernanceSuggestion = "卸载" | "重新整理能力" | "转移到其他机器人";

export const GOVERNANCE_SUGGESTIONS = [
  "卸载",
  "重新整理能力",
  "转移到其他机器人",
] as const satisfies readonly GovernanceSuggestion[];

/**
 * 治理问题证据。仅承载用于业务展示与边界判定的纯数值字段，**禁止**承载
 * 错误堆栈、原始枚举、运行时指标（`latency` / `p95` / `cpu` / `memory` 等）。
 *
 * 字段语义：
 * - `executions30d`：低效 / 僵尸判定使用的最近 30 天调用次数
 * - `successRate`：低效判定使用的成功率（[0, 1]）
 * - `installDays`：僵尸判定使用的安装时长（整数天）
 * - `similarity`：冲突判定使用的描述余弦相似度（[0, 1]）
 * - `conflictWith`：冲突判定中与本能力构成冲突的其它能力 ID 列表
 */
export type GovernanceIssueEvidence = {
  executions30d?: number;
  successRate?: number;
  installDays?: number;
  similarity?: number;
  conflictWith?: string[];
};

/**
 * 治理问题对象 — 三类问题的统一形态。
 *
 * `issueId` 由 `(type + capabilityId + robotId)` 派生（确定性），同一问题在
 * 不同检测周期保持稳定，便于会话内 acknowledge 去重（落实 Property 6 的
 * 幂等性要求；acknowledge 自身仅存在于 controller 内存中、不持久化，详见
 * Requirement 7.8）。
 *
 * 严格不存在以下运行时字段：`bindingId` / `runtimeAgentId` / `severity`
 * （平台层概念）/ `evidence.queueDepth` / `evidence.memoryPressure` 等。
 *
 * `description` 在投影层产生前必须经过术语黑名单扫描（业务语言守卫，
 * 详见 `./term-blacklist.ts` 与 Property 1）。
 */
export type GovernanceIssue = {
  /** 由 `(type + capabilityId + robotId)` 派生的稳定问题 ID */
  issueId: string;
  /** 问题类型（业务语言三类） */
  type: GovernanceIssueType;
  /** 关联能力 ID */
  capabilityId: string;
  /** 关联机器人 ID */
  robotId: string;
  /** 问题描述（业务语言；产生前已经过术语扫描） */
  description: string;
  /** 建议操作 */
  suggestion: GovernanceSuggestion;
  /** 证据数据（纯数值，非业务语言风险点） */
  evidence: GovernanceIssueEvidence;
  /** 检测时间（毫秒时间戳） */
  detectedAt: number;
};

/**
 * 治理检测器配置阈值。由阈值配置面板（`governance-threshold-panel.ts`）
 * 维护，对 `detectGovernanceIssues` 纯函数实时生效（落实 Requirement 7.6）。
 *
 * 边界规则（落实 Property 6，**严格**比较）：
 * - 低效能力：`executions30d > minExecutions && successRate < maxSuccessRate`
 *   （等于阈值不上榜：例如 50 调用 + 70% 成功率 → 不触发）
 * - 僵尸能力：`executions30d === 0 && installDays > minInstallDays`
 *   （等于阈值不上榜：例如安装 30 天 + 0 调用 → 不触发）
 * - 冲突能力：同一 `robotId` 下 `domain` 相同 + 描述余弦相似度 `>= minSimilarity`
 *   （此处含等号；与"上榜失败侧严格越界"语义自洽）
 */
export type GovernanceConfig = {
  /** 低效能力阈值（默认 minExecutions = 50, maxSuccessRate = 0.7） */
  lowEfficiency: {
    /** 最小调用量；严格大于此值才进入低效判定的"调用量充分"前提 */
    minExecutions: number;
    /** 最大成功率；严格小于此值才被判定为低效（[0, 1]） */
    maxSuccessRate: number;
  };
  /** 僵尸能力阈值（默认 minInstallDays = 30） */
  zombie: {
    /** 最小安装天数；严格大于此值才被判定为僵尸 */
    minInstallDays: number;
  };
  /** 冲突能力阈值（默认 minSimilarity = 0.8） */
  conflict: {
    /** 最小描述相似度；大于等于此值才被判定为冲突（[0, 1]） */
    minSimilarity: number;
  };
};

/**
 * 治理检测器默认阈值配置。
 *
 * 默认值与 Requirement 7.6 一致：
 * - 低效成功率阈值：70%
 * - 低效调用量阈值：50
 * - 僵尸天数阈值：30
 * - 冲突相似度阈值：0.8
 */
export const DEFAULT_GOVERNANCE_CONFIG: GovernanceConfig = {
  lowEfficiency: { minExecutions: 50, maxSuccessRate: 0.7 },
  zombie: { minInstallDays: 30 },
  conflict: { minSimilarity: 0.8 },
};
