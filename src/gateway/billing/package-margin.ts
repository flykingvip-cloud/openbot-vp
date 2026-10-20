/**
 * 套餐毛利健康度（Pricing × Unit Economics 闭环）。
 *
 * 把「实际毛利率」与套餐配置的「目标 / 警戒」阈值（`Plan.targetMarginRate` / `guardMarginRate`）
 * 对比，产出健康度，供经营仪表盘着色与告警。纯函数、无副作用。
 *
 * 判定（实际毛利 actual）：
 *   actual >= target          → "healthy"（绿）
 *   guard  <= actual < target → "warning"（黄）
 *   actual <  guard           → "critical"（红，套餐可能在亏钱，系统主动发现）
 * 未配置阈值或无实际毛利数据 → "unknown"（不告警）。
 */

export type MarginHealth = "healthy" | "warning" | "critical" | "unknown";

export type MarginHealthInput = {
  /** 实际毛利率（0..1），来自 unit-economics 的 cohort/projected margin；null = 无数据。 */
  actualMarginRate: number | null | undefined;
  /** 目标毛利率（0..1）。 */
  targetMarginRate?: number | null;
  /** 警戒毛利率（0..1，应 ≤ target）。 */
  guardMarginRate?: number | null;
};

export type MarginHealthResult = {
  health: MarginHealth;
  actualMarginRate: number | null;
  targetMarginRate: number | null;
  guardMarginRate: number | null;
};

/** 实际毛利 = MRR 与 provider 成本的差额率，可由调用方按口径预算。 */
export function marginRateFromCents(mrrCents: number, providerCostCents: number): number | null {
  if (!Number.isFinite(mrrCents) || mrrCents <= 0) {
    return null;
  }
  return (mrrCents - providerCostCents) / mrrCents;
}

export function evaluateMarginHealth(input: MarginHealthInput): MarginHealthResult {
  const actual =
    input.actualMarginRate === null || input.actualMarginRate === undefined
      ? null
      : input.actualMarginRate;
  const target =
    input.targetMarginRate === null || input.targetMarginRate === undefined
      ? null
      : input.targetMarginRate;
  const guard =
    input.guardMarginRate === null || input.guardMarginRate === undefined
      ? null
      : input.guardMarginRate;

  let health: MarginHealth = "unknown";
  if (actual !== null) {
    if (guard !== null && actual < guard) {
      health = "critical";
    } else if (target !== null && actual < target) {
      health = "warning";
    } else if (target !== null || guard !== null) {
      health = "healthy";
    }
  }

  return {
    health,
    actualMarginRate: actual,
    targetMarginRate: target,
    guardMarginRate: guard,
  };
}
