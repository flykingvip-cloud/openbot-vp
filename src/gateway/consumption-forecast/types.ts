import type { ModelBudgetStatus } from "../billing/model-budget-status.js";

/** 预测风险等级（none → high）。 */
export type ForecastRiskLevel = "none" | "low" | "medium" | "high";

export type ConsumptionForecast = {
  enterpriseId: string;
  cycleStart: string;
  cycleEnd: string;
  computedAt: string;
  /** 本周期预计月底成本（分）；enterprise_budget 用 provider 成本路径。 */
  forecastCostCents: number | null;
  forecastCostInsufficientData: boolean;
  creditsRemaining: number;
  monthlyCredits: number;
  /** 按当前消耗速率预计 Credits 耗尽天数；无配额或数据不足时为 null。 */
  creditsEtaDays: number | null;
  creditsEtaInsufficientData: boolean;
  concurrencyUsed: number;
  concurrencyLimit: number;
  concurrencyPeakInCycle: number;
  concurrencyRisk: ForecastRiskLevel;
  concurrencyRiskMessage?: string;
  marginCents: number;
  tenantRevenueCents: number;
  providerCostCents: number;
  marginRatio: number | null;
  marginWarning: ForecastRiskLevel;
  marginWarningMessage?: string;
  /** 成本预测算法：≥3 日 ledger 序列时用 WMA，否则 linear。 */
  forecastCostMode: "linear" | "wma";
  /** 当前活跃 Bot 数。 */
  activeBots: number;
  maxBots: number;
  botsCreatedInCycle: number;
  botGrowthRatePerDay: number | null;
  projectedBotsAtCycleEnd: number | null;
  botGrowthInsufficientData: boolean;
  botQuotaRisk: ForecastRiskLevel;
  botQuotaRiskMessage?: string;
  /**
   * Phase 4：模型级预算分账状态（口径独立于套餐总 Credits）。
   * 仅当当前订阅版本配置了 modelBudgets 时出现；否则省略（能力未启用）。
   */
  modelBudgets?: ModelBudgetStatus[];
};

export type CapacityRecommendationKind =
  | "upgrade_plan"
  | "top_up_credits"
  | "reduce_concurrency"
  | "contact_sales";

export type CapacityRecommendationTrigger =
  | "bot_quota"
  | "concurrency"
  | "credits"
  | "margin"
  | "cost";

export type CapacityRecommendationDecisionOption = {
  id: string;
  label: string;
  planId?: string;
};

export type CapacityRecommendation = {
  id: string;
  kind: CapacityRecommendationKind;
  trigger: CapacityRecommendationTrigger;
  severity: ForecastRiskLevel;
  title: string;
  message: string;
  decisionOptions?: CapacityRecommendationDecisionOption[];
};

export type ForecastAtRiskEnterprise = {
  enterpriseId: string;
  planId?: string;
  alerts: ForecastAlertKind[];
  maxRisk: ForecastRiskLevel;
  concurrencyRisk: ForecastRiskLevel;
  creditsEtaDays: number | null;
  marginWarning: ForecastRiskLevel;
  forecastCostCents: number | null;
};

export type ForecastAlertKind = "concurrency" | "credits" | "margin" | "cost" | "bots";

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
  atRiskEnterprises: ForecastAtRiskEnterprise[];
};
