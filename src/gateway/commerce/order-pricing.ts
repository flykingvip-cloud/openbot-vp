/**
 * 商业订单金额计算（纯函数）。
 *
 * 报价真源：PlanVersion.snapshot.basePriceCents（Property 1 / 版本锁定语义）。
 * Proration 窗口：subscription.commercialContract 优先，monthly 退化为自然月。
 */

import { computeCyclePrice } from "../billing/billing-cycle-pricing.js";
import type { Subscription } from "../billing/types.js";
import { remainingRatioInWindow, resolveProrationWindow } from "./commercial-contract.js";
import type { VersionPricingSource } from "./pricing-version-source.js";

export type SubscribeQuoteInput = {
  source: VersionPricingSource;
};

export type ChangePlanQuoteInput = {
  current: VersionPricingSource;
  target: VersionPricingSource;
  subscription?: Subscription | null;
  now?: Date;
};

export type OrderQuote = {
  amountCents: number;
  lineItems: Array<{ label: string; amountCents: number }>;
  /** 报价所依据的版本 id（审计 / 订单快照）。 */
  planVersionIds: string[];
  prorationUsesCommercialContract?: boolean;
};

export function quoteSubscribeOrder(input: SubscribeQuoteInput): OrderQuote {
  const cycle = input.source.billingCycle;
  const quote = computeCyclePrice(input.source.basePriceCents, cycle);
  return {
    amountCents: quote.totalCents,
    lineItems: [
      {
        label: `${input.source.planName} · ${cycle} · v:${input.source.planVersionId}`,
        amountCents: quote.totalCents,
      },
    ],
    planVersionIds: [input.source.planVersionId],
  };
}

/** 立即换套餐：按合同剩余比例 Proration 差价（非负）；current 用锁定版本快照。 */
export function quoteChangePlanOrder(input: ChangePlanQuoteInput): OrderQuote {
  const cycle = input.target.billingCycle;
  const now = input.now ?? new Date();
  const window = resolveProrationWindow(input.subscription, cycle, now);
  const remainingRatio = remainingRatioInWindow(window, now);

  const oldQuote = computeCyclePrice(input.current.basePriceCents, cycle);
  const newQuote = computeCyclePrice(input.target.basePriceCents, cycle);
  const creditOld = Math.round(oldQuote.totalCents * remainingRatio);
  const chargeNew = Math.round(newQuote.totalCents * remainingRatio);
  const amountCents = Math.max(0, chargeNew - creditOld);

  return {
    amountCents,
    lineItems: [
      {
        label: `剩余周期抵扣 · ${input.current.planName} · v:${input.current.planVersionId}`,
        amountCents: -creditOld,
      },
      {
        label: `剩余周期应付 · ${input.target.planName} · v:${input.target.planVersionId}`,
        amountCents: chargeNew,
      },
      { label: "应付差价", amountCents },
    ],
    planVersionIds: [input.current.planVersionId, input.target.planVersionId],
    prorationUsesCommercialContract: window.fromCommercialContract,
  };
}

export function quoteRenewOrder(source: VersionPricingSource): OrderQuote {
  const base = quoteSubscribeOrder({ source });
  return {
    ...base,
    lineItems: base.lineItems.map((item) => ({
      ...item,
      label: `${item.label} · 续费`,
    })),
  };
}
