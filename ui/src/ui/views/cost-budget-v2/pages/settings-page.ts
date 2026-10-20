import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import type { EnterprisePortReadModel } from "../../../ports/enterprise/semantic/enterprise-read-model.ts";
import {
  canAccessCostBudgetSettings,
  isAnalyticsPanelVisible,
} from "../../cost-budget/cost-budget-settings-helpers.ts";
import { renderCostBudgetSettingsRestricted } from "../../cost-budget/cost-budget-settings-restricted.ts";
import { renderEnterpriseSegmentedNav } from "../../enterprise-segmented-nav.ts";
import { renderAnalyticsSettingsSection } from "../panels/settings/analytics-section.ts";
import { renderBudgetSettingsPanel } from "../panels/settings/budget-panel.ts";
import { renderResourcesSettingsSection } from "../panels/settings/resources-section.ts";
import {
  type CostBudgetV2NavigateTarget,
  type CostBudgetV2SettingsPanel,
} from "../shell/cost-budget-v2-routes.ts";
import { ensureSettingsStore, getSettingsStoreState } from "../stores/settings-store.ts";

export type SettingsPageOptions = {
  client: GatewayBrowserClient | null;
  readModel: EnterprisePortReadModel | null | undefined;
  tenantId: string;
  activePanel: CostBudgetV2SettingsPanel;
  onNavigate: (target: CostBudgetV2NavigateTarget) => void;
  onRefresh: () => void;
};

function v2PanelLabel(panel: CostBudgetV2SettingsPanel): string {
  switch (panel) {
    case "budget":
      return t("costBudget.v2.settings.panels.budget");
    case "resources":
      return t("costBudget.v2.settings.panels.resources");
    case "analytics":
      return t("costBudget.v2.settings.panels.analytics");
  }
}

function visibleV2SettingsPanels(
  analytics: ReturnType<typeof getSettingsStoreState>["analytics"],
): CostBudgetV2SettingsPanel[] {
  const panels: CostBudgetV2SettingsPanel[] = ["budget", "resources"];
  if (isAnalyticsPanelVisible(analytics)) {
    panels.push("analytics");
  }
  return panels;
}

function renderPanelNav(
  activePanel: CostBudgetV2SettingsPanel,
  visiblePanels: CostBudgetV2SettingsPanel[],
  onSelect: (panel: CostBudgetV2SettingsPanel) => void,
): TemplateResult {
  return html`
    <nav class="cost-budget-settings-panel-nav" data-testid="cost-budget-v2-settings-panel-nav">
      ${renderEnterpriseSegmentedNav(
        visiblePanels.map((panel) => ({
          id: panel,
          label: v2PanelLabel(panel),
          active: activePanel === panel,
        })),
        (id) => onSelect(id as CostBudgetV2SettingsPanel),
      )}
    </nav>
  `;
}

function renderActivePanel(
  panel: CostBudgetV2SettingsPanel,
  client: GatewayBrowserClient,
  rerender: () => void,
): TemplateResult {
  const view = getSettingsStoreState();
  switch (panel) {
    case "budget":
      return renderBudgetSettingsPanel({ client, rerender });
    case "resources":
      return renderResourcesSettingsSection(view.resources);
    case "analytics":
      return renderAnalyticsSettingsSection(view.analytics);
  }
}

export function renderSettingsPage(options: SettingsPageOptions): TemplateResult {
  ensureSettingsStore(options.client, options.onRefresh, { tenantId: options.tenantId });
  const membershipRole = options.readModel?.membershipRole;
  const settingsAllowed = canAccessCostBudgetSettings(membershipRole);

  if (!settingsAllowed) {
    return html`
      <div class="cost-budget-v2-settings-page" data-testid="cost-budget-v2-settings-page">
        ${renderCostBudgetSettingsRestricted()}
      </div>
    `;
  }

  if (!options.client) {
    return html`
      <div class="cost-budget-v2-settings-page" data-testid="cost-budget-v2-settings-page">
        <div class="enterprise-empty">${t("costBudget.v2.gatewayDisconnected")}</div>
      </div>
    `;
  }

  const view = getSettingsStoreState();
  // Progressive load: unlock once budget/resources arrive; do not wait on dashboard/analytics.
  if (view.loading && !view.budget && !view.resources && !view.dashboard) {
    return html`
      <div class="cost-budget-v2-settings-page" data-testid="cost-budget-v2-settings-page">
        <div class="enterprise-empty" data-testid="cost-budget-v2-settings-loading">
          ${t("costBudget.v2.settings.loading")}
        </div>
      </div>
    `;
  }

  if (view.error) {
    return html`
      <div class="cost-budget-v2-settings-page" data-testid="cost-budget-v2-settings-page">
        <div class="callout warning">${view.error}</div>
      </div>
    `;
  }

  const visiblePanels = visibleV2SettingsPanels(view.analytics);
  const activePanel = visiblePanels.includes(options.activePanel) ? options.activePanel : "budget";

  return html`
    <div class="cost-budget-v2-settings-page" data-testid="cost-budget-v2-settings-page">
      ${renderPanelNav(activePanel, visiblePanels, (panel) => {
        options.onNavigate({ route: "settings", settingsPanel: panel });
      })}
      ${
        view.loadPartialFailure
          ? html`
              <div class="callout warning cost-budget-callout--spaced" data-testid="cost-budget-v2-settings-partial">
                ${t("costBudget.v2.settings.partialFailure")}
              </div>
            `
          : nothing
      }
      ${renderActivePanel(activePanel, options.client, options.onRefresh)}
    </div>
  `;
}
