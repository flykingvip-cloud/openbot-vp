import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { DashboardResponse } from "../../../capability/cost-budget-billing/index.ts";
import { createEnterpriseDataCapabilityGateway } from "../../../controllers/enterprise-data-capability/gateway-client.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { renderIcon } from "../../../icons.ts";
import { buildSeatsGovernanceDrilldownHref } from "../../cost-budget/cost-budget-drilldown.ts";
import { renderCostBudgetOverviewSubscribeHero } from "../../cost-budget/cost-budget-overview-subscribe-hero.ts";
import { buildCostBudgetTodos, type CostBudgetTodo } from "../../cost-budget/cost-budget-todos.ts";
import { renderEnterpriseKpiGrid, type EnterpriseKpiItem } from "../../enterprise-kpi-card.ts";
import { renderOverviewBudgetForecastPanel } from "../panels/overview-budget-forecast-panel.ts";
import { renderDashboardGovernancePanel } from "../panels/overview-governance-panel.ts";
import { renderKnowledgeGovernanceCreditsPanel } from "../panels/overview-knowledge-governance-credits-panel.ts";
import {
  buildCostBudgetV2UsageHref,
  type CostBudgetV2NavigateTarget,
} from "../shell/cost-budget-v2-routes.ts";
import { isCostBudgetGatewayReady } from "../stores/gateway-ready.ts";
import { ensureOperationsStore, getOperationsStoreState } from "../stores/operations-store.ts";
import { getSubscriptionStoreState, setPendingOrderId } from "../stores/subscription-store.ts";
import {
  buildOverviewPlanContext,
  buildOverviewUsageRows,
  renderOverviewPlanPanel,
} from "./overview-subscribed-snapshot.ts";

export type OverviewPageOptions = {
  client: GatewayBrowserClient | null;
  basePath: string;
  tenantId: string;
  onNavigate: (target: CostBudgetV2NavigateTarget) => void;
  onRefresh: () => void;
};

function fmtMoney(cents: number | null | undefined): string {
  if (cents == null) {
    return "—";
  }
  return `¥${(cents / 100).toFixed(2)}`;
}

function renderOverviewPanelHeader(title: string, hint?: string): TemplateResult {
  return html`
    <header class="cost-budget-v2-overview-panel__head">
      <h3 class="enterprise-section-title">${title}</h3>
      ${hint ? html`<p class="enterprise-hint cost-budget-v2-overview-panel__hint">${hint}</p>` : nothing}
    </header>
  `;
}

function buildHeroOverviewKpis(
  d: DashboardResponse,
  basePath: string,
  tenantId: string,
): EnterpriseKpiItem[] {
  const billingMode = d.billingMode ?? "credits";
  const isEnterpriseBudget = billingMode === "enterprise_budget";
  const budgetStatus = d.budgetStatus ?? {
    level: "ok" as const,
    monthlyLimitCents: 0,
    accruedCents: 0,
    predictedCents: null,
  };
  const level = budgetStatus.level ?? "ok";
  const budgetAccrued = budgetStatus.accruedCents ?? 0;
  const ratio =
    budgetStatus.monthlyLimitCents > 0
      ? Math.round((budgetAccrued / budgetStatus.monthlyLimitCents) * 100)
      : 0;
  const budgetTone: EnterpriseKpiItem["tone"] =
    level === "exceeded" ? "danger" : level === "alert" ? "warn" : "neutral";
  const accruedHref = buildSeatsGovernanceDrilldownHref(basePath, tenantId, "total");

  const items: EnterpriseKpiItem[] = [
    {
      label: isEnterpriseBudget ? "预算累计" : "累计总费用",
      value: fmtMoney(isEnterpriseBudget ? budgetAccrued : d.accruedCents),
      href: accruedHref,
      drilldown: t("costBudget.overviewPanel.drilldownTotal"),
      icon: "dollarSign",
    },
    {
      label: "预算用量",
      value: d.budgetStatus.monthlyLimitCents > 0 ? `${ratio}%` : "未设预算",
      tone: budgetTone,
      icon: "alertTriangle",
    },
    {
      label: "预计月底",
      value: d.predictedCents == null ? "数据不足" : fmtMoney(d.predictedCents),
      icon: "calendar",
    },
  ];

  if (!isEnterpriseBudget && d.creditsStatus && d.creditsStatus.monthlyCredits > 0) {
    items.push({
      label: "AI 工作额度剩余",
      value: `${d.creditsStatus.creditsRemaining} / ${d.creditsStatus.monthlyCredits}`,
      icon: "zap",
    });
  }

  return items;
}

function buildCostBreakdownKpis(
  d: DashboardResponse,
  basePath: string,
  tenantId: string,
): EnterpriseKpiItem[] {
  const seatHref = buildSeatsGovernanceDrilldownHref(basePath, tenantId, "seat");
  const usageHref = buildSeatsGovernanceDrilldownHref(basePath, tenantId, "usage");
  const extraHref = buildCostBudgetV2UsageHref(basePath, tenantId, {
    route: "settings",
    settingsPanel: "budget",
    hash: "#budget",
  });

  return [
    {
      label: "Seat 成本",
      value: fmtMoney(d.seatCostCents),
      href: seatHref,
      drilldown: t("costBudget.overviewPanel.drilldownSeat"),
    },
    {
      label: "Usage 成本",
      value: fmtMoney(d.usageCostCents),
      href: usageHref,
      drilldown: t("costBudget.overviewPanel.drilldownUsage"),
    },
    {
      label: "超额成本",
      value: fmtMoney(d.extraCostCents),
      href: extraHref,
      drilldown: t("costBudget.overviewPanel.drilldownExtra"),
    },
  ];
}

function handleTodoNavigate(
  todo: CostBudgetTodo,
  navigate: (target: CostBudgetV2NavigateTarget) => void,
): void {
  if (todo.kind === "pending_payment") {
    setPendingOrderId(todo.orderId ?? null);
  }
  navigate(todo.navigate);
}

function renderOverviewTodosCard(
  navigate: (target: CostBudgetV2NavigateTarget) => void,
): TemplateResult {
  const ops = getOperationsStoreState();
  const subscription = getSubscriptionStoreState().data;
  const todos = buildCostBudgetTodos({
    subscription,
    allocation: ops.allocation,
    seats: ops.seats,
    budget: ops.budget,
    forecast: ops.forecast,
    dashboard: ops.dashboard,
  });
  if (todos.length === 0) {
    return html``;
  }
  return html`
    <section
      class="enterprise-card cost-budget-v2-overview-panel cost-budget-v2-overview-panel--todos"
      data-testid="cost-budget-v2-overview-todos"
    >
      ${renderOverviewPanelHeader(t("costBudget.todos.title"))}
      <ul class="cost-budget-v2-overview-todo-list">
        ${todos.map(
          (todo) => html`
            <li class="cost-budget-v2-overview-todo-list__item">
              <span class="cost-budget-v2-overview-todo-list__text"
                >${t(`costBudget.todos.${todo.messageKey}`)}</span
              >
              <button
                type="button"
                class="btn btn--sm btn--primary"
                data-testid="cost-budget-todo-${todo.kind}"
                @click=${() => handleTodoNavigate(todo, navigate)}
              >
                ${t("costBudget.todos.action")}
              </button>
            </li>
          `,
        )}
      </ul>
    </section>
  `;
}

function renderSubscribedOverview(
  options: OverviewPageOptions,
  d: DashboardResponse,
): TemplateResult {
  const ops = getOperationsStoreState();
  const level = d.budgetStatus?.level ?? "ok";
  const planContext = buildOverviewPlanContext(ops);
  const usageRows = planContext ? buildOverviewUsageRows(planContext) : [];

  return html`
    <section class="cost-budget-v2-overview-hero" data-testid="cost-budget-v2-overview-hero">
      ${renderEnterpriseKpiGrid(buildHeroOverviewKpis(d, options.basePath, options.tenantId))}
    </section>

    <div class="cost-budget-v2-overview-columns">
      <section
        class="enterprise-card cost-budget-v2-overview-panel"
        data-testid="cost-budget-v2-overview-cost"
      >
        ${renderOverviewPanelHeader(
          t("costBudget.v2.overviewSnapshot.costBreakdownTitle"),
          t("costBudget.v2.overviewSnapshot.costBreakdownHint"),
        )}
        ${renderEnterpriseKpiGrid(buildCostBreakdownKpis(d, options.basePath, options.tenantId), {
          variant: "compact",
        })}
      </section>

      ${
        planContext
          ? html`
              <section
                class="enterprise-card cost-budget-v2-overview-panel"
                data-testid="cost-budget-v2-overview-plan-card"
              >
                ${renderOverviewPanelHeader(t("costBudget.v2.overviewSnapshot.planTitle"))}
                ${renderOverviewPlanPanel(planContext, { onNavigate: options.onNavigate })}
              </section>
            `
          : nothing
      }
    </div>

    ${renderOverviewBudgetForecastPanel({
      dashboard: d,
      forecast: ops.forecast,
      budget: ops.budget,
      usageRows,
    })}

    ${renderKnowledgeGovernanceCreditsPanel(d)}

    ${renderOverviewTodosCard(options.onNavigate)}

    ${renderDashboardGovernancePanel(d, {
      tenantId: options.tenantId,
      basePath: options.basePath,
      onDecideApproval: options.client?.connected
        ? async (approvalId, decision) => {
            const gateway = createEnterpriseDataCapabilityGateway(options.client!);
            const result = await gateway.decideGovernanceApproval(options.tenantId, {
              approvalId,
              decision,
            });
            if (!result.ok) {
              return { ok: false, error: result.error };
            }
            return { ok: true };
          }
        : undefined,
      onApprovalDecided: options.onRefresh,
    })}

    ${
      level !== "ok"
        ? html`
            <div class="callout warning cost-budget-v2-overview-alert" data-testid="cost-budget-v2-overview-alert">
              ${renderIcon("alertTriangle", "btn__icon")}
              ${level === "exceeded" ? "已超出月度预算上限" : "已达到预算提醒阈值"}
            </div>
          `
        : nothing
    }
    ${
      d.missingPriceKeys && d.missingPriceKeys.length > 0
        ? html`
            <div class="callout warning cost-budget-v2-overview-alert">
              存在缺失价格的计量项：${d.missingPriceKeys.join(", ")}
            </div>
          `
        : nothing
    }
  `;
}

export function renderOverviewPage(options: OverviewPageOptions): TemplateResult {
  const ops = getOperationsStoreState();

  if (!options.client) {
    return html`
      <div class="cost-budget-v2-overview-page" data-testid="cost-budget-v2-overview-page">
        <div class="enterprise-empty">${t("costBudget.v2.gatewayDisconnected")}</div>
      </div>
    `;
  }

  if (!isCostBudgetGatewayReady(options.client)) {
    return html`
      <div class="cost-budget-v2-overview-page" data-testid="cost-budget-v2-overview-page">
        <div class="enterprise-empty muted" data-testid="cost-budget-v2-gateway-reconnect-hint">
          ${t("costBudget.v2.gatewayReconnecting")}
        </div>
      </div>
    `;
  }

  // Idle with ready gateway: kick a load (shell ensure may have been skipped on first paint).
  if (ops.status === "idle" && !ops.dashboard && !ops.loadAttempted) {
    ensureOperationsStore(options.client, options.onRefresh, { tenantId: options.tenantId });
  }

  if (
    (ops.status === "loading" || ops.loading || ops.status === "idle") &&
    !ops.dashboard &&
    ops.status !== "error"
  ) {
    return html`
      <div class="cost-budget-v2-overview-page" data-testid="cost-budget-v2-overview-page">
        <div class="enterprise-empty" data-testid="cost-budget-v2-overview-loading">${t("costBudget.v2.loadingOverview")}</div>
      </div>
    `;
  }

  if ((ops.status === "error" || (ops.error && !ops.dashboard)) && !ops.dashboard) {
    return html`
      <div class="cost-budget-v2-overview-page" data-testid="cost-budget-v2-overview-page">
        <div class="callout warning" data-testid="cost-budget-v2-overview-error">
          <p>${ops.error ?? t("costBudget.v2.overviewNoData")}</p>
          ${
            ops.dashboardError
              ? html`<p class="muted" data-testid="overview-dashboard-error">billing.dashboard：${ops.dashboardError}</p>`
              : nothing
          }
          <div class="cost-budget-v2-error-actions">
            <button
              type="button"
              class="btn btn--sm"
              data-testid="cost-budget-v2-overview-reload"
              @click=${() => {
                if (!options.client) {
                  return;
                }
                ensureOperationsStore(options.client, options.onRefresh, {
                  force: true,
                  tenantId: options.tenantId,
                });
              }}
            >
              重新加载
            </button>
            <button
              type="button"
              class="btn btn--sm btn--ghost"
              data-testid="cost-budget-v2-overview-goto-plans"
              @click=${() =>
                options.onNavigate({ route: "plan-orders", planOrdersPanel: "catalog" })}
            >
              查看套餐
            </button>
          </div>
        </div>
      </div>
    `;
  }

  const d = ops.dashboard;
  if (!d) {
    return html`
      <div class="cost-budget-v2-overview-page" data-testid="cost-budget-v2-overview-page">
        <div class="enterprise-empty" data-testid="overview-no-dashboard">
          ${
            ops.loadPartialFailure || ops.status === "partial"
              ? t("costBudget.v2.overviewPartialFailure")
              : t("costBudget.v2.overviewNoData")
          }
          <div class="cost-budget-v2-error-actions">
            <button
              type="button"
              class="btn btn--sm"
              data-testid="cost-budget-v2-overview-reload"
              @click=${() => {
                if (!options.client) {
                  return;
                }
                ensureOperationsStore(options.client, options.onRefresh, {
                  force: true,
                  tenantId: options.tenantId,
                });
              }}
            >
              重新加载
            </button>
          </div>
        </div>
      </div>
    `;
  }

  if (!d.subscribed) {
    return html`
      <div class="cost-budget-v2-overview-page" data-testid="cost-budget-v2-overview-page">
        ${renderCostBudgetOverviewSubscribeHero({
          onStartRecommend: () =>
            options.onNavigate({ route: "plan-orders", planOrdersPanel: "catalog" }),
          onBrowsePlans: () =>
            options.onNavigate({ route: "plan-orders", planOrdersPanel: "catalog" }),
        })}
        ${renderOverviewTodosCard(options.onNavigate)}
      </div>
    `;
  }

  return html`
    <div class="cost-budget-v2-overview-page" data-testid="cost-budget-v2-overview-page">
      ${renderSubscribedOverview(options, d)}
    </div>
  `;
}
