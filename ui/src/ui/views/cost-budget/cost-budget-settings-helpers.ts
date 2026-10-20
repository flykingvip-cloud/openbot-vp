/**
 * 成本与预算 v2 — 设置页权限与 AOR 分析 panel 可见性。
 */

import type { AnalyticsResponse } from "../../capability/cost-budget-billing/index.ts";

export const AOR_METERING_KEYS = [
  "aor_task",
  "aor_orchestration",
  "aor_optimization_savings",
  "aor_optimization_revenue_share",
] as const;

export const GOVERNANCE_METERING_KEYS = [
  "knowledge_governance_llm_call",
  "knowledge_governance_llm_tokens",
] as const;

export function computeGovernanceMeterTotal(
  analytics: AnalyticsResponse | null | undefined,
): number {
  if (!analytics?.byKey) {
    return 0;
  }
  return GOVERNANCE_METERING_KEYS.reduce((sum, key) => sum + (analytics.byKey[key] ?? 0), 0);
}

export function computeAorTotal(analytics: AnalyticsResponse | null | undefined): number {
  if (!analytics?.byKey) {
    return 0;
  }
  return AOR_METERING_KEYS.reduce((sum, key) => sum + (analytics.byKey[key] ?? 0), 0);
}

/** v2.1 冻结：仅当本周期 AOR 计量合计 > 0 时展示使用量分析 panel。 */
export function isAnalyticsPanelVisible(analytics: AnalyticsResponse | null | undefined): boolean {
  return computeAorTotal(analytics) > 0;
}

/** 非 enterprise-admin 隐藏「设置」（预算编辑入口）。 */
export function canAccessCostBudgetSettings(membershipRole: string | null | undefined): boolean {
  return (membershipRole ?? "enterprise-admin") === "enterprise-admin";
}
