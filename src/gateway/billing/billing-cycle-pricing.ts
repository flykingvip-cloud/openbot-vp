/**
 * 计费周期定价（展示/报价层）。
 *
 * 月度 `basePriceCents` 为基准价；季度 / 年度按周期折扣计算「周期总价」与「等效月价」，
 * 用于套餐对比页的周期切换展示与下单报价。纯函数、无副作用，便于单测。
 *
 * 折扣为建议基线（商业侧可调）：季度 95 折（5% off）、年度 85 折（15% off）。
 * 单价单调递减不倒挂：月度 > 季度（等效月价）> 年度（等效月价）。
 */

import type { BillingCycle } from "./types.js";

/** 每个周期包含的月数。 */
export const CYCLE_MONTHS: Record<BillingCycle, number> = {
  monthly: 1,
  quarterly: 3,
  annual: 12,
};

/**
 * 周期折扣系数（应用于「月价 × 月数」后的总价）。1 = 无折扣。
 * monthly=1.0；quarterly=0.95（5% off）；annual=0.85（15% off）。
 */
export const CYCLE_DISCOUNT_MULTIPLIER: Record<BillingCycle, number> = {
  monthly: 1,
  quarterly: 0.95,
  annual: 0.85,
};

/** @deprecated 历史订单/配置可能仍写入 semiannual，运行时统一归一化为 quarterly。 */
export function normalizeBillingCycle(cycle: string | undefined | null): BillingCycle | undefined {
  if (!cycle) {
    return undefined;
  }
  if (cycle === "semiannual") {
    return "quarterly";
  }
  if (cycle === "monthly" || cycle === "quarterly" || cycle === "annual") {
    return cycle;
  }
  return undefined;
}

export type CyclePriceQuote = {
  cycle: BillingCycle;
  months: number;
  /** 该周期一次性应付总价（分，四舍五入到整数分）。 */
  totalCents: number;
  /** 等效月价（分，total / months，四舍五入），用于跨周期单价对比。 */
  effectiveMonthlyCents: number;
  /** 不打折时的原总价（分），用于展示划线价。 */
  listTotalCents: number;
  /** 节省金额（分） = listTotal - total。 */
  savingsCents: number;
  /** 折扣率（0..1），如 annual=0.15。 */
  discountRate: number;
};

/**
 * 计算某周期的报价。`monthlyBaseCents` 为月度基准价（Plan.basePriceCents）。
 */
export function computeCyclePrice(monthlyBaseCents: number, cycle: BillingCycle): CyclePriceQuote {
  const base = Math.max(0, Math.round(monthlyBaseCents));
  const months = CYCLE_MONTHS[cycle];
  const multiplier = CYCLE_DISCOUNT_MULTIPLIER[cycle];
  const listTotalCents = base * months;
  const totalCents = Math.round(listTotalCents * multiplier);
  const effectiveMonthlyCents = Math.round(totalCents / months);
  return {
    cycle,
    months,
    totalCents,
    effectiveMonthlyCents,
    listTotalCents,
    savingsCents: listTotalCents - totalCents,
    discountRate: 1 - multiplier,
  };
}

/** 一次性返回三周期报价，供对比页周期切换器使用。 */
export function computeAllCyclePrices(monthlyBaseCents: number): CyclePriceQuote[] {
  return (Object.keys(CYCLE_MONTHS) as BillingCycle[]).map((cycle) =>
    computeCyclePrice(monthlyBaseCents, cycle),
  );
}
