/**
 * 计费周期定价（UI 展示/报价层）。与后端 `src/gateway/billing/billing-cycle-pricing.ts`
 * 折扣口径保持一致：月度基准、季度 95 折、年度 85 折。纯函数，供对比页周期切换。
 *
 * BillingCycle 在此本地定义，避免 UI 组件耦合到 capability 类型镜像的改动（便于独立落地）。
 */

export type BillingCycle = "monthly" | "quarterly" | "annual";

export const CYCLE_MONTHS: Record<BillingCycle, number> = { monthly: 1, quarterly: 3, annual: 12 };

export const CYCLE_DISCOUNT_MULTIPLIER: Record<BillingCycle, number> = {
  monthly: 1,
  quarterly: 0.95,
  annual: 0.85,
};

export const BILLING_CYCLES: readonly BillingCycle[] = ["monthly", "quarterly", "annual"];

export type CyclePriceQuote = {
  cycle: BillingCycle;
  months: number;
  totalCents: number;
  effectiveMonthlyCents: number;
  listTotalCents: number;
  savingsCents: number;
  discountRate: number;
};

export function computeCyclePrice(monthlyBaseCents: number, cycle: BillingCycle): CyclePriceQuote {
  const base = Math.max(0, Math.round(monthlyBaseCents));
  const months = CYCLE_MONTHS[cycle];
  const multiplier = CYCLE_DISCOUNT_MULTIPLIER[cycle];
  const listTotalCents = base * months;
  const totalCents = Math.round(listTotalCents * multiplier);
  return {
    cycle,
    months,
    totalCents,
    effectiveMonthlyCents: Math.round(totalCents / months),
    listTotalCents,
    savingsCents: listTotalCents - totalCents,
    discountRate: 1 - multiplier,
  };
}
