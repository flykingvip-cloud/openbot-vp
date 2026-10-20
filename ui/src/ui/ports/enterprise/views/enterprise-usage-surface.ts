/**
 * 企业端「成本与预算」表面（enterpriseUsage 路由）。
 * R8：仅挂载 cost-budget-v2 shell。
 */

import { html } from "lit";
import { pushAppHistoryState, replaceAppHistoryState } from "../../../request-app-rerender.ts";
import {
  buildCostBudgetV2Hash,
  buildCostBudgetV2Path,
  renderCostBudgetV2Shell,
  resolveGuardedCostBudgetV2Navigation,
  shouldNormalizeCostBudgetV2Url,
  type CostBudgetV2NavigateTarget,
  type CostBudgetV2NavigationState,
} from "../../../views/cost-budget-v2/index.ts";
import {
  followDelegatedPortHref,
  renderEnterpriseDataNotice,
  renderEnterpriseSeatLimitNotice,
  requestEnterpriseAppRerender,
} from "./enterprise-surface-shared.ts";
import type { EnterpriseSurfaceProps } from "./enterprise-surface-types.ts";

let activeCostBudgetV2Navigation: CostBudgetV2NavigationState = {
  route: "overview",
  planOrdersPanel: "catalog",
  settingsPanel: "budget",
};

export function resetCostBudgetV2NavigationState(
  navigation: CostBudgetV2NavigationState = {
    route: "overview",
    planOrdersPanel: "catalog",
    settingsPanel: "budget",
  },
): void {
  activeCostBudgetV2Navigation = navigation;
}

export function getActiveCostBudgetV2Navigation(): CostBudgetV2NavigationState {
  return activeCostBudgetV2Navigation;
}

function refreshEnterpriseSurface(): void {
  if (typeof window === "undefined") {
    return;
  }
  requestEnterpriseAppRerender();
}

function normalizeBasePath(basePath: string): string {
  if (!basePath || basePath === "/") {
    return "";
  }
  return basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
}

function isEnterpriseUsagePath(pathname: string): boolean {
  const normalized = pathname.trim().replace(/\/+$/, "");
  return (
    /^\/enterprise\/[^/]+\/usage(?:\/v2)?(?:\/[^/?#]*)?$/i.test(normalized) ||
    /^\/enterprise\/usage(?:\/v2)?(?:\/[^/?#]*)?$/i.test(normalized)
  );
}

function syncNavigationFromLocation(membershipRole?: string | null): void {
  if (typeof window === "undefined") {
    return;
  }
  if (!isEnterpriseUsagePath(window.location.pathname)) {
    return;
  }
  activeCostBudgetV2Navigation = resolveGuardedCostBudgetV2Navigation(
    window.location.pathname,
    window.location.hash,
    membershipRole,
  );
  maybeNormalizeCostBudgetV2Url(membershipRole);
}

function maybeNormalizeCostBudgetV2Url(membershipRole?: string | null): void {
  if (typeof window === "undefined") {
    return;
  }
  if (!isEnterpriseUsagePath(window.location.pathname)) {
    return;
  }
  const resolved = resolveGuardedCostBudgetV2Navigation(
    window.location.pathname,
    window.location.hash,
    membershipRole,
  );
  if (!shouldNormalizeCostBudgetV2Url(window.location.pathname, window.location.hash, resolved)) {
    activeCostBudgetV2Navigation = resolved;
    return;
  }
  replaceAppHistoryState(`${resolved.normalizedPath}${resolved.normalizedHash}`);
  activeCostBudgetV2Navigation = resolved;
}

function resolveV2Navigation(
  membershipRole: string | null | undefined,
): CostBudgetV2NavigationState {
  syncNavigationFromLocation(membershipRole);
  return activeCostBudgetV2Navigation;
}

function navigateToV2Route(
  tenantId: string,
  basePath: string,
  target: CostBudgetV2NavigateTarget,
): void {
  if (typeof window === "undefined") {
    return;
  }
  const base = normalizeBasePath(basePath);
  const nextNavigation: CostBudgetV2NavigationState = {
    route: target.route,
    planOrdersPanel: target.planOrdersPanel ?? activeCostBudgetV2Navigation.planOrdersPanel,
    settingsPanel: target.settingsPanel ?? activeCostBudgetV2Navigation.settingsPanel,
  };
  if (target.route === "plan-orders" && !target.planOrdersPanel) {
    nextNavigation.planOrdersPanel = "catalog";
  }
  if (target.route === "settings" && !target.settingsPanel) {
    nextNavigation.settingsPanel = "budget";
  }
  activeCostBudgetV2Navigation = nextNavigation;
  const path = buildCostBudgetV2Path(
    `${base}/enterprise/${encodeURIComponent(tenantId)}/usage/${target.route}`,
    target.route,
  );
  const hash = target.hash ?? buildCostBudgetV2Hash(nextNavigation);
  pushAppHistoryState(`${path}${hash}`);
}

export function renderEnterpriseUsageSurface(props: EnterpriseSurfaceProps, basePath: string) {
  const membershipRole = props.readModel.membershipRole;
  const tenantId = props.readModel.currentTenantId ?? "default";
  const normalizedBasePath = normalizeBasePath(basePath);

  resolveV2Navigation(membershipRole);

  const seatLimitNotice = renderEnterpriseSeatLimitNotice({ authPanelProps: props.authPanelProps });
  const dataNotice = renderEnterpriseDataNotice(props.readModel);

  const page = renderCostBudgetV2Shell(
    {
      client: props.client ?? null,
      basePath: normalizedBasePath,
      tenantId,
      readModel: props.readModel,
      navigation: activeCostBudgetV2Navigation,
      onNavigate: (target) => navigateToV2Route(tenantId, normalizedBasePath, target),
      onRefresh: refreshEnterpriseSurface,
    },
    refreshEnterpriseSurface,
  );

  return html`
    <div class="enterprise-surface enterprise-surface--usage" @click=${followDelegatedPortHref}>
      ${seatLimitNotice}
      ${dataNotice}
      ${page}
    </div>
  `;
}

let costBudgetPopstateBound = false;
if (typeof window !== "undefined" && !costBudgetPopstateBound) {
  costBudgetPopstateBound = true;
  window.addEventListener("popstate", () => {
    if (!isEnterpriseUsagePath(window.location.pathname)) {
      return;
    }
    const previousV2 = activeCostBudgetV2Navigation.route;
    const previousHash = window.location.hash;
    syncNavigationFromLocation();
    if (
      activeCostBudgetV2Navigation.route !== previousV2 ||
      window.location.hash !== previousHash
    ) {
      requestEnterpriseAppRerender();
    }
  });
}
