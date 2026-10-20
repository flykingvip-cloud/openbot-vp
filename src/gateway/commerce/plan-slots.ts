/**
 * 套餐档位解析（gateway 侧，与 UI plan-display 别名对齐）。
 */

import type { Plan } from "../billing/types.js";

const ENTERPRISE_ALIASES = new Set(
  ["enterprise", "企业版", "卓越版"].map((name) => name.trim().toLowerCase()),
);

const TRIAL_ALIASES = new Set(
  ["trial", "free trial", "免费试用", "试用版", "体验版"].map((name) => name.trim().toLowerCase()),
);

function normalizePlanName(name: string): string {
  return name.trim().toLowerCase();
}

export function resolvePlanSlotKey(name: string): "trial" | "enterprise" | null {
  const normalized = normalizePlanName(name);
  if (TRIAL_ALIASES.has(normalized)) {
    return "trial";
  }
  if (ENTERPRISE_ALIASES.has(normalized)) {
    return "enterprise";
  }
  return null;
}

export function isContactSalesPlan(plan: Plan): boolean {
  return resolvePlanSlotKey(plan.name) === "enterprise";
}

export function isTrialPlan(plan: Plan): boolean {
  return resolvePlanSlotKey(plan.name) === "trial" || plan.basePriceCents <= 0;
}
