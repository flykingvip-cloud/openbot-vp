/**
 * 三端共用的用量与费用视图形状，以及展示格式化。
 * 汇总在 gateway projection 里做一次；这里只描述结果、把已汇总的数字格式化成文案。
 */

export type UsageCostSurface = "user" | "enterprise" | "platform";

export type UsageTokenTally = {
  known: number;
  unknownCount: number;
  complete: boolean;
};

export type UsageChargeKind = "credits" | "quota" | "invoice" | "estimate" | "pending";

export type UsageChargeLine = {
  kind: UsageChargeKind;
  currency: string | null;
  /** 整数分。未知金额为 null，禁止用 0 代替未知。 */
  amountCents: number | null;
  credits: number | null;
  final: boolean;
  basis: string | null;
  label: string;
};

export type UsageCostLifecycle = "running" | "finished" | "needs_review";

export type UsageCostTaskNode = {
  taskId: string;
  parentTaskId: string | null;
  status: "running" | "succeeded" | "failed" | "cancelled" | "unknown";
  callCount: number;
  retryCount: number;
  fallbackCount: number;
  input: UsageTokenTally;
  output: UsageTokenTally;
  cacheRead: UsageTokenTally;
  cacheWrite: UsageTokenTally;
  charges: UsageChargeLine[];
  /** 父节点合计来自子任务，不把父级汇总行再加一次。 */
  rolledUpFromChildren: boolean;
  children: UsageCostTaskNode[];
};

export type UsageCostModelRow = {
  provider: string | null;
  model: string | null;
  callCount: number;
  retryCount: number;
  fallbackCount: number;
  input: UsageTokenTally;
  output: UsageTokenTally;
  cacheRead: UsageTokenTally;
  cacheWrite: UsageTokenTally;
  charges: UsageChargeLine[];
  /** 仅平台响应保留。缺失价格时不出现，也不用 0 代替。 */
  procurementCents?: number | null;
  procurementKnown?: boolean;
};

export type UsageCostBucket = {
  id: string;
  callCount: number;
  failedCount: number;
  retryCount: number;
  fallbackCount: number;
  input: UsageTokenTally;
  output: UsageTokenTally;
  charges: UsageChargeLine[];
};

export type UsageCostRankRow = {
  provider: string | null;
  model: string | null;
  procurementCents: number;
  priceKind: "known" | "free";
  successRate: number | null;
  acceptanceRate: number | null;
  latencyMsMedian: number | null;
  callCount: number;
};

export type UsageCostExcludedRank = {
  provider: string | null;
  model: string | null;
  reason: "unknown_usage" | "missing_price";
};

export type UsageCostLayerView = {
  schemaVersion: 1;
  surface: UsageCostSurface;
  lifecycle: UsageCostLifecycle;
  headline: string;
  empty: boolean;
  coverage: "complete" | "truncated";
  freshness: "current" | "delayed";
  recoveredFromStore: true;
  /** 缓存分类说明。账本没有逐次缓存时明确写未知，不用 0 代替。 */
  cacheNote: string | null;
  mixedCurrency: boolean;
  callCount: number;
  input: UsageTokenTally;
  output: UsageTokenTally;
  cacheRead: UsageTokenTally;
  cacheWrite: UsageTokenTally;
  charges: UsageChargeLine[];
  models: UsageCostModelRow[];
  tasks: UsageCostTaskNode[];
  byMember: UsageCostBucket[];
  byAssistant: UsageCostBucket[];
  byModel: UsageCostBucket[];
  reconciliation: {
    detailInputKnown: number;
    modelInputKnown: number;
    taskInputKnown: number;
    aligned: boolean;
  };
  attention: {
    active: boolean;
    message: string | null;
  };
  /** 仅平台视图保留；其它层级在服务端删除。 */
  ranking?: UsageCostRankRow[];
  excludedFromRanking?: UsageCostExcludedRank[];
  procurementCents?: number | null;
  /** 仅平台。mixed 表示已确认成本和待确认价格同时存在，合计不能当成完整成本。 */
  procurementStatus?: "known" | "free" | "missing" | "mixed";
  commercialMarginCents?: number | null;
  taskType?: string | null;
  acceptance?: "passed" | "failed" | "pending" | null;
};

export const EMPTY_TOKEN_TALLY: UsageTokenTally = {
  known: 0,
  unknownCount: 0,
  complete: true,
};

export function formatTokenTally(tally: UsageTokenTally): string {
  if (tally.unknownCount > 0 && tally.known <= 0) {
    return "未知";
  }
  if (tally.unknownCount > 0) {
    return `已知 ${tally.known}，另有 ${tally.unknownCount} 笔未知`;
  }
  return String(tally.known);
}

export function formatMoney(currency: string, amountCents: number): string {
  const amount = (amountCents / 100).toFixed(2);
  if (currency === "CNY") {
    return `¥${amount}`;
  }
  if (currency === "USD") {
    return `US$${amount}`;
  }
  return `${amount} ${currency}`;
}

export function formatChargeLine(line: UsageChargeLine): string {
  if (line.kind === "credits") {
    return line.final
      ? `已扣 ${line.credits ?? 0} Credits`
      : `Credits ${line.credits ?? 0}（未最终确认）`;
  }
  if (line.kind === "quota") {
    return `套餐额度 ${line.credits ?? 0} Credits`;
  }
  if (line.kind === "pending") {
    const known = line.credits !== null ? `已知消耗 ${line.credits} Credits` : "已知消耗待确认";
    return `${known} · 待结算`;
  }
  if (line.kind === "estimate") {
    const money =
      line.currency && line.amountCents !== null
        ? formatMoney(line.currency, line.amountCents)
        : "金额未知";
    const basis = line.basis ? `（${line.basis}）` : "";
    return `估算 ${money}${basis}`;
  }
  if (line.currency && line.amountCents !== null) {
    const money = formatMoney(line.currency, line.amountCents);
    return line.final ? `结算 ${money}` : `待结算 ${money}`;
  }
  return "费用待确认";
}

/** 企业账单响应里去掉采购成本与商业差额。结算金额和 Credits 保留。 */
export const COMMERCIAL_COST_KEYS: ReadonlySet<string> = new Set([
  "providerCostCents",
  "providerCost",
  "marginCents",
  "margin",
  "commercialMarginCents",
  "marginTrendDelta",
  "providerCostPerTaskCents",
  "providerCostPerCreditCents",
]);

export function omitCommercialCostKeys<T>(value: T): T {
  return stripCommercial(value) as T;
}

function stripCommercial(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stripCommercial(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (COMMERCIAL_COST_KEYS.has(key)) {
      continue;
    }
    output[key] = stripCommercial(entry);
  }
  return output;
}
