/**
 * 计费内核（framework-free 纯函数）。
 *
 * 严格约束（见 design.md）：
 * - 不 import 任何 IO / gateway / lit；输入→输出确定，可被属性测试覆盖。
 * - 金额一律整数分（cents）；乘法用 Math.round 收敛；明细各自取整后求和即为分量合计；
 *   区间占比用「末区间回填」保证占比和恰为 1，分量相加即总额（Property 8 / 10）。
 * - 账单/快照是对事件投影的确定性输出；estimated 与 final 走同一 settleCycle（Property 11）。
 */

import {
  computeAiAuthorizationCost,
  type AiProfileHistoryInterval,
} from "./ai-authorization-cost.ts";
import { chargeMeters, type MeterDefinition } from "./meter-contract.ts";
import type {
  Bill,
  BillItem,
  BillingDomainEvent,
  BudgetCheckLevel,
  CostSnapshot,
  PlanVersion,
  PriceLookup,
  PricingType,
  SeatHistoryInterval,
  SeatRole,
  SnapshotType,
  UsageRecord,
} from "./types.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────
// 价格查询（R2.3 / R2.4 / Property 2）
// ─────────────────────────────────────────────────────────────────────────

/**
 * 从锁定的 PlanVersion 快照中查价。命中返回 `{ priceCents }`；
 * 未命中返回 `{ missing: true }`，**绝不**返回隐式默认价或 0。
 * 同输入连续调用结果一致（纯函数）。
 */
export function getPrice(version: PlanVersion, type: PricingType, key: string): PriceLookup {
  const match = version.snapshot.pricing.find((p) => p.type === type && p.key === key);
  if (!match) {
    return { missing: true };
  }
  return { priceCents: match.priceCents };
}

// ─────────────────────────────────────────────────────────────────────────
// 计费路径不变量守卫（R26.5/26.6、R27.3/27.4 / Property 15）
// ─────────────────────────────────────────────────────────────────────────

/** 计费路径数据完整性违例（缺 plan_version_id / 缺快照 / 以 planId 充当计费依据）。 */
export class BillingDataIntegrityError extends Error {
  constructor(message: string) {
    super(`billing data integrity violation: ${message}`);
    this.name = "BillingDataIntegrityError";
  }
}

/**
 * 计费入口守卫：断言锁定版本的定价快照可用，并拒绝以 `plan_id` 充当计费依据的输入。
 * 这是「计费只读 version snapshot」的最后防线（即使版本已 deprecated 也按其快照计费）。
 */
export function assertBillingInputs(input: {
  planVersionId?: string | null;
  version?: Pick<PlanVersion, "id" | "snapshot"> | null;
}): void {
  if (!input.planVersionId) {
    throw new BillingDataIntegrityError("subscription missing plan_version_id");
  }
  if (!input.version || !input.version.snapshot || !Array.isArray(input.version.snapshot.pricing)) {
    throw new BillingDataIntegrityError("locked plan version snapshot is unavailable");
  }
  if (input.version.id !== input.planVersionId) {
    throw new BillingDataIntegrityError("version does not match locked plan_version_id");
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 时间区间裁剪与占比（Proration 基础，Property 10）
// ─────────────────────────────────────────────────────────────────────────

function toMs(iso: string): number {
  return new Date(iso).getTime();
}

// ─────────────────────────────────────────────────────────────────────────
// 一致性守卫（R11.4，前置于 settleCycle）
// ─────────────────────────────────────────────────────────────────────────

export type ConsistencyDiagnostic = {
  code: "seat_interval_overlap" | "seat_interval_gap" | "usage_out_of_window" | "invalid_cycle";
  message: string;
  ref?: string;
};

/**
 * 校验周期投影切片的一致性：Seat 区间在窗口内闭合（无重叠），Usage 落在窗口内。
 * 返回诊断列表（空 = 一致）。不写补丁——调用方据此报错（R 一致性守卫）。
 */
export function assertCycleConsistency(input: {
  cycleStart: string;
  cycleEnd: string;
  intervals: readonly SeatHistoryInterval[];
  usage: readonly UsageRecord[];
}): ConsistencyDiagnostic[] {
  const diagnostics: ConsistencyDiagnostic[] = [];
  const cycleStart = toMs(input.cycleStart);
  const cycleEnd = toMs(input.cycleEnd);
  if (!(cycleEnd > cycleStart)) {
    diagnostics.push({ code: "invalid_cycle", message: "cycleEnd must be after cycleStart" });
    return diagnostics;
  }

  // 按 seat 分组校验区间无重叠。
  const bySeat = new Map<string, SeatHistoryInterval[]>();
  for (const iv of input.intervals) {
    bySeat.set(iv.seatId, [...(bySeat.get(iv.seatId) ?? []), iv]);
  }
  for (const [seatId, intervals] of bySeat) {
    const sorted = intervals
      .map((iv) => ({
        startMs: toMs(iv.startTime),
        endMs: iv.endTime ? toMs(iv.endTime) : cycleEnd,
      }))
      .toSorted((a, b) => a.startMs - b.startMs);
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (cur.startMs < prev.endMs) {
        diagnostics.push({
          code: "seat_interval_overlap",
          message: `seat ${seatId} has overlapping role intervals`,
          ref: seatId,
        });
        break;
      }
    }
  }

  // Usage 必须落在窗口内（越界事件属于其它周期）。
  for (const rec of input.usage) {
    const at = toMs(rec.occurredAt);
    if (at < cycleStart || at >= cycleEnd) {
      diagnostics.push({
        code: "usage_out_of_window",
        message: `usage record ${rec.eventId} occurredAt is outside the billing cycle`,
        ref: rec.eventId,
      });
    }
  }

  return diagnostics;
}

// ─────────────────────────────────────────────────────────────────────────
// Seat 超额成本（套餐内 seatQuota 免费；仅超额按时间比例 × extra/seat:{role}）
// ─────────────────────────────────────────────────────────────────────────

export type SeatCostResult = {
  seatCostCents: number;
  items: BillItem[];
  missingPriceKeys: string[];
};

type SeatRolePresence = {
  seatId: string;
  role: SeatRole;
  startMs: number;
  endMs: number;
};

/**
 * 计算周期内席位**超额**成本（正式账单 seatCostCents 真源）。
 *
 * 规则（与 hardening §2.5 / 企业应付公式对齐）：
 * - 套餐基础费覆盖 included `seatQuota[role]`，不得再按 `seat/{role}` 全量计费。
 * - 各角色配额独立，禁止跨角色抵扣。
 * - 按席位历史区间重建时间线；每个时间片内仅对 `max(0, activeCount[role]-quota[role])`
 *   的超额席位计费，单价取 `extra/seat:{role}`（缺价 → missingPriceKeys，禁止静默 0）。
 * - 月中角色变更：同一席位前后半段分别计入对应角色占用。
 * - 超额席位按 seatId 字典序稳定选取（前 quota 个免费，其余计费），便于归因下钻。
 */
export function computeSeatCost(args: {
  version: PlanVersion;
  intervals: readonly SeatHistoryInterval[];
  cycleStart: string;
  cycleEnd: string;
}): SeatCostResult {
  const cycleStart = toMs(args.cycleStart);
  const cycleEnd = toMs(args.cycleEnd);
  const cycleMs = cycleEnd - cycleStart;
  const missing = new Set<string>();

  if (cycleMs <= 0) {
    return { seatCostCents: 0, items: [], missingPriceKeys: [] };
  }

  const presence: SeatRolePresence[] = [];
  const boundaries = new Set<number>([cycleStart, cycleEnd]);
  for (const iv of args.intervals) {
    const ivStart = toMs(iv.startTime);
    const ivEnd = iv.endTime ? toMs(iv.endTime) : cycleEnd;
    const start = Math.max(ivStart, cycleStart);
    const end = Math.min(ivEnd, cycleEnd);
    if (end <= start) {
      continue;
    }
    presence.push({ seatId: iv.seatId, role: iv.role, startMs: start, endMs: end });
    boundaries.add(start);
    boundaries.add(end);
  }

  const points = [...boundaries].toSorted((a, b) => a - b);
  /** seatId → 精确（未取整）超额贡献分，末段回填。 */
  const exactBySeat = new Map<string, number>();
  const roleBySeat = new Map<string, SeatRole>();

  for (let i = 0; i < points.length - 1; i += 1) {
    const segStart = points[i];
    const segEnd = points[i + 1];
    if (segStart === undefined || segEnd === undefined) {
      continue;
    }
    const segMs = segEnd - segStart;
    if (segMs <= 0) {
      continue;
    }
    const activeByRole = new Map<SeatRole, string[]>();
    for (const p of presence) {
      if (p.startMs <= segStart && p.endMs >= segEnd) {
        const list = activeByRole.get(p.role) ?? [];
        list.push(p.seatId);
        activeByRole.set(p.role, list);
      }
    }
    for (const [role, seatIds] of activeByRole) {
      const unique = [...new Set(seatIds)].toSorted((a, b) => a.localeCompare(b, "en"));
      const quota = Math.max(0, args.version.snapshot.seatQuota[role] ?? 0);
      const overSeats = unique.slice(quota);
      if (overSeats.length === 0) {
        continue;
      }
      const price = getPrice(args.version, "extra", `seat:${role}`);
      if ("missing" in price) {
        missing.add(`extra/seat:${role}`);
        continue;
      }
      const fraction = segMs / cycleMs;
      for (const seatId of overSeats) {
        exactBySeat.set(seatId, (exactBySeat.get(seatId) ?? 0) + price.priceCents * fraction);
        roleBySeat.set(seatId, role);
      }
    }
  }

  const items: BillItem[] = [];
  let total = 0;
  const seatIds = [...exactBySeat.keys()].toSorted((a, b) => a.localeCompare(b, "en"));
  for (let i = 0; i < seatIds.length; i += 1) {
    const seatId = seatIds[i];
    if (seatId === undefined) {
      continue;
    }
    const exact = exactBySeat.get(seatId) ?? 0;
    const isLast = i === seatIds.length - 1;
    let amount: number;
    if (isLast) {
      const exactSum = seatIds.reduce((acc, id) => acc + (exactBySeat.get(id) ?? 0), 0);
      amount = Math.round(exactSum) - total;
    } else {
      amount = Math.round(exact);
    }
    const role = roleBySeat.get(seatId) ?? "viewer";
    items.push({
      type: "seat",
      key: role,
      detail: `seat:${seatId} role:${role} overage`,
      amountCents: amount,
    });
    total += amount;
  }

  return {
    seatCostCents: total,
    items,
    missingPriceKeys: [...missing].toSorted(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Usage 成本（Σ quantity × usage/{key} 单价，R9.5）
// ─────────────────────────────────────────────────────────────────────────

export type UsageCostResult = {
  usageCostCents: number;
  /** 按 key 聚合的用量（供超额计算复用）。 */
  usageByKey: Record<string, number>;
  items: BillItem[];
  missingPriceKeys: string[];
};

export function computeUsageCost(args: {
  version: PlanVersion;
  records: readonly UsageRecord[];
  /**
   * 套餐包含配额。提供时：
   * - usage 仅对 included=min(usage,quota) 计费（避免与 extra 对同一数量双计）
   * - 未提供时保持历史行为：对全量 usage 计费（仅 estimated/兼容路径）
   */
  usageQuota?: Record<string, number>;
}): UsageCostResult {
  const usageByKey: Record<string, number> = {};
  for (const rec of args.records) {
    usageByKey[rec.key] = (usageByKey[rec.key] ?? 0) + rec.quantity;
  }
  const items: BillItem[] = [];
  const missing = new Set<string>();
  let total = 0;
  for (const key of Object.keys(usageByKey).toSorted()) {
    const quantity = usageByKey[key];
    const price = getPrice(args.version, "usage", key);
    if ("missing" in price) {
      // 无 usage 单价时不报错：可能仅靠 extra 计超额（package 内免费）。
      continue;
    }
    const hasQuota = args.usageQuota != null && Object.hasOwn(args.usageQuota, key);
    const billableQty = hasQuota
      ? Math.min(Math.max(0, quantity), Math.max(0, args.usageQuota![key] ?? 0))
      : quantity;
    if (billableQty <= 0) {
      continue;
    }
    const amount = Math.round(price.priceCents * billableQty);
    items.push({
      type: "usage",
      key,
      detail: hasQuota
        ? `usage:${key} included:${billableQty} total:${quantity}`
        : `usage:${key} qty:${quantity}`,
      amountCents: amount,
    });
    total += amount;
  }
  return { usageCostCents: total, usageByKey, items, missingPriceKeys: [...missing] };
}

// ─────────────────────────────────────────────────────────────────────────
// 超额成本（用量/席位/Bot 超配额部分按 extra/{key}，R9.7 / R20.4 / Property 7）
// ─────────────────────────────────────────────────────────────────────────

export type ExtraCostResult = {
  extraCostCents: number;
  items: BillItem[];
  missingPriceKeys: string[];
  /** final 结算时配额缺失的计量 key。 */
  missingQuotaKeys: string[];
};

export function computeExtraCost(args: {
  version: PlanVersion;
  /** 周期内按计量 key 聚合的用量。 */
  usageByKey: Record<string, number>;
  /**
   * 各计量 key 的配额。
   * - final 路径必须提供；缺省 key 且 used>0 → missingQuotaKeys
   * - estimated 兼容：缺省仍按 0 配额计算超额（历史行为）
   */
  usageQuota?: Record<string, number>;
  /** final 时对缺失配额严格失败标记（默认 false=兼容 estimated）。 */
  strictQuota?: boolean;
  /** 当前各角色已分配席位数。 */
  seatCountByRole?: Partial<Record<SeatRole, number>>;
  /** 当前 Bot 数。 */
  botCount?: number;
}): ExtraCostResult {
  const items: BillItem[] = [];
  const missing = new Set<string>();
  const missingQuota = new Set<string>();
  let total = 0;

  // 用量超额：仅对 overage=max(0, usage-quota) 计费，不与 usage 全量重叠。
  for (const key of Object.keys(args.usageByKey).toSorted()) {
    const used = args.usageByKey[key];
    const hasQuota = args.usageQuota != null && Object.hasOwn(args.usageQuota, key);
    if (!hasQuota) {
      if (args.strictQuota && used > 0) {
        missingQuota.add(key);
      }
      // 无配额配置：strict 时跳过计费；非 strict 按 quota=0（历史 estimated 行为）
      if (args.strictQuota) {
        continue;
      }
    }
    const quota = hasQuota ? (args.usageQuota![key] ?? 0) : 0;
    const over = Math.max(0, used - quota);
    if (over <= 0) {
      continue;
    }
    const price = getPrice(args.version, "extra", key);
    if ("missing" in price) {
      missing.add(`extra/${key}`);
      continue;
    }
    const amount = Math.round(price.priceCents * over);
    items.push({ type: "extra", key, detail: `overage:${key} over:${over}`, amountCents: amount });
    total += amount;
  }

  // 席位超额已迁至 computeSeatCost（历史区间 + 角色配额时间线），此处不再按
  // 期末瞬时 seatCountByRole 重复计费。seatCountByRole 参数保留仅为 API 兼容。
  void args.seatCountByRole;

  // Bot 超额。
  if (typeof args.botCount === "number") {
    const over = Math.max(0, args.botCount - args.version.snapshot.botQuota);
    if (over > 0) {
      const price = getPrice(args.version, "extra", "bot");
      if ("missing" in price) {
        missing.add("extra/bot");
      } else {
        const amount = Math.round(price.priceCents * over);
        items.push({
          type: "extra",
          key: "bot",
          detail: `overage bot over:${over}`,
          amountCents: amount,
        });
        total += amount;
      }
    }
  }

  return {
    extraCostCents: total,
    items,
    missingPriceKeys: [...missing],
    missingQuotaKeys: [...missingQuota].toSorted(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 总成本单一入口（R10.1 / Property 1）
// ─────────────────────────────────────────────────────────────────────────

export function computeTotalCost(parts: {
  seatCostCents: number;
  usageCostCents: number;
  extraCostCents: number;
}): number {
  return parts.seatCostCents + parts.usageCostCents + parts.extraCostCents;
}

// ─────────────────────────────────────────────────────────────────────────
// 预算检查（R6.5 / R6.6 / Property 3）
// ─────────────────────────────────────────────────────────────────────────

/**
 * 预算检查边界：
 * - total >= limit×threshold → "alert"
 * - total > limit            → "exceeded"
 * - 否则                     → "ok"
 * 阈值边界（恰等于阈值）判定为触发提醒。
 */
export function checkBudget(args: {
  totalCostCents: number;
  monthlyLimitCents: number;
  alertThreshold: number;
}): { level: BudgetCheckLevel } {
  const { totalCostCents, monthlyLimitCents, alertThreshold } = args;
  if (monthlyLimitCents <= 0) {
    return { level: "ok" };
  }
  if (totalCostCents > monthlyLimitCents) {
    return { level: "exceeded" };
  }
  if (totalCostCents >= monthlyLimitCents * alertThreshold) {
    return { level: "alert" };
  }
  return { level: "ok" };
}

// ─────────────────────────────────────────────────────────────────────────
// 预计月底费用（R7.2 / R12 / Property 间接）
// ─────────────────────────────────────────────────────────────────────────

export type PredictionResult = { predictedCents: number } | { insufficientData: true };

/**
 * 预测本周期月底费用。
 * - 默认线性：accrued / elapsedDays × totalDays。
 * - 可选 wma：对 dailySeries 末段赋更高权重，缓解突发失真。
 * - elapsedDays == 0：返回 insufficientData（避免除零，R12.3）。
 */
export function predictMonthEndCost(args: {
  accruedCents: number;
  elapsedDays: number;
  totalDays: number;
  dailySeries?: readonly number[];
  mode?: "linear" | "wma";
}): PredictionResult {
  if (args.elapsedDays <= 0 || args.totalDays <= 0) {
    return { insufficientData: true };
  }
  if (args.mode === "wma" && args.dailySeries && args.dailySeries.length > 0) {
    const series = args.dailySeries;
    let weightedSum = 0;
    let weightTotal = 0;
    for (let i = 0; i < series.length; i += 1) {
      const weight = i + 1; // 线性递增权重，近期更高
      weightedSum += series[i] * weight;
      weightTotal += weight;
    }
    const weightedDaily = weightTotal > 0 ? weightedSum / weightTotal : 0;
    return { predictedCents: Math.round(weightedDaily * args.totalDays) };
  }
  const dailyRate = args.accruedCents / args.elapsedDays;
  return { predictedCents: Math.round(dailyRate * args.totalDays) };
}

// ─────────────────────────────────────────────────────────────────────────
// 周期结算（统一投影入口，estimated/final 同函数，Property 11）
// ─────────────────────────────────────────────────────────────────────────

export type SettleInput = {
  enterpriseId: string;
  version: PlanVersion;
  /** 订阅锁定的版本 id（用于计费路径守卫；缺省回退 version.id）。 */
  planVersionId?: string;
  cycleStart: string;
  cycleEnd: string;
  /** 当日（快照日期）。 */
  date: string;
  intervals: readonly SeatHistoryInterval[];
  usage: readonly UsageRecord[];
  /**
   * @deprecated 优先传 `meters`。usageQuota 仅作无 MeterDefinition 时的兼容路径。
   */
  usageQuota?: Record<string, number>;
  /** 权威计量定义；提供时 usage/extra 由 MeterDefinition 驱动。 */
  meters?: readonly MeterDefinition[];
  seatCountByRole?: Partial<Record<SeatRole, number>>;
  botCount?: number;
  /** AI 能力授权历史区间（月中升级按时间比例）。 */
  aiProfileIntervals?: readonly AiProfileHistoryInterval[];
  /** 套餐内授权配额（锁定 planVersion 的 entitlement.aiProfileQuota）。 */
  aiProfileQuota?: Partial<Record<"basic" | "pro" | "elite", number>>;
  snapshotType: SnapshotType;
  generatedAt: string;
  /** 生成的记录 id（由调用方注入，保证纯函数确定性）。 */
  billId: string;
  snapshotId: string;
  settlementKey?: string;
};

export type SettleResult = {
  bill: Bill;
  snapshot: CostSnapshot;
};

/**
 * 对一个计费周期的事件投影做确定性结算，产出 Bill + CostSnapshot。
 * estimated 与 final 走同一函数，仅 snapshotType 标记不同 → 二者必然收敛（Property 11）。
 */
export function settleCycle(input: SettleInput): SettleResult {
  // 计费路径守卫：仅经锁定版本快照计费，拒绝缺失/不一致输入（Property 15）。
  assertBillingInputs({
    planVersionId: input.planVersionId ?? input.version.id,
    version: input.version,
  });
  const seat = computeSeatCost({
    version: input.version,
    intervals: input.intervals,
    cycleStart: input.cycleStart,
    cycleEnd: input.cycleEnd,
  });

  const usageByKey: Record<string, number> = {};
  for (const rec of input.usage) {
    usageByKey[rec.key] = (usageByKey[rec.key] ?? 0) + rec.quantity;
  }

  let usageCostCents = 0;
  let extraCostCents = 0;
  let usageItems: BillItem[] = [];
  let extraItems: BillItem[] = [];
  let missingFromMeters: string[] = [];

  if (input.meters && input.meters.length > 0) {
    const charged = chargeMeters({
      meters: input.meters,
      usageByKey,
      pricing: input.version.snapshot.pricing,
      strict: input.snapshotType === "final",
    });
    usageCostCents = charged.usageCostCents;
    extraCostCents = charged.extraCostCents;
    usageItems = charged.items
      .filter((i) => i.type === "usage")
      .map((i) => ({
        type: "usage" as const,
        key: i.key,
        detail: i.detail,
        amountCents: i.amountCents,
      }));
    extraItems = charged.items
      .filter((i) => i.type === "extra")
      .map((i) => ({
        type: "extra" as const,
        key: i.key,
        detail: i.detail,
        amountCents: i.amountCents,
      }));
    missingFromMeters = [
      ...charged.missingPriceKeys,
      ...charged.missingQuotaKeys.map((k) => `quota/${k}`),
    ];
  } else {
    const usage = computeUsageCost({
      version: input.version,
      records: input.usage,
      usageQuota: input.usageQuota,
    });
    const extra = computeExtraCost({
      version: input.version,
      usageByKey: usage.usageByKey,
      usageQuota: input.usageQuota,
      strictQuota: input.snapshotType === "final",
      seatCountByRole: input.seatCountByRole,
      botCount: input.botCount,
    });
    usageCostCents = usage.usageCostCents;
    extraCostCents = extra.extraCostCents;
    usageItems = usage.items;
    extraItems = extra.items;
    missingFromMeters = [
      ...usage.missingPriceKeys,
      ...extra.missingPriceKeys,
      ...extra.missingQuotaKeys.map((k) => `quota/${k}`),
    ];
    // seat/bot extra still from computeExtraCost when meters path — re-run seat/bot only
  }

  // Bot / 其它资源超额与 meter 解耦；席位超额已在 computeSeatCost。
  if (input.meters && input.meters.length > 0) {
    const resourceExtra = computeExtraCost({
      version: input.version,
      usageByKey: {},
      usageQuota: {},
      strictQuota: false,
      botCount: input.botCount,
    });
    extraCostCents += resourceExtra.extraCostCents;
    extraItems = [...extraItems, ...resourceExtra.items];
    missingFromMeters = [...missingFromMeters, ...resourceExtra.missingPriceKeys];
  }

  // AI 能力授权超额（仅当套餐权益显式配置 aiProfileQuota 时启用）。
  let authMissing: string[] = [];
  let authItems: BillItem[] = [];
  let authCost = 0;
  if (input.aiProfileQuota) {
    const auth = computeAiAuthorizationCost({
      version: input.version,
      intervals: input.aiProfileIntervals ?? [],
      cycleStart: input.cycleStart,
      cycleEnd: input.cycleEnd,
      aiProfileQuota: input.aiProfileQuota,
    });
    authCost = auth.authorizationCostCents;
    authItems = auth.items;
    authMissing = auth.missingPriceKeys;
  }
  extraCostCents += authCost;
  extraItems = [...extraItems, ...authItems];
  missingFromMeters = [...missingFromMeters, ...authMissing];

  const totalCostCents = computeTotalCost({
    seatCostCents: seat.seatCostCents,
    usageCostCents,
    extraCostCents,
  });
  const missingPriceKeys = [
    ...new Set([...seat.missingPriceKeys, ...missingFromMeters]),
  ].toSorted();

  const bill: Bill = {
    id: input.billId,
    enterpriseId: input.enterpriseId,
    cycleStart: input.cycleStart,
    cycleEnd: input.cycleEnd,
    planVersionId: input.version.id,
    items: [...seat.items, ...usageItems, ...extraItems],
    seatCostCents: seat.seatCostCents,
    usageCostCents,
    extraCostCents,
    totalCostCents,
    generatedAt: input.generatedAt,
    ...(input.settlementKey ? { settlementKey: input.settlementKey } : {}),
  };

  const snapshot: CostSnapshot = {
    id: input.snapshotId,
    enterpriseId: input.enterpriseId,
    date: input.date,
    snapshotType: input.snapshotType,
    seatCostCents: seat.seatCostCents,
    usageCostCents,
    totalCostCents,
    missingPriceKeys,
    createdAt: input.generatedAt,
    ...(input.settlementKey ? { settlementKey: input.settlementKey } : {}),
    billId: input.billId,
  };

  return { bill, snapshot };
}

/** 计算两个 ISO 时间间的天数（向上取整，至少 1）。 */
export function daysBetween(startIso: string, endIso: string): number {
  const ms = toMs(endIso) - toMs(startIso);
  return Math.max(1, Math.ceil(ms / MS_PER_DAY));
}

// ─────────────────────────────────────────────────────────────────────────
// 事件投影（Source of Truth = 事件日志，Property 13）
// ─────────────────────────────────────────────────────────────────────────

export type ProjectionSlice = {
  intervals: SeatHistoryInterval[];
  usage: UsageRecord[];
};

/**
 * 从域事件日志重建某计费周期的投影切片（intervals + usage）。
 *
 * 这是「事件日志是唯一真相」的核心纯函数：
 * - UsageReportedEvent → UsageRecord，按 `eventId` 幂等去重（重复投递不重复计费，
 *   延续 Property 9；保证 at-least-once 投递安全，Property 13）。
 * - SeatChangedEvent → seat_history 区间：每次角色变更关闭上一区间、开启新区间。
 * 输入事件可乱序/重复，输出对相同事件集合确定（重放一致）。
 */
export function projectFromEvents(
  events: ReadonlyArray<BillingDomainEvent>,
  enterpriseId: string,
): ProjectionSlice {
  // Usage：按 eventId 去重（首次出现为准）。
  const usageByEventId = new Map<string, UsageRecord>();
  // Seat：按 seatId 收集角色变更，稍后排序成闭合区间。
  const seatChanges = new Map<string, Array<{ role: SeatRole; at: number; atIso: string }>>();

  for (const ev of events) {
    if (ev.enterpriseId !== enterpriseId) {
      continue;
    }
    if (ev.type === "usage.reported") {
      if (!usageByEventId.has(ev.eventId)) {
        usageByEventId.set(ev.eventId, {
          id: ev.eventId,
          enterpriseId,
          // 事件忠实携带 userId（按用户归因，R9.1 / R18 / R21）；旧日志缺字段时回退空串。
          userId: ev.userId ?? "",
          eventId: ev.eventId,
          key: ev.key,
          quantity: ev.quantity,
          occurredAt: ev.occurredAt,
          ingestedAt: ev.occurredAt,
          ...(ev.agentId ? { agentId: ev.agentId } : {}),
          ...(ev.orgSeatId ? { orgSeatId: ev.orgSeatId } : {}),
        });
      }
    } else if (ev.type === "seat.changed") {
      const list = seatChanges.get(ev.seatId) ?? [];
      list.push({ role: ev.toRole, at: toMs(ev.effectiveAt), atIso: ev.effectiveAt });
      seatChanges.set(ev.seatId, list);
    }
  }

  const intervals: SeatHistoryInterval[] = [];
  for (const [seatId, changesRaw] of seatChanges) {
    const changes = changesRaw.toSorted((a, b) => a.at - b.at);
    for (let i = 0; i < changes.length; i += 1) {
      const cur = changes[i];
      const next = changes[i + 1];
      intervals.push({
        id: `${seatId}:${i}`,
        seatId,
        enterpriseId,
        role: cur.role,
        startTime: cur.atIso,
        endTime: next ? next.atIso : null,
      });
    }
  }

  const usage = [...usageByEventId.values()].toSorted(
    (a, b) => toMs(a.occurredAt) - toMs(b.occurredAt),
  );
  return { intervals, usage };
}
