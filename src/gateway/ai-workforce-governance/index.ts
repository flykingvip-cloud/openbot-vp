/**
 * AI Workforce Governance Module
 * Enterprise AI asset governance system for unified bot/group management,
 * runtime monitoring, anomaly detection, and governance operations.
 */

// Shared - re-export only non-conflicting types
export type {
  AiAsset,
  AiAssetStatus,
  AiAssetType,
  AiAssetWithRelations,
  AiAnomaly,
  AiAnomalyWithAsset,
  AiMetricsDaily,
  AiRun,
  AiRunStatus,
  AiScore,
  AnomalyFilters,
  AnomalySeverity,
  AnomalyStatus,
  AnomalyType,
  AssetListFilters,
  AssetListItem,
  AssetMetrics,
  AssetSortConfig,
  AssetSortField,
  AutoGovernanceResult,
  AutoGovernanceRule,
  DetectionResult,
  DetectionRule,
  GovernanceAction,
  GovernanceActionRecord,
  GovernanceActionRequest,
  GovernanceActionResponse,
  GovernanceActionStatus,
  GovernanceActionType,
  GovernanceTrigger,
  PaginationInput,
  PaginationState,
  RankedItem,
  RankingResult,
  RiskAssessment,
  RiskLevel,
  ScoreComponent,
  ScoreType,
  SortDirection,
} from "./shared/types.js";

export * from "./shared/db-schema.js";
export * from "./shared/utils.js";

// AI Assets
export * as aiAssets from "./ai-assets/store.js";

// AI Runs
export * as aiRuns from "./ai-runs/store.js";

// Metrics Aggregator
export * as metricsAggregator from "./metrics-aggregator/aggregator.js";

// Scoring Engine
export * as scoringEngine from "./scoring-engine/scoring.js";

// Ranking Engine
export * as rankingEngine from "./scoring-engine/ranking.js";

// Auto Governance Engine
export * as autoGovernance from "./auto-governance/engine.js";

// Anomaly Engine
export * as anomalyEngine from "./anomaly-engine/detector.js";

// Governance API - re-export only non-conflicting types
export {
  GOVERNANCE_ENDPOINTS,
  type AggregationStatusRequest,
  type AggregationStatusResponse,
  type AnomalyListItem,
  type AnomalyListRequest,
  type AnomalyListResponse,
  type AssetDetailRequest,
  type AssetDetailResponse,
  type AssetListRequest,
  type AssetListResponse,
  type AssetRun,
  type ConfigureAutoGovernanceRequest,
  type ConfigureAutoGovernanceResponse,
  type DashboardStatsRequest,
  type DashboardStatsResponse,
  type ExecuteActionRequest,
  type ExecuteActionResponse,
  type ExecutePendingActionRequest,
  type ExecutePendingActionResponse,
  type GetRankingRequest,
  type GetRankingResponse,
  type GetScoreHistoryRequest,
  type GetScoreHistoryResponse,
  type GetScoreRequest,
  type GetScoreResponse,
  type GovernanceActionItem,
  type GovernanceEndpoint,
  type ListGovernanceActionsRequest,
  type ListGovernanceActionsResponse,
  type RankingItem,
  type ResolveAnomalyRequest,
  type ResolveAnomalyResponse,
  type TriggerAggregationRequest,
  type TriggerAggregationResponse,
} from "./governance-api/endpoints.js";
