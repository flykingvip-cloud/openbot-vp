/**
 * Gateway RPC endpoint definitions for the Platform Agent Runtime Center.
 *
 * 该模块声明 Agent Runtime Center 与后端 Gateway 之间的 RPC 命名空间
 * `agent-runtime.*`，并以类型安全的 Request / Response 形式描述每个端点的
 * 输入输出契约。
 *
 * 关键约束：
 * - 端点的所有响应类型仅承载 `runtime-canonical/types.ts` 中定义的运行时层模型，
 *   **禁止**直接暴露给员工端 / 企业端；下游层只能通过 `projection.ts` 中的纯
 *   函数消费这些响应。
 * - 端点请求中可以接受运行时层枚举（例如 `RuntimeLifecycle`、`BindingType`），
 *   因为这些操作只能由平台运维人员发起。
 *
 * 设计准则：
 * - 仅使用 `type` 别名（不使用 `interface`），保证可与字面量对象自由组合
 * - 类型从 `../runtime-canonical` 桶导出引入，单一真相来源
 * - 每个端点均有配对的 Request / Response 类型，方便客户端封装
 */

import type {
  BindingState,
  BindingType,
  GovernanceDetectorConfig,
  LoadStrategy,
  RuntimeAgent,
  RuntimeCapabilityBinding,
  RuntimeGovernanceIssue,
  RuntimeGovernanceIssueCategory,
  RuntimeGovernanceIssueSeverity,
  RuntimeHealth,
  RuntimeLifecycle,
  RuntimeTelemetry,
} from "../runtime-canonical/index.ts";

// ─────────────────────────────────────────────────────────────────────────
// Endpoint 名常量
// ─────────────────────────────────────────────────────────────────────────

/**
 * Agent Runtime Center 的 RPC 方法名常量表。
 *
 * 命名空间约定为 `agent-runtime.*`，与企业端 `enterprise-capability.*`、
 * 员工端 `employee-capability.*` 严格隔离。
 */
export const AGENT_RUNTIME_ENDPOINTS = {
  // Runtime Catalog
  listAgents: "agent-runtime.list-agents",
  getAgent: "agent-runtime.get-agent",

  // Capability Bindings
  listBindings: "agent-runtime.list-bindings",
  getBinding: "agent-runtime.get-binding",
  seed: "agent-runtime.seed",
  upsertBinding: "agent-runtime.upsert-binding",
  createBinding: "agent-runtime.create-binding",
  updateBindingState: "agent-runtime.update-binding-state",
  updateBindingPriority: "agent-runtime.update-binding-priority",
  updateBindingStrategy: "agent-runtime.update-binding-strategy",
  deleteBinding: "agent-runtime.delete-binding",

  // Runtime Health
  listTelemetry: "agent-runtime.list-telemetry",
  getHealthSummary: "agent-runtime.get-health-summary",

  // Deployment Lifecycle
  updateLifecycle: "agent-runtime.update-lifecycle",
  getLifecycleHistory: "agent-runtime.get-lifecycle-history",

  // Governance
  listGovernanceIssues: "agent-runtime.list-governance-issues",
  acknowledgeIssue: "agent-runtime.acknowledge-issue",
  getGovernanceConfig: "agent-runtime.get-governance-config",
  updateGovernanceConfig: "agent-runtime.update-governance-config",

  // KPI 卡片
  getRuntimeKpi: "agent-runtime.get-runtime-kpi",
} as const;

/** Agent Runtime Center 全部 RPC 方法名的字面量联合类型。 */
export type AgentRuntimeEndpoint =
  (typeof AGENT_RUNTIME_ENDPOINTS)[keyof typeof AGENT_RUNTIME_ENDPOINTS];

// ─────────────────────────────────────────────────────────────────────────
// Runtime Catalog
// ─────────────────────────────────────────────────────────────────────────

/**
 * 列出 Agent Runtime 实例。可按生命周期、健康、租户筛选；为简化分页接入，
 * 当前版本不支持分页（fleet 规模在治理台可控范围内），后续如需可向 Request
 * 增补 PaginationInput。
 */
export type ListAgentsRequest = {
  lifecycle: RuntimeLifecycle | null;
  health: RuntimeHealth | null;
  /** 按租户 ID 过滤；返回 `tenantCoverage` 包含该 ID 的 Agent。 */
  tenantId: string | null;
  /** 按 Agent 名称做大小写不敏感的子串匹配。 */
  searchQuery: string;
};

export type ListAgentsResponse = {
  agents: RuntimeAgent[];
};

export type GetAgentRequest = {
  runtimeAgentId: string;
};

export type GetAgentResponse = {
  agent: RuntimeAgent;
  bindings: RuntimeCapabilityBinding[];
};

// ─────────────────────────────────────────────────────────────────────────
// Capability Bindings
// ─────────────────────────────────────────────────────────────────────────

export type ListBindingsRequest = {
  runtimeAgentId: string | null;
  capabilityId: string | null;
  bindingType: BindingType | null;
  bindingState: BindingState | null;
  health: RuntimeHealth | null;
};

export type ListBindingsResponse = {
  bindings: RuntimeCapabilityBinding[];
};

export type GetBindingRequest = {
  bindingId: string;
};

export type GetBindingResponse = {
  binding: RuntimeCapabilityBinding;
  /** 关联的 Agent 名称（用于详情视图直接展示，避免再发一次请求）。 */
  agentName: string;
  /** 关联的 Capability 名称（同上）。 */
  capabilityName: string;
};

export type SeedRuntimeRequest = Record<string, never>;

export type SeedRuntimeResponse = {
  seeded: boolean;
  agentCount: number;
  bindingCount: number;
  tenantCount: number;
  reason?: string;
};

/**
 * 创建运行时绑定。
 *
 * 业务约束（后端实施）：
 * - 同一 (runtimeAgentId, capabilityId) 不允许重复活跃绑定
 * - 当 `bindingType === "tenant-installed"` 时表示由企业端"安装到机器人"反向触发；
 *   此时 `loadStrategy` 默认 `lazy`，`bindingState` 默认 `active`
 * - 其他类型由平台管理员显式创建
 */
export type CreateBindingRequest = {
  runtimeAgentId: string;
  capabilityId: string;
  capabilityVersion: string;
  bindingType: BindingType;
  loadStrategy: LoadStrategy;
  /** 可选；不指定时使用平台默认（数值由后端决定）。 */
  routingPriority: number | null;
  /** 可选；不指定时由后端补默认策略。 */
  policy: { sandbox: string; resourceQuota: string; hotReloadable: boolean } | null;
  /** 可选；指定降级备选 binding。 */
  fallbackBindingId: string | null;
};

export type CreateBindingResponse = {
  binding: RuntimeCapabilityBinding;
};

export type UpsertBindingRequest = CreateBindingRequest;

export type UpsertBindingResponse = {
  binding: RuntimeCapabilityBinding;
};

export type UpdateBindingStateRequest = {
  bindingId: string;
  bindingState: BindingState;
};

export type UpdateBindingStateResponse = {
  binding: RuntimeCapabilityBinding;
};

export type UpdateBindingPriorityRequest = {
  bindingId: string;
  routingPriority: number;
};

export type UpdateBindingPriorityResponse = {
  binding: RuntimeCapabilityBinding;
};

export type UpdateBindingStrategyRequest = {
  bindingId: string;
  loadStrategy: LoadStrategy;
};

export type UpdateBindingStrategyResponse = {
  binding: RuntimeCapabilityBinding;
};

export type DeleteBindingRequest = {
  bindingId: string;
};

export type DeleteBindingResponse = {
  bindingId: string;
  deleted: boolean;
};

// ─────────────────────────────────────────────────────────────────────────
// Runtime Health
// ─────────────────────────────────────────────────────────────────────────

/** 时间窗口标识，对应 UI 顶部的时间范围切换。 */
export type TelemetryWindow = "1h" | "6h" | "24h" | "7d" | "30d";

export type ListTelemetryRequest = {
  runtimeAgentId: string | null;
  capabilityId: string | null;
  window: TelemetryWindow;
};

export type ListTelemetryResponse = {
  samples: RuntimeTelemetry[];
};

/** Agent / Binding 的健康摘要（含分组计数 + 异常列表，供 Health 标签页直接渲染）。 */
export type GetHealthSummaryRequest = {
  window: TelemetryWindow;
};

export type GetHealthSummaryResponse = {
  /** 各健康状态的 Agent 计数（用于顶部分组数字）。 */
  agentCountByHealth: Record<RuntimeHealth, number>;
  /** 各健康状态的 Binding 计数。 */
  bindingCountByHealth: Record<RuntimeHealth, number>;
  /** 当前非 healthy 的异常详情（已按严重度排序）。 */
  unhealthyAgents: RuntimeAgent[];
  unhealthyBindings: RuntimeCapabilityBinding[];
};

// ─────────────────────────────────────────────────────────────────────────
// Deployment Lifecycle
// ─────────────────────────────────────────────────────────────────────────

export type UpdateLifecycleRequest = {
  runtimeAgentId: string;
  targetLifecycle: RuntimeLifecycle;
  /** 操作原因（运维语言，留作审计日志）。 */
  reason: string;
};

export type UpdateLifecycleResponse = {
  agent: RuntimeAgent;
  /** 转换被拒绝时返回原因；成功时为 null。 */
  rejectionReason: string | null;
  /** 影响评估快照（受影响的 binding 数 / 活跃会话 / 租户 / 是否触发 Projection 通知）。 */
  impact: {
    affectedBindingCount: number;
    activeSessionCount: number;
    affectedTenantCount: number;
    /** 转换是否会触发企业端 / 员工端的"即将下线"或"已下线"投影通知。 */
    triggersDownstreamNotification: boolean;
  };
};

export type LifecycleEvent = {
  id: string;
  runtimeAgentId: string;
  fromLifecycle: RuntimeLifecycle;
  toLifecycle: RuntimeLifecycle;
  actor: string;
  reason: string;
  timestamp: number;
};

export type GetLifecycleHistoryRequest = {
  runtimeAgentId: string;
};

export type GetLifecycleHistoryResponse = {
  events: LifecycleEvent[];
};

// ─────────────────────────────────────────────────────────────────────────
// Governance & Policy
// ─────────────────────────────────────────────────────────────────────────

export type ListGovernanceIssuesRequest = {
  category: RuntimeGovernanceIssueCategory | null;
  severity: RuntimeGovernanceIssueSeverity | null;
  /** 是否包含已 acknowledge 的问题；默认 false。 */
  includeAcknowledged: boolean;
};

export type ListGovernanceIssuesResponse = {
  issues: RuntimeGovernanceIssue[];
};

export type AcknowledgeIssueRequest = {
  issueId: string;
  /** Acknowledge 操作人标识（运维登录 ID）。 */
  reviewerId: string;
  /** 可选备注；保存到审计日志。 */
  note: string | null;
};

export type AcknowledgeIssueResponse = {
  issue: RuntimeGovernanceIssue;
};

export type GetGovernanceConfigRequest = Record<string, never>;

export type GetGovernanceConfigResponse = {
  config: GovernanceDetectorConfig;
};

export type UpdateGovernanceConfigRequest = {
  config: Partial<GovernanceDetectorConfig>;
};

export type UpdateGovernanceConfigResponse = {
  config: GovernanceDetectorConfig;
};

// ─────────────────────────────────────────────────────────────────────────
// Runtime KPI
// ─────────────────────────────────────────────────────────────────────────

/**
 * Runtime KPI — 顶部 5 张卡片所需的全部摘要数据。
 *
 * 字段语义：
 * - `agentCountByLifecycle`     按生命周期分组的 Agent 数量
 * - `agentCountTotal`           总 Agent 数（= 上一字段值之和）
 * - `bindingCountTotal`         总绑定数
 * - `bindingCountByState`       按 BindingState 分组
 * - `bindingCountByType`        按 BindingType 分组
 * - `avgBindingsPerAgent`       每 Agent 平均绑定数（精度 1 位小数）
 * - `healthyAgentRatio`         健康率（healthy 占总数的归一化比例 [0,1]）
 * - `tenantCoverageTotal`       覆盖租户总数（已去重）
 * - `activeSessionCount`        活跃会话总数
 */
export type RuntimeKpiData = {
  agentCountTotal: number;
  agentCountByLifecycle: Record<RuntimeLifecycle, number>;
  bindingCountTotal: number;
  bindingCountByState: Record<BindingState, number>;
  bindingCountByType: Record<BindingType, number>;
  avgBindingsPerAgent: number;
  healthyAgentRatio: number;
  tenantCoverageTotal: number;
  activeSessionCount: number;
};

export type GetRuntimeKpiRequest = Record<string, never>;

export type GetRuntimeKpiResponse = {
  kpi: RuntimeKpiData;
};
