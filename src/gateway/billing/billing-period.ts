/**
 * 权威账期（CycleWindow）解析。
 *
 * ## 三种独立时间概念（禁止混用）
 *
 * | 概念 | 用途 | 周期长度来源 |
 * |------|------|--------------|
 * | **payment_contract** | 预付合同/付款窗口 | commercialContract.billingCycle |
 * | **usage_settlement** | 消费出账 / final Bill | 同上（合同锚点 + 合同周期） |
 * | **credits_reset** | monthlyCredits 额度桶重置 | **始终 monthly**，锚点来自合同/订阅 |
 *
 * 所有窗口受 commercialContract.contractEnd 约束（半开 [start, end)）。
 * 边界一律从 **原始锚点** 计算：
 *   rawStart(i) = addUtcMonths(anchor, i * cycleMonths)
 *   rawEnd(i)   = addUtcMonths(anchor, (i + 1) * cycleMonths)
 *   cycleEnd    = min(rawEnd, contractEnd) when contractEnd 存在
 */

import { createHash } from "node:crypto";
import { CYCLE_MONTHS, normalizeBillingCycle } from "./billing-cycle-pricing.js";
import type { BillingCycle, Subscription } from "./types.js";

export type PeriodPurpose = "payment_contract" | "usage_settlement" | "credits_reset";

export type CycleWindow = {
  cycleStart: string;
  cycleEnd: string;
  billingCycle: BillingCycle;
  periodIndex: number;
  source: "commercial_contract" | "subscription_start" | "calendar_month_fallback";
  anchorIso: string;
  purpose: PeriodPurpose;
  /** 是否被 contractEnd 截短末期 */
  truncatedByContractEnd?: boolean;
};

export type SettlementKeyParts = {
  enterpriseId: string;
  subscriptionId: string;
  planVersionId: string;
  cycleStart: string;
  cycleEnd: string;
};

export type SubscriptionPeriodInput = Pick<Subscription, "id" | "startTime" | "commercialContract">;

export class InvalidContractError extends Error {
  readonly code = "INVALID_CONTRACT" as const;
  constructor(message: string) {
    super(message);
    this.name = "InvalidContractError";
  }
}

export class ContractEndedError extends Error {
  readonly code = "CONTRACT_ENDED" as const;
  constructor(
    readonly contractEnd: string,
    readonly nowIso: string,
  ) {
    super(`合同已结束（contractEnd=${contractEnd}），不能生成新周期：now=${nowIso}`);
    this.name = "ContractEndedError";
  }
}

export class NoPendingSettlementError extends Error {
  readonly code = "NO_PENDING_SETTLEMENT" as const;
  constructor(readonly nowIso: string) {
    super(`无待结账期：所有已完成周期均已结算（now=${nowIso}）`);
    this.name = "NoPendingSettlementError";
  }
}

/**
 * 结算窗 [cycleStart, cycleEnd) 内的 Credits 重置子窗（始终 monthly）。
 *
 * 边界一律从 **原始锚点 cycleStart** 推算（禁止链式 +1 月漂移）：
 *   start(i) = addUtcMonths(cycleStart, i)
 *   end(i)   = min(addUtcMonths(cycleStart, i+1), cycleEnd)
 * 含被 cycleEnd 截短的末期（非整月也计 1 个窗）。
 *
 * 例：
 * - [2026-01-15, 2026-03-01) → [1/15,2/15), [2/15,3/01) 共 2
 * - [2026-01-31, 2026-03-15) → [1/31,2/28), [2/28,3/15) 共 2（月末锚点）
 */
export function listCreditsResetWindowsInCycle(
  cycleStart: string,
  cycleEnd: string,
): CycleWindow[] {
  const endMs = Date.parse(cycleEnd);
  const startMs = Date.parse(cycleStart);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return [];
  }
  const out: CycleWindow[] = [];
  for (let i = 0; i < 1200; i++) {
    const periodStart = addUtcMonths(cycleStart, i);
    if (Date.parse(periodStart) >= endMs) {
      break;
    }
    const rawEnd = addUtcMonths(cycleStart, i + 1);
    const { cycleEnd: periodEnd, truncated } = clampCycleEndToContract(
      periodStart,
      rawEnd,
      cycleEnd,
    );
    out.push({
      cycleStart: periodStart,
      cycleEnd: periodEnd,
      billingCycle: "monthly",
      periodIndex: i,
      source: "commercial_contract",
      anchorIso: cycleStart,
      purpose: "credits_reset",
      ...(truncated ? { truncatedByContractEnd: true } : {}),
    });
  }
  return out;
}

/**
 * 结算窗 [cycleStart, cycleEnd) 覆盖的 Credits 重置月数（用于套餐包含量缩放）。
 * = listCreditsResetWindowsInCycle 长度：含截短末期，非整月也计 1。
 * 不得用 billingCycle 名义月数（年付恒 12）覆盖截短窗；也不得只计「完整月」丢掉部分月末。
 */
export function countMonthsInCycleWindow(cycleStart: string, cycleEnd: string): number {
  const n = listCreditsResetWindowsInCycle(cycleStart, cycleEnd).length;
  // 正长度窗至少 1（防御空结果，避免 includedQuota 归零）
  return n > 0 ? n : 1;
}

/** UTC 加整月，末日钳制。 */
export function addUtcMonths(iso: string, months: number): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) {
    throw new Error(`invalid ISO date: ${iso}`);
  }
  const day = d.getUTCDate();
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const seconds = d.getUTCSeconds();
  const ms = d.getUTCMilliseconds();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const probe = new Date(Date.UTC(y, m, 1, hours, minutes, seconds, ms));
  const lastDay = new Date(
    Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth() + 1, 0),
  ).getUTCDate();
  probe.setUTCDate(Math.min(day, lastDay));
  return probe.toISOString();
}

export function readContractBounds(subscription: SubscriptionPeriodInput): {
  contractStart: string | null;
  contractEnd: string | null;
} {
  const start = subscription.commercialContract?.contractStart ?? null;
  const end = subscription.commercialContract?.contractEnd ?? null;
  if (start && end) {
    const s = Date.parse(start);
    const e = Date.parse(end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
      throw new InvalidContractError(
        `无效合同边界：contractStart=${start} contractEnd=${end}（须 contractEnd > contractStart）`,
      );
    }
  }
  return { contractStart: start, contractEnd: end };
}

/** 钳制 cycleEnd 不超过 contractEnd（半开）。 */
export function clampCycleEndToContract(
  cycleStart: string,
  rawCycleEnd: string,
  contractEndIso: string | null | undefined,
): { cycleEnd: string; truncated: boolean } {
  if (!contractEndIso) {
    return { cycleEnd: rawCycleEnd, truncated: false };
  }
  const endMs = Date.parse(contractEndIso);
  const rawMs = Date.parse(rawCycleEnd);
  const startMs = Date.parse(cycleStart);
  if (!Number.isFinite(endMs)) {
    return { cycleEnd: rawCycleEnd, truncated: false };
  }
  if (startMs >= endMs) {
    throw new InvalidContractError(
      `周期起点不在合同内：cycleStart=${cycleStart} contractEnd=${contractEndIso}`,
    );
  }
  if (rawMs > endMs) {
    return { cycleEnd: new Date(endMs).toISOString(), truncated: true };
  }
  return { cycleEnd: rawCycleEnd, truncated: false };
}

export function cycleWindowAtPeriodIndex(args: {
  anchorIso: string;
  billingCycle: BillingCycle;
  periodIndex: number;
  source: CycleWindow["source"];
  purpose: PeriodPurpose;
  contractEndIso?: string | null;
}): CycleWindow {
  if (args.periodIndex < 0 || !Number.isInteger(args.periodIndex)) {
    throw new Error(`periodIndex must be a non-negative integer, got ${args.periodIndex}`);
  }
  const months = CYCLE_MONTHS[args.billingCycle];
  const cycleStart = addUtcMonths(args.anchorIso, args.periodIndex * months);
  if (args.contractEndIso) {
    const endMs = Date.parse(args.contractEndIso);
    if (Date.parse(cycleStart) >= endMs) {
      throw new InvalidContractError(
        `periodIndex=${args.periodIndex} 起点已超出 contractEnd=${args.contractEndIso}`,
      );
    }
  }
  const rawEnd = addUtcMonths(args.anchorIso, (args.periodIndex + 1) * months);
  const { cycleEnd, truncated } = clampCycleEndToContract(cycleStart, rawEnd, args.contractEndIso);
  return {
    cycleStart,
    cycleEnd,
    billingCycle: args.billingCycle,
    periodIndex: args.periodIndex,
    source: args.source,
    anchorIso: args.anchorIso,
    purpose: args.purpose,
    ...(truncated ? { truncatedByContractEnd: true } : {}),
  };
}

export function findContainingPeriodIndex(
  anchorIso: string,
  billingCycle: BillingCycle,
  at: Date,
  contractEndIso?: string | null,
): number {
  const months = CYCLE_MONTHS[billingCycle];
  const atMs = at.getTime();
  const anchorMs = Date.parse(anchorIso);
  if (!Number.isFinite(anchorMs)) {
    throw new Error(`invalid anchor: ${anchorIso}`);
  }
  if (atMs < anchorMs) {
    return 0;
  }
  const hardEnd = contractEndIso ? Date.parse(contractEndIso) : Number.POSITIVE_INFINITY;
  // at 在合同结束后：落在最后一个有效 period
  const effectiveAtMs = Math.min(atMs, Number.isFinite(hardEnd) ? hardEnd - 1 : atMs);

  let hi = Math.max(
    0,
    Math.ceil(
      ((new Date(effectiveAtMs).getUTCFullYear() - new Date(anchorIso).getUTCFullYear()) * 12 +
        (new Date(effectiveAtMs).getUTCMonth() - new Date(anchorIso).getUTCMonth()) +
        2) /
        months,
    ),
  );
  while (Date.parse(addUtcMonths(anchorIso, (hi + 1) * months)) <= effectiveAtMs) {
    hi = hi * 2 + 1;
    if (hi > 1200) {
      break;
    }
  }
  let lo = 0;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const startMs = Date.parse(addUtcMonths(anchorIso, mid * months));
    if (startMs <= effectiveAtMs && startMs < hardEnd) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function resolveAnchor(
  subscription: SubscriptionPeriodInput,
  at: Date,
  billingCycleHint?: BillingCycle,
): {
  anchorIso: string;
  billingCycle: BillingCycle;
  source: CycleWindow["source"];
  contractEndIso: string | null;
} {
  const { contractStart, contractEnd } = readContractBounds(subscription);
  const fromContract = normalizeBillingCycle(subscription.commercialContract?.billingCycle);
  const billingCycle =
    normalizeBillingCycle(billingCycleHint) ?? fromContract ?? ("monthly" as BillingCycle);

  if (contractStart) {
    return {
      anchorIso: contractStart,
      billingCycle: billingCycleHint === "monthly" ? "monthly" : (fromContract ?? billingCycle),
      source: "commercial_contract",
      contractEndIso: contractEnd,
    };
  }
  if (subscription.startTime) {
    return {
      anchorIso: subscription.startTime,
      billingCycle: billingCycleHint === "monthly" ? "monthly" : billingCycle,
      source: "subscription_start",
      contractEndIso: contractEnd,
    };
  }
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1, 0, 0, 0, 0));
  return {
    anchorIso: start.toISOString(),
    billingCycle: "monthly",
    source: "calendar_month_fallback",
    contractEndIso: null,
  };
}

/**
 * 含 `at` 的窗口。若 at >= contractEnd，抛 ContractEndedError（不得 preview 下一期）。
 * 合同结束日当天：仍可解析末期（at 恰好 = contractEnd 视为已结束，不生成下一期）。
 */
export function resolveContainingCycle(
  subscription: SubscriptionPeriodInput,
  at: Date = new Date(),
  billingCycleHint?: BillingCycle,
  purpose: PeriodPurpose = "usage_settlement",
): CycleWindow {
  const resolved = resolveAnchor(subscription, at, billingCycleHint);
  if (resolved.contractEndIso) {
    const endMs = Date.parse(resolved.contractEndIso);
    if (at.getTime() >= endMs) {
      throw new ContractEndedError(resolved.contractEndIso, at.toISOString());
    }
  }
  const periodIndex = findContainingPeriodIndex(
    resolved.anchorIso,
    resolved.billingCycle,
    at,
    resolved.contractEndIso,
  );
  return cycleWindowAtPeriodIndex({
    anchorIso: resolved.anchorIso,
    billingCycle: resolved.billingCycle,
    periodIndex,
    source: resolved.source,
    purpose,
    contractEndIso: resolved.contractEndIso,
  });
}

/**
 * 枚举合同内所有 **已完成** 的 usage_settlement 周期（cycleEnd <= at 且 cycleStart < contractEnd）。
 * 按 periodIndex 升序。
 */
export function listCompletedSettlementCycles(
  subscription: SubscriptionPeriodInput,
  at: Date = new Date(),
  billingCycleHint?: BillingCycle,
): CycleWindow[] {
  const resolved = resolveAnchor(subscription, at, billingCycleHint);
  const months = CYCLE_MONTHS[resolved.billingCycle];
  const atMs = at.getTime();
  const hardEnd = resolved.contractEndIso
    ? Date.parse(resolved.contractEndIso)
    : Number.POSITIVE_INFINITY;
  const out: CycleWindow[] = [];
  for (let i = 0; i < 1200; i++) {
    const rawStart = addUtcMonths(resolved.anchorIso, i * months);
    const startMs = Date.parse(rawStart);
    if (startMs >= hardEnd) {
      break;
    }
    const rawEnd = addUtcMonths(resolved.anchorIso, (i + 1) * months);
    const { cycleEnd, truncated } = clampCycleEndToContract(
      rawStart,
      rawEnd,
      resolved.contractEndIso,
    );
    const endMs = Date.parse(cycleEnd);
    // 已完成：at >= cycleEnd
    if (atMs < endMs) {
      break;
    }
    out.push({
      cycleStart: rawStart,
      cycleEnd,
      billingCycle: resolved.billingCycle,
      periodIndex: i,
      source: resolved.source,
      anchorIso: resolved.anchorIso,
      purpose: "usage_settlement",
      ...(truncated ? { truncatedByContractEnd: true } : {}),
    });
  }
  return out;
}

/** @deprecated 优先 listCompletedSettlementCycles + earliest unfinalized */
export function resolveLatestCompletedCycle(
  subscription: SubscriptionPeriodInput,
  at: Date = new Date(),
  billingCycleHint?: BillingCycle,
): CycleWindow | null {
  const all = listCompletedSettlementCycles(subscription, at, billingCycleHint);
  return all.at(-1) ?? null;
}

/**
 * 校验显式历史周期：属于订阅、已结束、未超出合同。
 */
export function resolveExplicitSettlementCycle(
  subscription: SubscriptionPeriodInput,
  cycleStart: string,
  at: Date = new Date(),
  billingCycleHint?: BillingCycle,
): CycleWindow {
  const all = listCompletedSettlementCycles(subscription, at, billingCycleHint);
  // also allow in-progress? No — must be completed
  const match = all.find((c) => c.cycleStart === cycleStart);
  if (!match) {
    // maybe incomplete cycle requested
    const resolved = resolveAnchor(subscription, at, billingCycleHint);
    const months = CYCLE_MONTHS[resolved.billingCycle];
    for (let i = 0; i < 1200; i++) {
      const start = addUtcMonths(resolved.anchorIso, i * months);
      if (start !== cycleStart) {
        continue;
      }
      const win = cycleWindowAtPeriodIndex({
        anchorIso: resolved.anchorIso,
        billingCycle: resolved.billingCycle,
        periodIndex: i,
        source: resolved.source,
        purpose: "usage_settlement",
        contractEndIso: resolved.contractEndIso,
      });
      if (at.getTime() < Date.parse(win.cycleEnd)) {
        throw new CycleNotEndedError(win.cycleStart, win.cycleEnd, at.toISOString());
      }
      if (
        resolved.contractEndIso &&
        Date.parse(win.cycleStart) >= Date.parse(resolved.contractEndIso)
      ) {
        throw new InvalidContractError(`周期 ${cycleStart} 超出合同范围`);
      }
      return win;
    }
    throw new InvalidContractError(`周期 cycleStart=${cycleStart} 不属于该订阅合同`);
  }
  return match;
}

export function resolveCreditsResetCycle(
  subscription: SubscriptionPeriodInput,
  at: Date = new Date(),
): CycleWindow {
  const resolved = resolveAnchor(subscription, at, "monthly");
  if (resolved.contractEndIso && at.getTime() >= Date.parse(resolved.contractEndIso)) {
    throw new ContractEndedError(resolved.contractEndIso, at.toISOString());
  }
  const periodIndex = findContainingPeriodIndex(
    resolved.anchorIso,
    "monthly",
    at,
    resolved.contractEndIso,
  );
  return cycleWindowAtPeriodIndex({
    anchorIso: resolved.anchorIso,
    billingCycle: "monthly",
    periodIndex,
    source: resolved.source,
    purpose: "credits_reset",
    contractEndIso: resolved.contractEndIso,
  });
}

export function resolvePaymentContractCycle(
  subscription: SubscriptionPeriodInput,
  at: Date = new Date(),
  billingCycleHint?: BillingCycle,
): CycleWindow {
  return resolveContainingCycle(subscription, at, billingCycleHint, "payment_contract");
}

export function resolveSubscriptionCycleWindow(
  subscription: SubscriptionPeriodInput,
  at: Date = new Date(),
  billingCycleHint?: BillingCycle,
): CycleWindow {
  return resolveContainingCycle(subscription, at, billingCycleHint, "usage_settlement");
}

export function resolveCycleWindowFromAnchor(args: {
  anchorIso: string;
  billingCycle: BillingCycle;
  at: Date;
  source: CycleWindow["source"];
  contractEndIso?: string;
  purpose?: PeriodPurpose;
}): CycleWindow {
  const periodIndex = findContainingPeriodIndex(
    args.anchorIso,
    args.billingCycle,
    args.at,
    args.contractEndIso,
  );
  return cycleWindowAtPeriodIndex({
    anchorIso: args.anchorIso,
    billingCycle: args.billingCycle,
    periodIndex,
    source: args.source,
    purpose: args.purpose ?? "usage_settlement",
    contractEndIso: args.contractEndIso,
  });
}

export function buildSettlementKey(parts: SettlementKeyParts): string {
  return [
    parts.enterpriseId,
    parts.subscriptionId,
    parts.planVersionId,
    parts.cycleStart,
    parts.cycleEnd,
  ].join("|");
}

export function deterministicBillId(settlementKey: string): string {
  const hex = createHash("sha256").update(settlementKey, "utf8").digest("hex").slice(0, 32);
  return `bill-${hex}`;
}

export function deterministicSnapshotId(
  settlementKey: string,
  snapshotType: "estimated" | "final",
): string {
  const hex = createHash("sha256")
    .update(`${settlementKey}|${snapshotType}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `snap-${hex}`;
}

export function isCycleComplete(cycleEndIso: string, now: Date = new Date()): boolean {
  return now.getTime() >= Date.parse(cycleEndIso);
}

export class CycleNotEndedError extends Error {
  readonly code = "CYCLE_NOT_ENDED" as const;
  constructor(
    readonly cycleStart: string,
    readonly cycleEnd: string,
    readonly nowIso: string,
  ) {
    super(`账期尚未结束，不能 final 结算：cycle=[${cycleStart}, ${cycleEnd}) now=${nowIso}`);
    this.name = "CycleNotEndedError";
  }
}

export class NoCompletedCycleError extends Error {
  readonly code = "NO_COMPLETED_CYCLE" as const;
  constructor(readonly nowIso: string) {
    super(`尚无已完成账期，不能 final 结算：now=${nowIso}`);
    this.name = "NoCompletedCycleError";
  }
}
