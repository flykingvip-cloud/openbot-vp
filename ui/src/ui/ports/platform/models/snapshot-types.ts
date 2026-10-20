/** UI mirror of gateway `PlatformModelsManagementSnapshot` (no @openbot/aor-* imports). */

export type PlatformModelsMode = "native" | "aor_enhanced";

export type PlatformAorSyncStatus = "ok" | "degraded" | "unavailable";

export type PlatformAorSelectorStrategy = "cheapest" | "best_quality" | "balanced" | "bandit";

export type PlatformAorEvaluatorMode = "content" | "workspace";

export type PlatformAorExecution = {
  taskTypeId: string;
  skillId?: string;
  selectorStrategy: PlatformAorSelectorStrategy;
  evaluatorMode: PlatformAorEvaluatorMode;
};

export type PlatformAorPolicyBinding = {
  planId: string;
  taskProfileId: string;
  taskTypeId: string;
  selectorStrategy: PlatformAorSelectorStrategy;
  evaluatorMode: PlatformAorEvaluatorMode;
  mapped: boolean;
};

export type PlatformAorRoutingExplanation = {
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

export type PlatformAorLiveCodingEvidence = {
  archivedAt: string;
  workspace: string;
  goal: string;
  model: string;
  evaluationScore?: number;
  runId: string;
};

export type PlatformAorReadModel = {
  enabled: boolean;
  syncStatus: PlatformAorSyncStatus;
  policyBindings: PlatformAorPolicyBinding[];
  routingExplanations: PlatformAorRoutingExplanation[];
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
  liveCodingEvidence: PlatformAorLiveCodingEvidence[];
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

export type PlatformModelsManagementSnapshot = {
  mode: PlatformModelsMode;
  generatedAt: string;
  assets?: Array<{
    modelRef: string;
    providerId: string;
    modelId: string;
    name: string | null;
    allowlisted: boolean;
    inCatalog: boolean;
  }>;
  governanceIssues?: Array<{
    issueId: string;
    type: string;
    severity: "critical" | "warning" | "info";
    title: string;
    description: string;
    relatedPlanIds?: string[];
    relatedPolicyIds?: string[];
    relatedModelRefs?: string[];
  }>;
  taskPlans?: Array<{
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
    userSelectable?: boolean;
    tenantOverrideAllowed?: boolean;
    updatedAt: number | null;
    aorExecution?: PlatformAorExecution;
  }>;
  taskProfiles?: PlatformModelsTaskProfileSnapshot[];
  routingPolicies?: Array<{
    policyId: string;
    name: string | null;
    taskProfileId: string | null;
    planId: string | null;
    primaryModelIds: string[];
    fallbackModelIds: string[];
    status: "active" | "draft" | "disabled" | null;
    rankingMode: "quality" | "cost" | "speed" | "balanced" | "bandit" | null;
    maxCostPerRequest?: number | null;
    maxLatencyMs?: number | null;
    requiredCapabilities?: string[];
    requiredHealth?: "healthy" | "not_unavailable" | null;
    scope?: {
      tenantIds: string[];
      userSegments: string[];
      agentIds: string[];
    };
    selectorStrategy?: PlatformAorSelectorStrategy;
    updatedAt?: number | null;
  }>;
  usageByModel?: PlatformModelsUsageModelSnapshot[];
  usageByPolicy?: PlatformModelsUsagePolicySnapshot[];
  usageByTask?: PlatformModelsUsageTaskSnapshot[];
  usageByPlan?: PlatformModelsUsagePlanSnapshot[];
  aor?: PlatformAorReadModel;
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
};
