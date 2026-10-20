/**
 * Cost Version & Economics RPC 端点（Package V2 Phase 4）。
 */

export const COST_ECONOMICS_ENDPOINTS = {
  costVersionOverview: "platform-cost-version.overview",
  costVersionList: "platform-cost-version.list",
  costVersionGet: "platform-cost-version.get",
  costVersionCreateFromCatalog: "platform-cost-version.create-from-catalog",
  costVersionActivate: "platform-cost-version.activate",
  economicsOverview: "platform-economics.overview",
  economicsLedger: "platform-economics.ledger",
  consumptionForecastPlatformOverview: "consumption-forecast.platform-overview",
} as const;

export type ModelCostSnapshot = {
  modelId: string;
  tier: string;
  inputCostPer1MCents: number;
  outputCostPer1MCents: number;
};

export type CostVersion = {
  id: string;
  version: number;
  status: "active" | "draft" | "deprecated";
  modelCosts: Record<string, ModelCostSnapshot>;
  createdAt: string;
  activatedAt?: string;
};

export type CostVersionOverviewResponse = {
  versions: CostVersion[];
  activeVersion: CostVersion | null;
};

export type EconomicsSummary = {
  taskCount: number;
  creditsCharged: number;
  providerCostCents: number;
  tenantRevenueCents: number;
  marginCents: number;
};

export type EconomicsByPricingEngine = Record<"v1" | "v2", EconomicsSummary>;

export type EconomicsProjectionContext = {
  benchmark: { inputTokens?: number; outputTokens?: number };
  benchmarkSource?: "ledger" | "default";
  benchmarkSampleCount?: number;
  creditWeights: Array<{ tier: string; creditCost: number }>;
  tierCosts: Record<
    string,
    {
      modelId: string;
      inputCostPer1MCents: number;
      outputCostPer1MCents: number;
      creditCost: number;
      providerCostPerTaskCents: number;
      providerCostPerCreditCents: number | null;
    }
  >;
  tierObservedMix?: Record<string, number>;
  selectorMixProfiles?: Partial<
    Record<"cheapest" | "balanced" | "best_quality" | "bandit", Record<string, number>>
  >;
};

export type EnterprisePlanRef = {
  planId: string;
  planName: string;
};

export type EconomicsOverviewResponse = {
  startTime: string;
  endTime: string;
  previousStartTime?: string;
  previousEndTime?: string;
  activeCostVersionId: string | null;
  summary: EconomicsSummary;
  byPricingEngine?: EconomicsByPricingEngine;
  previousSummary?: EconomicsSummary;
  marginTrendDelta?: number | null;
  byEnterprise: Record<string, EconomicsSummary>;
  byPlan: Record<string, EconomicsSummary>;
  previousByPlan?: Record<string, EconomicsSummary>;
  enterprisePlans?: Record<string, EnterprisePlanRef>;
  projectionContext?: EconomicsProjectionContext;
};

export type EconomicsLedgerEntry = {
  id: string;
  enterpriseId: string;
  taskId: string;
  modelId: string;
  tier: string;
  policyId: string;
  creditsCharged: number;
  providerCostCents: number;
  tenantRevenueCents: number;
  planId?: string;
  planVersionId?: string;
  inputTokens?: number;
  outputTokens?: number;
  occurredAt: string;
  pricingEngine?: "v1" | "v2";
};

export type EconomicsLedgerResponse = {
  entries: EconomicsLedgerEntry[];
  total: number;
  startTime?: string;
  endTime?: string;
  planId?: string;
  enterpriseId?: string;
};

export type ForecastRiskLevel = "none" | "low" | "medium" | "high";

export type PlatformConsumptionForecastOverview = {
  cycleStart: string;
  cycleEnd: string;
  computedAt: string;
  enterpriseCount: number;
  summary: {
    concurrencyHigh: number;
    creditsCritical: number;
    marginHigh: number;
    botQuotaHigh: number;
    anyAlert: number;
  };
  atRiskEnterprises: Array<{
    enterpriseId: string;
    planId?: string;
    alerts: Array<"concurrency" | "credits" | "margin" | "cost" | "bots">;
    maxRisk: ForecastRiskLevel;
    concurrencyRisk: ForecastRiskLevel;
    creditsEtaDays: number | null;
    marginWarning: ForecastRiskLevel;
    forecastCostCents: number | null;
  }>;
};
