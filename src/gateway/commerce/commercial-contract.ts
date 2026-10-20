/**
 * 商业合同周期：quarterly/annual 为预付合同；monthly 暂退化为自然月窗口（与 billing runtime 一致）。
 *
 * contractEnd 必须与 billing-period.addUtcMonths 同一套末日钳制，禁止 Date.UTC(y, m+n, day)
 * 在 1/31 等锚点上滚到错误月份（例如 Jan31+1m → Mar3）。
 */

import { CYCLE_MONTHS, normalizeBillingCycle } from "../billing/billing-cycle-pricing.js";
import { addUtcMonths } from "../billing/billing-period.js";
import { resolveCycleWindow } from "../billing/runtime.js";
import type { BillingCycle, Subscription } from "../billing/types.js";

export type ContractWindow = {
  contractStart: string;
  contractEnd: string;
  /** true = 来自 subscription.commercialContract；false = 自然月退化窗口。 */
  fromCommercialContract: boolean;
  billingCycle: BillingCycle;
};

/**
 * 合同结束时刻（半开区间右端）。与 usage_settlement / payment_contract 周期边界同源。
 */
export function computeContractEnd(contractStart: Date, billingCycle: BillingCycle): Date {
  const months = CYCLE_MONTHS[billingCycle];
  return new Date(addUtcMonths(contractStart.toISOString(), months));
}

export function buildCommercialContract(
  contractStart: Date,
  billingCycle: BillingCycle,
): NonNullable<Subscription["commercialContract"]> {
  const startIso = contractStart.toISOString();
  return {
    billingCycle,
    contractStart: startIso,
    contractEnd: computeContractEnd(contractStart, billingCycle).toISOString(),
  };
}

/** Proration 窗口：优先订阅锁定的预付合同；否则 monthly 自然月。 */
export function resolveProrationWindow(
  subscription: Subscription | null | undefined,
  billingCycle: BillingCycle,
  now: Date = new Date(),
): ContractWindow {
  const contract = subscription?.commercialContract;
  const contractBillingCycle = normalizeBillingCycle(contract?.billingCycle);
  if (contract && contractBillingCycle === billingCycle) {
    return {
      contractStart: contract.contractStart,
      contractEnd: contract.contractEnd,
      fromCommercialContract: true,
      billingCycle,
    };
  }
  if (billingCycle !== "monthly") {
    // 尚无合同记录时，非月度 proration 仍按「从 now 起的完整合同期」估算，并标记非锁定。
    const start = now;
    return {
      contractStart: start.toISOString(),
      contractEnd: computeContractEnd(start, billingCycle).toISOString(),
      fromCommercialContract: false,
      billingCycle,
    };
  }
  const { cycleStart, cycleEnd } = resolveCycleWindow(now);
  return {
    contractStart: cycleStart,
    contractEnd: cycleEnd,
    fromCommercialContract: false,
    billingCycle: "monthly",
  };
}

export function remainingRatioInWindow(window: ContractWindow, now: Date = new Date()): number {
  const startMs = Date.parse(window.contractStart);
  const endMs = Date.parse(window.contractEnd);
  const nowMs = now.getTime();
  const totalMs = Math.max(1, endMs - startMs);
  const remainingMs = Math.max(0, endMs - nowMs);
  return remainingMs / totalMs;
}

/** 续费合同起点：未到期则从 contractEnd 接续，已过期则从 now 起算。 */
export function nextRenewContractStart(
  subscription: Subscription | null | undefined,
  now: Date = new Date(),
): Date {
  const endIso = subscription?.commercialContract?.contractEnd;
  if (endIso) {
    const endMs = Date.parse(endIso);
    if (Number.isFinite(endMs) && endMs > now.getTime()) {
      return new Date(endMs);
    }
  }
  return now;
}
