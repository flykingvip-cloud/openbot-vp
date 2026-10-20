/**
 * 平台定价页 — Economics / CostVersion 子页。
 */

import { html, nothing } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { Plan, PlanVersion } from "../../../capability/cost-budget-billing/index.ts";
import { createCostEconomicsGateway } from "../../../capability/cost-economics/index.ts";
import type {
  CostVersion,
  EconomicsLedgerResponse,
  EconomicsOverviewResponse,
  PlatformConsumptionForecastOverview,
} from "../../../capability/cost-economics/index.ts";
import type { PlatformPlanBundleVersionRow } from "../../../capability/platform-plan-bundle/index.ts";
import type { PlatformCommercialSummary } from "../../../capability/platform-subscriptions/index.ts";
import type { RoutingPolicy } from "../../../capability/policy-engine/index.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { renderIcon, type IconName } from "../../../icons.ts";
import { renderEnterpriseKpiGrid } from "../../../views/enterprise-kpi-card.ts";
import { clearEconomicsFocus, getEconomicsFocus, setEconomicsFocus } from "./economics-focus.ts";
import {
  createGatewayLoadRetry,
  isTransientGatewayError,
  type GatewayLoadRetryController,
} from "./gateway-load-retry.ts";
import {
  buildPlanRecommendationHealthRows,
  marginHealthLabelKey,
} from "./plan-recommendation-health.ts";
import { buildExecutiveKpis, renderPricingOperatingTable } from "./pricing-operating-dashboard.ts";
import { renderEconomicsFocusBanner } from "./unit-economics-drawer.ts";
import {
  buildPlanUnitEconomics,
  formatMarginRate,
  formatMarginRateDelta,
} from "./unit-economics.ts";

type SectionState = {
  loading: boolean;
  busy: boolean;
  error: string | null;
  notice: string | null;
  versions: CostVersion[];
  activeVersion: CostVersion | null;
  economics: EconomicsOverviewResponse | null;
  ledgerLoading: boolean;
  ledgerError: string | null;
  ledger: EconomicsLedgerResponse | null;
  forecastOverview: PlatformConsumptionForecastOverview | null;
};

const state: SectionState = {
  loading: false,
  busy: false,
  error: null,
  notice: null,
  versions: [],
  activeVersion: null,
  economics: null,
  ledgerLoading: false,
  ledgerError: null,
  ledger: null,
  forecastOverview: null,
};

let lastClient: GatewayBrowserClient | null = null;
let loaded = false;
let rerenderFn: (() => void) | null = null;
let loadRetry: GatewayLoadRetryController | null = null;
type EconomicsDetailTab = "enterprise" | "ledger";
let economicsDetailTab: EconomicsDetailTab = "enterprise";

function cancelLoadRetry(): void {
  loadRetry?.cancel();
  loadRetry = null;
}

function gatewayOf(client: GatewayBrowserClient) {
  return createCostEconomicsGateway(client);
}

function fmtCents(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

async function loadLedger(client: GatewayBrowserClient): Promise<void> {
  if (!state.economics) {
    state.ledger = null;
    return;
  }
  state.ledgerLoading = true;
  state.ledgerError = null;
  rerenderFn?.();
  try {
    const focus = getEconomicsFocus();
    state.ledger = await gatewayOf(client).economicsLedger({
      startTime: state.economics.startTime,
      endTime: state.economics.endTime,
      planId: focus.planId ?? undefined,
      limit: 50,
    });
  } catch (err) {
    state.ledgerError =
      err instanceof Error ? err.message : t("platformEconomics.ledgerLoadFailed");
    state.ledger = null;
  } finally {
    state.ledgerLoading = false;
    rerenderFn?.();
  }
}

async function load(client: GatewayBrowserClient): Promise<void> {
  state.loading = true;
  state.error = null;
  rerenderFn?.();
  try {
    const [costOverview, economics, forecastOverview] = await Promise.all([
      gatewayOf(client).costVersionOverview(),
      gatewayOf(client).economicsOverview(),
      gatewayOf(client)
        .consumptionForecastPlatformOverview()
        .catch(() => null),
    ]);
    state.versions = costOverview.versions;
    state.activeVersion = costOverview.activeVersion;
    state.economics = economics;
    state.forecastOverview = forecastOverview;
    state.loading = false;
    loaded = true;
    cancelLoadRetry();
    await loadLedger(client);
  } catch (err) {
    state.loading = false;
    if (isTransientGatewayError(err)) {
      loaded = false;
      state.error = null;
      if (!loadRetry) {
        loadRetry = createGatewayLoadRetry(
          () => {
            if (lastClient === client && !loaded && !state.loading) {
              void load(client);
            }
          },
          {
            onExhausted: () => {
              loadRetry = null;
              state.error = err instanceof Error ? err.message : t("platformEconomics.loadFailed");
              rerenderFn?.();
            },
          },
        );
      }
    } else {
      loaded = true;
      cancelLoadRetry();
      state.error = err instanceof Error ? err.message : t("platformEconomics.loadFailed");
    }
    rerenderFn?.();
  }
}

function ensureLoaded(client: GatewayBrowserClient, rerender: () => void): void {
  rerenderFn = rerender;
  if (lastClient !== client) {
    lastClient = client;
    loaded = false;
    cancelLoadRetry();
  }
  if (loaded || state.loading) {
    return;
  }
  void load(client);
}

export function reloadPlatformEconomicsSection(
  client: GatewayBrowserClient,
  rerender: () => void,
): void {
  rerenderFn = rerender;
  lastClient = client;
  loaded = false;
  cancelLoadRetry();
  void load(client);
}

async function handleCreateDraft(client: GatewayBrowserClient): Promise<void> {
  state.busy = true;
  state.notice = null;
  rerenderFn?.();
  try {
    const result = await gatewayOf(client).createCostVersionFromCatalog();
    state.notice = t("platformEconomics.draftCreated", { n: String(result.version.version) });
    await load(client);
  } catch (err) {
    state.error = err instanceof Error ? err.message : "创建成本版本失败";
  } finally {
    state.busy = false;
    rerenderFn?.();
  }
}

async function handleActivate(client: GatewayBrowserClient, versionId: string): Promise<void> {
  state.busy = true;
  state.notice = null;
  rerenderFn?.();
  try {
    const result = await gatewayOf(client).activateCostVersion(versionId);
    state.notice = t("platformEconomics.versionActivated", { n: String(result.version.version) });
    await load(client);
  } catch (err) {
    state.error = err instanceof Error ? err.message : "激活失败";
  } finally {
    state.busy = false;
    rerenderFn?.();
  }
}

function renderFocusBanner(options?: EconomicsSectionOptions) {
  const focus = getEconomicsFocus();
  if (!focus.planId) {
    return nothing;
  }
  const plan =
    options?.plans?.find((entry) => entry.id === focus.planId) ??
    (focus.planName ? { id: focus.planId, name: focus.planName, basePriceCents: 0 } : null);
  if (!plan) {
    return nothing;
  }
  const metaMonthlyCredits =
    options?.plans !== undefined
      ? resolvePlanMonthlyCredits(focus.planId, options.plans, options.versionMetaById)
      : null;
  const allowedTiers =
    options?.plans !== undefined
      ? resolvePlanAllowedTiers(focus.planId, options.plans, options.versionMetaById)
      : [];
  const policyId = resolvePlanPolicyId(focus.planId, options?.plans, options?.versionMetaById);
  const selectorStrategy =
    options?.catalogPolicies?.find((policy) => policy.id === policyId)?.selectorStrategy ??
    "balanced";
  const unit = buildPlanUnitEconomics({
    planId: plan.id,
    basePriceCents: "basePriceCents" in plan ? plan.basePriceCents : 0,
    monthlyCredits: metaMonthlyCredits,
    allowedTiers,
    selectorStrategy,
    commercial: options?.commercialSummary ?? null,
    planActual: state.economics?.byPlan?.[plan.id],
    platformSummary: state.economics?.summary,
    economicsOverview: state.economics,
  });
  return renderEconomicsFocusBanner({
    planName: plan.name,
    unit,
    onClear: () => {
      clearEconomicsFocus();
      if (lastClient) {
        void loadLedger(lastClient);
      }
      rerenderFn?.();
    },
    onBackToPackages: options?.onBackToPackages,
  });
}

type EconomicsSectionOptions = {
  commercialSummary?: PlatformCommercialSummary | null;
  plans?: Plan[];
  catalogPolicies?: RoutingPolicy[];
  versionMetaById?: Record<string, PlatformPlanBundleVersionRow | undefined>;
  versionsByPlan?: Record<string, PlanVersion[]>;
  onBackToPackages?: () => void;
  onOpenUnitEconomics?: (planId: string) => void;
  onFocusPlan?: (planId: string) => void;
  onFixPlanModels?: (planId: string) => void;
  operatingRerender?: () => void;
};

function resolvePlanPolicyId(
  planId: string,
  plans: Plan[] | undefined,
  versionMetaById?: EconomicsSectionOptions["versionMetaById"],
): string | null {
  const plan = plans?.find((entry) => entry.id === planId);
  if (!plan) {
    return null;
  }
  const meta = versionMetaById?.[plan.currentVersionId];
  return meta?.binding?.policyId ?? null;
}

function resolvePlanMonthlyCredits(
  planId: string,
  plans: Plan[],
  versionMetaById?: EconomicsSectionOptions["versionMetaById"],
): number | null {
  const plan = plans.find((entry) => entry.id === planId);
  if (!plan) {
    return null;
  }
  return versionMetaById?.[plan.currentVersionId]?.entitlementSnapshot?.monthlyCredits ?? null;
}

function resolvePlanAllowedTiers(
  planId: string,
  plans: Plan[],
  versionMetaById?: EconomicsSectionOptions["versionMetaById"],
): string[] {
  const plan = plans.find((entry) => entry.id === planId);
  if (!plan) {
    return [];
  }
  const meta = versionMetaById?.[plan.currentVersionId];
  return meta?.binding?.allowedTiers ?? meta?.entitlementSnapshot?.allowedTiers ?? [];
}

function resolveActiveSummary() {
  const economics = state.economics;
  if (!economics) {
    return null;
  }
  const focus = getEconomicsFocus();
  if (focus.planId && economics.byPlan[focus.planId]) {
    return economics.byPlan[focus.planId];
  }
  return economics.summary;
}

function renderSummaryScopeHint() {
  const focus = getEconomicsFocus();
  if (!focus.planId) {
    return nothing;
  }
  return html`
    <div class="platform-economics__scope-hint muted" data-testid="economics-scope-hint">
      ${t("platformEconomics.scopedToPlan", { name: focus.planName ?? focus.planId })}
    </div>
  `;
}

function renderMergedEconomicsKpis(options?: EconomicsSectionOptions) {
  const economics = state.economics;
  const summary = resolveActiveSummary();
  if (!summary) {
    return nothing;
  }
  const focus = getEconomicsFocus();
  const marginRate =
    summary.tenantRevenueCents > 0 ? summary.marginCents / summary.tenantRevenueCents : null;
  const executive =
    !focus.planId && options?.plans?.length
      ? buildExecutiveKpis({
          plans: options.plans,
          commercialSummary: options.commercialSummary ?? null,
          economicsOverview: economics,
        })
      : null;
  const marginTrendSub =
    !focus.planId && economics?.previousSummary && economics.marginTrendDelta !== undefined
      ? t("platformEconomics.marginTrendDetail", {
          current: formatMarginRate(
            economics.summary.tenantRevenueCents > 0
              ? economics.summary.marginCents / economics.summary.tenantRevenueCents
              : null,
          ),
          previous: formatMarginRate(
            economics.previousSummary.tenantRevenueCents > 0
              ? economics.previousSummary.marginCents / economics.previousSummary.tenantRevenueCents
              : null,
          ),
          delta: formatMarginRateDelta(economics.marginTrendDelta ?? null),
        })
      : undefined;

  return html`
    ${renderSummaryScopeHint()}
    <div class="platform-pricing__kpi-grid" data-testid="economics-summary">
      ${
        executive
          ? html`
              ${renderEconomicsKpi(
                "dollarSign",
                t("platformPricing.dashboardKpiMrr"),
                fmtCents(executive.mrrCents),
              )}
              ${renderEconomicsKpi(
                "building",
                t("platformPricing.dashboardKpiEnterprises"),
                String(executive.activeSubscriptions),
              )}
            `
          : nothing
      }
      ${renderEconomicsKpi("activity", t("platformEconomics.tasks"), String(summary.taskCount))}
      ${renderEconomicsKpi("gauge", t("platformEconomics.creditsCharged"), String(summary.creditsCharged))}
      ${
        !focus.planId && economics?.byPricingEngine
          ? html`
              ${renderEconomicsKpi(
                "gauge",
                t("platformEconomics.creditsV1"),
                String(economics.byPricingEngine.v1.creditsCharged),
              )}
              ${renderEconomicsKpi(
                "gauge",
                t("platformEconomics.creditsV2"),
                String(economics.byPricingEngine.v2.creditsCharged),
              )}
            `
          : nothing
      }
      ${renderEconomicsKpi("dollarSign", t("platformEconomics.providerCost"), fmtCents(summary.providerCostCents))}
      ${renderEconomicsKpi("dollarSign", t("platformEconomics.tenantRevenue"), fmtCents(summary.tenantRevenueCents))}
      ${renderEconomicsKpi("trendingUp", t("platformEconomics.margin"), fmtCents(summary.marginCents))}
      ${
        marginRate !== null
          ? renderEconomicsKpi(
              "trendingUp",
              t("platformEconomics.marginRate"),
              formatMarginRate(marginRate),
              marginTrendSub,
            )
          : nothing
      }
    </div>
  `;
}

function renderEconomicsKpi(icon: IconName, label: string, value: string, sub?: string) {
  return html`
    <div class="platform-pricing__kpi">
      <span class="platform-pricing__kpi-icon"
        >${renderIcon(icon, "platform-pricing__kpi-icon-svg")}</span
      >
      <div class="platform-pricing__kpi-body">
        <div class="platform-pricing__kpi-label">${label}</div>
        <div class="platform-pricing__kpi-value">${value}</div>
        ${sub ? html`<div class="platform-pricing__kpi-sub muted">${sub}</div>` : nothing}
      </div>
    </div>
  `;
}

function renderByEnterprise(_options?: EconomicsSectionOptions) {
  const focus = getEconomicsFocus();
  const enterprisePlans = state.economics?.enterprisePlans ?? {};
  const rows = Object.entries(state.economics?.byEnterprise ?? {})
    .filter(([enterpriseId]) => {
      if (!focus.planId) {
        return true;
      }
      return enterprisePlans[enterpriseId]?.planId === focus.planId;
    })
    .toSorted(([a], [b]) => a.localeCompare(b));
  if (rows.length === 0) {
    return html`<div class="muted card-follow--sm">
      ${t("platformEconomics.noEnterpriseData")}
    </div>`;
  }
  return html`
    <div class="list card-follow--sm" data-testid="economics-by-enterprise">
      ${rows.map(
        ([enterpriseId, row]) => html`
          <div class="list-item">
            <div class="list-main">
              <div class="list-title">${enterpriseId}</div>
              <div class="list-sub">
                ${
                  enterprisePlans[enterpriseId]
                    ? html`<span>${enterprisePlans[enterpriseId].planName}</span> · `
                    : nothing
                }
                ${t("platformEconomics.rowSummary", {
                  tasks: String(row.taskCount),
                  credits: String(row.creditsCharged),
                  cost: fmtCents(row.providerCostCents),
                  revenue: fmtCents(row.tenantRevenueCents),
                  margin: fmtCents(row.marginCents),
                })}
              </div>
            </div>
          </div>
        `,
      )}
    </div>
  `;
}

function renderLedgerTableContent() {
  const focus = getEconomicsFocus();
  const ledger = state.ledger;
  return html`
    <div class="platform-economics__panel-head">
      <div>
        <div class="platform-economics__section-title">
          ${
            focus.planId
              ? t("platformEconomics.ledgerForPlan", { name: focus.planName ?? focus.planId })
              : t("platformEconomics.ledgerTitle")
          }
        </div>
      </div>
      ${
        ledger
          ? html`
              <div
                class="muted platform-economics__ledger-count"
                data-testid="economics-ledger-count"
              >
                ${t("platformEconomics.ledgerCount", {
                  shown: String(ledger.entries.length),
                  total: String(ledger.total),
                })}
              </div>
            `
          : nothing
      }
    </div>
    ${
      state.ledgerLoading
        ? html`<div class="muted card-follow--sm">${t("platformEconomics.ledgerLoading")}</div>`
        : state.ledgerError
          ? html`<div class="callout warning card-follow--sm">${state.ledgerError}</div>`
          : !ledger || ledger.entries.length === 0
            ? html`<div class="muted card-follow--sm">${t("platformEconomics.ledgerEmpty")}</div>`
            : html`
                <div class="platform-pricing__operating-table-wrap card-follow--sm">
                  <table
                    class="platform-pricing__operating-table"
                    data-testid="economics-ledger-table"
                  >
                    <thead>
                      <tr>
                        <th scope="col">${t("platformEconomics.ledgerColTime")}</th>
                        <th scope="col">${t("platformEconomics.enterprise")}</th>
                        <th scope="col">${t("platformEconomics.ledgerColModel")}</th>
                        <th scope="col">${t("platformEconomics.creditsCharged")}</th>
                        <th scope="col">${t("platformEconomics.pricingEngine")}</th>
                        <th scope="col">${t("platformEconomics.providerCost")}</th>
                        <th scope="col">${t("platformEconomics.tenantRevenue")}</th>
                        <th scope="col">${t("platformEconomics.margin")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${ledger.entries.map(
                        (entry) => html`
                          <tr data-testid="economics-ledger-row-${entry.id}">
                            <td>${entry.occurredAt.slice(0, 16).replace("T", " ")}</td>
                            <td>${entry.enterpriseId}</td>
                            <td>
                              <div>${entry.modelId}</div>
                              <div class="muted">${entry.tier} · ${entry.policyId}</div>
                            </td>
                            <td>${entry.creditsCharged}</td>
                            <td>${entry.pricingEngine ?? "v1"}</td>
                            <td>${fmtCents(entry.providerCostCents)}</td>
                            <td>${fmtCents(entry.tenantRevenueCents)}</td>
                            <td>${fmtCents(entry.tenantRevenueCents - entry.providerCostCents)}</td>
                          </tr>
                        `,
                      )}
                    </tbody>
                  </table>
                </div>
              `
    }
  `;
}

function renderCostVersionsContent(client: GatewayBrowserClient) {
  return html`
    <div class="row row--split">
      <div>
        <div class="platform-economics__section-title">${t("platformEconomics.costVersions")}</div>
      </div>
      <button
        class="btn btn--sm"
        type="button"
        data-testid="create-cost-version-btn"
        ?disabled=${state.busy}
        @click=${() => void handleCreateDraft(client)}
      >
        ${state.busy ? t("platformEconomics.busy") : t("platformEconomics.createFromCatalog")}
      </button>
    </div>
    ${
      state.activeVersion
        ? html`
            <div class="callout card-follow--sm">
              ${t("platformEconomics.activeVersion", {
                n: String(state.activeVersion.version),
                id: state.activeVersion.id,
              })}
            </div>
          `
        : html`
            <div class="callout warning card-follow--sm">
              ${t("platformEconomics.noActiveVersion")}
            </div>
          `
    }
    <div class="list card-follow--sm">
      ${state.versions.map(
        (version) => html`
          <div class="list-item" data-testid="cost-version-row">
            <div class="list-main">
              <div class="list-title">
                v${version.version}
                <span class="chip">${version.status}</span>
              </div>
              <div class="list-sub">
                ${Object.keys(version.modelCosts).length} ${t("platformEconomics.models")} ·
                ${version.id}
              </div>
            </div>
            ${
              version.status === "draft"
                ? html`
                    <button
                      class="btn btn--primary btn--sm"
                      data-testid="activate-cost-version-btn"
                      ?disabled=${state.busy}
                      @click=${() => void handleActivate(client, version.id)}
                    >
                      ${t("platformEconomics.activate")}
                    </button>
                  `
                : nothing
            }
          </div>
        `,
      )}
    </div>
  `;
}

function forecastAlertLabel(kind: string): string {
  switch (kind) {
    case "concurrency":
      return t("platformEconomics.forecastAlertConcurrency");
    case "credits":
      return t("platformEconomics.forecastAlertCredits");
    case "margin":
      return t("platformEconomics.forecastAlertMargin");
    case "cost":
      return t("platformEconomics.forecastAlertCost");
    case "bots":
      return t("platformEconomics.forecastAlertBots");
    default:
      return kind;
  }
}

function renderForecastAtRiskContent(): ReturnType<typeof html> | typeof nothing {
  const overview = state.forecastOverview;
  if (!overview) {
    return nothing;
  }
  return html`
    <div data-testid="economics-forecast-at-risk">
      ${renderEnterpriseKpiGrid([
        {
          label: t("platformEconomics.forecastSummaryAny"),
          value: String(overview.summary.anyAlert),
        },
        {
          label: t("platformEconomics.forecastSummaryConcurrency"),
          value: String(overview.summary.concurrencyHigh),
        },
        {
          label: t("platformEconomics.forecastSummaryCredits"),
          value: String(overview.summary.creditsCritical),
        },
        {
          label: t("platformEconomics.forecastSummaryMargin"),
          value: String(overview.summary.marginHigh),
        },
      ])}
      ${
        overview.atRiskEnterprises.length === 0
          ? html`<div class="muted">${t("platformEconomics.forecastAtRiskEmpty")}</div>`
          : html`
              <div class="cost-budget-table card-follow--sm">
                ${overview.atRiskEnterprises.map(
                  (row) => html`
                    <div class="cost-budget-row">
                      <span>${row.enterpriseId}${row.planId ? ` · ${row.planId}` : ""}</span>
                      <span>${row.alerts.map((a) => forecastAlertLabel(a)).join(" · ")}</span>
                    </div>
                  `,
                )}
              </div>
            `
      }
    </div>
  `;
}

function renderPlanRecommendationHealthContent(options?: EconomicsSectionOptions) {
  if (!options?.plans?.length || !state.economics) {
    return nothing;
  }
  const rows = buildPlanRecommendationHealthRows({
    plans: options.plans,
    economics: state.economics,
    forecastOverview: state.forecastOverview,
    commercialSummary: options.commercialSummary ?? null,
    versionMetaById: options.versionMetaById ?? {},
    catalogPolicies: options.catalogPolicies ?? [],
  });
  if (rows.length === 0) {
    return nothing;
  }
  return html`
    <div class="cost-budget-table" data-testid="economics-recommendation-health">
      <div class="cost-budget-row cost-budget-row--head">
        <span>${t("platformEconomics.recHealthColPlan")}</span>
        <span>${t("platformEconomics.recHealthColMargin")}</span>
        <span>${t("platformEconomics.recHealthColAtRisk")}</span>
        <span>${t("platformEconomics.recHealthColUpgrade")}</span>
      </div>
      ${rows.map(
        (row) => html`
          <div class="cost-budget-row" data-testid="rec-health-row-${row.planId}">
            <span>
              <strong>${row.planName}</strong>
              ${
                row.targetPersonas.length > 0
                  ? html`
                      <span class="muted">
                        ·
                        ${row.targetPersonas.slice(0, 3).join(", ")}${row.targetPersonas.length > 3 ? "…" : ""}
                      </span>
                    `
                  : nothing
              }
            </span>
            <span data-testid="rec-health-margin-${row.planId}">
              ${t(marginHealthLabelKey(row.marginHealth))}
              ${
                row.targetMarginRate != null
                  ? html`
                      <span class="muted">
                        (${t("platformEconomics.recHealthTarget", {
                          rate: `${Math.round(row.targetMarginRate * 100)}%`,
                        })})
                      </span>
                    `
                  : nothing
              }
            </span>
            <span>${row.atRiskEnterpriseCount}</span>
            <span>${row.upgradeAlertCount}</span>
          </div>
        `,
      )}
    </div>
  `;
}

function renderRiskSection(options?: EconomicsSectionOptions) {
  const overview = state.forecastOverview;
  const recRows =
    options?.plans?.length && state.economics
      ? buildPlanRecommendationHealthRows({
          plans: options.plans,
          economics: state.economics,
          forecastOverview: state.forecastOverview,
          commercialSummary: options.commercialSummary ?? null,
          versionMetaById: options.versionMetaById ?? {},
          catalogPolicies: options.catalogPolicies ?? [],
        })
      : [];
  if (!overview && recRows.length === 0) {
    return nothing;
  }
  return html`
    <div class="platform-economics__workspace-section">
      <div class="platform-economics__section-head">
        <div class="platform-economics__section-title">
          ${t("platformEconomics.riskSectionTitle")}
        </div>
      </div>
      ${overview ? renderForecastAtRiskContent() : nothing}
      ${recRows.length > 0 ? renderPlanRecommendationHealthContent(options) : nothing}
    </div>
  `;
}

function renderDetailSection(client: GatewayBrowserClient, options?: EconomicsSectionOptions) {
  return html`
    <div class="platform-economics__workspace-section" data-testid="economics-detail-section">
      <div class="platform-economics__detail-tabs">
        <button
          type="button"
          class="platform-economics__detail-tab ${economicsDetailTab === "enterprise" ? "is-active" : ""}"
          data-testid="economics-detail-tab-enterprise"
          @click=${() => {
            economicsDetailTab = "enterprise";
            rerenderFn?.();
          }}
        >
          ${t("platformEconomics.byEnterprise")}
        </button>
        <button
          type="button"
          class="platform-economics__detail-tab ${economicsDetailTab === "ledger" ? "is-active" : ""}"
          data-testid="economics-detail-tab-ledger"
          @click=${() => {
            economicsDetailTab = "ledger";
            rerenderFn?.();
          }}
        >
          ${t("platformEconomics.ledgerTitle")}
        </button>
      </div>
      ${
        economicsDetailTab === "enterprise"
          ? html`<div data-testid="economics-by-enterprise">${renderByEnterprise(options)}</div>`
          : html`<div data-testid="economics-ledger-panel">${renderLedgerTableContent()}</div>`
      }
    </div>
  `;
}

export function __resetEconomicsSectionForTest(): void {
  state.loading = false;
  state.busy = false;
  state.error = null;
  state.notice = null;
  state.versions = [];
  state.activeVersion = null;
  state.economics = null;
  state.ledgerLoading = false;
  state.ledgerError = null;
  state.ledger = null;
  state.forecastOverview = null;
  economicsDetailTab = "enterprise";
  lastClient = null;
  loaded = false;
  rerenderFn = null;
  cancelLoadRetry();
}

export function renderPlatformEconomicsSection(
  client: GatewayBrowserClient,
  rerender: () => void,
  options?: EconomicsSectionOptions,
) {
  ensureLoaded(client, rerender);

  if (state.loading) {
    return html`<div class="muted">${t("platformEconomics.loading")}</div>`;
  }

  const focus = getEconomicsFocus();
  const operatingRerender = options?.operatingRerender ?? rerender;

  return html`
    <div class="platform-economics">
      ${renderFocusBanner(options)}
      ${state.error ? html`<div class="callout warning">${state.error}</div>` : nothing}
      ${state.notice ? html`<div class="callout">${state.notice}</div>` : nothing}

      <section class="card platform-economics__workspace" data-testid="economics-workspace">
        <header class="platform-economics__workspace-head">
          <div>
            <div class="card-title">${t("platformEconomics.workspaceTitle")}</div>
            ${
              state.economics
                ? html`
                    <div class="platform-economics__period muted">
                      ${state.economics.startTime.slice(0, 10)} →
                      ${state.economics.endTime.slice(0, 10)}
                    </div>
                  `
                : nothing
            }
          </div>
        </header>

        ${renderMergedEconomicsKpis(options)}
        ${
          options?.plans?.length
            ? html`
                <div
                  class="platform-economics__workspace-section"
                  data-testid="plan-adoption-overview"
                >
                  <div class="platform-economics__section-head">
                    <div class="platform-economics__section-title">
                      ${t("platformPricing.dashboardOperatingTitle")}
                    </div>
                  </div>
                  ${renderPricingOperatingTable({
                    plans: options.plans,
                    commercialSummary: options.commercialSummary ?? null,
                    economicsOverview: state.economics,
                    versionMetaById: options.versionMetaById ?? {},
                    versionsByPlan: options.versionsByPlan ?? {},
                    catalogPolicies: options.catalogPolicies ?? [],
                    rerender: operatingRerender,
                    filterPlanId: focus.planId,
                    onOpenUnitEconomics: (planId) => options?.onOpenUnitEconomics?.(planId),
                    onOpenEconomicsAnalysis: (planId, planName) => {
                      setEconomicsFocus(planId, planName);
                      void loadLedger(client);
                      rerender();
                    },
                    onFocusPlan: (planId) => options?.onFocusPlan?.(planId),
                    onFixPlanModels: (planId) => options?.onFixPlanModels?.(planId),
                  })}
                </div>
              `
            : nothing
        }
        ${renderRiskSection(options)} ${renderDetailSection(client, options)}
      </section>

      <details class="platform-economics__advanced" data-testid="cost-version-panel">
        <summary class="platform-economics__advanced-summary">
          ${t("platformEconomics.advancedCostTitle")}
        </summary>
        <div class="platform-economics__advanced-body">${renderCostVersionsContent(client)}</div>
      </details>
    </div>
  `;
}
