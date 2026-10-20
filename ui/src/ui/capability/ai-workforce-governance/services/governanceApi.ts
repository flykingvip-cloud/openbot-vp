/**
 * Governance API Service
 * Frontend API client for AI Workforce Governance backend.
 */

import type { GatewayBrowserClient } from "../../../gateway.ts";
import type { EvolutionLineageEvent, EvolutionLineageProposal } from "../evolution-lineage.ts";
import type {
  AssetListItem,
  AssetFilters,
  AssetSortConfig,
  PaginationState,
  Anomaly,
  AnomalyFilters,
  AssetDetail,
  DashboardStats,
  GovernanceActionResult,
  GovernanceActionType,
  MeshGrowthAggregateView,
  PerformanceGrowthBlend,
  RankingView,
  AssetScore,
  ScoreHistoryPoint,
  GovernanceActionRecord,
  GovernanceActionStatus,
  WorkingStyleEffectItem,
  WorkingStyleEffectivenessAggregate,
} from "../types/index.ts";

let governanceClient: GatewayBrowserClient | null = null;

export function setGovernanceApiClient(client: GatewayBrowserClient | null | undefined) {
  governanceClient = client ?? null;
}

export function isGovernanceGatewayReady() {
  return Boolean(governanceClient?.connected);
}

async function requestGateway<T>(method: string, params: unknown): Promise<T | null> {
  if (!governanceClient?.connected) {
    return null;
  }
  try {
    return await governanceClient.request<T>(method, params);
  } catch (err) {
    console.warn(`[governance] ${method} unavailable; using local fallback`, err);
    return null;
  }
}

// ============================================================================
// Legacy Mock Data Fallback
// NOTE: Enterprise mesh page should prefer gateway data or readModel fallback.
// These mocks are kept only for non-enterprise standalone development paths.
// ============================================================================

const MOCK_DELAY = 150;

const mockAssets: AssetListItem[] = [
  {
    id: "bot_001",
    name: "Customer Support Bot",
    type: "bot",
    status: "active",
    position: "Support Team",
    owner: "Alice Johnson",
    metrics: { taskCount: 1250, successRate: 0.98, avgLatency: 850, totalCost: 32.5 },
    riskLevel: "low",
    activeAnomalyCount: 0,
  },
  {
    id: "bot_002",
    name: "Sales Assistant",
    type: "bot",
    status: "active",
    position: "Sales Team",
    owner: "Bob Smith",
    metrics: { taskCount: 890, successRate: 0.92, avgLatency: 1200, totalCost: 28.3 },
    riskLevel: "medium",
    activeAnomalyCount: 1,
  },
  {
    id: "bot_003",
    name: "Data Processing Bot",
    type: "bot",
    status: "paused",
    position: "Engineering",
    owner: "David Lee",
    metrics: { taskCount: 2100, successRate: 0.65, avgLatency: 3200, totalCost: 45.8 },
    riskLevel: "high",
    activeAnomalyCount: 3,
  },
  {
    id: "group_001",
    name: "Marketing Group",
    type: "group",
    status: "active",
    position: "Marketing",
    owner: "Carol White",
    memberCount: 12,
    metrics: { taskCount: 450, successRate: 0.95, avgLatency: 1500, totalCost: 15.2 },
    riskLevel: "low",
    activeAnomalyCount: 0,
  },
];

const mockRanking: RankingView = {
  type: "bot",
  items: [
    {
      id: "bot_001",
      name: "Customer Support Bot",
      type: "bot",
      score: 87,
      rank: 1,
      metrics: { taskCount: 1250, successRate: 0.98, avgCost: 0.026 },
    },
    {
      id: "bot_002",
      name: "Sales Assistant",
      type: "bot",
      score: 76,
      rank: 2,
      metrics: { taskCount: 890, successRate: 0.92, avgCost: 0.032 },
    },
    {
      id: "bot_003",
      name: "Data Processing Bot",
      type: "bot",
      score: 45,
      rank: 3,
      metrics: { taskCount: 2100, successRate: 0.65, avgCost: 0.022 },
    },
  ],
  total: 3,
  generatedAt: new Date().toISOString(),
};

const mockScores: AssetScore[] = [
  {
    assetId: "bot_001",
    name: "Customer Support Bot",
    type: "bot",
    score: 87,
    breakdown: { efficiency: 90, cost: 85, stability: 85 },
    rank: 1,
    metrics: { taskCount: 1250, successRate: 0.98, costPerTask: 0.026, failRate: 0.02 },
  },
  {
    assetId: "bot_002",
    name: "Sales Assistant",
    type: "bot",
    score: 76,
    breakdown: { efficiency: 80, cost: 75, stability: 72 },
    rank: 2,
    metrics: { taskCount: 890, successRate: 0.92, costPerTask: 0.032, failRate: 0.08 },
  },
  {
    assetId: "bot_003",
    name: "Data Processing Bot",
    type: "bot",
    score: 45,
    breakdown: { efficiency: 50, cost: 40, stability: 45 },
    rank: 3,
    metrics: { taskCount: 2100, successRate: 0.65, costPerTask: 0.022, failRate: 0.35 },
  },
];

const mockGovernanceActions: GovernanceActionRecord[] = [
  {
    id: "action_001",
    assetId: "bot_003",
    assetName: "Data Processing Bot",
    action: "pause",
    trigger: "auto_governance",
    reason: "空跑2天，自动暂停",
    status: "executed",
    executedAt: "2026-05-30T10:00:00Z",
    createdAt: "2026-05-30T10:00:00Z",
  },
  {
    id: "action_002",
    assetId: "bot_002",
    assetName: "Sales Assistant",
    action: "notify_admin",
    trigger: "auto_governance",
    reason: "成本暴涨35%",
    status: "pending",
    createdAt: "2026-05-30T09:30:00Z",
  },
];

// ============================================================================
// API Functions
// ============================================================================

export async function fetchAssets(
  filters: AssetFilters,
  pagination: { page: number; pageSize: number },
  sort: AssetSortConfig,
): Promise<{ items: AssetListItem[]; pagination: PaginationState }> {
  const gatewayResult = await requestGateway<{
    items?: AssetListItem[];
    pagination?: PaginationState;
  }>("governance.assets.list", { filters, pagination, sorting: sort });
  if (gatewayResult?.items && gatewayResult.pagination) {
    return {
      items: gatewayResult.items.map(normalizeAssetListItem),
      pagination: gatewayResult.pagination,
    };
  }

  await delay(MOCK_DELAY);

  let filtered = mockAssets.map(normalizeAssetListItem);

  if (filters.type) {
    filtered = filtered.filter((a) => a.type === filters.type);
  }
  if (filters.status) {
    filtered = filtered.filter((a) => a.status === filters.status);
  }
  if (filters.riskLevel) {
    filtered = filtered.filter((a) => a.riskLevel === filters.riskLevel);
  }
  if (filters.search) {
    const query = filters.search.toLowerCase();
    filtered = filtered.filter(
      (a) =>
        a.name.toLowerCase().includes(query) ||
        (a.position?.toLowerCase().includes(query) ?? false) ||
        (a.owner?.toLowerCase().includes(query) ?? false),
    );
  }

  // Sort
  filtered.sort((a, b) => {
    let comparison = 0;
    switch (sort.field) {
      case "cost":
        comparison = a.metrics.totalCost - b.metrics.totalCost;
        break;
      case "task":
        comparison = a.metrics.taskCount - b.metrics.taskCount;
        break;
      case "success_rate":
        comparison = a.metrics.successRate - b.metrics.successRate;
        break;
      default:
        comparison = a.name.localeCompare(b.name);
    }
    return sort.direction === "desc" ? -comparison : comparison;
  });

  const total = filtered.length;
  const offset = (pagination.page - 1) * pagination.pageSize;
  const paginated = filtered.slice(offset, offset + pagination.pageSize);

  return {
    items: paginated,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.ceil(total / pagination.pageSize),
    },
  };
}

export async function fetchAssetDetail(assetId: string): Promise<AssetDetail | null> {
  const gatewayResult = await requestGateway<AssetDetail>("governance.assets.detail", { assetId });
  if (gatewayResult) {
    return gatewayResult;
  }

  await delay(MOCK_DELAY);
  const asset = mockAssets.find((a) => a.id === assetId);
  if (!asset) {
    return null;
  }

  return {
    asset: {
      ...asset,
      position: asset.position ? { id: "pos_001", title: asset.position } : null,
      owner: asset.owner
        ? {
            id: "user_001",
            name: asset.owner,
            email: `${asset.owner.toLowerCase().replace(/\s+/g, ".")}@company.com`,
          }
        : null,
      runtime: { id: asset.id.replace("_", "_rt_"), status: asset.status },
      createdAt: "2026-01-15T10:00:00Z",
      updatedAt: "2026-05-30T08:00:00Z",
    },
    metrics: {
      ...asset.metrics,
      avgCostPerTask: asset.metrics.totalCost / (asset.metrics.taskCount || 1),
      errorCount: asset.activeAnomalyCount * 2,
    },
    dailyMetrics: [
      {
        date: "2026-05-28",
        taskCount: 400,
        successRate: 0.96,
        avgLatencyMs: 900,
        totalCost: 10.5,
        costGrowthRate: 0.05,
      },
      {
        date: "2026-05-29",
        taskCount: 420,
        successRate: 0.95,
        avgLatencyMs: 920,
        totalCost: 11.2,
        costGrowthRate: 0.07,
      },
      {
        date: "2026-05-30",
        taskCount: 430,
        successRate: 0.92,
        avgLatencyMs: 1200,
        totalCost: 12.8,
        costGrowthRate: 0.14,
      },
    ],
    recentRuns: [
      {
        id: "run_001",
        taskId: "task_1234",
        startTime: "2026-05-30T10:00:00Z",
        endTime: "2026-05-30T10:00:05Z",
        durationMs: 5000,
        status: "success",
        errorCode: null,
        tokensInput: 150,
        tokensOutput: 80,
        cost: 0.02,
      },
      {
        id: "run_002",
        taskId: "task_1235",
        startTime: "2026-05-30T10:05:00Z",
        endTime: "2026-05-30T10:05:03Z",
        durationMs: 3000,
        status: "success",
        errorCode: null,
        tokensInput: 120,
        tokensOutput: 60,
        cost: 0.015,
      },
    ],
    activeAnomalies: [],
    riskLevel: asset.riskLevel,
    riskFactors: asset.riskLevel === "high" ? ["high failure rate", "cost spike"] : [],
  };
}

export async function executeGovernanceAction(
  assetId: string,
  action: GovernanceActionType,
  reason?: string,
): Promise<GovernanceActionResult> {
  const gatewayResult = await requestGateway<GovernanceActionResult>("governance.assets.action", {
    assetId,
    action,
    reason,
  });
  if (gatewayResult) {
    return gatewayResult;
  }

  await delay(300);
  return {
    success: true,
    action,
    appliedAt: new Date().toISOString(),
    message: `Asset ${assetId} ${action}d successfully${reason ? `: ${reason}` : ""}`,
  };
}

export async function fetchRanking(type: "bot" | "group" | "position"): Promise<RankingView> {
  const gatewayResult = await requestGateway<RankingView>("governance.ranking.get", {
    type,
    limit: 20,
  });
  if (gatewayResult) {
    return gatewayResult;
  }

  await delay(MOCK_DELAY);
  return { ...mockRanking, type };
}

export async function fetchScores(_filters?: {
  type?: "bot" | "group" | "position";
  period?: string;
}): Promise<AssetScore[]> {
  const ranking = await requestGateway<RankingView>("governance.ranking.get", {
    type: _filters?.type ?? "bot",
    limit: 20,
  });
  if (ranking?.items) {
    return ranking.items.map((item) => ({
      assetId: item.id,
      name: item.name,
      type: item.type,
      score: item.score,
      rank: item.rank,
      breakdown: {
        efficiency: item.score,
        cost: item.score,
        stability: item.score,
      },
      metrics: {
        taskCount: item.metrics.taskCount,
        successRate: item.metrics.successRate,
        costPerTask: item.metrics.avgCost,
        failRate: Math.max(0, 1 - item.metrics.successRate),
      },
    }));
  }

  await delay(MOCK_DELAY);
  return mockScores;
}

export async function fetchScoreHistory(_assetId: string): Promise<ScoreHistoryPoint[]> {
  await delay(MOCK_DELAY);
  return [
    { date: "2026-05-28", score: 85, rank: 2 },
    { date: "2026-05-29", score: 86, rank: 2 },
    { date: "2026-05-30", score: 87, rank: 1 },
  ];
}

export async function fetchGovernanceActions(filters?: {
  assetId?: string;
  status?: GovernanceActionStatus;
}): Promise<GovernanceActionRecord[]> {
  const gatewayResult = await requestGateway<{ items?: GovernanceActionRecord[] }>(
    "governance.actions.list",
    { filters },
  );
  if (gatewayResult?.items) {
    return gatewayResult.items;
  }

  await delay(MOCK_DELAY);
  let filtered = [...mockGovernanceActions];
  if (filters?.assetId) {
    filtered = filtered.filter((a) => a.assetId === filters.assetId);
  }
  if (filters?.status) {
    filtered = filtered.filter((a) => a.status === filters.status);
  }
  return filtered;
}

export async function executePendingAction(actionId: string): Promise<boolean> {
  // Enterprise mesh sets a client. A failed or disconnected call must not look successful.
  if (governanceClient) {
    const gatewayResult = await requestGateway<{ success?: boolean }>(
      "governance.actions.execute",
      {
        actionId,
      },
    );
    if (!gatewayResult) {
      return false;
    }
    return gatewayResult.success !== false;
  }

  await delay(300);
  const action = mockGovernanceActions.find((a) => a.id === actionId);
  if (action) {
    action.status = "executed";
    action.executedAt = new Date().toISOString();
  }
  return true;
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const gatewayResult = await requestGateway<DashboardStats>("governance.metrics.dashboard", {});
  if (gatewayResult) {
    return gatewayResult;
  }

  await delay(MOCK_DELAY);
  return {
    summary: { totalAssets: 42, activeAssets: 38, pausedAssets: 3, errorAssets: 1 },
    metrics: {
      totalTasksToday: 4560,
      totalCostToday: 125.8,
      avgSuccessRate: 0.94,
      totalAnomalies: 5,
      pendingAnomalies: 3,
    },
    riskDistribution: { low: 35, medium: 5, high: 2 },
    recentAnomalies: [],
  };
}

// ============================================================================
// Evolution runtime-closure snapshot (real durable governance)
// ============================================================================

export type EvolutionEffectVerification = {
  id: string;
  assetId: string;
  runtimeAgentId: string;
  reason: string;
  pausedAt: string;
  verifyAfterAt: string;
  status: "open" | "resumed" | "held" | "escalated";
  outcomeNote?: string;
};

export type SkillAutoInstallJobRow = {
  candidateId: string;
  agentId: string;
  skillId?: string;
  stage: string;
  lastError?: string;
  scanWarnings?: string[];
  healthWatchStartedAt?: string;
  healthWatchUntil?: string;
  updatedAt?: string;
  cancelReason?: string;
};

export type EvolutionGovernanceSnapshot = {
  killSwitch: boolean;
  /** off | assist | auto */
  mode?: string;
  /** Full skill auto-evolution (approve→publish→install). */
  skillAutoEvolution?: boolean;
  effectVerifications: EvolutionEffectVerification[];
  limits?: Record<string, unknown>;
  redirects?: Record<string, { targetAgentId: string; reason: string }>;
  /** Durable skill-auto install jobs (tenant-scoped in snapshot). */
  skillAutoJobs?: Record<string, SkillAutoInstallJobRow>;
  /**
   * Agents visible to this tenant (co-owned / shared) but not uniquely owned —
   * write actions require platform admin.
   */
  sharedAgentWriteDenied?: string[];
  attribution?: {
    totalAttributed: number;
    totalUnattributed: number;
    counts: Record<string, number>;
  };
  actions?: Array<{ action?: string; reason?: string; status?: string; assetId?: string }>;
  updatedAt?: string;
};

export async function fetchEvolutionGovernanceSnapshot(): Promise<EvolutionGovernanceSnapshot | null> {
  return requestGateway<EvolutionGovernanceSnapshot>("evolution-governance.snapshot", {});
}

export async function fetchEvolutionSurfaces(): Promise<unknown[] | null> {
  const result = await requestGateway<{ surfaces?: unknown[] }>("evolution.surfaces.list", {});
  return result?.surfaces ?? null;
}

export async function humanResumeEvolutionAgent(
  runtimeAgentId: string,
  reason?: string,
): Promise<boolean> {
  const result = await requestGateway<{ ok?: boolean }>("evolution-governance.human-resume", {
    runtimeAgentId,
    reason,
  });
  return Boolean(result);
}

export async function humanHoldEvolutionAgent(
  runtimeAgentId: string,
  reason?: string,
): Promise<boolean> {
  const result = await requestGateway<{ ok?: boolean }>("evolution-governance.human-hold", {
    runtimeAgentId,
    reason,
  });
  return Boolean(result);
}

export async function clearEvolutionLimit(runtimeAgentId: string): Promise<boolean> {
  const result = await requestGateway<{ ok?: boolean }>("evolution-governance.clear-limit", {
    runtimeAgentId,
  });
  return Boolean(result);
}

export async function applyEvolutionLimit(
  runtimeAgentId: string,
  reason?: string,
): Promise<boolean> {
  const result = await requestGateway<{ ok?: boolean }>("evolution-governance.apply-limit", {
    runtimeAgentId,
    reason,
  });
  return Boolean(result?.ok);
}

export async function applyEvolutionRedirect(
  runtimeAgentId: string,
  targetAgentId: string,
  reason?: string,
): Promise<boolean> {
  const result = await requestGateway<{ ok?: boolean }>("evolution-governance.apply-redirect", {
    runtimeAgentId,
    targetAgentId,
    reason,
  });
  return Boolean(result?.ok);
}

export async function clearEvolutionRedirect(runtimeAgentId: string): Promise<boolean> {
  const result = await requestGateway<{ ok?: boolean }>("evolution-governance.clear-redirect", {
    runtimeAgentId,
  });
  return Boolean(result?.ok);
}

export async function setEvolutionKillSwitch(enabled: boolean): Promise<boolean> {
  const result = await requestGateway<{ killSwitch?: boolean }>(
    "evolution-governance.set-kill-switch",
    { enabled },
  );
  return typeof result?.killSwitch === "boolean";
}

export async function enrollSkillAutoInstall(params: {
  candidateId: string;
  agentId?: string;
}): Promise<boolean> {
  const result = await requestGateway<{ ok?: boolean; job?: unknown }>(
    "evolution-governance.enroll-skill-auto",
    {
      candidateId: params.candidateId,
      ...(params.agentId ? { agentId: params.agentId } : {}),
    },
  );
  return Boolean(result?.ok ?? result?.job);
}

export async function cancelSkillAutoInstall(params: {
  candidateId: string;
  reason?: string;
}): Promise<boolean> {
  const result = await requestGateway<{ ok?: boolean; job?: unknown }>(
    "evolution-governance.cancel-skill-auto",
    {
      candidateId: params.candidateId,
      reason: params.reason ?? "ui-cancel",
    },
  );
  return Boolean(result?.ok ?? result?.job);
}

export type EvolutionPendingApproval = {
  kind: "effect" | "limit" | "redirect";
  id: string;
  runtimeAgentId: string;
  reason: string;
  targetAgentId?: string | null;
  actions: string[];
  /** Shared multi-tenant agent: tenant operators see item but cannot write. */
  requiresPlatformAdmin?: boolean;
};

export async function fetchEvolutionPendingApprovals(): Promise<EvolutionPendingApproval[]> {
  const result = await requestGateway<{ items?: EvolutionPendingApproval[] }>(
    "evolution-governance.pending-approvals",
    {},
  );
  return result?.items ?? [];
}

export async function resolveEvolutionApproval(
  runtimeAgentId: string,
  decision: "resume" | "hold" | "clear_limit" | "clear_redirect",
  reason?: string,
): Promise<boolean> {
  const result = await requestGateway<{ ok?: boolean }>("evolution-governance.resolve-approval", {
    runtimeAgentId,
    decision,
    reason,
  });
  return Boolean(result);
}

export async function fetchAnomalies(_filters: AnomalyFilters): Promise<Anomaly[]> {
  const gatewayResult = await requestGateway<{ items?: Anomaly[] }>("governance.anomalies.list", {
    filters: _filters,
    pagination: { page: 1, pageSize: 20 },
  });
  if (gatewayResult?.items) {
    return gatewayResult.items;
  }

  await delay(MOCK_DELAY);
  return [
    {
      id: "anomaly_001",
      assetId: "bot_002",
      assetName: "Sales Assistant",
      assetType: "bot",
      type: "cost_spike",
      severity: "medium",
      description: "Cost increased by 35% compared to yesterday",
      detectedAt: "2026-05-30T08:30:00Z",
      status: "pending",
    },
    {
      id: "anomaly_002",
      assetId: "bot_003",
      assetName: "Data Processing Bot",
      assetType: "bot",
      type: "high_failure",
      severity: "high",
      description: "Failure rate is 35% (35/100 tasks)",
      detectedAt: "2026-05-30T09:15:00Z",
      status: "pending",
    },
  ];
}

// ============================================================================
// Utilities
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAssetListItem(item: AssetListItem): AssetListItem {
  const avgCostPerTask =
    item.metrics.avgCostPerTask ??
    item.metrics.totalCost / Math.max(item.metrics.taskCount || 0, 1);
  const score =
    item.score ??
    Math.round(
      item.metrics.successRate * 70 +
        Math.max(0, 20 - item.activeAnomalyCount * 6) +
        Math.max(0, 10 - avgCostPerTask),
    );
  return {
    ...item,
    score,
    metrics: {
      ...item.metrics,
      avgCostPerTask,
    },
  };
}

export function hasGovernanceGatewayClient() {
  return Boolean(governanceClient);
}

/** Merge governance cost dashboard with growth aggregate for the enterprise cockpit. */
export function blendPerformanceGrowth(
  dashboard: DashboardStats | null,
  growth: MeshGrowthAggregateView | null,
): PerformanceGrowthBlend | null {
  if (!dashboard && !growth) {
    return null;
  }
  const metrics = dashboard?.metrics;
  const summary = growth?.summary;
  const botCount = summary?.botCount ?? 0;
  const totalCostToday = metrics?.totalCostToday ?? 0;
  const avgGrowthVelocity = summary?.avgGrowthVelocity ?? 0;
  return {
    totalCostToday,
    totalTasksToday: metrics?.totalTasksToday ?? 0,
    avgSuccessRate: metrics?.avgSuccessRate ?? 0,
    avgCostPerBot: botCount > 0 ? totalCostToday / botCount : 0,
    avgGrowthVelocity,
    costPerGrowthPoint:
      avgGrowthVelocity > 0
        ? (botCount > 0 ? totalCostToday / botCount : 0) / avgGrowthVelocity
        : 0,
  };
}

/**
 * 拉取各 agent 最近一次 Working DNA 变更的效果评估（企业治理可视化）。
 * 网关不可用时返回空数组（行为治理不使用 mock 数据）。
 */
export async function fetchWorkingStyleEffects(): Promise<WorkingStyleEffectItem[]> {
  const result = await requestGateway<{ effects: WorkingStyleEffectItem[] }>(
    "agents.list-working-style-effects",
    {},
  );
  return result?.effects ?? [];
}

/** 跨 agent 行为改变有效性聚合（企业治理分析）。网关不可用 → null。 */
export async function fetchWorkingStyleEffectiveness(): Promise<WorkingStyleEffectivenessAggregate | null> {
  const result = await requestGateway<{ aggregate: WorkingStyleEffectivenessAggregate }>(
    "agents.working-style-effectiveness",
    {},
  );
  return result?.aggregate ?? null;
}

// ============================================================================
// Pattern detection governance (human approve → draft skill)
// ============================================================================

export type PatternCandidateGovernanceRow = {
  agentId: string;
  candidateId: string;
  suggestedName: string;
  suggestedSummary: string;
  overallConfidence: number;
  sampleCount: number;
  status: "candidate" | "approved" | "rejected" | "published";
};

function asPatternCandidateRow(value: unknown): PatternCandidateGovernanceRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const agentId = typeof record.agentId === "string" ? record.agentId.trim() : "";
  const candidateId =
    typeof record.candidateId === "string"
      ? record.candidateId.trim()
      : typeof record.id === "string"
        ? record.id.trim()
        : "";
  if (!agentId || !candidateId) {
    return null;
  }
  const statusRaw = typeof record.status === "string" ? record.status : "candidate";
  const status =
    statusRaw === "approved" ||
    statusRaw === "rejected" ||
    statusRaw === "published" ||
    statusRaw === "candidate"
      ? statusRaw
      : "candidate";
  const sampleCount =
    typeof record.independentTaskCount === "number" && Number.isFinite(record.independentTaskCount)
      ? Math.max(0, Math.floor(record.independentTaskCount))
      : typeof record.sampleCount === "number" && Number.isFinite(record.sampleCount)
        ? Math.max(0, Math.floor(record.sampleCount))
        : 0;
  const overallConfidence =
    typeof record.overallConfidence === "number" && Number.isFinite(record.overallConfidence)
      ? Math.max(0, Math.min(1, record.overallConfidence))
      : 0;
  return {
    agentId,
    candidateId,
    suggestedName:
      (typeof record.suggestedName === "string" ? record.suggestedName.trim() : "") ||
      "稳定工作模式",
    suggestedSummary:
      (typeof record.suggestedSummary === "string" ? record.suggestedSummary.trim() : "") ||
      "跨多次独立任务观察到的可复用执行模式",
    overallConfidence,
    sampleCount,
    status,
  };
}

export async function fetchPatternCandidatesForAgent(
  agentId: string,
  status: PatternCandidateGovernanceRow["status"] = "candidate",
): Promise<PatternCandidateGovernanceRow[]> {
  const result = await requestGateway<{ candidates?: unknown[] }>(
    "pattern-detection.list-candidates",
    { agentId, status },
  );
  if (!result?.candidates) {
    return [];
  }
  return result.candidates
    .map(asPatternCandidateRow)
    .filter((row): row is PatternCandidateGovernanceRow => row !== null);
}

export async function fetchPatternCandidatesForAgents(
  agentIds: string[],
): Promise<PatternCandidateGovernanceRow[]> {
  const unique = [...new Set(agentIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return [];
  }
  const batches = await Promise.all(
    unique.map(async (agentId) => {
      const [pending, approved] = await Promise.all([
        fetchPatternCandidatesForAgent(agentId, "candidate"),
        fetchPatternCandidatesForAgent(agentId, "approved"),
      ]);
      return [...pending, ...approved];
    }),
  );
  return batches.flat();
}

export async function approvePatternCandidate(params: {
  agentId: string;
  candidateId: string;
  autoInstallIntent?: boolean;
}): Promise<boolean> {
  const result = await requestGateway<{ candidate?: unknown }>("pattern-detection.approve", {
    agentId: params.agentId,
    candidateId: params.candidateId,
    autoInstallIntent: params.autoInstallIntent === true,
  });
  return Boolean(result?.candidate);
}

export async function rejectPatternCandidate(params: {
  agentId: string;
  candidateId: string;
}): Promise<boolean> {
  const result = await requestGateway<{ candidate?: unknown }>("pattern-detection.reject", {
    agentId: params.agentId,
    candidateId: params.candidateId,
  });
  return Boolean(result?.candidate);
}

export async function fetchEvolutionProposals(): Promise<EvolutionLineageProposal[]> {
  const result = await requestGateway<{ proposals?: EvolutionLineageProposal[] }>(
    "evolution.proposals.list",
    {},
  );
  return result?.proposals ?? [];
}

export async function fetchEvolutionLedger(): Promise<EvolutionLineageEvent[]> {
  const result = await requestGateway<{ events?: EvolutionLineageEvent[] }>(
    "evolution.ledger.query",
    {},
  );
  return result?.events ?? [];
}

export type EvolutionTransitionResult =
  | { ok: true; status: string }
  | { ok: false; message: string };

function newEvolutionCommandId(kind: string, proposalId: string): string {
  const suffix =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `ui:${kind}:${proposalId}:${suffix}`;
}

async function requestEvolutionWrite<T>(
  method: string,
  params: Record<string, unknown>,
): Promise<{ ok: true; payload: T } | { ok: false; message: string }> {
  if (!governanceClient?.connected) {
    return { ok: false, message: "Gateway 未连接" };
  }
  try {
    const payload = await governanceClient.request<T>(method, params);
    return { ok: true, payload };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : `${method} failed`,
    };
  }
}

export async function holdEvolutionProposal(
  proposalId: string,
): Promise<EvolutionTransitionResult> {
  const result = await requestEvolutionWrite<{
    proposal?: { status?: string };
    receipt?: { status?: string };
  }>("evolution.proposals.transition", {
    commandId: newEvolutionCommandId("hold", proposalId),
    proposalId,
    command: "hold",
  });
  if (!result.ok) {
    return result;
  }
  const status = result.payload.proposal?.status ?? result.payload.receipt?.status;
  if (!status) {
    return { ok: false, message: "hold did not return a proposal status" };
  }
  return { ok: true, status };
}

export async function resumeEvolutionExperiment(
  proposalId: string,
): Promise<EvolutionTransitionResult> {
  const result = await requestEvolutionWrite<{
    experiment?: { experimentId?: string };
    receipt?: { experimentId?: string };
  }>("evolution.experiments.create", {
    commandId: newEvolutionCommandId("resume", proposalId),
    proposalId,
  });
  if (!result.ok) {
    return result;
  }
  if (!result.payload.experiment?.experimentId && !result.payload.receipt?.experimentId) {
    return { ok: false, message: "resume did not return an experiment" };
  }
  return { ok: true, status: "EXPERIMENTING" };
}

export async function publishPatternDraftSkill(params: {
  agentId: string;
  candidateId: string;
  sourceAgentId?: string;
}): Promise<boolean> {
  const result = await requestGateway<{ skillId?: string; candidate?: unknown }>(
    "pattern-detection.publish-draft-skill",
    {
      agentId: params.agentId,
      candidateId: params.candidateId,
      ...(params.sourceAgentId ? { sourceAgentId: params.sourceAgentId } : {}),
    },
  );
  return Boolean(result?.skillId ?? result?.candidate);
}
