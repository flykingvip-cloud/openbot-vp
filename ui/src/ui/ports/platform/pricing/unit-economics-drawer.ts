import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { Plan } from "../../../capability/cost-budget-billing/index.ts";
import type { EconomicsOverviewResponse } from "../../../capability/cost-economics/index.ts";
import type { PlatformCommercialSummary } from "../../../capability/platform-subscriptions/index.ts";
import {
  buildPlanUnitEconomics,
  formatMarginRate,
  type PlanUnitEconomics,
} from "./unit-economics.ts";

function fmtMoney(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

export function renderUnitEconomicsDrawer(params: {
  plan: Plan;
  monthlyCredits: number | null;
  allowedTiers: readonly string[];
  selectorStrategy: string;
  economics: EconomicsOverviewResponse | null;
  commercial: PlatformCommercialSummary | null;
  onClose: () => void;
  onOpenEconomicsTab: () => void;
}): TemplateResult {
  const unit = buildPlanUnitEconomics({
    planId: params.plan.id,
    basePriceCents: params.plan.basePriceCents,
    monthlyCredits: params.monthlyCredits,
    allowedTiers: params.allowedTiers,
    selectorStrategy: params.selectorStrategy,
    commercial: params.commercial,
    planActual: params.economics?.byPlan?.[params.plan.id],
    platformSummary: params.economics?.summary,
    economicsOverview: params.economics,
  });

  return html`
    <section class="card platform-pricing__economics-drawer" data-testid="unit-economics-drawer">
      <div class="platform-pricing__economics-drawer-head">
        <div>
          <div class="card-title">${t("platformPricing.unitEconomicsTitle")}</div>
          <div class="card-sub">${params.plan.name}</div>
        </div>
        <button class="btn btn--sm" type="button" data-testid="close-economics-drawer" @click=${params.onClose}>
          ${t("platformPricing.cancel")}
        </button>
      </div>

      <div class="platform-pricing__economics-drawer-grid">
        ${renderMetric(t("platformPricing.commercialMrr"), fmtMoney(unit.mrrCents))}
        ${renderMetric(t("platformPricing.commercialActiveSubs"), String(unit.activeSubscriptions))}
        ${renderMetric(t("platformPricing.unitEconomicsRevenue"), fmtMoney(unit.subscriptionRevenueCents))}
        ${
          unit.monthlyCredits && unit.monthlyCredits > 0
            ? renderMetric("Credits", `${unit.monthlyCredits}${t("platformPricing.perMonth")}`)
            : renderMetric("Credits", t("platformPricing.enterpriseBudget"))
        }
      </div>

      <div class="platform-pricing__economics-drawer-section">
        <h4 class="platform-pricing__economics-drawer-section-title">
          ${t("platformPricing.unitEconomicsActual")}
        </h4>
        ${
          unit.actualProviderCostCents !== null
            ? html`
                <div class="platform-pricing__economics-drawer-grid">
                  ${renderMetric(t("platformEconomics.providerCost"), fmtMoney(unit.actualProviderCostCents))}
                  ${renderMetric(
                    t("platformPricing.unitEconomicsCohortMargin"),
                    unit.cohortMarginCents !== null
                      ? `${fmtMoney(unit.cohortMarginCents)} (${formatMarginRate(unit.cohortMarginRate)})`
                      : "—",
                  )}
                </div>
              `
            : html`<div class="muted">${t("platformPricing.unitEconomicsNoActual")}</div>`
        }
      </div>

      <div class="platform-pricing__economics-drawer-section">
        <h4 class="platform-pricing__economics-drawer-section-title">
          ${t("platformPricing.unitEconomicsProjected")}
        </h4>
        ${
          unit.costVersionFullQuotaCostCents !== null
            ? html`
                <div class="platform-pricing__economics-drawer-grid">
                  ${renderMetric(
                    t("platformPricing.unitEconomicsCostVersionCost"),
                    fmtMoney(unit.costVersionFullQuotaCostCents),
                  )}
                  ${renderMetric(
                    t("platformPricing.unitEconomicsEstMargin"),
                    unit.costVersionMarginRate !== null
                      ? `${fmtMoney(params.plan.basePriceCents - unit.costVersionFullQuotaCostCents)} (${formatMarginRate(unit.costVersionMarginRate)})`
                      : "—",
                  )}
                </div>
                <div class="muted platform-pricing__economics-assumption">
                  ${
                    params.economics?.projectionContext?.benchmarkSource === "ledger"
                      ? t("platformPricing.unitEconomicsCostVersionAssumptionLedger", {
                          input: String(
                            params.economics.projectionContext.benchmark.inputTokens ?? 0,
                          ),
                          output: String(
                            params.economics.projectionContext.benchmark.outputTokens ?? 0,
                          ),
                        })
                      : t("platformPricing.unitEconomicsCostVersionAssumption")
                  }
                </div>
              `
            : unit.projectedFullQuotaCostCents !== null
              ? html`
                  <div class="platform-pricing__economics-drawer-grid">
                    ${renderMetric(
                      t("platformPricing.unitEconomicsEstCost"),
                      fmtMoney(unit.projectedFullQuotaCostCents),
                    )}
                    ${renderMetric(
                      t("platformPricing.unitEconomicsEstMargin"),
                      unit.projectedSubscriptionMarginCents !== null
                        ? `${fmtMoney(unit.projectedSubscriptionMarginCents)} (${formatMarginRate(unit.projectedMarginRate)})`
                        : "—",
                    )}
                  </div>
                  <div class="muted platform-pricing__economics-assumption">
                    ${t("platformPricing.unitEconomicsAssumption", {
                      source:
                        unit.projectionSource === "plan"
                          ? t("platformPricing.unitEconomicsAssumptionPlan")
                          : t("platformPricing.unitEconomicsAssumptionPlatform"),
                    })}
                  </div>
                `
              : html`<div class="muted">${t("platformPricing.unitEconomicsNoProjected")}</div>`
        }
      </div>

      <div class="platform-pricing__economics-drawer-actions">
        <button
          class="btn btn--sm"
          type="button"
          data-testid="open-economics-tab-btn"
          @click=${params.onOpenEconomicsTab}
        >
          ${t("platformPricing.unitEconomicsOpenTab")}
        </button>
      </div>
    </section>
  `;
}

function renderMetric(label: string, value: string): TemplateResult {
  return html`
    <div class="platform-pricing__commercial-kpi">
      <span class="platform-pricing__commercial-kpi-label">${label}</span>
      <span class="platform-pricing__commercial-kpi-value">${value}</span>
    </div>
  `;
}

export function renderEconomicsFocusBanner(params: {
  planName: string;
  unit: PlanUnitEconomics;
  onClear: () => void;
  onBackToPackages?: () => void;
}): TemplateResult {
  return html`
    <div class="platform-pricing__economics-focus" data-testid="economics-focus-banner">
      <div>
        <div class="platform-pricing__economics-focus-title">
          ${t("platformPricing.unitEconomicsFocus", { name: params.planName })}
        </div>
        <div class="muted">
          MRR ${fmtMoney(params.unit.mrrCents)} · ${t("platformPricing.commercialActiveSubs")}
          ${params.unit.activeSubscriptions}
          ${
            params.unit.cohortMarginRate !== null
              ? html` · ${t("platformPricing.unitEconomicsCohortMargin")} ${formatMarginRate(params.unit.cohortMarginRate)}`
              : nothing
          }
        </div>
      </div>
      <div class="platform-pricing__economics-focus-actions">
        ${
          params.onBackToPackages
            ? html`
                <button
                  class="btn btn--sm"
                  type="button"
                  data-testid="economics-back-packages-btn"
                  @click=${params.onBackToPackages}
                >
                  ${t("platformPricing.economicsBackToPackages")}
                </button>
              `
            : nothing
        }
        <button class="btn btn--sm" type="button" @click=${params.onClear}>
          ${t("platformPricing.unitEconomicsClearFocus")}
        </button>
      </div>
    </div>
  `;
}
