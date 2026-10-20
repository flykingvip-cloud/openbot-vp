/**
 * 用量去重与成本控制闸口的纯函数（framework-free）。
 *
 * - dedupeUsage：按 `(enterpriseId, eventId)` 幂等去重（R9.1-R9.3 / Property 9）。
 * - evaluateGate：执行前闸口判定（R8 / R23 / Property 12）。
 */

import type { BudgetCheckLevel, BudgetControls, UsageRecord } from "./types.ts";

// ─────────────────────────────────────────────────────────────────────────
// 用量幂等去重
// ─────────────────────────────────────────────────────────────────────────

export type DedupeResult = {
  /** 去重后的记录集合（仅在非重复时追加 incoming）。 */
  records: UsageRecord[];
  /** incoming 是否被识别为重复（被忽略）。 */
  deduped: boolean;
};

/**
 * 在 enterpriseId 维度按 eventId 去重。
 * 若 incoming.eventId 已存在（同一 enterpriseId），返回原集合并标记 deduped=true；
 * 否则追加 incoming。纯函数，不修改入参。
 */
export function dedupeUsage(existing: readonly UsageRecord[], incoming: UsageRecord): DedupeResult {
  const duplicate = existing.some(
    (r) => r.enterpriseId === incoming.enterpriseId && r.eventId === incoming.eventId,
  );
  if (duplicate) {
    return { records: [...existing], deduped: true };
  }
  return { records: [...existing, incoming], deduped: false };
}

// ─────────────────────────────────────────────────────────────────────────
// 成本控制闸口
// ─────────────────────────────────────────────────────────────────────────

export type GateAction = "ai" | "bot";
export type GateDecision = { allowed: true } | { allowed: false; reason: string };

/**
 * 执行前闸口判定（R23.2 / R23.6 / Property 12）：
 * - 仅当「对应控制项启用 ∧ 预算超限（level=exceeded）」时拒绝；
 * - 未启用对应控制项 → 放行（最多由上层触发提醒）；
 * - 预算未超限 → 放行。
 *
 * 注意：Bot 配额已满属于资源层拒绝，由 Resource_Service 单独处理；本函数仅负责
 * 预算驱动的拦截。
 */
export function evaluateGate(args: {
  action: GateAction;
  budgetLevel: BudgetCheckLevel;
  controls: BudgetControls;
}): GateDecision {
  const exceeded = args.budgetLevel === "exceeded";
  if (!exceeded) {
    return { allowed: true };
  }
  if (args.action === "ai" && args.controls.limitAiCalls) {
    return { allowed: false, reason: "预算已超限，AI 调用已被限制" };
  }
  if (args.action === "bot" && args.controls.limitBotCreation) {
    return { allowed: false, reason: "预算已超限，Bot 创建已被限制" };
  }
  return { allowed: true };
}
