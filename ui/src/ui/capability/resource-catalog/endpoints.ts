/**
 * Resource Catalog RPC 端点（Package V2 Phase 1）。
 */

export const RESOURCE_CATALOG_ENDPOINTS = {
  overview: "platform-resource-catalog.overview",
  tiersList: "platform-resource-catalog.tiers.list",
  tiersUpsert: "platform-resource-catalog.tiers.upsert",
  modelsList: "platform-resource-catalog.models.list",
  modelsUpsert: "platform-resource-catalog.models.upsert",
  modelsSeedFromConfig: "platform-resource-catalog.models.seed-from-config",
  creditWeightsList: "platform-resource-catalog.credit-weights.list",
  creditWeightsUpsert: "platform-resource-catalog.credit-weights.upsert",
  failoverRulesList: "platform-resource-catalog.failover-rules.list",
  failoverRulesUpsert: "platform-resource-catalog.failover-rules.upsert",
  resolveTiers: "platform-resource-catalog.resolve-tiers",
} as const;

export type ResourceTier = {
  id: string;
  code: string;
  name: string;
  description: string;
  sortOrder: number;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
};

export type ResourceModelCapability =
  | "coding"
  | "reasoning"
  | "tool_use"
  | "vision"
  | "long_context";

export type ResourceModelCatalogEntry = {
  modelId: string;
  provider: string;
  displayName: string;
  tier: string;
  enabled: boolean;
  contextWindow?: number;
  capabilities?: ResourceModelCapability[];
  avgTokensPerTask?: number;
  inputCostPer1MCents: number;
  outputCostPer1MCents: number;
  updatedAt: string;
};

export type CreditWeight = {
  tier: string;
  creditCost: number;
  updatedAt: string;
};

export type TierFailoverMode = "disabled" | "next_in_pool" | "fallback_tier";

export type TierFailoverRule = {
  tier: string;
  enabled: boolean;
  failureRateThreshold: number | null;
  minSampleSize: number;
  maxConsecutiveFailures: number;
  latencyThresholdMs: number;
  cooldownSeconds: number;
  mode: TierFailoverMode;
  fallbackTierId: string | null;
  fallbackModelId: string | null;
  updatedAt: string;
};

export type TierUsageStat = {
  tierId: string;
  taskCount: number;
  failureRate: number | null;
  avgLatencyMs: number | null;
};

export type TierUsageWindow = {
  startTime: string;
  endTime: string;
};

export type ResourceCatalogOverviewResponse = {
  tiers: ResourceTier[];
  models: ResourceModelCatalogEntry[];
  creditWeights: CreditWeight[];
  failoverRules: TierFailoverRule[];
  configModelCount: number;
  missingFromCatalog: string[];
  tierUsageWindow: TierUsageWindow;
  tierUsageStats: TierUsageStat[];
};

export type ResourceCatalogModelsUpsertRequest = {
  modelId: string;
  tier: string;
  provider?: string;
  displayName?: string;
  enabled?: boolean;
  contextWindow?: number;
  avgTokensPerTask?: number;
  inputCostPer1MCents?: number;
  outputCostPer1MCents?: number;
  capabilities?: ResourceModelCapability[];
};

export type ResourceCatalogSeedResponse = {
  tiers: number;
  weights: number;
  seed: { created: number; skipped: number; total: number };
};

export type ResourceCatalogTierUpsertRequest = {
  id: string;
  code: string;
  name: string;
  description?: string;
  sortOrder?: number;
  status?: "active" | "archived";
};

export type ResourceCatalogFailoverUpsertRequest = {
  tier: string;
  enabled?: boolean;
  failureRateThreshold?: number | null;
  minSampleSize?: number;
  maxConsecutiveFailures?: number;
  latencyThresholdMs?: number;
  cooldownSeconds?: number;
  mode?: TierFailoverMode;
  fallbackTierId?: string | null;
  fallbackModelId?: string | null;
};

export type TierModelPoolResult = {
  tierIds: string[];
  modelIds: string[];
  byTier: Record<string, string[]>;
};

export type ResourceCatalogResolveTiersResponse = {
  pool: TierModelPoolResult;
  comparison?: {
    projectedModelIds: string[];
    missingFromProjection: string[];
    extraInProjection: string[];
    aligned: boolean;
  };
};
