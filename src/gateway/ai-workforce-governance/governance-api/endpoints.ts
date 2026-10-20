/**
 * Governance API Endpoints
 * Typed request/response contracts for AI Workforce Governance API.
 */

import type {
  AiAssetStatus,
  AiAssetType,
  AnomalySeverity,
  AnomalyStatus,
  AnomalyType,
  AssetListItem,
  AssetSortConfig,
  GovernanceActionResponse,
  GovernanceActionType,
  PaginationInput,
  PaginationState,
  RiskLevel,
} from "../shared/types.ts";

// ============================================================================
// Endpoint Name Constants
// ============================================================================

export const GOVERNANCE_ENDPOINTS = {
  // Asset management
  listAssets: "governance.assets.list",
  getAssetDetail: "governance.assets.detail",
  executeAction: "governance.assets.action",

  // Anomaly management
  listAnomalies: "governance.anomalies.list",
  resolveAnomaly: "governance.anomalies.resolve",

  // Metrics
  getAssetMetrics: "governance.metrics.asset",
  getDashboardStats: "governance.metrics.dashboard",

  // Ranking & Scoring
  getRanking: "governance.ranking.get",
  getScore: "governance.scores.get",
  getScoreHistory: "governance.scores.history",

  // Auto Governance
  listGovernanceActions: "governance.actions.list",
  executePendingAction: "governance.actions.execute",
  getAutoGovernanceStatus: "governance.auto.status",
  configureAutoGovernance: "governance.auto.configure",

  // Aggregation control
  triggerAggregation: "governance.admin.trigger-aggregation",
  getAggregationStatus: "governance.admin.aggregation-status",
} as const;

export type GovernanceEndpoint = (typeof GOVERNANCE_ENDPOINTS)[keyof typeof GOVERNANCE_ENDPOINTS];

// ============================================================================
// Asset List
// ============================================================================

export interface AssetListRequest {
  filters: {
    type?: AiAssetType;
    search?: string;
    owner?: string;
    position?: string;
    riskLevel?: RiskLevel;
    status?: AiAssetStatus;
  };
  pagination: PaginationInput;
  sorting: AssetSortConfig;
}

export interface AssetListResponse {
  items: AssetListItem[];
  pagination: PaginationState;
}

// ============================================================================
// Asset Detail
// ============================================================================

export interface AssetDetailRequest {
  assetId: string;
}

export interface AssetRun {
  id: string;
  taskId: string | null;
  startTime: string;
  endTime: string | null;
  durationMs: number | null;
  status: string;
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

export interface AssetDetailResponse {
  asset: {
    id: string;
    name: string;
    type: AiAssetType;
    status: AiAssetStatus;
    position: {
      id: string;
      title: string;
    } | null;
    owner: {
      id: string;
      name: string;
      email: string;
    } | null;
    runtime: {
      id: string | null;
      status: string;
    };
    createdAt: string;
    updatedAt: string;
  };
  metrics: {
    taskCount: number;
    successRate: number;
    avgLatencyMs: number;
    totalCost: number;
    avgCostPerTask: number;
    errorCount: number;
  };
  dailyMetrics: Array<{
    date: string;
    taskCount: number;
    successRate: number;
    avgLatencyMs: number;
    totalCost: number;
    costGrowthRate: number;
  }>;
  recentRuns: AssetRun[];
  activeAnomalies: AssetAnomaly[];
  riskLevel: RiskLevel;
  riskFactors: string[];
}

// ============================================================================
// Governance Actions
// ============================================================================

export interface ExecuteActionRequest {
  assetId: string;
  action: GovernanceActionType;
  reason?: string;
  params?: Record<string, unknown>;
}

export interface ExecuteActionResponse extends GovernanceActionResponse {}

// ============================================================================
// Anomalies
// ============================================================================

export interface AnomalyListRequest {
  filters: {
    severity?: AnomalySeverity;
    status?: AnomalyStatus;
    assetId?: string;
    type?: AnomalyType;
  };
  pagination: PaginationInput;
}

export interface AnomalyListItem {
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

export interface AnomalyListResponse {
  items: AnomalyListItem[];
  pagination: PaginationState;
}

export interface ResolveAnomalyRequest {
  anomalyId: string;
  resolutionNote?: string;
}

export interface ResolveAnomalyResponse {
  success: boolean;
  anomalyId: string;
  resolvedAt: string;
}

// ============================================================================
// Dashboard Stats
// ============================================================================

export interface DashboardStatsRequest {
  // No parameters needed - derived from caller context
}

export interface DashboardStatsResponse {
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
  recentAnomalies: AnomalyListItem[];
}

// ============================================================================
// Admin Operations
// ============================================================================

export interface TriggerAggregationRequest {
  assetIds?: string[]; // If not provided, aggregates all assets
  date?: string; // If not provided, uses today
}

export interface TriggerAggregationResponse {
  startedAt: string;
  completedAt: string;
  processed: number;
  errors: number;
}

export interface AggregationStatusRequest {
  // No parameters needed
}

export interface AggregationStatusResponse {
  isRunning: boolean;
  lastRunAt: string | null;
  intervalMinutes: number;
}

// ============================================================================
// Ranking & Scoring
// ============================================================================

export interface GetRankingRequest {
  type: "bot" | "group" | "position";
  date?: string;
  limit?: number;
}

export interface RankingItem {
  id: string;
  name: string;
  type: "bot" | "group" | "position";
  score: number;
  rank: number;
  metrics: {
    taskCount: number;
    successRate: number;
    avgCost: number;
  };
}

export interface GetRankingResponse {
  type: "bot" | "group" | "position";
  items: RankingItem[];
  total: number;
  generatedAt: string;
}

export interface GetScoreRequest {
  assetId: string;
  date?: string;
}

export interface GetScoreResponse {
  assetId: string;
  name: string;
  type: "bot" | "group" | "position";
  score: number;
  efficiencyScore: number;
  costScore: number;
  stabilityScore: number;
  rank?: number;
  metrics: {
    taskCount: number;
    successRate: number;
    costPerTask: number;
    failRate: number;
  };
  date: string;
}

export interface GetScoreHistoryRequest {
  assetId: string;
  startDate?: string;
  endDate?: string;
}

export interface GetScoreHistoryResponse {
  assetId: string;
  history: Array<{
    date: string;
    score: number;
    rank?: number;
  }>;
}

// ============================================================================
// Auto Governance
// ============================================================================

export interface ListGovernanceActionsRequest {
  filters?: {
    assetId?: string;
    status?: "pending" | "executed" | "failed" | "cancelled";
    trigger?: "auto_governance" | "manual" | "anomaly";
  };
  pagination?: PaginationInput;
}

export interface GovernanceActionItem {
  id: string;
  assetId: string;
  assetName: string;
  action: string;
  trigger: string;
  reason: string;
  status: string;
  executedAt?: string;
  createdAt: string;
}

export interface ListGovernanceActionsResponse {
  items: GovernanceActionItem[];
  pagination: PaginationState;
}

export interface ExecutePendingActionRequest {
  actionId: string;
}

export interface ExecutePendingActionResponse {
  success: boolean;
  actionId: string;
  status: string;
  executedAt: string;
}

export interface AutoGovernanceStatusRequest {
  // No parameters needed
}

export interface AutoGovernanceStatusResponse {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  isRunning: boolean;
}

export interface ConfigureAutoGovernanceRequest {
  enabled?: boolean;
  intervalMinutes?: number;
}

export interface ConfigureAutoGovernanceResponse {
  enabled: boolean;
  intervalMinutes: number;
}
