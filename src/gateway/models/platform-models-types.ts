/** Platform model management canonical snapshot (server-side truth). */

export type PlatformModelsMode = "native" | "aor_enhanced";

export type PlatformModelsAorSyncStatus = "ok" | "degraded" | "unavailable";

export type PlatformModelsSelectorStrategy = "cheapest" | "best_quality" | "balanced" | "bandit";

export type PlatformModelsEvaluatorMode = "content" | "workspace";

export type PlatformModelsAorExecution = {
  taskTypeId: string;
  skillId?: string;
  selectorStrategy: PlatformModelsSelectorStrategy;
  evaluatorMode: PlatformModelsEvaluatorMode;
};

export type PlatformModelsPlanSnapshot = {
  planId: string;
  taskProfileId: string | null;
  name: string | null;
  description: string | null;
  audience: "platform" | "tenant" | "user" | null;
  primaryModelIds: string[];
  fallbackModelIds: string[];
  costTarget: "low" | "medium" | "high" | null;
  qualityTarget: "standard" | "high" | "premium" | null;
  latencyTarget: "realtime" | "interactive" | "batch" | null;
  status: "draft" | "published" | "deprecated" | null;
  userSelectable: boolean;
  tenantOverrideAllowed: boolean;
  updatedAt: number | null;
  aorExecution?: PlatformModelsAorExecution;
};

export type PlatformModelsRoutingPolicyScopeSnapshot = {
  tenantIds: string[];
  userSegments: string[];
  agentIds: string[];
};

export type PlatformModelsRoutingPolicySnapshot = {
  policyId: string;
  name: string | null;
  taskProfileId: string | null;
  planId: string | null;
  primaryModelIds: string[];
  fallbackModelIds: string[];
  status: "active" | "draft" | "disabled" | null;
  rankingMode: "quality" | "cost" | "speed" | "balanced" | "bandit" | null;
  maxCostPerRequest: number | null;
  maxLatencyMs: number | null;
  requiredCapabilities: string[];
  requiredHealth: "healthy" | "not_unavailable" | null;
  scope: PlatformModelsRoutingPolicyScopeSnapshot;
  updatedAt: number | null;
  selectorStrategy?: PlatformModelsSelectorStrategy;
};

export type PlatformModelsTaskProfileSnapshot = {
  taskProfileId: string;
  name: string;
  description: string | null;
  category: string;
  priorityMode: "quality" | "cost" | "speed" | "balanced";
  status: "active" | "draft" | "deprecated";
};

export type PlatformModelsUsageModelSnapshot = {
  modelRef: string;
  providerId: string;
  modelId: string;
  calls7d: number;
  cost7d: number;
  totalTokens?: number;
  successRate?: number;
  fallbackRate?: number;
  avgLatencyMs?: number;
  /** Legacy billing quantity when cost/calls are unavailable */
  quantity?: number;
};

export type PlatformModelsUsagePolicySnapshot = {
  policyId: string;
  calls7d: number;
  quantity: number;
  primaryHitRate?: number;
  fallbackRate?: number;
  manualOverrideRate?: number;
  avgLatencyMs?: number;
  avgCostPerRequest?: number;
};

export type PlatformModelsUsageTaskSnapshot = {
  taskProfileId: string;
  name?: string;
  calls7d: number;
  cost7d: number;
  topModelRefs: string[];
  failureRate?: number;
  manualOverrideRate?: number;
};

export type PlatformModelsUsagePlanSnapshot = {
  planId: string;
  taskProfileId: string;
  name?: string;
  calls7d: number;
  cost7d: number;
  fallbackRate?: number;
  manualOverrideRate?: number;
};

export type PlatformModelsAssetSnapshot = {
  modelRef: string;
  providerId: string;
  modelId: string;
  name: string | null;
  allowlisted: boolean;
  inCatalog: boolean;
};

export type PlatformModelsGovernanceIssueSnapshot = {
  issueId: string;
  type: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  relatedPlanIds?: string[];
  relatedPolicyIds?: string[];
  relatedModelRefs?: string[];
};

export type PlatformModelsRoutingExplanationSnapshot = {
  requestId: string;
  taskProfileId: string;
  planId?: string;
  selectedModelId: string;
  matchedRules: string[];
  rejectedModels: Array<{ modelId: string; reason: string }>;
  fallbackChain: string[];
  decisionReason: string;
  evaluatorScore?: number;
  createdAt?: number;
};

export type PlatformModelsPolicyBindingSnapshot = {
  planId: string;
  taskProfileId: string;
  taskTypeId: string;
  selectorStrategy: PlatformModelsSelectorStrategy;
  evaluatorMode: PlatformModelsEvaluatorMode;
  mapped: boolean;
};

export type PlatformModelsLiveCodingEvidenceSnapshot = {
  archivedAt: string;
  workspace: string;
  goal: string;
  model: string;
  evaluationScore?: number;
  runId: string;
};

export type PlatformModelsAorProjection = {
  enabled: boolean;
  syncStatus: PlatformModelsAorSyncStatus;
  policyBindings: PlatformModelsPolicyBindingSnapshot[];
  routingExplanations: PlatformModelsRoutingExplanationSnapshot[];
  learning: {
    arms: Array<{ arm: string; mean: number; trials: number }>;
    updatedAt?: number;
  };
  optimization: {
    savingsProxyQty: number;
    revenueShareProxyQty: number;
    savingsUsd?: number;
    revenueShareUsd?: number;
    updatedAt?: number;
  };
  liveCodingEvidence: PlatformModelsLiveCodingEvidenceSnapshot[];
};

export type PlatformModelsManagementSnapshot = {
  mode: PlatformModelsMode;
  generatedAt: string;
  /** Last persisted models.probe results. Session probes still win per model in the UI. */
  lastModelProbe?: {
    finishedAt: number;
    results: Array<{
      provider: string;
      model?: string;
      label: string;
      source: string;
      status: string;
      latencyMs?: number;
      error?: string;
    }>;
  };
  assets: PlatformModelsAssetSnapshot[];
  taskPlans: PlatformModelsPlanSnapshot[];
  taskProfiles: PlatformModelsTaskProfileSnapshot[];
  routingPolicies: PlatformModelsRoutingPolicySnapshot[];
  governanceIssues: PlatformModelsGovernanceIssueSnapshot[];
  usageByModel: PlatformModelsUsageModelSnapshot[];
  usageByPolicy: PlatformModelsUsagePolicySnapshot[];
  usageByTask: PlatformModelsUsageTaskSnapshot[];
  usageByPlan: PlatformModelsUsagePlanSnapshot[];
  aor?: PlatformModelsAorProjection;
};

export type PlatformModelsAorStatus = {
  mode: PlatformModelsMode;
  enabled: boolean;
  syncStatus: PlatformModelsAorSyncStatus;
  banditStatePath?: string;
  liveCodingArchivePath?: string;
  lastSnapshotAt?: string;
};
