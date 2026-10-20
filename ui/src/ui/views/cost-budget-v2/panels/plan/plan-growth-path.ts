import { t } from "../../../../../i18n/index.ts";
import type {
  CommercialOrderDetail,
  Plan,
  Subscription,
  SubscriptionGetResponse,
} from "../../../../capability/cost-budget-billing/index.ts";
import type { TenantCreditsCycle } from "../../../../capability/cost-budget-billing/index.ts";
import { resolveAssignedSeatCount } from "../../../cost-budget/assigned-seat-count.ts";
import { parseSubscriptionEntitlement } from "../../../cost-budget/parse-subscription-entitlement.ts";
import {
  buildPlanCapacitySummary,
  type PlanCapacitySummary,
} from "../../../cost-budget/plan-capacity-display.ts";
import { formatTierListCompact } from "../../../cost-budget/tier-display.ts";
import type { OperationsStoreState } from "../../stores/operations-store.ts";

export type PlanGrowthMetricId = "bots" | "concurrency" | "credits" | "tiers" | "seats";

export type PlanGrowthSummaryItem = {
  id: PlanGrowthMetricId;
  label: string;
  value: string;
  subValue?: string;
};

export type PlanGrowthTrendPoint = {
  at: string;
  value: number;
  label: string;
  /** credits 周期趋势：同周期配额上限 */
  quota?: number;
};

export type PlanGrowthMetricSeries = {
  id: PlanGrowthMetricId;
  label: string;
  unit: string;
  points: PlanGrowthTrendPoint[];
  /** tiers 等分类型指标的可读说明；credits 为周期消耗趋势说明 */
  detail?: string;
  /** credits：按计费周期消耗，而非套餐变更里程碑 */
  mode?: "entitlement_milestones" | "billing_cycle_usage";
};

export type PlanGrowthPathContext = {
  summaries: PlanGrowthSummaryItem[];
  seriesByMetric: Record<PlanGrowthMetricId, PlanGrowthMetricSeries>;
  /** 订阅创建时间（图表默认窗口起点）。 */
  subscriptionCreatedAt: string | null;
  milestones: readonly PlanMilestone[];
};

export type PlanGrowthChartWindowPreset = "subscription" | "30d" | "90d" | "365d";

export const PLAN_GROWTH_CHART_WINDOW_PRESETS: readonly PlanGrowthChartWindowPreset[] = [
  "subscription",
  "90d",
  "30d",
];

export type PlanGrowthChartWindow = {
  preset: PlanGrowthChartWindowPreset;
  startAt: string;
  endAt: string;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_CHART_WINDOW_MS = 365 * MS_PER_DAY;

type PlanMilestone = {
  at: string;
  planId: string;
};

function resolvePlanForId(subscription: SubscriptionGetResponse, planId: string): Plan | null {
  return (
    subscription.availablePlans.find((plan) => plan.id === planId) ??
    (subscription.planView?.id === planId ? subscription.planView : null)
  );
}

function resolveCapacityAtPlan(
  subscription: SubscriptionGetResponse,
  planId: string,
): PlanCapacitySummary | null {
  const plan = resolvePlanForId(subscription, planId);
  if (!plan) {
    return null;
  }
  const entitlement =
    parseSubscriptionEntitlement(subscription.planEntitlements?.[planId]) ?? undefined;
  return buildPlanCapacitySummary({ plan, entitlement });
}

function buildPlanMilestones(
  subscription: Subscription | null | undefined,
  orders: readonly CommercialOrderDetail[],
): PlanMilestone[] {
  const milestones: PlanMilestone[] = [];
  if (subscription?.createdAt && subscription.planId) {
    milestones.push({ at: subscription.createdAt, planId: subscription.planId });
  }
  for (const order of orders) {
    if (order.kind !== "change_plan") {
      continue;
    }
    const at = order.paidAt ?? order.createdAt;
    const planId = order.targetPlanId ?? order.planId;
    if (!at || !planId) {
      continue;
    }
    if (order.status !== "paid" && order.status !== "fulfilled") {
      continue;
    }
    milestones.push({ at, planId });
  }
  const seen = new Set<string>();
  return milestones
    .filter((entry) => {
      const key = `${entry.at}::${entry.planId}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .toSorted((a, b) => a.at.localeCompare(b.at));
}

function fmtShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

/** 图表 X 轴端点：订购至今默认最长 365 天。 */
export function resolveGrowthChartWindow(
  subscriptionCreatedAt: string | null | undefined,
  preset: PlanGrowthChartWindowPreset = "subscription",
  nowMs: number = Date.now(),
): PlanGrowthChartWindow {
  const endMs = nowMs;
  let startMs: number;
  switch (preset) {
    case "30d":
      startMs = endMs - 30 * MS_PER_DAY;
      break;
    case "90d":
      startMs = endMs - 90 * MS_PER_DAY;
      break;
    case "365d":
      startMs = endMs - MAX_CHART_WINDOW_MS;
      break;
    case "subscription":
    default: {
      const parsed = subscriptionCreatedAt ? Date.parse(subscriptionCreatedAt) : Number.NaN;
      startMs = Number.isNaN(parsed) ? endMs - MAX_CHART_WINDOW_MS : parsed;
      const cappedStart = endMs - MAX_CHART_WINDOW_MS;
      if (startMs < cappedStart) {
        startMs = cappedStart;
      }
      break;
    }
  }
  if (startMs > endMs) {
    startMs = endMs;
  }
  return {
    preset,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
  };
}

export function fmtChartAxisDate(iso: string, window: PlanGrowthChartWindow): string {
  try {
    const startYear = new Date(window.startAt).getFullYear();
    const endYear = new Date(window.endAt).getFullYear();
    const spanMs = Date.parse(window.endAt) - Date.parse(window.startAt);
    const includeYear = startYear !== endYear || spanMs > 90 * MS_PER_DAY;
    return new Date(iso).toLocaleDateString(
      "zh-CN",
      includeYear
        ? { year: "numeric", month: "short", day: "numeric" }
        : { month: "short", day: "numeric" },
    );
  } catch {
    return iso;
  }
}

function resolveMetricValueAtTime(
  atIso: string,
  metricId: PlanGrowthMetricId,
  milestones: readonly PlanMilestone[],
  subscription: SubscriptionGetResponse,
): number | null {
  let planId: string | null = null;
  for (const milestone of milestones) {
    if (milestone.at <= atIso) {
      planId = milestone.planId;
    } else {
      break;
    }
  }
  if (!planId) {
    planId = subscription.subscription?.planId ?? subscription.planView?.id ?? null;
  }
  if (!planId) {
    return null;
  }
  const capacity = resolveCapacityAtPlan(subscription, planId);
  if (!capacity) {
    return null;
  }
  return metricValueFromCapacity(metricId, capacity).value;
}

/** 将序列点展开到图表时间窗；权益类在窗内补起点/终点锚点。 */
export function expandSeriesToChartWindow(
  points: readonly PlanGrowthTrendPoint[],
  window: PlanGrowthChartWindow,
  options: {
    mode: PlanGrowthMetricSeries["mode"];
    metricId: PlanGrowthMetricId;
    milestones: readonly PlanMilestone[];
    subscription: SubscriptionGetResponse;
  },
): PlanGrowthTrendPoint[] {
  if (options.mode === "billing_cycle_usage") {
    return points
      .filter((point) => point.at >= window.startAt && point.at <= window.endAt)
      .toSorted((left, right) => left.at.localeCompare(right.at));
  }

  const { metricId, milestones, subscription } = options;
  const startValue = resolveMetricValueAtTime(window.startAt, metricId, milestones, subscription);
  const endValue = resolveMetricValueAtTime(window.endAt, metricId, milestones, subscription);
  if (startValue == null && endValue == null) {
    return [];
  }

  const result: PlanGrowthTrendPoint[] = [];
  const pushPoint = (at: string, value: number) => {
    const existing = result.find((point) => point.at === at);
    if (existing) {
      existing.value = value;
      return;
    }
    result.push({ at, value, label: fmtShortDate(at) });
  };

  if (startValue != null) {
    pushPoint(window.startAt, startValue);
  }

  for (const milestone of milestones) {
    if (milestone.at <= window.startAt || milestone.at > window.endAt) {
      continue;
    }
    const capacity = resolveCapacityAtPlan(subscription, milestone.planId);
    if (!capacity) {
      continue;
    }
    pushPoint(milestone.at, metricValueFromCapacity(metricId, capacity).value);
  }

  if (endValue != null) {
    pushPoint(window.endAt, endValue);
  }

  return result.toSorted((left, right) => left.at.localeCompare(right.at));
}

function metricValueFromCapacity(
  id: PlanGrowthMetricId,
  capacity: PlanCapacitySummary,
): { value: number; detail?: string } {
  switch (id) {
    case "bots":
      return { value: capacity.aiEmployees };
    case "concurrency":
      return { value: capacity.concurrentRuns };
    case "credits":
      return { value: capacity.monthlyCredits ?? 0 };
    case "tiers":
      return {
        value: capacity.allowedTiers.length,
        detail: formatTierListCompact(capacity.allowedTiers),
      };
    case "seats":
      return { value: capacity.teamMembers };
  }
}

function buildCurrentSummary(
  subscription: SubscriptionGetResponse,
  ops: OperationsStoreState,
  capacity: PlanCapacitySummary,
): PlanGrowthSummaryItem[] {
  const resources = ops.resources;
  const assignedSeats = resolveAssignedSeatCount({
    allocationSeats: ops.allocation?.seats,
    rosterSeats: ops.seats?.seats,
  });
  const botLimit = resources?.quota ?? capacity.aiEmployees;
  const usedBots = resources?.usedBots ?? 0;
  const concurrencyLimit =
    resources?.concurrencyLimit ?? ops.forecast?.concurrencyLimit ?? capacity.concurrentRuns;
  const concurrencyPeak = Math.max(
    resources?.concurrencyUsed ?? 0,
    ops.forecast?.concurrencyPeakInCycle ?? 0,
  );
  const creditsLimit =
    subscription.creditsStatus?.monthlyCredits ??
    ops.allocation?.ceiling.monthlyCredits ??
    capacity.monthlyCredits;
  const creditsUsed = subscription.creditsStatus?.creditsConsumed ?? 0;
  const tierLabel = formatTierListCompact(capacity.allowedTiers);

  return [
    {
      id: "bots",
      label: t("costBudget.v2.myPlan.growthPath.metrics.bots"),
      value: `${usedBots} / ${botLimit}`,
      subValue: t("costBudget.v2.myPlan.growthPath.fieldMaxBots"),
    },
    {
      id: "concurrency",
      label: t("costBudget.v2.myPlan.growthPath.metrics.concurrency"),
      value: `${concurrencyPeak} / ${concurrencyLimit}`,
      subValue: t("costBudget.v2.myPlan.growthPath.fieldMaxConcurrentRuns"),
    },
    {
      id: "credits",
      label: t("costBudget.v2.myPlan.growthPath.metrics.credits"),
      value:
        creditsLimit != null && creditsLimit > 0
          ? `${creditsUsed} / ${creditsLimit}`
          : t("costBudget.resourcesPanel.unlimited"),
      subValue: t("costBudget.v2.myPlan.growthPath.fieldCredits"),
    },
    {
      id: "tiers",
      label: t("costBudget.v2.myPlan.growthPath.metrics.tiers"),
      value: tierLabel,
      subValue: t("costBudget.v2.myPlan.growthPath.fieldAllowedTiers"),
    },
    {
      id: "seats",
      label: t("costBudget.v2.myPlan.growthPath.metrics.seats"),
      value: `${assignedSeats} / ${capacity.teamMembers}`,
      subValue: t("costBudget.v2.myPlan.growthPath.fieldSeats"),
    },
  ];
}

function buildMetricSeries(
  id: PlanGrowthMetricId,
  milestones: readonly PlanMilestone[],
  subscription: SubscriptionGetResponse,
): PlanGrowthMetricSeries {
  const labelKey = `costBudget.v2.myPlan.growthPath.metrics.${id}` as const;
  const unitKey = `costBudget.v2.myPlan.growthPath.units.${id}` as const;
  const points: PlanGrowthTrendPoint[] = [];
  let lastDetail: string | undefined;

  for (const milestone of milestones) {
    const capacity = resolveCapacityAtPlan(subscription, milestone.planId);
    if (!capacity) {
      continue;
    }
    const mapped = metricValueFromCapacity(id, capacity);
    lastDetail = mapped.detail ?? lastDetail;
    points.push({
      at: milestone.at,
      value: mapped.value,
      label: fmtShortDate(milestone.at),
    });
  }

  if (points.length === 0 && subscription.planView) {
    const current = buildPlanCapacitySummary({
      plan: subscription.planView,
      entitlement: parseSubscriptionEntitlement(subscription.entitlementSnapshot) ?? undefined,
    });
    const mapped = metricValueFromCapacity(id, current);
    const at = subscription.subscription?.createdAt ?? new Date().toISOString();
    points.push({ at, value: mapped.value, label: fmtShortDate(at) });
    lastDetail = mapped.detail;
  }

  return {
    id,
    label: t(labelKey),
    unit: t(unitKey),
    points,
    detail: lastDetail,
    mode: "entitlement_milestones",
  };
}

function buildCreditsConsumptionSeries(
  creditCycles: readonly TenantCreditsCycle[] | null | undefined,
  subscription: SubscriptionGetResponse,
): PlanGrowthMetricSeries {
  const points: PlanGrowthTrendPoint[] = [];
  const seen = new Set<string>();

  for (const cycle of creditCycles ?? []) {
    seen.add(cycle.cycleStart);
    points.push({
      at: cycle.cycleStart,
      value: cycle.creditsConsumed,
      label: fmtShortDate(cycle.cycleStart),
      quota: cycle.monthlyCredits,
    });
  }

  const current = subscription.creditsStatus;
  if (current?.cycleStart && !seen.has(current.cycleStart)) {
    points.push({
      at: current.cycleStart,
      value: current.creditsConsumed,
      label: fmtShortDate(current.cycleStart),
      quota: current.monthlyCredits,
    });
  }

  points.sort((left, right) => left.at.localeCompare(right.at));

  const latest = points.at(-1);
  const detail =
    latest?.quota != null && latest.quota > 0
      ? t("costBudget.v2.myPlan.growthPath.creditsCycleQuota", { quota: latest.quota })
      : t("costBudget.v2.myPlan.growthPath.creditsCycleUsageHint");

  return {
    id: "credits",
    label: t("costBudget.v2.myPlan.growthPath.metrics.credits"),
    unit: t("costBudget.v2.myPlan.growthPath.units.credits"),
    points,
    detail,
    mode: "billing_cycle_usage",
  };
}

export function buildPlanGrowthPathContext(input: {
  subscription: SubscriptionGetResponse;
  operations: OperationsStoreState;
  orders: readonly CommercialOrderDetail[];
}): PlanGrowthPathContext | null {
  const plan = input.subscription.planView;
  if (!plan || !input.subscription.subscription) {
    return null;
  }
  const entitlement =
    parseSubscriptionEntitlement(input.subscription.entitlementSnapshot) ?? undefined;
  const currentCapacity = buildPlanCapacitySummary({ plan, entitlement });
  const milestones = buildPlanMilestones(input.subscription.subscription, input.orders);
  const metricIds: PlanGrowthMetricId[] = ["bots", "concurrency", "credits", "tiers", "seats"];
  const seriesByMetric = {} as Record<PlanGrowthMetricId, PlanGrowthMetricSeries>;
  for (const id of metricIds) {
    if (id === "credits") {
      seriesByMetric.credits = buildCreditsConsumptionSeries(
        input.operations.creditCycles,
        input.subscription,
      );
      continue;
    }
    seriesByMetric[id] = buildMetricSeries(id, milestones, input.subscription);
  }
  return {
    summaries: buildCurrentSummary(input.subscription, input.operations, currentCapacity),
    seriesByMetric,
    subscriptionCreatedAt: input.subscription.subscription?.createdAt ?? null,
    milestones,
  };
}

export function growthDeltaLabel(
  points: readonly PlanGrowthTrendPoint[],
  options?: { mode?: PlanGrowthMetricSeries["mode"] },
): string | null {
  if (points.length < 2) {
    return null;
  }
  const first = points[0]?.value ?? 0;
  const last = points[points.length - 1]?.value ?? 0;
  if (first === last) {
    return options?.mode === "billing_cycle_usage"
      ? t("costBudget.v2.myPlan.growthPath.creditsDeltaStable")
      : t("costBudget.v2.myPlan.growthPath.deltaStable");
  }
  const sign = last > first ? "+" : "";
  if (options?.mode === "billing_cycle_usage") {
    return t("costBudget.v2.myPlan.growthPath.creditsDeltaSinceFirst", {
      delta: `${sign}${last - first}`,
    });
  }
  return t("costBudget.v2.myPlan.growthPath.deltaSinceStart", {
    delta: `${sign}${last - first}`,
  });
}
