/**
 * 当前套餐 vs 目标套餐 Capacity 对比（换套餐 confirm drawer）。
 */

import { t } from "../../../../../i18n/index.ts";
import type { PlanCapacitySummary } from "../../../cost-budget/plan-capacity-display.ts";

export type PlanCapacityDiffDirection = "up" | "down" | "same";

export type PlanCapacityDiffRow = {
  id: string;
  label: string;
  current: string;
  target: string;
  direction: PlanCapacityDiffDirection;
};

function formatLimit(value: number, custom = false): string {
  if (custom) {
    return t("costBudget.planCapacity.custom");
  }
  if (value <= 0) {
    return "—";
  }
  return String(value);
}

function formatCredits(value: number | null): string {
  if (value == null || value <= 0) {
    return "—";
  }
  return String(value);
}

function directionForNumbers(current: number, target: number): PlanCapacityDiffDirection {
  if (current === target) {
    return "same";
  }
  return target > current ? "up" : "down";
}

export function buildPlanCapacityDiff(params: {
  current: PlanCapacitySummary;
  target: PlanCapacitySummary;
}): PlanCapacityDiffRow[] {
  const { current, target } = params;
  const rows: PlanCapacityDiffRow[] = [
    {
      id: "teamMembers",
      label: t("costBudget.planCapacity.teamMembers"),
      current: formatLimit(current.teamMembers, current.contactSales),
      target: formatLimit(target.teamMembers, target.contactSales),
      direction: directionForNumbers(current.teamMembers, target.teamMembers),
    },
    {
      id: "aiEmployees",
      label: t("costBudget.planCapacity.aiEmployees"),
      current: formatLimit(current.aiEmployees, current.contactSales),
      target: formatLimit(target.aiEmployees, target.contactSales),
      direction: directionForNumbers(current.aiEmployees, target.aiEmployees),
    },
    {
      id: "concurrentRuns",
      label: t("costBudget.planCapacity.concurrentRuns"),
      current: formatLimit(current.concurrentRuns, current.contactSales),
      target: formatLimit(target.concurrentRuns, target.contactSales),
      direction: directionForNumbers(current.concurrentRuns, target.concurrentRuns),
    },
    {
      id: "monthlyCredits",
      label: t("costBudget.planCapacity.monthlyCredits"),
      current: formatCredits(current.monthlyCredits),
      target: formatCredits(target.monthlyCredits),
      direction: directionForNumbers(current.monthlyCredits ?? 0, target.monthlyCredits ?? 0),
    },
    {
      id: "allowedTiers",
      label: t("costBudget.planCapacity.allowedTiers"),
      current: String(current.allowedTiers.length),
      target: String(target.allowedTiers.length),
      direction: directionForNumbers(current.allowedTiers.length, target.allowedTiers.length),
    },
  ];
  return rows.filter((row) => row.direction !== "same" || row.current !== row.target);
}
