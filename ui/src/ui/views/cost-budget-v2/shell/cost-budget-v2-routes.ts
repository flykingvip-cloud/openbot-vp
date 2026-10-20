import type { CostBudgetSubRoute } from "../../../navigation.ts";
import { normalizeCostBudgetBasePath } from "../../cost-budget/cost-budget-drilldown.ts";

/** v2 canonical 子路由（URL 尾段）。 */
export const COST_BUDGET_V2_ROUTES = ["overview", "plan-orders", "seats", "settings"] as const;

export type CostBudgetV2Route = (typeof COST_BUDGET_V2_ROUTES)[number];

export type CostBudgetV2PlanOrdersPanel = "plan" | "catalog" | "orders";

export type CostBudgetV2SettingsPanel = "budget" | "resources" | "analytics";

export type CostBudgetV2NavigationState = {
  route: CostBudgetV2Route;
  planOrdersPanel: CostBudgetV2PlanOrdersPanel;
  settingsPanel: CostBudgetV2SettingsPanel;
  /** 若由 legacy subRoute 映射而来，保留来源便于 telemetry / 测试。 */
  legacySource?: CostBudgetSubRoute;
};

export type CostBudgetV2NavigateTarget = {
  route: CostBudgetV2Route;
  planOrdersPanel?: CostBudgetV2PlanOrdersPanel;
  settingsPanel?: CostBudgetV2SettingsPanel;
  hash?: string;
};

const PLAN_ORDERS_PANELS: readonly CostBudgetV2PlanOrdersPanel[] = ["plan", "catalog", "orders"];
const SETTINGS_PANELS: readonly CostBudgetV2SettingsPanel[] = ["budget", "resources", "analytics"];

function isV2Route(value: string): value is CostBudgetV2Route {
  return (COST_BUDGET_V2_ROUTES as readonly string[]).includes(value);
}

function parsePanelHash<T extends string>(hash: string, allowed: readonly T[], fallback: T): T {
  const raw = hash.replace(/^#/, "").trim();
  if (raw && (allowed as readonly string[]).includes(raw)) {
    return raw as T;
  }
  return fallback;
}

/** legacy / v1 canonical subRoute → v2 导航状态。 */
export function mapLegacySubRouteToV2(
  sub: CostBudgetSubRoute,
  options?: { hasSubscription?: boolean },
): CostBudgetV2NavigationState {
  const hasSubscription = options?.hasSubscription ?? false;
  switch (sub) {
    case "overview":
    case "billing":
      return {
        route: "overview",
        planOrdersPanel: "catalog",
        settingsPanel: "budget",
        legacySource: sub,
      };
    case "subscription":
      return {
        route: "plan-orders",
        planOrdersPanel: hasSubscription ? "plan" : "catalog",
        settingsPanel: "budget",
        legacySource: sub,
      };
    case "orders":
    case "invoices":
      return {
        route: "plan-orders",
        planOrdersPanel: "orders",
        settingsPanel: "budget",
        legacySource: sub,
      };
    case "seats":
      return {
        route: "seats",
        planOrdersPanel: "plan",
        settingsPanel: "budget",
        legacySource: sub,
      };
    case "control":
      return {
        route: "settings",
        planOrdersPanel: "plan",
        settingsPanel: "budget",
        legacySource: sub,
      };
    case "resources":
      return {
        route: "settings",
        planOrdersPanel: "plan",
        settingsPanel: "resources",
        legacySource: sub,
      };
    case "analytics":
      return {
        route: "settings",
        planOrdersPanel: "plan",
        settingsPanel: "analytics",
        legacySource: sub,
      };
    default:
      return {
        route: "overview",
        planOrdersPanel: "catalog",
        settingsPanel: "budget",
        legacySource: sub,
      };
  }
}

export function parseCostBudgetV2RouteSegment(
  segment: string | null | undefined,
): CostBudgetV2Route | null {
  if (!segment) {
    return null;
  }
  if (segment === "v2") {
    return null;
  }
  return isV2Route(segment) ? segment : null;
}

/**
 * 从 pathname + hash 解析 v2 导航。
 * 支持 `/usage/v2/{route}` 与 `/usage/{route}`（v2 route 或 legacy subRoute）。
 */
export function resolveCostBudgetV2Navigation(
  pathname: string,
  hash: string,
  options?: { hasSubscription?: boolean },
): CostBudgetV2NavigationState & { normalizedPath: string; normalizedHash: string } {
  const v2Prefix = pathname.match(/\/usage\/v2\/?([^/?#]*)/);
  const legacyMatch = pathname.match(/\/usage\/([^/?#]+)/);
  const segment = (v2Prefix?.[1] || legacyMatch?.[1] || "").split("/")[0] || "overview";

  let state: CostBudgetV2NavigationState;
  if (isV2Route(segment)) {
    state = {
      route: segment,
      planOrdersPanel:
        segment === "plan-orders" ? parsePanelHash(hash, PLAN_ORDERS_PANELS, "catalog") : "catalog",
      settingsPanel:
        segment === "settings" ? parsePanelHash(hash, SETTINGS_PANELS, "budget") : "budget",
    };
  } else if (
    (
      [
        "overview",
        "subscription",
        "seats",
        "control",
        "orders",
        "invoices",
        "resources",
        "analytics",
        "billing",
      ] as const
    ).includes(segment as CostBudgetSubRoute)
  ) {
    state = mapLegacySubRouteToV2(segment as CostBudgetSubRoute, options);
  } else {
    state = { route: "overview", planOrdersPanel: "catalog", settingsPanel: "budget" };
  }

  const normalizedPath = buildCostBudgetV2Path(pathname, state.route);
  const normalizedHash = buildCostBudgetV2Hash(state);
  return { ...state, normalizedPath, normalizedHash };
}

export function buildCostBudgetV2Path(pathname: string, route: CostBudgetV2Route): string {
  const enterpriseMatch = pathname.match(/^(.*\/enterprise\/[^/]+)\/usage(?:\/v2)?(?:\/[^/?#]*)?/);
  const fallbackBase = pathname.replace(/\/usage(?:\/v2)?(?:\/[^/?#]*)?$/, "");
  const base = normalizeCostBudgetBasePath(enterpriseMatch?.[1] ?? fallbackBase);
  return `${base}/usage/${route}`;
}

export function buildCostBudgetV2Hash(
  state: Pick<CostBudgetV2NavigationState, "route" | "planOrdersPanel" | "settingsPanel">,
): string {
  if (state.route === "plan-orders" && state.planOrdersPanel !== "catalog") {
    return `#${state.planOrdersPanel}`;
  }
  if (state.route === "settings" && state.settingsPanel !== "budget") {
    return `#${state.settingsPanel}`;
  }
  return "";
}

/** 企业端 v2 usage 深链（含 plan-orders / settings hash）。 */
export function buildCostBudgetV2UsageHref(
  basePath: string,
  tenantId: string,
  target: CostBudgetV2NavigateTarget,
): string {
  const base = normalizeCostBudgetBasePath(basePath);
  const path = `${base}/enterprise/${encodeURIComponent(tenantId)}/usage/${target.route}`;
  if (target.hash) {
    return `${path}${target.hash.startsWith("#") ? target.hash : `#${target.hash}`}`;
  }
  const panelHash = buildCostBudgetV2Hash({
    route: target.route,
    planOrdersPanel: target.planOrdersPanel ?? "catalog",
    settingsPanel: target.settingsPanel ?? "budget",
  });
  return `${path}${panelHash}`;
}

export function shouldNormalizeCostBudgetV2Url(
  pathname: string,
  hash: string,
  state: ReturnType<typeof resolveCostBudgetV2Navigation>,
): boolean {
  const targetPath = state.normalizedPath;
  const targetHash = state.normalizedHash;
  return pathname !== targetPath || hash !== targetHash;
}
