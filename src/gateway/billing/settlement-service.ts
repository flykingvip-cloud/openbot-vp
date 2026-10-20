/**
 * 正式结算服务。
 *
 * - estimated → containing cycle（usage_settlement preview）
 * - final → **earliest unfinalized completed cycle**（积压按序补结）
 * - settlementKey 幂等；Bill+Snapshot 原子写入
 * - 周期长度优先 commercialContract.billingCycle（订阅合同锚点），非「最新一期」捷径
 */

import { createAsyncLock } from "../../infra/json-files.js";
import { getPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import {
  buildSettlementKey,
  ContractEndedError,
  countMonthsInCycleWindow,
  CycleNotEndedError,
  deterministicBillId,
  deterministicSnapshotId,
  InvalidContractError,
  isCycleComplete,
  listCompletedSettlementCycles,
  NoCompletedCycleError,
  NoPendingSettlementError,
  resolveContainingCycle,
  resolveExplicitSettlementCycle,
  type CycleWindow,
} from "./billing-period.js";
import { countActiveBotsAt } from "./bot-resources-store.js";
import { settleCycle } from "./engine.js";
import { appendFinalSettlementIdempotent, findFinalSettlementByKey } from "./ledger-store.js";
import { buildMeterDefinitions } from "./meter-contract.js";
import { getPlan, getPlanVersion } from "./plans-store.js";
import type { BillingStorePaths } from "./runtime.js";
import { listSeatEntitlementProfileIntervals } from "./seat-entitlement-assignments-store.js";
import { countSeatsByRole, listSeatIntervals } from "./seats-store.js";
import {
  getActiveSubscription,
  listEnterpriseSettleableSubscriptions,
} from "./subscriptions-store.js";
import type { Bill, BillingCycle, CostSnapshot, Plan, PlanVersion, Subscription } from "./types.js";
import { listUsageLedgerEntries } from "./usage-ledger-store.js";
import { listUsageRecords } from "./usage-records-store.js";

export class SettlementConfigError extends Error {
  readonly code = "SETTLEMENT_CONFIG_ERROR" as const;
  constructor(
    message: string,
    readonly missingPriceKeys: string[],
  ) {
    super(message);
    this.name = "SettlementConfigError";
  }
}

export type SettlementMode = "estimated" | "final";

export type SettlementResult = {
  bill: Bill;
  snapshot: CostSnapshot;
  subscription: Subscription;
  plan: Plan | null;
  version: PlanVersion;
  cycle: CycleWindow;
  settlementKey: string;
  deduped: boolean;
  mode: SettlementMode;
  /** true = 无待结账期（所有已完成周期已 final） */
  noPending?: boolean;
};

export type SettleOptions = {
  enterpriseId: string;
  mode: SettlementMode;
  now?: Date;
  /** 显式历史周期起点；须已结束且在合同内 */
  cycleStart?: string;
  /**
   * 精确锁定补结目标订阅（active/expired/canceled 均可）。
   * 与 cycleStart 联用时：周期必须属于该订阅；单独使用时：仅在该订阅内选 earliest unfinalized。
   * 未传时：企业范围默认跨订阅补结（旧订阅优先）。
   */
  subscriptionId?: string;
  storePaths?: BillingStorePaths & { ledger?: string; usageLedger?: string };
};

/** 串行化 final 选期+落账，避免并发各自跳过不同周期或重复出账竞态。 */
const withFinalSettleLock = createAsyncLock();

function settlementKeyFor(
  enterpriseId: string,
  subscription: Subscription,
  cycle: CycleWindow,
): string {
  return buildSettlementKey({
    enterpriseId,
    subscriptionId: subscription.id,
    planVersionId: subscription.planVersionId,
    cycleStart: cycle.cycleStart,
    cycleEnd: cycle.cycleEnd,
  });
}

/**
 * 结算用账期长度：合同 billingCycle 优先于 plan 头（禁止 plan 月付头误导年付合同枚举）。
 */
export function resolveSettlementBillingCycle(
  subscription: Subscription,
  plan: Plan | null | undefined,
): BillingCycle | undefined {
  return subscription.commercialContract?.billingCycle ?? plan?.billingCycle ?? undefined;
}

/**
 * 单订阅内最早一条「已完成且未 final」的结算周期。
 * 严格按 periodIndex 升序扫描 completed 列表，禁止选 latest。
 */
export async function findEarliestUnfinalizedCompletedCycle(args: {
  enterpriseId: string;
  subscription: Subscription;
  planBillingCycle?: string;
  now: Date;
  ledgerPath?: string;
}): Promise<CycleWindow | null> {
  const completed = listCompletedSettlementCycles(
    args.subscription,
    args.now,
    args.planBillingCycle as BillingCycle | undefined,
  );
  for (const cycle of completed) {
    // 防御：起点不得落在合同结束之后
    const contractEnd = args.subscription.commercialContract?.contractEnd;
    if (contractEnd && Date.parse(cycle.cycleStart) >= Date.parse(contractEnd)) {
      continue;
    }
    const key = settlementKeyFor(args.enterpriseId, args.subscription, cycle);
    const existing = await findFinalSettlementByKey(args.enterpriseId, key, args.ledgerPath);
    if (!existing) {
      return cycle;
    }
  }
  return null;
}

export type SettlementCandidate = {
  subscription: Subscription;
  plan: Plan | null;
  version: PlanVersion;
  cycle: CycleWindow;
  cycleHint: BillingCycle | undefined;
};

/**
 * 企业级最早未结：扫描 active + expired/canceled 等可结算订阅。
 * 排序：cycleStart 升序 → 订阅 startTime 升序 → subscriptionId（先旧后新，禁止跳过旧订阅积压）。
 */
export async function findEnterpriseEarliestUnfinalizedSettlement(args: {
  enterpriseId: string;
  now: Date;
  /** 若指定，仅在该订阅内选 earliest（精确历史补结） */
  subscriptionId?: string;
  storePaths?: SettleOptions["storePaths"];
}): Promise<{
  candidate: SettlementCandidate | null;
  /** 扫描范围内是否存在任一已完成周期（用于区分 NoCompleted vs NoPending） */
  hasAnyCompleted: boolean;
}> {
  let subscriptions = await listEnterpriseSettleableSubscriptions(
    args.enterpriseId,
    args.storePaths?.subscriptions,
  );
  if (args.subscriptionId) {
    subscriptions = subscriptions.filter((s) => s.id === args.subscriptionId);
  }
  const candidates: SettlementCandidate[] = [];
  let hasAnyCompleted = false;

  for (const subscription of subscriptions) {
    const version = await getPlanVersion(subscription.planVersionId, args.storePaths?.plans);
    if (!version) {
      continue;
    }
    const plan = await getPlan(subscription.planId, args.storePaths?.plans);
    const cycleHint = resolveSettlementBillingCycle(subscription, plan);
    const completed = listCompletedSettlementCycles(subscription, args.now, cycleHint);
    if (completed.length > 0) {
      hasAnyCompleted = true;
    }
    const earliest = await findEarliestUnfinalizedCompletedCycle({
      enterpriseId: args.enterpriseId,
      subscription,
      planBillingCycle: cycleHint,
      now: args.now,
      ledgerPath: args.storePaths?.ledger,
    });
    if (!earliest) {
      continue;
    }
    candidates.push({ subscription, plan, version, cycle: earliest, cycleHint });
  }

  if (candidates.length === 0) {
    return { candidate: null, hasAnyCompleted };
  }

  candidates.sort((a, b) => {
    const byCycle = a.cycle.cycleStart.localeCompare(b.cycle.cycleStart);
    if (byCycle !== 0) {
      return byCycle;
    }
    const bySubStart = a.subscription.startTime.localeCompare(b.subscription.startTime);
    if (bySubStart !== 0) {
      return bySubStart;
    }
    return a.subscription.id.localeCompare(b.subscription.id);
  });

  return { candidate: candidates[0], hasAnyCompleted };
}

/**
 * 用量必须落在结算窗 [cycleStart, cycleEnd) 内；合同存在时还不得落在合同外。
 */
function filterUsageInSettlementWindow(
  usage: Awaited<ReturnType<typeof listUsageRecords>>,
  cycle: CycleWindow,
  subscription: Subscription,
): typeof usage {
  const startMs = Date.parse(cycle.cycleStart);
  const endMs = Date.parse(cycle.cycleEnd);
  const contractStartMs = subscription.commercialContract?.contractStart
    ? Date.parse(subscription.commercialContract.contractStart)
    : Number.NEGATIVE_INFINITY;
  const contractEndMs = subscription.commercialContract?.contractEnd
    ? Date.parse(subscription.commercialContract.contractEnd)
    : Number.POSITIVE_INFINITY;
  return usage.filter((u) => {
    const at = Date.parse(u.occurredAt);
    if (!Number.isFinite(at)) {
      return false;
    }
    if (at < startMs || at >= endMs) {
      return false;
    }
    if (at < contractStartMs || at >= contractEndMs) {
      return false;
    }
    return true;
  });
}

async function buildAndPersistSettlement(args: {
  enterpriseId: string;
  subscription: Subscription;
  plan: Plan | null;
  version: PlanVersion;
  cycle: CycleWindow;
  mode: SettlementMode;
  now: Date;
  storePaths?: SettleOptions["storePaths"];
}): Promise<SettlementResult> {
  const { enterpriseId, subscription, plan, version, cycle, mode, now, storePaths } = args;
  const settlementKey = settlementKeyFor(enterpriseId, subscription, cycle);
  const billId = deterministicBillId(settlementKey);
  const snapshotId = deterministicSnapshotId(settlementKey, mode);

  if (mode === "final") {
    const existing = await findFinalSettlementByKey(
      enterpriseId,
      settlementKey,
      storePaths?.ledger,
    );
    if (existing) {
      return {
        bill: existing.bill,
        snapshot: existing.snapshot,
        subscription,
        plan,
        version,
        cycle,
        settlementKey,
        deduped: true,
        mode: "final",
      };
    }
  }

  const intervals = await listSeatIntervals(enterpriseId, storePaths?.seats);
  const rawUsage = await listUsageRecords(
    enterpriseId,
    { startTime: cycle.cycleStart, endTime: cycle.cycleEnd },
    storePaths?.usage,
  );
  const usage = filterUsageInSettlementWindow(rawUsage, cycle, subscription);
  const seatCountByRole = await countSeatsByRole(enterpriseId, storePaths?.seats);
  // 历史账期：按 cycleEnd 时点重建 Bot 数，禁止读当前活跃数污染旧账单。
  const botCount = await countActiveBotsAt(enterpriseId, cycle.cycleEnd, storePaths?.resources);
  const entitlement = await getPlanEntitlementSnapshot(
    subscription.planVersionId,
    storePaths?.entitlementSnapshot,
  );
  const aiProfileIntervals = await listSeatEntitlementProfileIntervals(
    enterpriseId,
    storePaths?.seatEntitlementAssignments,
  );
  const usageKeys = [...new Set(usage.map((u) => u.key))];
  // Credits 包含量 = monthlyCredits × **实际窗长月数**（截短合同不得按名义 12/3 放大）
  const cycleMonths = countMonthsInCycleWindow(cycle.cycleStart, cycle.cycleEnd);
  const meters = buildMeterDefinitions({
    version,
    entitlement,
    usageKeys,
  }).map((m) => {
    if (m.key !== "ai_credits" && m.key !== "ai_token") {
      return m;
    }
    if (m.includedQuota == null) {
      return m;
    }
    return {
      ...m,
      includedQuota: Math.max(0, Math.round(m.includedQuota)) * cycleMonths,
    };
  });

  const settled = settleCycle({
    enterpriseId,
    version,
    planVersionId: subscription.planVersionId,
    cycleStart: cycle.cycleStart,
    cycleEnd: cycle.cycleEnd,
    date: now.toISOString().slice(0, 10),
    intervals,
    usage,
    meters,
    seatCountByRole,
    botCount,
    aiProfileIntervals,
    aiProfileQuota: entitlement?.aiProfileQuota,
    snapshotType: mode === "final" ? "final" : "estimated",
    generatedAt: now.toISOString(),
    billId,
    snapshotId,
    settlementKey,
  });

  if (mode === "final" && settled.snapshot.missingPriceKeys.length > 0) {
    throw new SettlementConfigError(
      `正式结算配置不完整，拒绝出账：${settled.snapshot.missingPriceKeys.join(", ")}`,
      settled.snapshot.missingPriceKeys,
    );
  }

  // PAYG：把账本 overageAmountCents 并入 final Bill extra（与 meter 取 max，防漏计/双计）
  let billItems = [...settled.bill.items];
  let extraCostCents = settled.bill.extraCostCents;
  if (mode === "final") {
    const ledgerEntries = await listUsageLedgerEntries(
      enterpriseId,
      { startTime: cycle.cycleStart, endTime: cycle.cycleEnd },
      storePaths?.usageLedger,
    );
    const paygOverageCents = ledgerEntries
      .filter((e) => !e.subscriptionId || e.subscriptionId === subscription.id)
      .reduce((sum, e) => sum + Math.max(0, Math.floor(e.overageAmountCents ?? 0)), 0);
    if (paygOverageCents > extraCostCents) {
      const delta = paygOverageCents - extraCostCents;
      billItems = [
        ...billItems,
        {
          type: "extra",
          key: "ai_credits",
          detail: `payg_overage_ledger_cents:${paygOverageCents}`,
          amountCents: delta,
        },
      ];
      extraCostCents = paygOverageCents;
    }
  }
  const totalCostCents = settled.bill.seatCostCents + settled.bill.usageCostCents + extraCostCents;

  const bill: Bill = {
    ...settled.bill,
    items: billItems,
    extraCostCents,
    totalCostCents,
    subscriptionId: subscription.id,
    settlementKey,
    status: mode === "final" ? "finalized" : "estimated",
  };
  const snapshot: CostSnapshot = {
    ...settled.snapshot,
    settlementKey,
    billId: bill.id,
    snapshotType: mode === "final" ? "final" : "estimated",
    totalCostCents,
  };

  if (mode === "final") {
    const written = await appendFinalSettlementIdempotent(bill, snapshot, storePaths?.ledger);
    return {
      bill: written.bill,
      snapshot: written.snapshot,
      subscription,
      plan,
      version,
      cycle,
      settlementKey,
      deduped: written.deduped,
      mode: "final",
    };
  }

  return {
    bill,
    snapshot,
    subscription,
    plan,
    version,
    cycle,
    settlementKey,
    deduped: false,
    mode: "estimated",
  };
}

export async function settleEnterpriseCycle(
  options: SettleOptions,
): Promise<SettlementResult | null> {
  const now = options.now ?? new Date();

  if (options.mode === "estimated") {
    // preview 仅针对当前 active 订阅的进行中窗口
    const subscription = await getActiveSubscription(
      options.enterpriseId,
      options.storePaths?.subscriptions,
    );
    if (!subscription) {
      return null;
    }
    const version = await getPlanVersion(subscription.planVersionId, options.storePaths?.plans);
    if (!version) {
      return null;
    }
    const plan = await getPlan(subscription.planId, options.storePaths?.plans);
    const cycleHint = resolveSettlementBillingCycle(subscription, plan);
    let cycle: CycleWindow;
    try {
      cycle = resolveContainingCycle(subscription, now, cycleHint, "usage_settlement");
    } catch (err) {
      if (err instanceof ContractEndedError || err instanceof InvalidContractError) {
        throw err;
      }
      throw err;
    }
    return buildAndPersistSettlement({
      enterpriseId: options.enterpriseId,
      subscription,
      plan,
      version,
      cycle,
      mode: "estimated",
      now,
      storePaths: options.storePaths,
    });
  }

  // ── final：可结算 active + expired/canceled 历史订阅上的未结周期 ──
  let settleable = await listEnterpriseSettleableSubscriptions(
    options.enterpriseId,
    options.storePaths?.subscriptions,
  );
  if (options.subscriptionId) {
    const pinned = settleable.find((s) => s.id === options.subscriptionId);
    if (!pinned) {
      throw new InvalidContractError(
        `订阅 ${options.subscriptionId} 不存在、不属于该企业或不可结算（仅 active/expired/canceled/suspended）`,
      );
    }
    settleable = [pinned];
  }
  if (settleable.length === 0) {
    return null;
  }

  if (options.cycleStart) {
    // 显式周期：可选 subscriptionId 精确锁定；未锁定时在可结算订阅中定位（优先旧订阅）
    for (const subscription of settleable) {
      const version = await getPlanVersion(subscription.planVersionId, options.storePaths?.plans);
      if (!version) {
        continue;
      }
      const plan = await getPlan(subscription.planId, options.storePaths?.plans);
      const cycleHint = resolveSettlementBillingCycle(subscription, plan);
      try {
        const cycle = resolveExplicitSettlementCycle(
          subscription,
          options.cycleStart,
          now,
          cycleHint,
        );
        if (!isCycleComplete(cycle.cycleEnd, now)) {
          throw new CycleNotEndedError(cycle.cycleStart, cycle.cycleEnd, now.toISOString());
        }
        return buildAndPersistSettlement({
          enterpriseId: options.enterpriseId,
          subscription,
          plan,
          version,
          cycle,
          mode: "final",
          now,
          storePaths: options.storePaths,
        });
      } catch (err) {
        if (err instanceof CycleNotEndedError) {
          throw err;
        }
        // 不属于该订阅 / 超出合同 → 试下一订阅（若已锁定 subscriptionId 则不再继续）
        if (options.subscriptionId) {
          throw err instanceof Error
            ? err
            : new InvalidContractError(
                `周期 cycleStart=${options.cycleStart} 不属于订阅 ${options.subscriptionId}`,
              );
        }
        continue;
      }
    }
    throw new InvalidContractError(
      options.subscriptionId
        ? `周期 cycleStart=${options.cycleStart} 不属于订阅 ${options.subscriptionId} 的可结算合同`
        : `周期 cycleStart=${options.cycleStart} 不属于该企业任一可结算订阅合同`,
    );
  }

  // 默认：企业级 earliest unfinalized（旧订阅积压优先于新 active）；
  // 传 subscriptionId 时仅在该订阅内选 earliest。
  const { candidate, hasAnyCompleted } = await findEnterpriseEarliestUnfinalizedSettlement({
    enterpriseId: options.enterpriseId,
    now,
    ...(options.subscriptionId ? { subscriptionId: options.subscriptionId } : {}),
    storePaths: options.storePaths,
  });
  if (!candidate) {
    if (!hasAnyCompleted) {
      throw new NoCompletedCycleError(now.toISOString());
    }
    throw new NoPendingSettlementError(now.toISOString());
  }
  if (!isCycleComplete(candidate.cycle.cycleEnd, now)) {
    throw new CycleNotEndedError(
      candidate.cycle.cycleStart,
      candidate.cycle.cycleEnd,
      now.toISOString(),
    );
  }

  const pinned = candidate;
  return withFinalSettleLock(async () => {
    const key = settlementKeyFor(options.enterpriseId, pinned.subscription, pinned.cycle);
    const existing = await findFinalSettlementByKey(
      options.enterpriseId,
      key,
      options.storePaths?.ledger,
    );
    if (existing) {
      return {
        bill: existing.bill,
        snapshot: existing.snapshot,
        subscription: pinned.subscription,
        plan: pinned.plan,
        version: pinned.version,
        cycle: pinned.cycle,
        settlementKey: key,
        deduped: true,
        mode: "final" as const,
      };
    }
    return buildAndPersistSettlement({
      enterpriseId: options.enterpriseId,
      subscription: pinned.subscription,
      plan: pinned.plan,
      version: pinned.version,
      cycle: pinned.cycle,
      mode: "final",
      now,
      storePaths: options.storePaths,
    });
  });
}
