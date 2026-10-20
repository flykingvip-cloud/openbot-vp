/**
 * 容量扩容 / 套餐升级建议（P3 纯函数）。
 */

import { assessCostOverBudgetRisk, assessCreditsRisk } from "./alerts.js";
import type {
  CapacityRecommendation,
  CapacityRecommendationDecisionOption,
  ConsumptionForecast,
  ForecastRiskLevel,
} from "./types.js";

export type PlanUpgradeCandidate = {
  planId: string;
  planName: string;
  maxBots: number;
  maxConcurrentRuns: number;
  monthlyCredits: number;
  monthlyPriceCents: number;
};

const SEV_RANK: Record<ForecastRiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function sortBySeverity(recs: CapacityRecommendation[]): CapacityRecommendation[] {
  return recs.toSorted((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
}

function findUpgradePlan(
  candidates: readonly PlanUpgradeCandidate[],
  currentPlanId: string,
  needs: {
    minBots?: number;
    minConcurrency?: number;
    minCredits?: number;
  },
): PlanUpgradeCandidate | null {
  const eligible = candidates.filter((plan) => {
    if (plan.planId === currentPlanId) {
      return false;
    }
    if (needs.minBots != null && needs.minBots > 0) {
      if (plan.maxBots > 0 && plan.maxBots < needs.minBots) {
        return false;
      }
    }
    if (needs.minConcurrency != null && needs.minConcurrency > 0) {
      if (plan.maxConcurrentRuns > 0 && plan.maxConcurrentRuns < needs.minConcurrency) {
        return false;
      }
    }
    if (needs.minCredits != null && needs.minCredits > 0) {
      if (plan.monthlyCredits > 0 && plan.monthlyCredits < needs.minCredits) {
        return false;
      }
    }
    return true;
  });
  if (eligible.length === 0) {
    return null;
  }
  return eligible.toSorted((a, b) => a.monthlyPriceCents - b.monthlyPriceCents)[0];
}

function upgradeDecisionOptions(
  candidate: PlanUpgradeCandidate | null,
  contactSalesLabel: string,
): CapacityRecommendationDecisionOption[] {
  if (!candidate) {
    return [{ id: "contact_sales", label: contactSalesLabel }];
  }
  return [
    {
      id: `upgrade:${candidate.planId}`,
      label: `升级至 ${candidate.planName}`,
      planId: candidate.planId,
    },
    { id: "contact_sales", label: contactSalesLabel },
  ];
}

export function buildCapacityRecommendations(input: {
  forecast: ConsumptionForecast;
  currentPlanId: string;
  currentPlanName: string;
  upgradeCandidates: readonly PlanUpgradeCandidate[];
  monthlyBudgetCents?: number;
  labels?: {
    contactSales?: string;
  };
}): CapacityRecommendation[] {
  const recs: CapacityRecommendation[] = [];
  const contactSales = input.labels?.contactSales ?? "联系顾问定制方案";
  const budget = input.monthlyBudgetCents ?? 0;

  if (input.forecast.botQuotaRisk === "high" || input.forecast.botQuotaRisk === "medium") {
    const needBots = input.forecast.projectedBotsAtCycleEnd ?? input.forecast.activeBots + 1;
    const upgrade = findUpgradePlan(input.upgradeCandidates, input.currentPlanId, {
      minBots: needBots + 1,
    });
    recs.push({
      id: "rec-bot-quota",
      kind: upgrade ? "upgrade_plan" : "contact_sales",
      trigger: "bot_quota",
      severity: input.forecast.botQuotaRisk,
      title: "Bot 配额即将触顶",
      message:
        input.forecast.botQuotaRiskMessage ??
        `当前 ${input.forecast.activeBots} 个 AI 员工，套餐上限 ${input.forecast.maxBots}。`,
      decisionOptions: upgradeDecisionOptions(upgrade, contactSales),
    });
  }

  if (input.forecast.concurrencyRisk === "high" || input.forecast.concurrencyRisk === "medium") {
    const needConcurrency = Math.max(
      input.forecast.concurrencyUsed,
      input.forecast.concurrencyPeakInCycle,
    );
    const upgrade = findUpgradePlan(input.upgradeCandidates, input.currentPlanId, {
      minConcurrency: needConcurrency + 1,
    });
    recs.push({
      id: "rec-concurrency",
      kind: upgrade ? "upgrade_plan" : "contact_sales",
      trigger: "concurrency",
      severity: input.forecast.concurrencyRisk,
      title: "并发容量不足",
      message:
        input.forecast.concurrencyRiskMessage ??
        `峰值并发 ${input.forecast.concurrencyPeakInCycle}，上限 ${input.forecast.concurrencyLimit}。`,
      decisionOptions: upgradeDecisionOptions(upgrade, contactSales),
    });
  }

  const creditsRisk = assessCreditsRisk(input.forecast);
  if (creditsRisk === "high" || creditsRisk === "medium") {
    const upgrade = findUpgradePlan(input.upgradeCandidates, input.currentPlanId, {
      minCredits:
        input.forecast.monthlyCredits + Math.max(100, input.forecast.monthlyCredits * 0.5),
    });
    recs.push({
      id: "rec-credits",
      kind: upgrade ? "upgrade_plan" : "top_up_credits",
      trigger: "credits",
      severity: creditsRisk,
      title: "Credits 即将耗尽",
      message:
        input.forecast.creditsEtaDays != null
          ? `预计 ${input.forecast.creditsEtaDays} 天内耗尽，剩余 ${input.forecast.creditsRemaining}。`
          : `Credits 剩余 ${input.forecast.creditsRemaining}，消耗速率偏高。`,
      decisionOptions: upgrade
        ? upgradeDecisionOptions(upgrade, contactSales)
        : [
            { id: "top_up_credits", label: "购买 Credits 加量包" },
            { id: "contact_sales", label: contactSales },
          ],
    });
  }

  const costRisk = assessCostOverBudgetRisk(input.forecast, budget);
  if (costRisk === "high" || costRisk === "medium") {
    recs.push({
      id: "rec-cost-budget",
      kind: "reduce_concurrency",
      trigger: "cost",
      severity: costRisk,
      title: "预计超出月度预算",
      message: `预测月底成本 ${input.forecast.forecastCostCents ?? "—"} 分，预算 ${budget} 分。建议收紧并发或升级套餐。`,
      decisionOptions: [
        { id: "review_budget", label: "调整预算与控制策略" },
        { id: "contact_sales", label: contactSales },
      ],
    });
  }

  if (input.forecast.marginWarning === "high") {
    recs.push({
      id: "rec-margin",
      kind: "contact_sales",
      trigger: "margin",
      severity: input.forecast.marginWarning,
      title: "毛利预警",
      message:
        input.forecast.marginWarningMessage ??
        "本周期供应商成本接近或超过收入归因，建议优化模型策略。",
      decisionOptions: [{ id: "contact_sales", label: contactSales }],
    });
  }

  return sortBySeverity(recs);
}
