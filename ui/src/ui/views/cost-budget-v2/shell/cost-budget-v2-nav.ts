import { t } from "../../../../i18n/index.ts";
import type { CostBudgetV2NavigationState, CostBudgetV2Route } from "./cost-budget-v2-routes.ts";
import {
  buildCostBudgetV2Hash,
  buildCostBudgetV2Path,
  resolveCostBudgetV2Navigation,
} from "./cost-budget-v2-routes.ts";

export type CostBudgetV2NavTabDef = {
  id: CostBudgetV2Route;
  labelKey: "overview" | "planOrders" | "seats" | "settings";
};

export const COST_BUDGET_V2_NAV_TABS: readonly CostBudgetV2NavTabDef[] = [
  { id: "overview", labelKey: "overview" },
  { id: "plan-orders", labelKey: "planOrders" },
  { id: "seats", labelKey: "seats" },
  { id: "settings", labelKey: "settings" },
];

export function costBudgetV2NavLabel(tab: CostBudgetV2NavTabDef["labelKey"]): string {
  switch (tab) {
    case "overview":
      return t("costBudget.v2.nav.overview");
    case "planOrders":
      return t("costBudget.v2.nav.planOrders");
    case "seats":
      return t("costBudget.v2.nav.seats");
    case "settings":
      return t("costBudget.v2.nav.settings");
  }
}

export function canAccessCostBudgetV2Settings(membershipRole: string | null | undefined): boolean {
  return (membershipRole ?? "enterprise-admin") === "enterprise-admin";
}

export function visibleCostBudgetV2NavTabs(
  membershipRole: string | null | undefined,
): CostBudgetV2Route[] {
  const tabs = COST_BUDGET_V2_NAV_TABS.map((row) => row.id);
  if (canAccessCostBudgetV2Settings(membershipRole)) {
    return tabs;
  }
  return tabs.filter((tab) => tab !== "settings");
}

/** 非 admin 深链进入 settings 时重定向到总览（R6 legacy 清理）。 */
export function guardCostBudgetV2Navigation(
  state: CostBudgetV2NavigationState,
  membershipRole: string | null | undefined,
): CostBudgetV2NavigationState {
  if (state.route === "settings" && !canAccessCostBudgetV2Settings(membershipRole)) {
    return {
      route: "overview",
      planOrdersPanel: state.planOrdersPanel ?? "catalog",
      settingsPanel: "budget",
      legacySource: state.legacySource,
    };
  }
  return state;
}

/** 解析 URL 并套用 admin 访问守卫，返回 canonical path/hash。 */
export function resolveGuardedCostBudgetV2Navigation(
  pathname: string,
  hash: string,
  membershipRole?: string | null,
): CostBudgetV2NavigationState & { normalizedPath: string; normalizedHash: string } {
  const resolved = resolveCostBudgetV2Navigation(pathname, hash);
  const guarded = guardCostBudgetV2Navigation(resolved, membershipRole);
  return {
    ...guarded,
    normalizedPath: buildCostBudgetV2Path(pathname, guarded.route),
    normalizedHash: buildCostBudgetV2Hash(guarded),
  };
}
