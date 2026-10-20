/**
 * 企业计费模式解析（纯函数 + IO 薄封装）。
 *
 * - credits：套餐含 monthlyCredits > 0，走 Credits 配额。
 * - enterprise_budget：monthlyCredits = 0（Enterprise），走供应商成本预算。
 */

export type EnterpriseBillingMode = "credits" | "enterprise_budget";

export function resolveBillingModeFromMonthlyCredits(
  monthlyCredits: number,
): EnterpriseBillingMode {
  return monthlyCredits > 0 ? "credits" : "enterprise_budget";
}
