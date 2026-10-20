/**
 * 套餐 Tab 经营总览：KPI 卡片 + 套餐分布 + 套餐经营表（Phase 0）。
 */

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { Plan, PlanVersion } from "../../../capability/cost-budget-billing/index.ts";
import type { EconomicsOverviewResponse } from "../../../capability/cost-economics/index.ts";
import type { PlatformPlanBundleVersionRow } from "../../../capability/platform-plan-bundle/index.ts";
import type { PlatformCommercialSummary } from "../../../capability/platform-subscriptions/index.ts";
import type { RoutingPolicy } from "../../../capability/policy-engine/index.ts";
import { renderIcon, type IconName } from "../../../icons.ts";
import { formatAdoptionShare } from "./plan-adoption-overview.ts";
import { resolvePlanVersionHealth, renderPlanHealthSummary } from "./plan-health-summary.ts";
import {
  buildPlanUnitEconomics,
  formatMarginRate,
  formatMarginRateDelta,
} from "./unit-economics.ts";

export type PlanAdoptionRow = {
  planId: string;
  planName: string;
  activeSubscriptions: number;
  sharePercent: number | null;
  mrrCents: number;
};

export type PlanOperatingRow = PlanAdoptionRow & {
  arrCents: number;
  versionNumber: number | null;
  versionStatus: PlanVersion["status"] | null;
  providerCostCents: number | null;
  marginCents: number | null;
  marginRate: number | null;
  marginSource: "actual" | "projected" | "none";
  marginTrendDelta: number | null;
  subsTrendDelta: number | null;
  mrrTrendDelta: number | null;
  marketingTags: Array<"default" | "recommended">;
  isPopular: boolean;
  isDeprecated: boolean;
  tierCount: number;
  modelsBound: boolean;
  modelCount: number;
  needsModels: boolean;
};

export type ExecutiveKpis = {
  mrrCents: number;
  activePlanCount: number;
  activeSubscriptions: number;
  grossMarginRate: number | null;
  marginTrendDelta: number | null;
  mrrTrendDelta: number | null;
  subsTrendDelta: number | null;
};

export type OperatingTableSortKey = "mrr" | "enterprises" | "margin";

let operatingSortKey: OperatingTableSortKey = "mrr";
let operatingSortDesc = true;

function fmtMoney(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function formatPercentTrend(delta: number | null | undefined): string {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) {
    return "—";
  }
  const pct = delta * 100;
  const sign = pct > 0 ? "+" : "";
  const arrow = pct > 0 ? "↑ " : pct < 0 ? "↓ " : "";
  return `${arrow}${sign}${pct.toFixed(1)}%`;
}

function formatCountTrend(delta: number | null | undefined): string {
  if (delta === null || delta === undefined || !Number.isFinite(delta) || delta === 0) {
    return delta === 0 ? "—" : "—";
  }
  const arrow = delta > 0 ? "↑ " : "↓ ";
  return `${arrow}${Math.abs(delta)}`;
}

function planMarginTrendDelta(
  planId: string,
  economicsOverview: EconomicsOverviewResponse | null,
): number | null {
  const current = economicsOverview?.byPlan?.[planId];
  const previous = economicsOverview?.previousByPlan?.[planId];
  if (!current || !previous) {
    return null;
  }
  const currentRate =
    current.tenantRevenueCents > 0 ? current.marginCents / current.tenantRevenueCents : null;
  const previousRate =
    previous.tenantRevenueCents > 0 ? previous.marginCents / previous.tenantRevenueCents : null;
  if (currentRate === null || previousRate === null) {
    return null;
  }
  return currentRate - previousRate;
}

function renderCompositeTrend(row: PlanOperatingRow): TemplateResult {
  const parts: string[] = [];
  const mrrTrend = formatPercentTrend(row.mrrTrendDelta);
  const subsTrend = formatCountTrend(row.subsTrendDelta);
  const marginTrend =
    row.marginTrendDelta !== null ? formatMarginRateDelta(row.marginTrendDelta) : "—";
  if (mrrTrend !== "—") {
    parts.push(`MRR ${mrrTrend}`);
  }
  if (subsTrend !== "—") {
    parts.push(`${t("platformPricing.operatingColEnterprises")} ${subsTrend}`);
  }
  if (marginTrend !== "—") {
    parts.push(`${t("platformPricing.operatingColMargin")} ${marginTrend}`);
  }
  if (parts.length === 0) {
    return html`
      <span class="muted">—</span>
    `;
  }
  return html`<span class="platform-pricing__trend-inline">${parts.join(" · ")}</span>`;
}

export function buildPlanAdoptionRows(
  plans: readonly Plan[],
  summary: PlatformCommercialSummary | null,
): PlanAdoptionRow[] {
  const totalSubs = summary?.totals.activeSubscriptions ?? 0;
  return plans
    .map((plan) => {
      const metrics = summary?.plans[plan.id];
      const activeSubscriptions = metrics?.activeSubscriptions ?? 0;
      const mrrCents = metrics?.mrrCents ?? 0;
      return {
        planId: plan.id,
        planName: plan.name,
        activeSubscriptions,
        sharePercent: totalSubs > 0 ? (activeSubscriptions / totalSubs) * 100 : null,
        mrrCents,
      };
    })
    .toSorted((left, right) => {
      if (right.activeSubscriptions !== left.activeSubscriptions) {
        return right.activeSubscriptions - left.activeSubscriptions;
      }
      if (right.mrrCents !== left.mrrCents) {
        return right.mrrCents - left.mrrCents;
      }
      return left.planName.localeCompare(right.planName, "zh-CN");
    });
}

function resolvePlanVersion(
  plan: Plan,
  versionsByPlan: Record<string, PlanVersion[]>,
): PlanVersion | null {
  const versions = versionsByPlan[plan.id] ?? [];
  return versions.find((entry) => entry.id === plan.currentVersionId) ?? versions[0] ?? null;
}

function resolveSelectorStrategy(
  policyId: string | null,
  catalogPolicies: readonly RoutingPolicy[],
): string {
  if (!policyId) {
    return "balanced";
  }
  return catalogPolicies.find((policy) => policy.id === policyId)?.selectorStrategy ?? "balanced";
}

export function buildPlanOperatingRows(params: {
  plans: readonly Plan[];
  commercialSummary: PlatformCommercialSummary | null;
  economicsOverview: EconomicsOverviewResponse | null;
  versionMetaById: Record<string, PlatformPlanBundleVersionRow | undefined>;
  versionsByPlan: Record<string, PlanVersion[]>;
  catalogPolicies: readonly RoutingPolicy[];
}): PlanOperatingRow[] {
  const adoption = buildPlanAdoptionRows(params.plans, params.commercialSummary);
  const maxSubs = adoption.reduce((max, row) => Math.max(max, row.activeSubscriptions), 0);

  return adoption.map((row) => {
    const plan = params.plans.find((entry) => entry.id === row.planId);
    if (!plan) {
      return {
        ...row,
        arrCents: row.mrrCents * 12,
        versionNumber: null,
        versionStatus: null,
        providerCostCents: null,
        marginCents: null,
        marginRate: null,
        marginSource: "none" as const,
        marginTrendDelta: null,
        subsTrendDelta: null,
        mrrTrendDelta: null,
        marketingTags: [],
        isPopular: false,
        isDeprecated: false,
        tierCount: 0,
        modelsBound: false,
        modelCount: 0,
        needsModels: true,
      };
    }

    const version = resolvePlanVersion(plan, params.versionsByPlan);
    const meta = params.versionMetaById[plan.currentVersionId];
    const allowedTiers =
      meta?.binding?.allowedTiers ?? meta?.entitlementSnapshot?.allowedTiers ?? [];
    const monthlyCredits = meta?.entitlementSnapshot?.monthlyCredits ?? null;
    const policyId = meta?.binding?.policyId ?? null;
    const planActual = params.economicsOverview?.byPlan?.[plan.id];
    const unit = buildPlanUnitEconomics({
      planId: plan.id,
      basePriceCents: plan.basePriceCents,
      monthlyCredits,
      allowedTiers,
      selectorStrategy: resolveSelectorStrategy(policyId, params.catalogPolicies),
      commercial: params.commercialSummary,
      planActual,
      platformSummary: params.economicsOverview?.summary,
      economicsOverview: params.economicsOverview,
    });

    const providerCostCents =
      planActual && planActual.providerCostCents > 0 ? planActual.providerCostCents : null;
    const marginCents =
      row.mrrCents > 0 && providerCostCents !== null ? row.mrrCents - providerCostCents : null;
    const actualMarginRate =
      marginCents !== null && row.mrrCents > 0 ? marginCents / row.mrrCents : null;
    const projectedMarginRate = unit.preferredProjectedMarginRate;
    const marginRate = actualMarginRate ?? projectedMarginRate;
    const marginSource: PlanOperatingRow["marginSource"] =
      actualMarginRate !== null ? "actual" : projectedMarginRate !== null ? "projected" : "none";

    const planMetrics = params.commercialSummary?.plans[row.planId];
    const health = resolvePlanVersionHealth(meta);

    return {
      ...row,
      arrCents: row.mrrCents * 12,
      versionNumber: version?.version ?? null,
      versionStatus: version?.status ?? null,
      providerCostCents,
      marginCents,
      marginRate,
      marginSource,
      marginTrendDelta: planMarginTrendDelta(plan.id, params.economicsOverview),
      subsTrendDelta: planMetrics?.subsTrendDelta ?? null,
      mrrTrendDelta: planMetrics?.mrrTrendDelta ?? null,
      marketingTags: plan.marketingTags ?? [],
      isPopular: maxSubs > 0 && row.activeSubscriptions === maxSubs,
      isDeprecated: version?.status === "deprecated" || plan.status === "archived",
      tierCount: health.tierCount,
      modelsBound: health.modelsBound,
      modelCount: health.modelCount,
      needsModels: health.needsModels,
    };
  });
}

export function buildExecutiveKpis(params: {
  plans: readonly Plan[];
  commercialSummary: PlatformCommercialSummary | null;
  economicsOverview: EconomicsOverviewResponse | null;
}): ExecutiveKpis {
  const summary = params.economicsOverview?.summary;
  const grossMarginRate =
    summary && summary.tenantRevenueCents > 0
      ? summary.marginCents / summary.tenantRevenueCents
      : null;
  return {
    mrrCents: params.commercialSummary?.totals.mrrCents ?? 0,
    activePlanCount: params.plans.filter((plan) => plan.status === "active").length,
    activeSubscriptions: params.commercialSummary?.totals.activeSubscriptions ?? 0,
    grossMarginRate,
    marginTrendDelta: params.economicsOverview?.marginTrendDelta ?? null,
    mrrTrendDelta: params.commercialSummary?.totals.mrrTrendDelta ?? null,
    subsTrendDelta: params.commercialSummary?.totals.subsTrendDelta ?? null,
  };
}

export function sortOperatingRows(
  rows: PlanOperatingRow[],
  sortKey: OperatingTableSortKey = operatingSortKey,
  descending: boolean = operatingSortDesc,
): PlanOperatingRow[] {
  const sorted = rows.toSorted((left, right) => {
    let cmp = 0;
    switch (sortKey) {
      case "enterprises":
        cmp = left.activeSubscriptions - right.activeSubscriptions;
        break;
      case "margin":
        cmp = (left.marginRate ?? -1) - (right.marginRate ?? -1);
        break;
      case "mrr":
      default:
        cmp = left.mrrCents - right.mrrCents;
        break;
    }
    if (cmp === 0) {
      return left.planName.localeCompare(right.planName, "zh-CN");
    }
    return descending ? -cmp : cmp;
  });
  return sorted;
}

function renderKpiCard(icon: IconName, label: string, value: string, sub?: string) {
  return html`
    <div class="platform-pricing__kpi">
      <span class="platform-pricing__kpi-icon">${renderIcon(icon, "platform-pricing__kpi-icon-svg")}</span>
      <div class="platform-pricing__kpi-body">
        <div class="platform-pricing__kpi-label">${label}</div>
        <div class="platform-pricing__kpi-value">${value}</div>
        ${sub ? html`<div class="platform-pricing__kpi-sub muted">${sub}</div>` : nothing}
      </div>
    </div>
  `;
}

function renderExecutiveKpis(kpis: ExecutiveKpis) {
  const mrrSub =
    kpis.mrrTrendDelta !== null && kpis.mrrTrendDelta !== undefined
      ? t("platformPricing.dashboardMrrTrend", { delta: formatPercentTrend(kpis.mrrTrendDelta) })
      : t("platformPricing.dashboardKpiMrrHint");
  const enterprisesSub =
    kpis.subsTrendDelta !== null && kpis.subsTrendDelta !== undefined && kpis.subsTrendDelta !== 0
      ? t("platformPricing.dashboardSubsTrend", { delta: formatCountTrend(kpis.subsTrendDelta) })
      : t("platformPricing.dashboardKpiEnterprisesHint");
  const marginSub =
    kpis.marginTrendDelta !== null
      ? t("platformPricing.dashboardMarginTrend", {
          delta: formatMarginRateDelta(kpis.marginTrendDelta),
        })
      : t("platformPricing.dashboardMarginHint");
  return html`
    <div class="platform-pricing__kpi-grid" data-testid="pricing-executive-kpis">
      ${renderKpiCard("dollarSign", t("platformPricing.dashboardKpiMrr"), fmtMoney(kpis.mrrCents), mrrSub)}
      ${renderKpiCard(
        "barChart",
        t("platformPricing.dashboardKpiPlans"),
        String(kpis.activePlanCount),
        t("platformPricing.dashboardKpiPlansHint"),
      )}
      ${renderKpiCard(
        "building",
        t("platformPricing.dashboardKpiEnterprises"),
        String(kpis.activeSubscriptions),
        enterprisesSub,
      )}
      ${renderKpiCard(
        "trendingUp",
        t("platformPricing.dashboardKpiMargin"),
        formatMarginRate(kpis.grossMarginRate),
        marginSub,
      )}
    </div>
  `;
}

function renderDistribution(rows: PlanOperatingRow[]) {
  const withShare = rows.filter((row) => (row.sharePercent ?? 0) > 0);
  if (withShare.length === 0) {
    return html`
      <div class="muted platform-pricing__distribution-empty" data-testid="plan-distribution-empty">
        ${t("platformPricing.adoptionNoSubscriptions")}
      </div>
    `;
  }
  return html`
    <div class="platform-pricing__distribution" data-testid="plan-distribution-chart">
      ${withShare.map(
        (row) => html`
          <div class="platform-pricing__distribution-row" data-testid="plan-distribution-row-${row.planId}">
            <div class="platform-pricing__distribution-label">${row.planName}</div>
            <div class="platform-pricing__distribution-bar-track" aria-hidden="true">
              <div
                class="platform-pricing__distribution-bar-fill"
                style="width: ${Math.min(100, row.sharePercent ?? 0)}%;"
              ></div>
            </div>
            <div class="platform-pricing__distribution-pct">${formatAdoptionShare(row.sharePercent)}</div>
          </div>
        `,
      )}
    </div>
  `;
}

function renderSortHeader(label: string, sortKey: OperatingTableSortKey, rerender: () => void) {
  const active = operatingSortKey === sortKey;
  return html`
    <button
      type="button"
      class="platform-pricing__operating-sort ${active ? "is-active" : ""}"
      data-testid="operating-sort-${sortKey}"
      @click=${() => {
        if (operatingSortKey === sortKey) {
          operatingSortDesc = !operatingSortDesc;
        } else {
          operatingSortKey = sortKey;
          operatingSortDesc = true;
        }
        rerender();
      }}
    >
      ${label}${active ? (operatingSortDesc ? " ↓" : " ↑") : ""}
    </button>
  `;
}

function renderMarketingBadges(tags: PlanOperatingRow["marketingTags"]): TemplateResult {
  return html`
    ${
      tags.includes("default")
        ? html`<span class="chip platform-pricing__operating-badge-default">${t("platformPricing.badgeDefault")}</span>`
        : nothing
    }
    ${
      tags.includes("recommended")
        ? html`<span class="chip platform-pricing__operating-badge-recommended">${t("platformPricing.badgeRecommended")}</span>`
        : nothing
    }
  `;
}

function renderOperatingPlanBadges(row: PlanOperatingRow): TemplateResult {
  return html`
    ${renderMarketingBadges(row.marketingTags)}
    ${
      row.isPopular
        ? html`<span class="chip platform-pricing__operating-badge-popular">${t("platformPricing.badgePopular")}</span>`
        : nothing
    }
    ${
      row.isDeprecated
        ? html`<span class="chip platform-pricing__operating-badge-deprecated">${t("platformPricing.badgeDeprecated")}</span>`
        : nothing
    }
  `;
}

function renderOperatingPlanCell(
  row: PlanOperatingRow,
  _onFixPlanModels: (planId: string) => void,
): TemplateResult {
  return html`
    <div class="platform-pricing__operating-plan-cell">
      <div class="platform-pricing__operating-plan-title-row">
        <span class="platform-pricing__operating-plan-name">${row.planName}</span>
        ${renderOperatingPlanBadges(row)}
      </div>
      ${renderPlanHealthSummary({
        tierCount: row.tierCount,
        modelsBound: row.modelsBound,
        modelCount: row.modelCount,
        readOnly: true,
      })}
    </div>
  `;
}

function renderOperatingTable(
  rows: PlanOperatingRow[],
  rerender: () => void,
  context: "packages" | "economics",
  onOpenUnitEconomics: (planId: string) => void,
  onOpenEconomicsAnalysis: (planId: string, planName: string) => void,
  onFocusPlan: (planId: string) => void,
  onFixPlanModels: (planId: string) => void,
) {
  const sorted = sortOperatingRows(rows);
  return html`
    <div class="platform-pricing__operating-table-wrap">
      <table class="platform-pricing__operating-table" data-testid="plan-operating-table">
        <thead>
          <tr>
            <th scope="col">${t("platformPricing.operatingColPlan")}</th>
            <th scope="col">${renderSortHeader(t("platformPricing.operatingColEnterprises"), "enterprises", rerender)}</th>
            <th scope="col">${renderSortHeader(t("platformPricing.operatingColMrr"), "mrr", rerender)}</th>
            <th scope="col">${t("platformPricing.operatingColArr")}</th>
            <th scope="col">${t("platformPricing.operatingColCost")}</th>
            <th scope="col">${renderSortHeader(t("platformPricing.operatingColMargin"), "margin", rerender)}</th>
            <th scope="col">${t("platformPricing.operatingColTrend")}</th>
            <th scope="col">${t("platformPricing.operatingColActions")}</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(
            (row) => html`
            <tr data-testid="plan-adoption-row-${row.planId}">
              <td>${renderOperatingPlanCell(row, onFixPlanModels)}</td>
              <td>${row.activeSubscriptions}</td>
              <td>${fmtMoney(row.mrrCents)}</td>
              <td>${fmtMoney(row.arrCents)}</td>
              <td>${row.providerCostCents !== null ? fmtMoney(row.providerCostCents) : "—"}</td>
              <td>
                <span class="platform-pricing__margin-inline">
                  ${formatMarginRate(row.marginRate)}
                  ${
                    row.marginSource === "projected"
                      ? html`
                          <span class="muted platform-pricing__margin-est">*</span>
                        `
                      : nothing
                  }
                </span>
              </td>
              <td>${renderCompositeTrend(row)}</td>
              <td>
                <div class="platform-pricing__operating-actions">
                  ${
                    context === "packages"
                      ? html`
                          <button
                            type="button"
                            class="btn btn--sm"
                            data-testid="operating-analysis-${row.planId}"
                            @click=${(event: Event) => {
                              event.stopPropagation();
                              onOpenEconomicsAnalysis(row.planId, row.planName);
                            }}
                          >
                            ${t("platformPricing.operatingActionAnalysis")}
                          </button>
                        `
                      : html`
                          <button
                            type="button"
                            class="btn btn--sm"
                            data-testid="operating-focus-${row.planId}"
                            @click=${(event: Event) => {
                              event.stopPropagation();
                              onOpenEconomicsAnalysis(row.planId, row.planName);
                            }}
                          >
                            ${t("platformPricing.operatingActionFocus")}
                          </button>
                        `
                  }
                  <button
                    type="button"
                    class="btn btn--sm"
                    data-testid="operating-economics-${row.planId}"
                    @click=${(event: Event) => {
                      event.stopPropagation();
                      onOpenUnitEconomics(row.planId);
                    }}
                  >
                    ${t("platformPricing.operatingActionEconomics")}
                  </button>
                  ${
                    context === "economics"
                      ? html`
                          <button
                            type="button"
                            class="btn btn--sm"
                            data-testid="operating-config-${row.planId}"
                            @click=${(event: Event) => {
                              event.stopPropagation();
                              onFocusPlan(row.planId);
                            }}
                          >
                            ${t("platformPricing.operatingActionManage")}
                          </button>
                        `
                      : nothing
                  }
                </div>
              </td>
            </tr>
          `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

export function renderPricingOperatingTable(params: {
  plans: readonly Plan[];
  commercialSummary: PlatformCommercialSummary | null;
  economicsOverview: EconomicsOverviewResponse | null;
  versionMetaById: Record<string, PlatformPlanBundleVersionRow | undefined>;
  versionsByPlan: Record<string, PlanVersion[]>;
  catalogPolicies: readonly RoutingPolicy[];
  rerender: () => void;
  filterPlanId?: string | null;
  onOpenUnitEconomics: (planId: string) => void;
  onOpenEconomicsAnalysis: (planId: string, planName: string) => void;
  onFocusPlan: (planId: string) => void;
  onFixPlanModels: (planId: string) => void;
}): TemplateResult {
  let rows = buildPlanOperatingRows({
    plans: params.plans,
    commercialSummary: params.commercialSummary,
    economicsOverview: params.economicsOverview,
    versionMetaById: params.versionMetaById,
    versionsByPlan: params.versionsByPlan,
    catalogPolicies: params.catalogPolicies,
  });
  if (params.filterPlanId) {
    rows = rows.filter((row) => row.planId === params.filterPlanId);
  }
  if (rows.length === 0) {
    return html`
      <div class="muted platform-pricing__distribution-empty">${t("platformPricing.adoptionNoSubscriptions")}</div>
    `;
  }
  return renderOperatingTable(
    rows,
    params.rerender,
    "economics",
    params.onOpenUnitEconomics,
    params.onOpenEconomicsAnalysis,
    params.onFocusPlan,
    params.onFixPlanModels,
  );
}

export function __resetPricingOperatingDashboardForTest(): void {
  operatingSortKey = "mrr";
  operatingSortDesc = true;
}

export function renderPricingOperatingDashboard(params: {
  plans: readonly Plan[];
  commercialSummary: PlatformCommercialSummary | null;
  economicsOverview: EconomicsOverviewResponse | null;
  versionMetaById: Record<string, PlatformPlanBundleVersionRow | undefined>;
  versionsByPlan: Record<string, PlanVersion[]>;
  catalogPolicies: readonly RoutingPolicy[];
  loading: boolean;
  rerender: () => void;
  /** packages：仅 KPI + 分布；economics：含经营表 */
  context?: "packages" | "economics";
  onOpenEconomicsTab?: () => void;
  onOpenUnitEconomics: (planId: string) => void;
  onOpenEconomicsAnalysis: (planId: string, planName: string) => void;
  onFocusPlan: (planId: string) => void;
  onFixPlanModels: (planId: string) => void;
}): TemplateResult | typeof nothing {
  if (params.loading) {
    return nothing;
  }
  if (params.plans.length === 0) {
    return nothing;
  }

  const kpis = buildExecutiveKpis(params);
  const rows = buildPlanOperatingRows(params);
  const context = params.context ?? "economics";
  const showTable = context === "economics";

  return html`
    <div class="platform-pricing__executive-dashboard" data-testid="plan-adoption-overview">
      <section class="card platform-pricing__executive-section">
        <div class="card-title">${t("platformPricing.dashboardOverviewTitle")}</div>
        ${renderExecutiveKpis(kpis)}
      </section>

      <section class="card platform-pricing__executive-section">
        <div class="card-title">${t("platformPricing.dashboardDistributionTitle")}</div>
        ${renderDistribution(rows)}
      </section>

      ${
        showTable
          ? html`
              <section class="card platform-pricing__executive-section">
                <div class="card-title">${t("platformPricing.dashboardOperatingTitle")}</div>
                ${renderOperatingTable(
                  rows,
                  params.rerender,
                  context,
                  params.onOpenUnitEconomics,
                  params.onOpenEconomicsAnalysis,
                  params.onFocusPlan,
                  params.onFixPlanModels,
                )}
              </section>
            `
          : html`
              <section class="card platform-pricing__executive-section platform-pricing__executive-section--link">
                <div class="card-title">${t("platformPricing.dashboardOperatingTitle")}</div>
                ${
                  params.onOpenEconomicsTab
                    ? html`
                        <button
                          type="button"
                          class="btn btn--sm"
                          data-testid="open-economics-operating-table"
                          @click=${params.onOpenEconomicsTab}
                        >
                          ${t("platformPricing.openEconomicsOperatingTable")}
                        </button>
                      `
                    : nothing
                }
              </section>
            `
      }
    </div>
  `;
}
