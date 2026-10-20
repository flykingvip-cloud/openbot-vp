/**
 * 计量合同（MeterDefinition）— 权威控制：
 * - 单位 unit
 * - 套餐包含配额 includedQuota
 * - 包含量是否按 usage 单价收费 chargeIncludedAtUsagePrice（必须显式，禁止用「有无 extra 价」推断）
 * - 超额是否允许 / 所需价格键
 *
 * 公式：
 *   included = min(usage, quota)
 *   overage  = max(0, usage - quota)
 * 禁止同一数量在 usage 与 extra 双计。
 *
 * **不** 将 monthlyCredits 隐式映射到 ai_token。
 * **ai_credits**：monthlyCredits 为套餐包含量，默认 chargeIncludedAtUsagePrice=false。
 */

import type { EntitlementSnapshot } from "../package-entitlement/types.js";
import type { PlanPricing, PlanVersion } from "./types.js";

export type MeterKey = string;

export type MeterUnit = "credit" | "token" | "cent" | "count";

export type MeterDefinition = {
  key: MeterKey;
  unit: MeterUnit;
  /** 套餐包含量；undefined = 无套餐配额（纯计量或未配置）。 */
  includedQuota?: number;
  /**
   * true：included（或无配额时的全量）按 usage/{key} 单价计费；
   * false：套餐内免费，仅 overage 走 extra/{key}。
   * 必须由持久化定义或显式默认表给出，禁止从「是否存在 extra 价」推断。
   */
  chargeIncludedAtUsagePrice: boolean;
  /** 是否允许超额（无 extra 价且 overage>0 时 final 失败）。 */
  allowOverage: boolean;
  aggregate: "sum";
  rounding: "integer";
};

/** PlanVersion.snapshot.meters 条目（冻结字段）。 */
export type PersistedMeterDefinition = {
  key: string;
  unit: MeterUnit;
  includedQuota?: number;
  chargeIncludedAtUsagePrice: boolean;
  allowOverage: boolean;
  aggregate?: "sum";
  rounding?: "integer";
};

/**
 * 显式默认表（非价格推断）。
 * ai_credits：套餐包含免费；允许超额（需 extra 价才可出账）。
 */
export const WELL_KNOWN_METER_DEFAULTS: Readonly<
  Record<string, Pick<MeterDefinition, "unit" | "chargeIncludedAtUsagePrice" | "allowOverage">>
> = {
  ai_credits: {
    unit: "credit",
    chargeIncludedAtUsagePrice: false,
    allowOverage: true,
  },
  /** 兼容历史 ai_token 计量键：套餐内免费，超额只走 extra/ai_token。 */
  ai_token: {
    unit: "token",
    chargeIncludedAtUsagePrice: false,
    allowOverage: true,
  },
};

export type MeterSplit = {
  key: MeterKey;
  usage: number;
  quota: number;
  included: number;
  overage: number;
  missingQuota: boolean;
};

export type MeterChargeLine = {
  type: "usage" | "extra";
  key: string;
  detail: string;
  amountCents: number;
  quantity: number;
};

export type MeterChargeResult = {
  usageCostCents: number;
  extraCostCents: number;
  items: MeterChargeLine[];
  missingPriceKeys: string[];
  missingQuotaKeys: string[];
  usageByKey: Record<string, number>;
};

/** 将用量与配额拆为 included / overage（整数，非负）。 */
export function splitMeterUsage(
  key: MeterKey,
  usage: number,
  quota: number | undefined,
): MeterSplit {
  const u = Math.max(0, Math.round(usage));
  if (quota == null || !Number.isFinite(quota)) {
    return {
      key,
      usage: u,
      quota: 0,
      included: 0,
      overage: u,
      missingQuota: true,
    };
  }
  const q = Math.max(0, Math.round(quota));
  return {
    key,
    usage: u,
    quota: q,
    included: Math.min(u, q),
    overage: Math.max(0, u - q),
    missingQuota: false,
  };
}

function normalizePersisted(m: PersistedMeterDefinition): MeterDefinition {
  return {
    key: m.key,
    unit: m.unit,
    ...(m.includedQuota !== undefined
      ? { includedQuota: Math.max(0, Math.round(m.includedQuota)) }
      : {}),
    chargeIncludedAtUsagePrice: Boolean(m.chargeIncludedAtUsagePrice),
    allowOverage: Boolean(m.allowOverage),
    aggregate: m.aggregate ?? "sum",
    rounding: m.rounding ?? "integer",
  };
}

/**
 * 解析运行时 MeterDefinition。
 *
 * 优先级：
 * 1. PlanVersion.snapshot.meters（持久化冻结，权威）
 * 2. 显式 WELL_KNOWN_METER_DEFAULTS + 定价登记的 key
 *
 * entitlement.monthlyCredits **仅** 写入 ai_credits.includedQuota，
 * 不改写 chargeIncludedAtUsagePrice。
 */
export function buildMeterDefinitions(args: {
  version: PlanVersion;
  entitlement?: Pick<EntitlementSnapshot, "monthlyCredits"> | null;
  usageKeys?: readonly string[];
}): MeterDefinition[] {
  const pricing = args.version.snapshot.pricing ?? [];
  const persisted = args.version.snapshot.meters;

  if (persisted && persisted.length > 0) {
    return mergeEntitlementQuota(
      persisted.map(normalizePersisted),
      args.entitlement,
      args.usageKeys,
    );
  }

  // 无持久化定义：用显式默认表 + 定价/用量 key 合成（仍不按 extra 推断 chargeIncluded）
  const keys = new Set<string>();
  for (const p of pricing) {
    if (p.type === "usage" || p.type === "extra") {
      keys.add(p.key);
    }
  }
  for (const k of args.usageKeys ?? []) {
    keys.add(k);
  }
  if (args.entitlement && !keys.has("ai_credits")) {
    keys.add("ai_credits");
  }

  const defs: MeterDefinition[] = [];
  for (const key of [...keys].toSorted()) {
    const hasExtra = pricing.some((p) => p.type === "extra" && p.key === key);
    const hasUsage = pricing.some((p) => p.type === "usage" && p.key === key);
    const known = WELL_KNOWN_METER_DEFAULTS[key];
    if (known) {
      defs.push({
        key,
        unit: known.unit,
        chargeIncludedAtUsagePrice: known.chargeIncludedAtUsagePrice,
        // 允许超额语义仅在存在 extra 价时生效，避免无 extra 却 allowOverage=true 导致无法保存
        allowOverage: known.allowOverage && hasExtra,
        // 套餐内免费计量：缺省 includedQuota=0（整笔走 extra）；ai_credits 稍后由 entitlement 覆盖
        ...(!known.chargeIncludedAtUsagePrice ? { includedQuota: 0 } : {}),
        aggregate: "sum",
        rounding: "integer",
      });
      continue;
    }
    // 未知 key：默认「纯计量」— 全量按 usage 价（无套餐包含）；超额需 extra 价时 allowOverage
    defs.push({
      key,
      unit: inferUnit(key),
      // 无套餐包含语义：charge 全量 usage；不因「没有 extra」而改语义
      chargeIncludedAtUsagePrice: hasUsage,
      allowOverage: hasExtra,
      aggregate: "sum",
      rounding: "integer",
    });
  }
  return mergeEntitlementQuota(defs, args.entitlement, args.usageKeys);
}

function mergeEntitlementQuota(
  defs: MeterDefinition[],
  entitlement: Pick<EntitlementSnapshot, "monthlyCredits"> | null | undefined,
  usageKeys?: readonly string[],
): MeterDefinition[] {
  const byKey = new Map(defs.map((d) => [d.key, { ...d }]));
  // 确保 usage 出现的 key 都有定义
  for (const k of usageKeys ?? []) {
    if (!byKey.has(k)) {
      const known = WELL_KNOWN_METER_DEFAULTS[k];
      byKey.set(k, {
        key: k,
        unit: known?.unit ?? inferUnit(k),
        chargeIncludedAtUsagePrice: known?.chargeIncludedAtUsagePrice ?? false,
        allowOverage: known?.allowOverage ?? true,
        aggregate: "sum",
        rounding: "integer",
      });
    }
  }
  if (entitlement) {
    const credits = Math.max(0, Math.round(entitlement.monthlyCredits));
    const existing = byKey.get("ai_credits");
    if (existing) {
      // 仅覆盖配额；永不改写 chargeIncludedAtUsagePrice
      existing.includedQuota = credits;
    } else {
      byKey.set("ai_credits", {
        key: "ai_credits",
        unit: "credit",
        includedQuota: credits,
        chargeIncludedAtUsagePrice: false,
        allowOverage: true,
        aggregate: "sum",
        rounding: "integer",
      });
    }
  }
  return [...byKey.values()].toSorted((a, b) => a.key.localeCompare(b.key));
}

function inferUnit(key: string): MeterUnit {
  if (key.includes("credit")) {
    return "credit";
  }
  if (key.includes("token")) {
    return "token";
  }
  if (key.includes("cost") || key.endsWith("_cents")) {
    return "cent";
  }
  return "count";
}

/**
 * 按 MeterDefinition 计算 usage + extra 费用（不双计）。
 * strict=true（final）：缺配额/缺所需价格 → missing* 集合。
 */
export function chargeMeters(args: {
  meters: readonly MeterDefinition[];
  usageByKey: Record<string, number>;
  pricing: readonly PlanPricing[];
  strict: boolean;
}): MeterChargeResult {
  const items: MeterChargeLine[] = [];
  const missingPrice = new Set<string>();
  const missingQuota = new Set<string>();
  let usageCostCents = 0;
  let extraCostCents = 0;
  const meterByKey = new Map(args.meters.map((m) => [m.key, m]));

  for (const key of Object.keys(args.usageByKey).toSorted()) {
    const usage = Math.max(0, Math.round(args.usageByKey[key]));
    if (usage <= 0) {
      continue;
    }
    const meter = meterByKey.get(key);
    if (!meter) {
      if (args.strict) {
        missingQuota.add(key);
      }
      continue;
    }

    const hasPackageQuota = meter.includedQuota != null && Number.isFinite(meter.includedQuota);

    if (!hasPackageQuota) {
      // 无套餐包含量
      if (meter.chargeIncludedAtUsagePrice) {
        // 纯计量：全量按 usage 价
        const price = findPrice(args.pricing, "usage", key);
        if (price == null) {
          missingPrice.add(`usage/${key}`);
        } else {
          const amount = meterAmountCents(usage, price);
          items.push({
            type: "usage",
            key,
            detail: `usage:${key} qty:${usage}`,
            amountCents: amount,
            quantity: usage,
          });
          usageCostCents += amount;
        }
        continue;
      }
      // 套餐内免费语义但无配额配置
      if (args.strict) {
        missingQuota.add(key);
        continue;
      }
      // non-strict：整笔当 overage
      if (meter.allowOverage) {
        const price = findPrice(args.pricing, "extra", key);
        if (price != null) {
          const amount = meterAmountCents(usage, price);
          items.push({
            type: "extra",
            key,
            detail: `overage:${key} over:${usage}`,
            amountCents: amount,
            quantity: usage,
          });
          extraCostCents += amount;
        }
      }
      continue;
    }

    const split = splitMeterUsage(key, usage, meter.includedQuota);

    if (meter.chargeIncludedAtUsagePrice && split.included > 0) {
      const price = findPrice(args.pricing, "usage", key);
      if (price == null) {
        missingPrice.add(`usage/${key}`);
      } else {
        const amount = meterAmountCents(split.included, price);
        items.push({
          type: "usage",
          key,
          detail: `usage:${key} included:${split.included} total:${split.usage}`,
          amountCents: amount,
          quantity: split.included,
        });
        usageCostCents += amount;
      }
    }

    if (split.overage > 0) {
      if (!meter.allowOverage) {
        if (args.strict) {
          missingPrice.add(`extra/${key}`);
        }
        continue;
      }
      const price = findPrice(args.pricing, "extra", key);
      if (price == null) {
        if (args.strict) {
          missingPrice.add(`extra/${key}`);
        }
      } else {
        const amount = meterAmountCents(split.overage, price);
        items.push({
          type: "extra",
          key,
          detail: `overage:${key} over:${split.overage}`,
          amountCents: amount,
          quantity: split.overage,
        });
        extraCostCents += amount;
      }
    }
  }

  return {
    usageCostCents,
    extraCostCents,
    items,
    missingPriceKeys: [...missingPrice].toSorted(),
    missingQuotaKeys: [...missingQuota].toSorted(),
    usageByKey: { ...args.usageByKey },
  };
}

function findPrice(
  pricing: readonly PlanPricing[],
  type: "usage" | "extra",
  key: string,
): number | null {
  const row = pricing.find((p) => p.type === type && p.key === key);
  return row ? row.priceCents : null;
}

/**
 * @deprecated 仅返回 ai_credits 配额；不改 charge 语义。
 */
export function usageQuotaFromEntitlement(
  entitlement: Pick<EntitlementSnapshot, "monthlyCredits"> | null | undefined,
): Record<string, number> | undefined {
  if (!entitlement) {
    return undefined;
  }
  return {
    ai_credits: Math.max(0, Math.round(entitlement.monthlyCredits)),
  };
}

/** 计量金额（整数分）。 */
export function meterAmountCents(quantity: number, unitPriceCents: number): number {
  const q = Math.max(0, Math.round(quantity));
  const p = Math.round(unitPriceCents);
  return Math.round(q * p);
}

/** 构造可冻结进 PlanVersion.snapshot 的 meters 数组。 */
export function toPersistedMeters(defs: readonly MeterDefinition[]): PersistedMeterDefinition[] {
  return defs.map((d) => ({
    key: d.key,
    unit: d.unit,
    ...(d.includedQuota !== undefined ? { includedQuota: d.includedQuota } : {}),
    chargeIncludedAtUsagePrice: d.chargeIncludedAtUsagePrice,
    allowOverage: d.allowOverage,
    aggregate: d.aggregate,
    rounding: d.rounding,
  }));
}

const VALID_UNITS = new Set<MeterUnit>(["credit", "token", "cent", "count"]);

export class MeterValidationError extends Error {
  readonly code = "METER_VALIDATION" as const;
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "MeterValidationError";
  }
}

/**
 * Pricing ↔ MeterDefinition 一致性校验。
 * 拒绝重复 key、负/非有限/非整数配额、非法单位，以及缺失所需 usage/extra 价格。
 */
export function validateMetersAgainstPricing(
  meters: readonly PersistedMeterDefinition[],
  pricing: readonly PlanPricing[],
): void {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const m of meters) {
    if (!m.key?.trim()) {
      errors.push("meter key 不能为空");
      continue;
    }
    if (seen.has(m.key)) {
      errors.push(`重复 meter key: ${m.key}`);
    }
    seen.add(m.key);
    if (!VALID_UNITS.has(m.unit)) {
      errors.push(`非法 unit: ${m.unit} (key=${m.key})`);
    }
    if (m.includedQuota !== undefined) {
      const q = m.includedQuota;
      if (!Number.isFinite(q)) {
        errors.push(`非法配额（非有限数）: ${m.key}=${String(q)}`);
      } else if (q < 0) {
        errors.push(`负配额: ${m.key}=${q}`);
      } else if (!Number.isInteger(q)) {
        errors.push(`配额必须为非负整数: ${m.key}=${q}`);
      }
    }
    if (m.chargeIncludedAtUsagePrice) {
      const hasUsage = pricing.some((p) => p.type === "usage" && p.key === m.key);
      if (!hasUsage) {
        errors.push(`chargeIncludedAtUsagePrice=true 需要 usage/${m.key} 价格`);
      }
    }
    if (m.allowOverage) {
      const hasExtra = pricing.some((p) => p.type === "extra" && p.key === m.key);
      if (!hasExtra) {
        errors.push(`allowOverage=true 需要 extra/${m.key} 价格`);
      }
    }
  }
  // pricing 中 usage/extra key 必须有 meter
  for (const p of pricing) {
    if (p.type === "usage" || p.type === "extra") {
      if (!seen.has(p.key)) {
        errors.push(`pricing ${p.type}/${p.key} 缺少对应 MeterDefinition`);
      }
    }
  }
  if (errors.length > 0) {
    throw new MeterValidationError(`MeterDefinition 校验失败：${errors.join("; ")}`, errors);
  }
}

/**
 * 规范化外部输入 meters（API/UI）。
 * 非法配额在此直接拒绝（NaN / 负值 / 非有限），不得静默写成 0 或 NaN 落库。
 */
export function normalizeMeterInput(
  input: readonly Partial<PersistedMeterDefinition>[],
): PersistedMeterDefinition[] {
  const errors: string[] = [];
  const out: PersistedMeterDefinition[] = [];
  for (const m of input) {
    const key = String(m.key ?? "").trim();
    if (!key) {
      errors.push("meter key 不能为空");
      continue;
    }
    const unitRaw = String(m.unit ?? "count").trim() as MeterUnit;
    if (!VALID_UNITS.has(unitRaw)) {
      errors.push(`非法 unit: ${String(m.unit)} (key=${key})`);
      continue;
    }
    let includedQuota: number | undefined;
    if (m.includedQuota !== undefined && m.includedQuota !== null && `${m.includedQuota}` !== "") {
      const q = typeof m.includedQuota === "number" ? m.includedQuota : Number(m.includedQuota);
      if (!Number.isFinite(q)) {
        errors.push(`非法配额（非有限数）: ${key}=${String(m.includedQuota)}`);
        continue;
      }
      if (q < 0) {
        errors.push(`负配额: ${key}=${q}`);
        continue;
      }
      includedQuota = Math.round(q);
      if (includedQuota < 0) {
        errors.push(`负配额: ${key}=${includedQuota}`);
        continue;
      }
    }
    out.push({
      key,
      unit: unitRaw,
      ...(includedQuota !== undefined ? { includedQuota } : {}),
      chargeIncludedAtUsagePrice: Boolean(m.chargeIncludedAtUsagePrice),
      allowOverage: Boolean(m.allowOverage),
      aggregate: "sum",
      rounding: "integer",
    });
  }
  if (errors.length > 0) {
    throw new MeterValidationError(`MeterDefinition 输入非法：${errors.join("; ")}`, errors);
  }
  return out;
}

/**
 * 为新 PlanVersion 冻结 meters。
 *
 * - 始终按**当前 pricing** 重建 key 集合（改价新增/删除计量不会丢或脏拷贝）。
 * - 对同名 key 保留上一版本的 chargeIncludedAtUsagePrice / allowOverage / 显式 includedQuota
 *   （运营策略不因改价丢失）。
 * - 新 key 使用 WELL_KNOWN 或默认纯计量语义，**不**用「有无 extra」推断。
 */
export function freezeMetersForNewPlanVersion(args: {
  version: PlanVersion;
  previousMeters?: readonly PersistedMeterDefinition[] | null;
}): PersistedMeterDefinition[] {
  // 先忽略 snapshot.meters，强制按 pricing 合成
  const versionWithoutMeters: PlanVersion = {
    ...args.version,
    snapshot: {
      ...args.version.snapshot,
      meters: undefined,
    },
  };
  const built = buildMeterDefinitions({ version: versionWithoutMeters });
  const pricing = args.version.snapshot.pricing ?? [];
  const prevByKey = new Map((args.previousMeters ?? []).map((m) => [m.key, m]));
  const merged: MeterDefinition[] = built.map((m) => {
    const prev = prevByKey.get(m.key);
    if (!prev) {
      return m;
    }
    const hasExtra = pricing.some((p) => p.type === "extra" && p.key === m.key);
    const hasUsage = pricing.some((p) => p.type === "usage" && p.key === m.key);
    // 继承策略时不得保留脏标志：无 usage 价不得 chargeIncluded；无 extra 价不得 allowOverage
    return {
      ...m,
      chargeIncludedAtUsagePrice: Boolean(prev.chargeIncludedAtUsagePrice) && hasUsage,
      allowOverage: Boolean(prev.allowOverage) && hasExtra,
      ...(prev.includedQuota !== undefined
        ? { includedQuota: Math.max(0, Math.round(prev.includedQuota)) }
        : m.includedQuota !== undefined
          ? { includedQuota: m.includedQuota }
          : {}),
    };
  });
  return toPersistedMeters(merged);
}
