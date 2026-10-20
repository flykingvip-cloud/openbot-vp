import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import type { EnterprisePortReadModel } from "../../../ports/enterprise/semantic/enterprise-read-model.ts";
import {
  ensureCostBudgetSeatsWorkspaceHooks,
  renderCostBudgetSeatsWorkspace,
} from "../../cost-budget/cost-budget-seats-workspace.ts";
import { createV2SeatsDataSource } from "../adapters/seats-data-source.ts";
import type { CostBudgetV2NavigateTarget } from "../shell/cost-budget-v2-routes.ts";
import { isCostBudgetGatewayReady } from "../stores/gateway-ready.ts";
import { ensureSeatsStore, getSeatsStoreState } from "../stores/seats-store.ts";

export type SeatsPageOptions = {
  client: GatewayBrowserClient | null;
  readModel: EnterprisePortReadModel | null | undefined;
  tenantId: string;
  onNavigate: (target: CostBudgetV2NavigateTarget) => void;
  onRefresh: () => void;
};

const v2SeatsDataSource = createV2SeatsDataSource();

export function renderSeatsPage(options: SeatsPageOptions): TemplateResult {
  ensureSeatsStore(options.client, options.onRefresh, { tenantId: options.tenantId });
  ensureCostBudgetSeatsWorkspaceHooks(options.onRefresh);

  if (!options.client) {
    return html`
      <div class="cost-budget-v2-seats-page" data-testid="cost-budget-v2-seats-page">
        <div class="enterprise-empty">${t("costBudget.v2.gatewayDisconnected")}</div>
      </div>
    `;
  }

  if (!isCostBudgetGatewayReady(options.client)) {
    return html`
      <div class="cost-budget-v2-seats-page" data-testid="cost-budget-v2-seats-page">
        <div class="enterprise-empty muted" data-testid="cost-budget-v2-gateway-reconnect-hint">
          ${t("costBudget.v2.gatewayReconnecting")}
        </div>
      </div>
    `;
  }

  const view = getSeatsStoreState();
  if (view.loading || (!view.loadAttempted && !view.allocation)) {
    return html`
      <div class="cost-budget-v2-seats-page" data-testid="cost-budget-v2-seats-page">
        <div class="enterprise-empty" data-testid="cost-budget-v2-seats-loading">
          ${t("costBudget.v2.seats.loading")}
        </div>
      </div>
    `;
  }

  if (view.error) {
    return html`
      <div class="cost-budget-v2-seats-page" data-testid="cost-budget-v2-seats-page">
        <div class="callout warning">${view.error}</div>
        <div class="enterprise-page__actions cost-budget-actions--spaced">
          <button
            type="button"
            class="btn btn--sm"
            ?disabled=${view.loading}
            data-testid="cost-budget-v2-seats-retry"
            @click=${() => {
              void v2SeatsDataSource.reload(options.client!);
            }}
          >
            重试加载
          </button>
        </div>
      </div>
    `;
  }

  return html`
    <div class="cost-budget-v2-seats-page" data-testid="cost-budget-v2-seats-page">
      ${
        view.loadPartialFailure
          ? html`
              <div
                class="callout warning cost-budget-callout--spaced"
                data-testid="cost-budget-v2-seats-partial"
              >
                ${t("costBudget.v2.seats.partialFailure")}
              </div>
            `
          : nothing
      }
      ${renderCostBudgetSeatsWorkspace({
        client: options.client,
        readModel: options.readModel,
        tenantId: options.tenantId,
        rerender: options.onRefresh,
        onNavigate: options.onNavigate,
        dataSource: v2SeatsDataSource,
      })}
    </div>
  `;
}
