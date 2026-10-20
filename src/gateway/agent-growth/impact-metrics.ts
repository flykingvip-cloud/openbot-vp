/**
 * Agent Growth OS — businessImpact 指标（spec: agent-growth-lifecycle, P2 任务 14.1）。
 *
 * 业务影响优先于工具调用次数（design §9）。指标为领域相关，按出现的计数生成；
 * 缺失或 ≤0 的计数不产出指标（避免「减少 0 次」噪声）。
 */

import type { ImpactMetric } from "./types.js";

/** 业务影响候选输入：key → { value, unit?, description }。 */
export type BusinessImpactInput = Record<
  string,
  { value: number; unit?: string; description: string } | undefined
>;

/** 内置示例指标的中文描述（design §9 示例 key）。 */
const KNOWN_DESCRIPTIONS: Record<string, string> = {
  manual_review_avoided: "减少人工审核",
  risk_contracts_flagged: "提前发现风险合同",
  customer_auto_replies: "自动回复客户",
  hours_saved: "节省工时",
};

/**
 * 由计数输入构建 businessImpact 列表。
 * - 仅保留 value 为有限数且 > 0 的项。
 * - description 缺省时回退到内置示例描述，再回退到 key。
 */
export function computeBusinessImpact(input?: BusinessImpactInput): ImpactMetric[] {
  if (!input) {
    return [];
  }
  const metrics: ImpactMetric[] = [];
  for (const [key, entry] of Object.entries(input)) {
    if (!entry) {
      continue;
    }
    const value = entry.value;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      continue;
    }
    metrics.push({
      key,
      value,
      ...(entry.unit ? { unit: entry.unit } : {}),
      description: entry.description || KNOWN_DESCRIPTIONS[key] || key,
    });
  }
  return metrics;
}
