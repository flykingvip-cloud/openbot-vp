import { normalizePath, pathForTab } from "../../../navigation.ts";
import { replaceAppHistoryState } from "../../../request-app-rerender.ts";
import type { PlanEditTab, PlanWorkspaceMode } from "./plan-config-workspace.ts";

export type PlanDetailRoute = {
  mode: PlanWorkspaceMode;
  editTab: PlanEditTab;
};

/** 套餐与定价顶栏子 Tab（与 URL `?tab=` 同步）。 */
export type PricingSubTab = "packages" | "resourceCatalog" | "economics" | "commerce";

const PRICING_SUB_TABS = new Set<PricingSubTab>([
  "packages",
  "resourceCatalog",
  "economics",
  "commerce",
]);

export function parsePricingSubTab(search: string): PricingSubTab {
  const tab = new URLSearchParams(search).get("tab");
  if (tab && PRICING_SUB_TABS.has(tab as PricingSubTab)) {
    return tab as PricingSubTab;
  }
  return "packages";
}

export function platformPricingHref(basePath: string): string {
  return pathForTab("platformPricing", basePath);
}

export type PlatformPricingHomeOptions = {
  tab?: PricingSubTab;
};

export function platformPricingHomeHref(
  basePath: string,
  options?: PlatformPricingHomeOptions,
): string {
  const base = platformPricingHref(basePath);
  const params = new URLSearchParams();
  if (options?.tab && options.tab !== "packages") {
    params.set("tab", options.tab);
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function platformPricingCreateHref(basePath: string): string {
  return `${platformPricingHref(basePath)}/new`;
}

const EDIT_TABS = new Set<PlanEditTab>(["bundle", "models", "billing", "marketing", "versions"]);

export function normalizePlanDetailRoute(
  input?: Partial<PlanDetailRoute> | PlanEditTab | "overview",
): PlanDetailRoute {
  if (input === "overview" || input === undefined) {
    return { mode: "preview", editTab: "models" };
  }
  if (typeof input === "string") {
    if (EDIT_TABS.has(input)) {
      return { mode: "edit", editTab: input };
    }
    return { mode: "preview", editTab: "models" };
  }
  if (input.mode === "edit") {
    const editTab = input.editTab && EDIT_TABS.has(input.editTab) ? input.editTab : "models";
    return { mode: "edit", editTab };
  }
  return { mode: "preview", editTab: input.editTab ?? "models" };
}

export function platformPricingPlanHref(
  basePath: string,
  planId: string,
  route?: Partial<PlanDetailRoute> | PlanEditTab | "overview",
): string {
  const resolved = normalizePlanDetailRoute(route);
  const base = `${platformPricingHref(basePath)}/${encodeURIComponent(planId)}`;
  if (resolved.mode === "preview") {
    return base;
  }
  return `${base}?mode=edit&tab=${encodeURIComponent(resolved.editTab)}`;
}

export function platformPricingTierHref(
  basePath: string,
  tierId: string,
  section?: "modelPool",
): string {
  const base = `${platformPricingHref(basePath)}/tiers/${encodeURIComponent(tierId)}`;
  return section === "modelPool" ? `${base}#model-pool` : base;
}

export type PlatformPricingView = "home" | "planDetail" | "tierDetail" | "create";

/** @deprecated Use `home` instead of `overview` / `plans`. */
export type LegacyPlatformPricingView = "overview" | "plans" | PlatformPricingView;

export type ResolvedPricingRoute =
  | { view: "home" }
  | { view: "planDetail"; planId: string; mode: PlanWorkspaceMode; editTab: PlanEditTab }
  | { view: "tierDetail"; tierId: string }
  | { view: "create" };

function parsePlanDetailRoute(search: string): PlanDetailRoute {
  const params = new URLSearchParams(search);
  const modeParam = params.get("mode");
  const tabParam = params.get("tab");
  if (modeParam === "edit") {
    const editTab =
      tabParam && EDIT_TABS.has(tabParam as PlanEditTab) ? (tabParam as PlanEditTab) : "models";
    return { mode: "edit", editTab };
  }
  if (tabParam && EDIT_TABS.has(tabParam as PlanEditTab)) {
    return { mode: "edit", editTab: tabParam as PlanEditTab };
  }
  return { mode: "preview", editTab: "models" };
}

function resolvePlanDetailFromSegment(planId: string, search: string): ResolvedPricingRoute | null {
  const trimmed = planId.trim();
  if (!trimmed || trimmed === "new" || trimmed === "plans") {
    return null;
  }
  const detailRoute = parsePlanDetailRoute(search);
  return {
    view: "planDetail",
    planId: decodeURIComponent(trimmed),
    mode: detailRoute.mode,
    editTab: detailRoute.editTab,
  };
}

export function resolvePricingRoute(
  pathname: string,
  basePath: string,
  search?: string,
): ResolvedPricingRoute {
  const root = normalizePath(platformPricingHref(basePath));
  const createPath = normalizePath(platformPricingCreateHref(basePath));
  const current = normalizePath(pathname);
  const resolvedSearch = search ?? (typeof window !== "undefined" ? window.location.search : "");

  if (current === createPath) {
    return { view: "create" };
  }

  const rootPrefix = `${root}/`;
  if (current.startsWith(rootPrefix)) {
    const remainder = current.slice(rootPrefix.length);
    const parts = remainder.split("/").filter(Boolean);
    if (parts[0] === "tiers" && parts[1]) {
      return { view: "tierDetail", tierId: decodeURIComponent(parts[1]) };
    }
    const segment = parts[0]?.trim();
    if (segment) {
      if (segment === "plans") {
        const legacyPlanId = remainder.split("/").slice(1).join("/").split("/")[0]?.trim();
        if (legacyPlanId) {
          return (
            resolvePlanDetailFromSegment(legacyPlanId, resolvedSearch) ?? {
              view: "home",
            }
          );
        }
        return { view: "home" };
      }
      const detail = resolvePlanDetailFromSegment(segment, resolvedSearch);
      if (detail) {
        return detail;
      }
    }
  }

  if (current === root) {
    return { view: "home" };
  }

  return { view: "home" };
}

/** 将旧版 `/platform/pricing/plans` 路径替换为 canonical `/platform/pricing`。 */
export function maybeRedirectLegacyPricingPath(basePath: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const root = normalizePath(platformPricingHref(basePath));
  const current = normalizePath(window.location.pathname);
  const legacyList = `${root}/plans`;
  const url = new URL(window.location.href);

  if (current === legacyList) {
    url.pathname = root;
    replaceAppHistoryState(url.toString());
    return true;
  }

  if (current.startsWith(`${legacyList}/`)) {
    const legacyPlanId = current.slice(`${legacyList}/`.length).split("/")[0]?.trim();
    if (legacyPlanId) {
      url.pathname = `${root}/${encodeURIComponent(decodeURIComponent(legacyPlanId))}`;
      replaceAppHistoryState(url.toString());
      return true;
    }
  }

  return false;
}

/** @deprecated Use resolvePricingRoute instead. */
export function resolvePricingView(pathname: string, basePath: string): LegacyPlatformPricingView {
  const route = resolvePricingRoute(pathname, basePath);
  if (route.view === "home") {
    return "overview";
  }
  return route.view;
}
