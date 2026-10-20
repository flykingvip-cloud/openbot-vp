import { html, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import type { EnterprisePortReadModel } from "../../../ports/enterprise/semantic/enterprise-read-model.ts";
import { renderEnterpriseModuleHeader } from "../../enterprise-module-header.ts";
import { renderEnterpriseSegmentedNav } from "../../enterprise-segmented-nav.ts";
import { renderOverviewPage } from "../pages/overview-page.ts";
import { renderPlanOrdersPage } from "../pages/plan-orders-page.ts";
import { renderSeatsPage } from "../pages/seats-page.ts";
import { renderSettingsPage } from "../pages/settings-page.ts";
import { renderChangePlanDrawer } from "../panels/plan/change-plan-drawer.ts";
import { ensureOperationsStore } from "../stores/operations-store.ts";
import { ensureSeatsStore } from "../stores/seats-store.ts";
import { ensureSettingsStore } from "../stores/settings-store.ts";
import { ensureSubscriptionStore } from "../stores/subscription-store.ts";
import {
  COST_BUDGET_V2_NAV_TABS,
  costBudgetV2NavLabel,
  visibleCostBudgetV2NavTabs,
} from "./cost-budget-v2-nav.ts";
import type {
  CostBudgetV2NavigationState,
  CostBudgetV2NavigateTarget,
  CostBudgetV2Route,
} from "./cost-budget-v2-routes.ts";

export type CostBudgetV2ShellProps = {
  client: GatewayBrowserClient | null;
  basePath: string;
  tenantId: string;
  readModel: EnterprisePortReadModel;
  navigation: CostBudgetV2NavigationState;
  onNavigate: (target: CostBudgetV2NavigateTarget) => void;
  onRefresh?: () => void;
};

function renderPrimaryNav(
  props: CostBudgetV2ShellProps,
  membershipRole: string | null | undefined,
): TemplateResult {
  const visible = visibleCostBudgetV2NavTabs(membershipRole);
  const tabs = COST_BUDGET_V2_NAV_TABS.filter((tab) => visible.includes(tab.id));
  return renderEnterpriseSegmentedNav(
    tabs.map((tab) => ({
      id: tab.id,
      label: costBudgetV2NavLabel(tab.labelKey),
      active: props.navigation.route === tab.id,
    })),
    (id) => {
      const route = id as CostBudgetV2Route;
      if (route === "plan-orders") {
        props.onNavigate({
          route,
          // Default to the subscribed "my plan" panel first; the plan-orders page
          // itself safely downgrades to catalog when no active subscription exists.
          // This avoids a stale "catalog" choice when subscription data has not
          // finished loading yet at click time.
          planOrdersPanel: "plan",
        });
        return;
      }
      if (route === "settings") {
        props.onNavigate({ route, settingsPanel: "budget" });
        return;
      }
      props.onNavigate({ route });
    },
  );
}

function renderBody(props: CostBudgetV2ShellProps, rerender?: () => void): TemplateResult {
  const refresh = rerender ?? props.onRefresh ?? (() => {});
  switch (props.navigation.route) {
    case "overview":
      return renderOverviewPage({
        client: props.client,
        basePath: props.basePath,
        tenantId: props.tenantId,
        onNavigate: props.onNavigate,
        onRefresh: refresh,
      });
    case "plan-orders":
      return renderPlanOrdersPage({
        client: props.client,
        tenantId: props.tenantId,
        activePanel: props.navigation.planOrdersPanel,
        onNavigate: props.onNavigate,
        onRefresh: refresh,
      });
    case "seats":
      return renderSeatsPage({
        client: props.client,
        readModel: props.readModel,
        tenantId: props.tenantId,
        onNavigate: props.onNavigate,
        onRefresh: refresh,
      });
    case "settings":
      return renderSettingsPage({
        client: props.client,
        readModel: props.readModel,
        tenantId: props.tenantId,
        activePanel: props.navigation.settingsPanel,
        onNavigate: props.onNavigate,
        onRefresh: refresh,
      });
  }
}

export function renderCostBudgetV2Shell(
  props: CostBudgetV2ShellProps,
  rerender?: () => void,
): TemplateResult {
  const refresh = rerender ?? props.onRefresh ?? (() => {});
  if (props.client) {
    if (
      props.navigation.route === "plan-orders" ||
      props.navigation.route === "overview" ||
      props.navigation.route === "seats" ||
      props.navigation.route === "settings"
    ) {
      ensureSubscriptionStore(props.client, refresh, { tenantId: props.tenantId });
    }
    if (props.navigation.route === "overview" || props.navigation.route === "plan-orders") {
      ensureOperationsStore(props.client, refresh, { tenantId: props.tenantId });
    }
    if (props.navigation.route === "settings") {
      ensureSettingsStore(props.client, refresh, { tenantId: props.tenantId });
    }
    if (props.navigation.route === "seats") {
      ensureSeatsStore(props.client, refresh, { tenantId: props.tenantId });
    }
  }

  const membershipRole = props.readModel.membershipRole;
  const reloadCurrentRoute = () => {
    const options = { force: true, tenantId: props.tenantId };
    const route = props.navigation.route;
    if (props.client) {
      if (
        route === "plan-orders" ||
        route === "overview" ||
        route === "seats" ||
        route === "settings"
      ) {
        ensureSubscriptionStore(props.client, refresh, options);
      }
      if (route === "overview" || route === "plan-orders") {
        ensureOperationsStore(props.client, refresh, options);
      }
      if (route === "settings") {
        ensureSettingsStore(props.client, refresh, options);
      }
      if (route === "seats") {
        ensureSeatsStore(props.client, refresh, options);
      }
    }
    refresh();
  };
  return html`
    <div class="cost-budget-page cost-budget-v2-page" data-testid="cost-budget-v2-page">
      ${renderEnterpriseModuleHeader({
        title: t("tabs.enterpriseUsage"),
        refresh: { onRefresh: reloadCurrentRoute },
      })}
      ${renderPrimaryNav(props, membershipRole)}
      <div class="cost-budget-body cost-budget-v2-body">${renderBody(props, refresh)}</div>
      ${renderChangePlanDrawer({
        client: props.client,
        onNavigate: props.onNavigate,
        onRefresh: refresh,
      })}
    </div>
  `;
}
