/**
 * AI Workforce Governance - Frontend Types
 * Type definitions for the governance UI module.
 */

// ============================================================================
// Asset Types
// ============================================================================

export type AiAssetType = "bot" | "group";
export type AiAssetStatus = "active" | "paused" | "error";

export interface AiAsset {
  id: string;
  name: string;
  type: AiAssetType;
  status: AiAssetStatus;
  position: string | null;
  owner: string | null;
}

export interface AssetMetrics {
  taskCount: number;
  successRate: number;
  avgLatency: number;
  /** Calendar-month cost (本月) — list column. */
  totalCost: number;
  /** Lifetime / cumulative cost — detail only. */
  lifetimeCost?: number;
  avgCostPerTask?: number;
}

export type RiskLevel = "low" | "medium" | "high";

export interface AssetListItem extends AiAsset {
  metrics: AssetMetrics;
  riskLevel: RiskLevel;
  activeAnomalyCount: number;
  memberCount?: number;
  score?: number;
}

// ============================================================================
// Anomaly Types
// ============================================================================

export type AnomalyType =
  | "no_task"
  | "cost_spike"
  | "high_failure"
  | "runtime_error"
  | "low_success_rate"
  | "high_latency";

export type AnomalySeverity = "low" | "medium" | "high";
export type AnomalyStatus = "pending" | "resolved";

export interface Anomaly {
  id: string;
  assetId: string;
  assetName: string;
  assetType: AiAssetType;
  type: AnomalyType;
  severity: AnomalySeverity;
  description: string;
  detectedAt: string;
  status: AnomalyStatus;
}

// ============================================================================
// Filter Types
// ============================================================================

export interface AssetFilters {
  type?: AiAssetType;
  search?: string;
  owner?: string;
  position?: string;
  riskLevel?: RiskLevel;
  status?: AiAssetStatus;
}

export interface AnomalyFilters {
  severity?: AnomalySeverity;
  status?: AnomalyStatus;
  assetId?: string;
  type?: AnomalyType;
}

// ============================================================================
// Sort Types
// ============================================================================

export type AssetSortField =
  | "cost"
  | "task"
  | "success_rate"
  | "name"
  | "created"
  | "score"
  | "position"
  | "owner";
export type SortDirection = "asc" | "desc";

export interface AssetSortConfig {
  field: AssetSortField;
  direction: SortDirection;
}

// ============================================================================
// Pagination Types
// ============================================================================

export interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type PageSize = 10 | 20 | 50;

// ============================================================================
// Detail Types
// ============================================================================

export interface AssetRun {
  id: string;
  taskId: string | null;
  startTime: string;
  endTime: string | null;
  durationMs: number | null;
  status: "success" | "failed" | "timeout" | "running";
  errorCode: string | null;
  tokensInput: number;
  tokensOutput: number;
  cost: number;
}

export interface AssetAnomaly {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  description: string;
  detectedAt: string;
  status: AnomalyStatus;
}

export interface DailyMetrics {
  date: string;
  taskCount: number;
  successRate: number;
  avgLatencyMs: number;
  totalCost: number;
  costGrowthRate: number;
}

export interface AssetDetail {
  asset: Omit<AiAsset, "position" | "owner"> & {
    position: { id: string; title: string } | null;
    owner: { id: string; name: string; email: string } | null;
    runtime: { id: string | null; status: string };
    createdAt: string;
    updatedAt: string;
  };
  metrics: AssetMetrics & {
    avgCostPerTask: number;
    errorCount: number;
  };
  dailyMetrics: DailyMetrics[];
  recentRuns: AssetRun[];
  activeAnomalies: AssetAnomaly[];
  riskLevel: RiskLevel;
  riskFactors: string[];
}

// ============================================================================
// Governance Actions
// ============================================================================

export type GovernanceActionType =
  | "pause"
  | "resume"
  | "limit"
  | "redirect"
  | "notify_admin"
  | "mark_risk"
  | "recommend_optimization";

export interface GovernanceActionResult {
  success: boolean;
  action: GovernanceActionType;
  appliedAt: string;
  message?: string;
}

// ============================================================================
// Scoring & Ranking Types
// ============================================================================

export interface ScoreBreakdown {
  efficiency: number;
  cost: number;
  stability: number;
}

export interface AssetScore {
  assetId: string;
  name: string;
  type: AiAssetType | "position";
  score: number;
  breakdown: ScoreBreakdown;
  rank?: number;
  metrics: {
    taskCount: number;
    successRate: number;
    costPerTask: number;
    failRate: number;
  };
}

export interface RankingItem {
  id: string;
  name: string;
  type: AiAssetType | "position";
  score: number;
  rank: number;
  metrics: {
    taskCount: number;
    successRate: number;
    avgCost: number;
  };
}

export interface RankingView {
  type: "bot" | "group" | "position";
  items: RankingItem[];
  total: number;
  generatedAt: string;
}

export interface ScoreHistoryPoint {
  date: string;
  score: number;
  rank?: number;
}

// ============================================================================
// Auto Governance Types
// ============================================================================

export type GovernanceActionStatus = "pending" | "executed" | "failed" | "cancelled";
export type GovernanceTrigger = "auto_governance" | "manual" | "anomaly";

export interface GovernanceActionRecord {
  id: string;
  assetId: string;
  assetName: string;
  action: string;
  trigger: GovernanceTrigger;
  reason: string;
  status: GovernanceActionStatus;
  executedAt?: string;
  createdAt: string;
}

export interface AutoGovernanceConfig {
  enabled: boolean;
  intervalMinutes: number;
}

// ============================================================================
// Dashboard Types
// ============================================================================

export interface DashboardStats {
  summary: {
    totalAssets: number;
    activeAssets: number;
    pausedAssets: number;
    errorAssets: number;
  };
  metrics: {
    totalTasksToday: number;
    totalCostToday: number;
    avgSuccessRate: number;
    totalAnomalies: number;
    pendingAnomalies: number;
  };
  riskDistribution: {
    low: number;
    medium: number;
    high: number;
  };
  recentAnomalies: Anomaly[];
}

export interface MeshGrowthAggregateView {
  generatedAt: string;
  summary: {
    botCount: number;
    trackedCount: number;
    withOperationalScore: number;
    falseReadyCount: number;
    activatedCount: number;
    missionReadyCount: number;
    avgActivationScore: number;
    avgOperationalScore: number;
    avgGrowthVelocity: number;
  };
  lifecycleDistribution: Record<string, unknown>;
  workingStyle: {
    botsWithProfile: number;
    botsWithRecentChange: number;
    effectiveness: {
      overall: WorkingStyleEffectivenessBucket;
    };
  };
  ranking: unknown[];
}

export type PerformanceGrowthBlend = {
  totalCostToday: number;
  totalTasksToday: number;
  avgSuccessRate: number;
  avgCostPerBot: number;
  avgGrowthVelocity: number;
  costPerGrowthPoint: number;
};

// ============================================================================
// UI State Types
// ============================================================================

export interface GovernanceUIState {
  // Asset list
  assets: AssetListItem[];
  assetFilters: AssetFilters;
  assetPagination: PaginationState;
  assetSort: AssetSortConfig;
  isLoadingAssets: boolean;
  assetError: string | null;

  // Anomaly queue
  anomalies: Anomaly[];
  anomalyFilters: AnomalyFilters;
  isLoadingAnomalies: boolean;
  anomalyError: string | null;

  // Selected asset detail
  selectedAssetId: string | null;
  assetDetail: AssetDetail | null;
  isLoadingDetail: boolean;
  detailError: string | null;

  // Dashboard stats
  dashboardStats: DashboardStats | null;
  isLoadingStats: boolean;

  // Actions
  isExecutingAction: boolean;
  lastActionResult: GovernanceActionResult | null;

  // Drawer state
  isDetailDrawerOpen: boolean;
  isOwnerPanelOpen: boolean;
  selectedOwnerId: string | null;
}

/**
 * 二阶反馈：某 agent 最近一次 Working DNA 变更的效果评估（企业治理可视化）。
 * status 为 null 表示尚未评估（实战数据不足）；rolledBack 表示因判定回归已自动回滚。
 */
export interface WorkingStyleEffectItem {
  agentId: string;
  status: "improved" | "regressed" | "inconclusive" | null;
  deltaScore: number | null;
  changedAtMs: number;
  assessedAtMs: number | null;
  rolledBack: boolean;
  appliedDelta: Record<string, unknown>;
}

/** 行为改变有效性聚合的桶（overall / per-signature / per-cohort 共用）。 */
export interface WorkingStyleEffectivenessBucket {
  total: number;
  improved: number;
  regressed: number;
  inconclusive: number;
  rolledBack: number;
  improvedRate: number | null;
  avgDeltaScore: number | null;
}

export interface WorkingStyleSignatureStats extends WorkingStyleEffectivenessBucket {
  signature: string;
  netEffectiveness: number;
}

/** 跨 agent 行为改变有效性聚合（overall + 按签名 + 按 A/B cohort）。 */
export interface WorkingStyleEffectivenessAggregate {
  overall: WorkingStyleEffectivenessBucket;
  bySignature: WorkingStyleSignatureStats[];
  byCohort: {
    treatment: WorkingStyleEffectivenessBucket;
    control: WorkingStyleEffectivenessBucket;
  };
}
