import type { ModelsVM as LegacyModelsVM } from "../view-models/types.ts";
import type { CapabilityEvidenceItem } from "./capability-evidence.ts";
import type { AutoRoutingAdmission } from "./model-admission-store.ts";
import type { PlatformAorReadModel, PlatformModelsMode } from "./snapshot-types.ts";

export type LegacyPlatformModelsVM = LegacyModelsVM;

export type PlatformModelsTabContext = {
  modelId?: string;
  sourceModelId?: string;
  taskProfileId?: string;
  planId?: string;
  policyId?: string;
  actionHint?: "replace_model" | "add_fallback" | "adjust_policy";
  suggestedModelId?: string;
};

export type ModelsTabId =
  | "overview"
  | "issues"
  | "modelAssets"
  | "taskPlans"
  | "smartRouting"
  | "usageAnalytics"
  | "governance";

export type ModelAsset = {
  modelId: string;
  providerId: string;
  providerName?: string;
  displayName: string;
  /** Provider · localModelId subtitle for tables. */
  displaySubtitle?: string;
  /** Scope chips such as BYOK / 租户专属. */
  scopeBadges?: Array<"BYOK" | "租户专属">;
  avatarLabel?: string;
  source: "configured" | "referenced" | "discovered";
  inputModalities: Array<"text" | "image" | "audio" | "video" | "multimodal">;
  outputModalities: Array<"text" | "image" | "audio" | "video">;
  capabilities: Array<"reasoning" | "vision" | "code" | "tools" | "stream" | "long_context">;
  /**
   * Capability evidence with source + verification status.
   * Inferred tags land as status=suggested; never treat as verified.
   */
  capabilityEvidence?: CapabilityEvidenceItem[];
  /** Actual executor path badge (e.g. 图片生成 · Stepfun). */
  executorPathBadge?: string;
  executorPathDetail?: string;
  /** Fingerprint of endpoint/protocol/model used for connection admission. */
  connectionFingerprint?: string;
  baseUrl?: string | null;
  api?: string | null;
  contextWindow?: number;
  /** True when context/maxTokens came from an explicit source (not a hidden default). */
  contextWindowSource?: "catalog" | "admin" | "unknown";
  maxOutputTokens?: number;
  maxOutputTokensSource?: "catalog" | "admin" | "unknown";
  costTier: "low" | "medium" | "high" | "unknown";
  inputPrice?: number;
  outputPrice?: number;
  health: "healthy" | "degraded" | "unavailable";
  healthBasis?:
    | "live_probe_ok"
    | "live_probe_failed"
    | "catalog_verified"
    | "catalog_missing"
    | "config_inferred"
    | "auth_missing";
  healthNote?: string;
  liveProbe?: {
    status:
      | "ok"
      | "auth"
      | "rate_limit"
      | "billing"
      | "timeout"
      | "format"
      | "unknown"
      | "no_model";
    source: "profile" | "env" | "models.json";
    label: string;
    latencyMs?: number;
    error?: string;
    checkedAt?: number;
  };
  stabilityScore?: number;
  avgLatencyMs?: number;
  taskTags: string[];
  inRecommendationPool: boolean;
  tenantSelectable: boolean;
  /** Independent of allowlist / recommendation pool. */
  autoRouting?: AutoRoutingAdmission;
  autoRoutingReason?: string;
  autoRoutingTaskCategories?: string[];
  usage7d?: {
    calls: number;
    cost: number;
    successRate?: number;
    fallbackRate?: number;
  };
  governance?: {
    issueCount: number;
    highestSeverity?: "critical" | "warning" | "info";
  };
};

export type TaskProfile = {
  taskProfileId: string;
  name: string;
  description?: string;
  category:
    | "general_text"
    | "long_context"
    | "coding"
    | "image_generation"
    | "image_understanding"
    | "video_processing"
    | "realtime_voice"
    | "high_quality_reasoning"
    | "low_cost_batch";
  requiredCapabilities: string[];
  forbiddenWeaknesses?: string[];
  inputModalities: string[];
  outputModalities: string[];
  maxCostPerRequest?: number;
  latencyTargetMs?: number;
  stabilityTarget?: "standard" | "high" | "critical";
  priorityMode: "quality" | "cost" | "speed" | "balanced";
  status?: "active" | "draft" | "deprecated";
};

export type ModelPlan = {
  planId: string;
  name: string;
  description: string;
  taskProfileId: string;
  configSource?: "platform_default" | "dedicated" | "derived";
  audience: "platform" | "tenant" | "user";
  primaryModelIds: string[];
  fallbackModelIds: string[];
  costTarget: "low" | "medium" | "high";
  qualityTarget: "standard" | "high" | "premium";
  latencyTarget: "realtime" | "interactive" | "batch";
  userSelectable: boolean;
  tenantOverrideAllowed: boolean;
  status: "draft" | "published" | "deprecated";
  missingModelIds?: string[];
  usage7d?: {
    calls: number;
    cost: number;
    successRate?: number;
    fallbackRate?: number;
    manualOverrideRate?: number;
  };
  governance?: {
    issueCount: number;
    highestSeverity?: "critical" | "warning" | "info";
  };
  /** AOR execution mapping when platform runs in `aor_enhanced` mode. */
  aorExecution?: {
    taskTypeId: string;
    skillId?: string;
    selectorStrategy: "cheapest" | "best_quality" | "balanced" | "bandit";
    evaluatorMode: "content" | "workspace";
  };
  updatedAt?: number;
};

export type RoutingPolicy = {
  policyId: string;
  name: string;
  taskProfileId: string;
  planId?: string;
  configSource?: "platform_default" | "dedicated" | "derived";
  scope: {
    tenantIds?: string[];
    userSegments?: string[];
    agentIds?: string[];
  };
  constraints: {
    maxCostPerRequest?: number;
    maxLatencyMs?: number;
    requiredCapabilities?: string[];
    requiredHealth?: "healthy" | "not_unavailable";
  };
  ranking: {
    mode: "quality" | "cost" | "speed" | "balanced" | "bandit";
    weights?: {
      quality?: number;
      cost?: number;
      latency?: number;
      stability?: number;
    };
  };
  candidates: {
    primary: string[];
    fallback: string[];
    excluded?: string[];
  };
  performance?: {
    primaryHitRate?: number;
    fallbackRate?: number;
    manualOverrideRate?: number;
    avgLatencyMs?: number;
    avgCostPerRequest?: number;
  };
  status: "active" | "draft" | "disabled";
  updatedAt?: number;
};

export type RoutingDecisionExplanation = {
  requestId: string;
  taskProfileId: string;
  planId?: string;
  selectedModelId: string;
  matchedRules: string[];
  rejectedModels: Array<{
    modelId: string;
    reason: string;
  }>;
  fallbackChain: string[];
  decisionReason: string;
  evaluatorScore?: number;
  constraintsSnapshot?: {
    maxCostPerRequest?: number;
    maxLatencyMs?: number;
    requiredCapabilities?: string[];
    requiredHealth?: string;
  };
  createdAt?: number;
};

export type ModelUsageMetric = {
  modelId: string;
  providerId?: string;
  providerName?: string;
  calls7d: number;
  cost7d: number;
  avgCostPerCall: number;
  successRate: number;
  executionSuccessRate?: number;
  taskSuccessRate?: number;
  userAcceptedRate?: number;
  fallbackRecoveredRate?: number;
  hardFailureRate?: number;
  avgLatencyMs: number;
  fallbackRate: number;
  trends?: {
    calls7d?: number[];
    cost7d?: number[];
    success7d?: number[];
    fallback7d?: number[];
    latency7d?: number[];
  };
  flags?: Array<
    "high_cost" | "low_success" | "high_fallback" | "high_override" | "unstable_latency"
  >;
};

export type TaskUsageMetric = {
  taskProfileId: string;
  name?: string;
  calls7d: number;
  cost7d: number;
  topModelIds: string[];
  modelDistribution?: Array<{
    modelId: string;
    ratio: number;
  }>;
  failureRate: number;
  executionSuccessRate?: number;
  taskSuccessRate?: number;
  userAcceptedRate?: number;
  fallbackRecoveredRate?: number;
  hardFailureRate?: number;
  manualOverrideRate?: number;
  trends?: {
    calls7d?: number[];
    cost7d?: number[];
    success7d?: number[];
    fallback7d?: number[];
    manualOverride7d?: number[];
  };
  flags?: Array<
    "high_cost" | "low_success" | "high_fallback" | "high_override" | "unstable_latency"
  >;
};

export type PlanUsageMetric = {
  planId: string;
  name?: string;
  taskProfileId?: string;
  calls7d: number;
  cost7d: number;
  avgCostPerCall?: number;
  budgetStatus: "within_budget" | "near_limit" | "over_budget";
  budget?: {
    targetCostPerCall?: number;
    actualCostPerCall?: number;
    deviationRatio?: number;
    source: "plan" | "taskProfile" | "tenantPolicy";
  };
  modelDistribution?: Array<{
    modelId: string;
    ratio: number;
  }>;
  fallbackRate?: number;
  manualOverrideRate?: number;
  trends?: {
    calls7d?: number[];
    cost7d?: number[];
    fallback7d?: number[];
    manualOverride7d?: number[];
  };
  flags?: Array<
    "high_cost" | "low_success" | "high_fallback" | "high_override" | "unstable_latency"
  >;
  recommendedAction?: string;
};

export type ModelGovernanceIssue = {
  issueId: string;
  type:
    | "high_cost_low_usage"
    | "high_usage_high_failure"
    | "unregistered_model_used"
    | "task_without_candidate"
    | "missing_fallback"
    | "fallback_never_used"
    | "cost_spike"
    | "manual_override_high"
    | "underused_model"
    | "missing_capability_tag"
    | "missing_price"
    | "aor_execution_unmapped"
    | "aor_no_policy_bindings"
    | "aor_sync_degraded";
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  relatedModelIds?: string[];
  relatedTaskProfileIds?: string[];
  relatedPlanIds?: string[];
  relatedPolicyIds?: string[];
  suggestedAction:
    | "deprecate_model"
    | "move_to_fallback"
    | "promote_to_primary"
    | "bind_to_task_profile"
    | "remove_from_recommendation_pool"
    | "complete_metadata"
    | "add_fallback"
    | "review_policy";
};

export type ModelIssueAction = {
  actionId: string;
  label: string;
  type:
    | "go_to_model_asset"
    | "go_to_task_plan"
    | "go_to_routing"
    | "go_to_usage"
    | "replace_model"
    | "add_fallback"
    | "adjust_policy"
    | "mark_ignored";
  payload?: Record<string, unknown>;
  isPrimary?: boolean;
};

export type GovernanceInsight = {
  insightId: string;
  type:
    | "model_underutilized"
    | "model_overused"
    | "high_cost_inefficiency"
    | "missing_capability"
    | "plan_inefficiency"
    | "routing_bias"
    | "fallback_ineffective";
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  impact: {
    costSavingPotential?: number;
    successRateImprovement?: number;
  };
  suggestion: string;
  actions: ModelIssueAction[];
  relatedObjects: {
    modelIds?: string[];
    planIds?: string[];
    policyIds?: string[];
  };
};

export type GovernanceRisk = {
  riskId: string;
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  targetTab: "modelAssets" | "taskPlans" | "smartRouting" | "usageAnalytics" | "governance";
  targetContext?: PlatformModelsTabContext;
};

export type ModelOverviewVM = {
  timeRange: {
    label: string;
    from?: number;
    to?: number;
  };
  summary: {
    totalProviders: number;
    totalModels: number;
    healthyModels: number;
    recommendationPoolSize: number;
    totalCalls7d: number;
    activeModels7d: number;
    cost7d: number;
    avgCostPerRequest: number;
    routingHitRate: number;
    fallbackRate: number;
    manualOverrideRate?: number;
    highCostModelCount?: number;
    highFailureTaskCount?: number;
    highFallbackPlanCount?: number;
  };
  trends?: {
    cost7d?: Array<{
      timestamp: number;
      cost: number;
    }>;
    routingHitRate7d?: Array<{
      timestamp: number;
      rate: number;
    }>;
  };
  topUsedModels: Array<{
    modelId: string;
    name: string;
    providerName?: string;
    calls: number;
    cost?: number;
    successRate?: number;
  }>;
  topCostModels: Array<{
    modelId: string;
    name: string;
    providerName?: string;
    cost: number;
    calls?: number;
    avgCostPerCall?: number;
  }>;
  routingHealth: {
    status: "healthy" | "warning" | "critical";
    primaryHitRate: number;
    fallbackRate: number;
    manualOverrideRate?: number;
    abnormalTaskCount: number;
    notes: Array<{
      type: "info" | "warning" | "critical";
      message: string;
      targetTab?: "smartRouting" | "taskPlans" | "governance" | "usageAnalytics";
      targetContext?: PlatformModelsTabContext;
    }>;
  };
  governancePreview: Array<{
    issueId: string;
    severity: "critical" | "warning" | "info";
    title: string;
    description: string;
    suggestedAction:
      | "deprecate_model"
      | "move_to_fallback"
      | "promote_to_primary"
      | "bind_to_task_profile"
      | "remove_from_recommendation_pool"
      | "complete_metadata"
      | "add_fallback"
      | "review_policy";
    targetTab: "modelAssets" | "taskPlans" | "smartRouting" | "usageAnalytics" | "governance";
    targetContext?: PlatformModelsTabContext;
  }>;
  optimizationHighlights: GovernanceInsight[];
  structuralRisks: GovernanceRisk[];
  quickActions: Array<{
    label: string;
    targetTab: "modelAssets" | "taskPlans" | "smartRouting" | "usageAnalytics" | "governance";
    intent: "add_model" | "create_plan" | "review_routing" | "view_usage" | "fix_governance";
    targetContext?: PlatformModelsTabContext;
  }>;
  routingWorkbench: {
    plans: Array<{
      planId: string;
      name: string;
      description: string;
      callsShare: number;
      status: ModelPlan["status"];
    }>;
    selectedPlan?: {
      planId: string;
      name: string;
      description: string;
      primaryModel: {
        modelId: string;
        name: string;
        providerName?: string;
        hitRate?: number;
      };
      candidates: Array<{
        modelId: string;
        name: string;
        providerName?: string;
        ratio?: number;
      }>;
      fallbackChain: Array<{
        modelId: string;
        name: string;
        providerName?: string;
      }>;
      constraints: string[];
      policyScope: string[];
      decision: {
        selectedModelName: string;
        selectedProvider?: string;
        cost?: number;
        latencyMs?: number;
        reasons: string[];
        rejectedModels: Array<{
          modelId: string;
          reason: string;
        }>;
      };
    };
    performance: {
      byPlan: Array<{
        name: string;
        hitRate?: number;
        fallbackRate?: number;
        manualOverrideRate?: number;
        avgCostPerCall?: number;
      }>;
      byModel: Array<{
        name: string;
        calls: number;
        successRate?: number;
        fallbackRate?: number;
        avgCostPerCall?: number;
      }>;
    };
  };
};

export type ModelAssetsVM = {
  summary: {
    totalModels: number;
    activeModels7d: number;
    healthyModels: number;
    degradedModels: number;
    unavailableModels: number;
    recommendationPoolSize: number;
    tenantSelectableModels: number;
  };
  models: ModelAsset[];
  filters: {
    providers: string[];
    modalities: string[];
    capabilities: string[];
    costTiers: Array<"low" | "medium" | "high" | "unknown">;
    healthStates: Array<"healthy" | "degraded" | "unavailable">;
    taskTags: string[];
  };
  defaultSort: {
    field:
      | "displayName"
      | "providerId"
      | "calls7d"
      | "cost7d"
      | "avgLatencyMs"
      | "stabilityScore"
      | "costTier"
      | "health";
    direction: "asc" | "desc";
  };
  emptyState?: {
    title: string;
    description: string;
    primaryActionLabel?: string;
  };
};

export type ModelTaskPlansVM = {
  summary: {
    totalTaskProfiles: number;
    totalPlans: number;
    publishedPlans: number;
    draftPlans: number;
    deprecatedPlans: number;
    userSelectablePlans: number;
    tenantOverrideAllowedPlans: number;
    plansMissingFallback: number;
  };
  taskProfiles: TaskProfile[];
  plans: ModelPlan[];
  filters: {
    categories: TaskProfile["category"][];
    priorityModes: TaskProfile["priorityMode"][];
    audiences: ModelPlan["audience"][];
    statuses: ModelPlan["status"][];
    costTargets: ModelPlan["costTarget"][];
    qualityTargets: ModelPlan["qualityTarget"][];
    latencyTargets: ModelPlan["latencyTarget"][];
  };
  defaultSort: {
    field: "name" | "category" | "status" | "calls7d" | "cost7d" | "updatedAt";
    direction: "asc" | "desc";
  };
  emptyState?: {
    title: string;
    description: string;
    primaryActionLabel?: string;
  };
};

export type ModelRoutingVM = {
  summary: {
    totalPolicies: number;
    activePolicies: number;
    draftPolicies: number;
    disabledPolicies: number;
    policiesMissingFallback: number;
    conflictsCount: number;
    averagePrimaryHitRate?: number;
    averageFallbackRate?: number;
    manualOverrideRate?: number;
  };
  policies: RoutingPolicy[];
  explanations: RoutingDecisionExplanation[];
  conflicts: Array<{
    conflictId: string;
    policyId: string;
    reason: string;
    severity: "critical" | "warning";
    relatedPolicyIds?: string[];
    suggestedAction?: string;
  }>;
  filters: {
    taskProfileIds: string[];
    planIds: string[];
    statuses: RoutingPolicy["status"][];
    rankingModes: RoutingPolicy["ranking"]["mode"][];
    scopeTypes: Array<"platform" | "tenant" | "userSegment" | "agent">;
  };
  defaultSort: {
    field: "name" | "status" | "fallbackRate" | "primaryHitRate" | "updatedAt";
    direction: "asc" | "desc";
  };
  emptyState?: {
    title: string;
    description: string;
    primaryActionLabel?: string;
  };
};

export type ModelUsageAnalyticsVM = {
  timeRange: {
    label: string;
    from?: number;
    to?: number;
  };
  summary: {
    totalCalls7d: number;
    totalCost7d: number;
    avgCostPerRequest: number;
    avgExecutionSuccessRate?: number;
    avgTaskSuccessRate?: number;
    avgUserAcceptedRate?: number;
    avgLatencyMs?: number;
    avgFallbackRate?: number;
    avgManualOverrideRate?: number;
    highestCostModelId?: string;
    highestCostTaskProfileId?: string;
    overBudgetPlanCount: number;
    highCostModelCount: number;
    highFailureTaskCount: number;
    highFallbackPlanCount: number;
    trends?: {
      calls7d?: number[];
      cost7d?: number[];
      success7d?: number[];
      fallback7d?: number[];
      manualOverride7d?: number[];
    };
  };
  byModel: ModelUsageMetric[];
  byTask: TaskUsageMetric[];
  byPlan: PlanUsageMetric[];
  filters: {
    modelIds: string[];
    taskProfileIds: string[];
    planIds: string[];
    providerIds: string[];
    capabilityTags: string[];
    budgetStatuses: PlanUsageMetric["budgetStatus"][];
  };
  defaultView: "byModel" | "byTask" | "byPlan";
  defaultSort: {
    field:
      | "calls7d"
      | "cost7d"
      | "avgCostPerCall"
      | "successRate"
      | "avgLatencyMs"
      | "fallbackRate"
      | "manualOverrideRate";
    direction: "asc" | "desc";
  };
  emptyState?: {
    title: string;
    description: string;
    primaryActionLabel?: string;
  };
  aor?: {
    enabled: boolean;
    syncStatus?: PlatformAorReadModel["syncStatus"];
    banditArms: PlatformAorReadModel["learning"]["arms"];
    optimization?: PlatformAorReadModel["optimization"];
  };
};

export type ModelGovernanceVM = {
  summary: {
    totalIssues: number;
    criticalIssues: number;
    warningIssues: number;
    infoIssues: number;
    highCostProblems: number;
    routingFailures: number;
    highOverrideProblems: number;
    modelIssues: number;
    taskProfileIssues: number;
    planIssues: number;
    policyIssues: number;
    recommendedActions: number;
    optimizationInsights: number;
    structuralRisks: number;
  };
  insights: GovernanceInsight[];
  risks: GovernanceRisk[];
  assetOptimizations: GovernanceInsight[];
  planOptimizations: GovernanceInsight[];
  policyOptimizations: GovernanceInsight[];
  issues: Array<
    ModelGovernanceIssue & {
      targetTab: "modelAssets" | "taskPlans" | "smartRouting" | "usageAnalytics" | "governance";
      targetIds: string[];
      context: {
        modelId?: string;
        planId?: string;
        taskProfileId?: string;
        policyId?: string;
      };
      metrics: {
        cost7d?: number;
        fallbackRate?: number;
        successRate?: number;
        overrideRate?: number;
      };
      rootCause?: string;
      suggestedActions: ModelIssueAction[];
      createdAt: number;
    }
  >;
  recommendations: Array<{
    id: string;
    title: string;
    action: string;
    severity?: "critical" | "warning" | "info";
    targetType: "model" | "taskProfile" | "plan" | "policy";
    targetId: string;
    targetTab: "modelAssets" | "taskPlans" | "smartRouting" | "usageAnalytics" | "governance";
  }>;
  filters: {
    severities: Array<"critical" | "warning" | "info">;
    issueTypes: ModelGovernanceIssue["type"][];
    targetTabs: Array<
      "modelAssets" | "taskPlans" | "smartRouting" | "usageAnalytics" | "governance"
    >;
  };
  defaultSort: {
    field: "severity" | "type" | "title";
    direction: "asc" | "desc";
  };
  emptyState?: {
    title: string;
    description: string;
    primaryActionLabel?: string;
  };
};

export type PlatformModelsVM = {
  overview: ModelOverviewVM;
  assets: ModelAssetsVM;
  taskPlans: ModelTaskPlansVM;
  routing: ModelRoutingVM;
  analytics: ModelUsageAnalyticsVM;
  governance: ModelGovernanceVM;
  platformModelsMode?: PlatformModelsMode;
  modelsManagementLoading?: boolean;
  modelsManagementError?: string | null;
  modelsManagementSnapshotAt?: string | null;
  aor?: PlatformAorReadModel;
  context?: PlatformModelsTabContext;
  compat?: {
    legacyModelsVM: LegacyPlatformModelsVM | null;
  };
};
