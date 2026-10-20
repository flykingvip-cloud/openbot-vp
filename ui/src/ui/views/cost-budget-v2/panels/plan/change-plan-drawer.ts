import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../../i18n/index.ts";
import type { Plan, PricingDiff } from "../../../../capability/cost-budget-billing/index.ts";
import type { GatewayBrowserClient } from "../../../../gateway.ts";
import { parseSubscriptionEntitlement } from "../../../cost-budget/parse-subscription-entitlement.ts";
import { buildPlanCapacitySummary } from "../../../cost-budget/plan-capacity-display.ts";
import { executePlanSelectionV2 } from "../../actions/plan-selection.ts";
import type { CostBudgetV2NavigateTarget } from "../../shell/cost-budget-v2-routes.ts";
import {
  bindChangePlanDrawerRerender,
  closeChangePlanDrawer,
  getChangePlanDrawerState,
  openChangePlanDrawerConfirm,
} from "../../stores/change-plan-drawer-store.ts";
import {
  resolveCurrentSubscriptionPlan,
  resolvePlanEntitlement,
  resolveSubscriptionPlan,
} from "../../stores/subscription-plan-helpers.ts";
import {
  getSubscriptionStoreState,
  hasActiveSubscription,
} from "../../stores/subscription-store.ts";
import { buildPlanCapacityDiff, type PlanCapacityDiffRow } from "./plan-capacity-diff.ts";

export type ChangePlanDrawerProps = {
  client: GatewayBrowserClient | null;
  onNavigate: (target: CostBudgetV2NavigateTarget) => void;
  onRefresh: () => void;
};

function fmtMoney(cents: number | null | undefined): string {
  if (cents == null) {
    return "—";
  }
  return `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function directionSymbol(direction: PlanCapacityDiffRow["direction"]): string {
  if (direction === "up") {
    return "↑";
  }
  if (direction === "down") {
    return "↓";
  }
  return "→";
}

function renderCapacityDiffTable(
  currentPlan: Plan,
  targetPlan: Plan,
  targetEntitlement: unknown,
): TemplateResult {
  const currentEntitlement = resolvePlanEntitlement(currentPlan.id);
  const current = buildPlanCapacitySummary({
    plan: currentPlan,
    entitlement: parseSubscriptionEntitlement(currentEntitlement),
  });
  const target = buildPlanCapacitySummary({
    plan: targetPlan,
    entitlement:
      parseSubscriptionEntitlement(targetEntitlement) ??
      parseSubscriptionEntitlement(resolvePlanEntitlement(targetPlan.id)),
  });
  const rows = buildPlanCapacityDiff({ current, target });
  if (rows.length === 0) {
    return html`
      <p class="enterprise-hint" data-testid="change-plan-capacity-diff-empty">
        ${t("costBudget.changePlanWizard.diffEmpty")}
      </p>
    `;
  }
  return html`
    <div class="cost-budget-plan-diff" data-testid="change-plan-capacity-diff">
      <div class="cost-budget-plan-diff__head">
        <span>${t("costBudget.changePlanWizard.diffColMetric")}</span>
        <span>${t("costBudget.changePlanWizard.diffColCurrent")}</span>
        <span>${t("costBudget.changePlanWizard.diffColTarget")}</span>
      </div>
      ${rows.map(
        (row) => html`
          <div class="cost-budget-plan-diff__row" data-testid="change-plan-capacity-diff-${row.id}">
            <span>${row.label}</span>
            <span>${row.current}</span>
            <span>${directionSymbol(row.direction)} ${row.target}</span>
          </div>
        `,
      )}
    </div>
  `;
}

function renderServerPricingDiff(diff: PricingDiff | null, loading: boolean): TemplateResult {
  if (loading) {
    return html`<div class="enterprise-empty" data-testid="change-plan-server-diff-loading">${t("costBudget.v2.changePlanDrawer.loadingDiff")}</div>`;
  }
  const changed = (diff?.entries ?? []).filter((entry) => entry.change !== "unchanged");
  if (changed.length === 0) {
    return html`
      <p class="enterprise-hint" data-testid="change-plan-server-diff-empty">
        ${t("costBudget.v2.changePlanDrawer.serverDiffEmpty")}
      </p>
    `;
  }
  const changeLabel = (change: string) =>
    change === "added"
      ? t("platformPricing.diffAdded")
      : change === "removed"
        ? t("platformPricing.diffRemoved")
        : t("platformPricing.diffChanged");
  return html`
    <div class="platform-pricing__activate-pricing-diff" data-testid="change-plan-server-diff">
      ${changed.map(
        (entry) => html`
          <div class="platform-pricing__activate-pricing-row">
            <span class="chip">${changeLabel(entry.change)}</span>
            <span class="mono">${entry.type}/${entry.key}</span>
            <span class="platform-pricing__activate-pricing-values">
              ${fmtMoney(entry.oldPriceCents)} → ${fmtMoney(entry.newPriceCents)}
            </span>
          </div>
        `,
      )}
    </div>
  `;
}

function renderConfirmStep(props: ChangePlanDrawerProps): TemplateResult {
  const drawer = getChangePlanDrawerState();
  const currentPlan = resolveCurrentSubscriptionPlan();
  const targetPlan = resolveSubscriptionPlan(drawer.targetPlanId);
  if (!props.client || !currentPlan || !targetPlan) {
    return html`<div class="enterprise-empty">${t("costBudget.v2.changePlanDrawer.missingPlan")}</div>`;
  }
  const preview = drawer.targetPreview;
  const subscription = getSubscriptionStoreState();
  const busy = subscription.actionBusy;

  return html`
    <section class="cost-budget-v2-change-plan-confirm" data-testid="change-plan-drawer-confirm">
      <h3 class="enterprise-section-title">${t("costBudget.v2.changePlanDrawer.confirmTitle")}</h3>
      <p class="enterprise-hint">
        ${t("costBudget.v2.changePlanDrawer.confirmSubtitle", {
          current: currentPlan.name,
          target: targetPlan.name,
        })}
      </p>
      ${drawer.diffError ? html`<div class="callout warning">${drawer.diffError}</div>` : nothing}
      ${
        preview?.preview
          ? html`
              <div class="callout" data-testid="change-plan-allocation-preview">
                ${preview.preview.guide.summary}
              </div>
            `
          : nothing
      }
      <section class="cost-budget-v2-change-plan-confirm__capacity-diff">
        <h4>${t("costBudget.changePlanWizard.diffTitle")}</h4>
        ${renderCapacityDiffTable(currentPlan, targetPlan, preview?.entitlement)}
      </section>
      <section class="cost-budget-v2-change-plan-confirm__server-diff">
        <h4>${t("costBudget.v2.changePlanDrawer.serverDiffTitle")}</h4>
        ${renderServerPricingDiff(drawer.pricingDiff, drawer.pricingDiffLoading)}
      </section>
      <div class="cost-budget-action-row cost-budget-actions--spaced">
        <button type="button" class="btn btn--sm" data-testid="change-plan-drawer-cancel" @click=${closeChangePlanDrawer}>
          ${t("costBudget.v2.changePlanDrawer.cancel")}
        </button>
        <button
          type="button"
          class="btn btn--sm btn--primary"
          data-testid="change-plan-drawer-confirm"
          ?disabled=${busy || drawer.pricingDiffLoading || targetPlan.id === currentPlan.id}
          @click=${() => {
            const catalogPlan = subscription.data?.pricingCatalog?.plans.find(
              (plan) => plan.id === targetPlan.id,
            );
            if (!catalogPlan || !props.client) {
              return;
            }
            void executePlanSelectionV2(props.client, catalogPlan, true, {
              onNavigate: props.onNavigate,
            }).then(() => {
              closeChangePlanDrawer();
              props.onRefresh();
            });
          }}
        >
          ${busy ? t("costBudget.v2.changePlanDrawer.confirmBusy") : t("costBudget.v2.changePlanDrawer.confirmCta")}
        </button>
      </div>
    </section>
  `;
}

export function renderChangePlanDrawer(props: ChangePlanDrawerProps): TemplateResult {
  bindChangePlanDrawerRerender(props.onRefresh);
  const drawer = getChangePlanDrawerState();
  if (!drawer.open || !hasActiveSubscription()) {
    return html``;
  }

  return html`
    <div
      class="model-assets-drawer-overlay cost-budget-v2-change-plan-overlay"
      role="dialog"
      aria-modal="true"
      aria-label=${t("costBudget.v2.changePlanDrawer.title")}
      data-testid="change-plan-drawer"
      @click=${() => closeChangePlanDrawer()}
    >
      <aside
        class="model-assets-drawer cost-budget-v2-change-plan-drawer"
        @click=${(event: Event) => event.stopPropagation()}
      >
        <div class="model-assets-drawer__header">
          <div>
            <div class="model-assets-drawer__title">${t("costBudget.v2.changePlanDrawer.title")}</div>
            <div class="model-assets-drawer__sub">${t("costBudget.v2.changePlanDrawer.subtitle")}</div>
          </div>
          <button
            type="button"
            class="btn btn--sm btn--ghost"
            data-testid="change-plan-drawer-close"
            @click=${() => closeChangePlanDrawer()}
          >
            ${t("costBudget.invoices.closeDrawer")}
          </button>
        </div>
        <div class="model-assets-drawer__body cost-budget-v2-change-plan-drawer__body">
          ${renderConfirmStep(props)}
        </div>
      </aside>
    </div>
  `;
}

export function openChangePlanForPricingPlanId(
  client: GatewayBrowserClient | null,
  targetPlanId: string,
  currentPlanId: string | undefined,
  onRefresh: () => void,
): void {
  if (!client || !targetPlanId || targetPlanId === currentPlanId) {
    return;
  }
  openChangePlanDrawerConfirm(targetPlanId, client);
  onRefresh();
}

export {
  closeChangePlanDrawer,
  openChangePlanDrawerConfirm,
} from "../../stores/change-plan-drawer-store.ts";
