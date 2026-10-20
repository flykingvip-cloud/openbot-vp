/**
 * AI Workforce Governance - Shared Types
 * Core type definitions for the AI governance system.
 */

// ============================================================================
// Asset Types
// ============================================================================

export type AiAssetType = "bot" | "group";
export type AiAssetStatus = "active" | "paused" | "error";

export interface AiAsset {
  id: string;
  type: AiAssetType;
  name: string;
  positionId: string | null;
  digitalWorkerId: string | null;
  ownerUserId: string | null;
  runtimeId: string | null;
  templateId: string | null;
  status: AiAssetStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AiAssetWithRelations extends AiAsset {
  position?: {
    id: string;
    title: string;
  } | null;
  owner?: {
    id: string;
    name: string;
    email: string;
  } | null;
  digitalWorker?: {
    id: string;
    name: string;
  } | null;
}

// ============================================================================
// Run Types
// ============================================================================

export type AiRunStatus = "success" | "failed" | "timeout" | "running";

export interface AiRun {
  id: string;
  assetId: string;
  taskId: string | null;
  startTime: string;
  endTime: string | null;
  durationMs: number | null;
  status: AiRunStatus;
  errorCode: string | null;
  tokensInput: number;
  tokensOutput: number;
  cost: number;
  createdAt: string;
}

// ============================================================================
// Metrics Types
// ============================================================================

export interface AiMetricsDaily {
  id: string;
  assetId: string;
  date: string; // ISO date string YYYY-MM-DD
  taskCount: number;
  successCount: number;
  failCount: number;
  avgLatencyMs: number;
  totalDurationMs: number;
  totalTokens: number;
  totalCost: number;
  avgCostPerTask: number;
  errorCount: number;
  successRate: number; // 0-1
  costGrowthRate: number; // 0-1, can be negative
  createdAt: string;
  updatedAt: string;
}

export interface AssetMetrics {
  taskCount: number;
  successRate: number;
  avgLatencyMs: number;
  totalCost: number;
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

export interface AiAnomaly {
  id: string;
  assetId: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  description: string;
  detectedAt: string;
  resolvedAt: string | null;
  status: AnomalyStatus;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AiAnomalyWithAsset extends AiAnomaly {
  assetName: string;
  assetType: AiAssetType;
}

// ============================================================================
// Risk Assessment
// ============================================================================

export type RiskLevel = "low" | "medium" | "high";

export interface RiskAssessment {
  level: RiskLevel;
  factors: string[];
  anomalyCount: number;
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

export interface GovernanceAction {
  id: string;
  assetId: string;
  action: GovernanceActionType;
  reason: string | null;
  params: Record<string, unknown> | null;
  executedBy: string | null;
  executedAt: string;
  createdAt: string;
}

export interface GovernanceActionRequest {
  action: GovernanceActionType;
  reason?: string;
  params?: Record<string, unknown>;
}

export interface GovernanceActionResponse {
  success: boolean;
  action: GovernanceActionType;
  appliedAt: string;
  message?: string;
}

// ============================================================================
// Filter & Pagination Types
// ============================================================================

export interface AssetListFilters {
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

export interface PaginationInput {
  page: number;
  pageSize: 10 | 20 | 50;
}

export interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type AssetSortField = "cost" | "task" | "success_rate" | "name" | "created";
export type SortDirection = "asc" | "desc";

export interface AssetSortConfig {
  field: AssetSortField;
  direction: SortDirection;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface AssetListItem {
  id: string;
  name: string;
  type: AiAssetType;
  status: AiAssetStatus;
  position: string | null;
  owner: string | null;
  memberCount?: number;
  metrics: AssetMetrics;
  riskLevel: RiskLevel;
  activeAnomalyCount: number;
}

export interface AssetListResponse {
  items: AssetListItem[];
  pagination: PaginationState;
}

export interface AnomalyListResponse {
  items: AiAnomalyWithAsset[];
  pagination: PaginationState;
}

export interface AssetDetailResponse {
  asset: AiAssetWithRelations;
  metrics: AssetMetrics;
  dailyMetrics: AiMetricsDaily[];
  recentRuns: AiRun[];
  activeAnomalies: AiAnomaly[];
  riskAssessment: RiskAssessment;
}

// ============================================================================
// Aggregation Job Types
// ============================================================================

export interface AggregationJobConfig {
  intervalMinutes: number;
  batchSize: number;
  retentionDays: number;
}

export interface AggregationResult {
  assetId: string;
  date: string;
  metrics: Omit<AiMetricsDaily, "id" | "assetId" | "date" | "createdAt" | "updatedAt">;
  inserted: boolean;
}

// ============================================================================
// Detection Rule Types
// ============================================================================

export interface DetectionRule {
  type: AnomalyType;
  severity: AnomalySeverity;
  condition: (metrics: AiMetricsDaily, history: AiMetricsDaily[]) => boolean;
  description: (metrics: AiMetricsDaily) => string;
}

export interface DetectionResult {
  triggered: boolean;
  anomaly?: Omit<AiAnomaly, "id" | "createdAt">;
}

// ============================================================================
// Scoring & Ranking Types
// ============================================================================

export type ScoreType = "bot" | "group" | "position";
export type ScoreComponent = "efficiency" | "cost" | "stability";

export interface AiScore {
  id: string;
  assetId: string;
  type: ScoreType;
  score: number; // 0-100
  efficiencyScore: number;
  costScore: number;
  stabilityScore: number;
  taskCount: number;
  successRate: number;
  costPerTask: number;
  failRate: number;
  rank?: number;
  date: string;
  createdAt: string;
  updatedAt: string;
}

export interface RankedItem {
  id: string;
  name: string;
  type: ScoreType;
  score: number;
  rank: number;
  metrics: {
    taskCount: number;
    successRate: number;
    avgCost: number;
  };
}

export interface RankingResult {
  type: ScoreType;
  items: RankedItem[];
  total: number;
  generatedAt: string;
}

// ============================================================================
// Auto Governance Types
// ============================================================================

export type GovernanceTrigger = "auto_governance" | "manual" | "anomaly";
export type GovernanceActionStatus = "pending" | "executed" | "failed" | "cancelled";

export interface GovernanceActionRecord {
  id: string;
  assetId: string;
  action: GovernanceActionType;
  trigger: GovernanceTrigger;
  reason: string;
  params?: Record<string, unknown>;
  status: GovernanceActionStatus;
  executedBy?: string;
  executedAt?: string;
  createdAt: string;
}

export interface AutoGovernanceRule {
  id: string;
  name: string;
  condition: (metrics: AiMetricsDaily, history: AiMetricsDaily[]) => boolean;
  action: GovernanceActionType;
  severity: "low" | "medium" | "high";
  autoExecute: boolean; // true for auto, false for notification only
  description: string;
}

export interface AutoGovernanceResult {
  ruleId: string;
  triggered: boolean;
  action?: GovernanceActionRecord;
  message?: string;
}
