import { html } from "lit";
import { formatCost } from "../../../../views/usage-metrics.ts";
import { requestPlatformSurfaceRerender } from "../../shared/surface.ts";
import type {
  ModelUsageAnalyticsVM,
  ModelUsageMetric,
  PlanUsageMetric,
  PlatformModelsTabContext,
  TaskUsageMetric,
} from "../view-model.ts";

type UsageAnalyticsNavigateTab =
  | "overview"
  | "modelAssets"
  | "taskPlans"
  | "smartRouting"
  | "governance";

type UsageAnalyticsView = "byModel" | "byTask" | "byPlan";

type UsageAnalyticsFilterState = {
  search: string;
  view: UsageAnalyticsView;
  providerId: string;
  budgetStatus: "" | PlanUsageMetric["budgetStatus"];
  sortField: ModelUsageAnalyticsVM["defaultSort"]["field"];
  sortDirection: ModelUsageAnalyticsVM["defaultSort"]["direction"];
};

const DEFAULT_USAGE_FILTER_STATE: UsageAnalyticsFilterState = {
  search: "",
  view: "byPlan",
  providerId: "",
  budgetStatus: "",
  sortField: "calls7d",
  sortDirection: "desc",
};

let usageAnalyticsFilterState: UsageAnalyticsFilterState = { ...DEFAULT_USAGE_FILTER_STATE };
let lastUsageAnalyticsContextKey = "";

function requestRerender() {
  requestPlatformSurfaceRerender();
}

function ensureUsageDefaults(vm: ModelUsageAnalyticsVM) {
  if (
    usageAnalyticsFilterState.view === DEFAULT_USAGE_FILTER_STATE.view &&
    usageAnalyticsFilterState.sortField === DEFAULT_USAGE_FILTER_STATE.sortField &&
    usageAnalyticsFilterState.sortDirection === DEFAULT_USAGE_FILTER_STATE.sortDirection
  ) {
    usageAnalyticsFilterState = {
      ...usageAnalyticsFilterState,
      view: vm.defaultView,
      sortField: vm.defaultSort.field,
      sortDirection: vm.defaultSort.direction,
    };
  }
}

function syncUsageAnalyticsContext(context?: PlatformModelsTabContext) {
  const contextKey = JSON.stringify(context ?? {});
  if (contextKey === lastUsageAnalyticsContextKey) {
    return;
  }
  lastUsageAnalyticsContextKey = contextKey;
  if (context?.modelId) {
    usageAnalyticsFilterState = {
      ...usageAnalyticsFilterState,
      view: "byModel",
      search: context.modelId,
    };
    return;
  }
  if (context?.planId) {
    usageAnalyticsFilterState = {
      ...usageAnalyticsFilterState,
      view: "byPlan",
      search: context.planId,
    };
    return;
  }
  if (context?.taskProfileId) {
    usageAnalyticsFilterState = {
      ...usageAnalyticsFilterState,
      view: "byTask",
      search: context.taskProfileId,
    };
  }
}

function updateUsageFilters(next: Partial<UsageAnalyticsFilterState>) {
  usageAnalyticsFilterState = {
    ...usageAnalyticsFilterState,
    ...next,
  };
  requestRerender();
}

function resetUsageFilters(vm: ModelUsageAnalyticsVM) {
  usageAnalyticsFilterState = {
    ...DEFAULT_USAGE_FILTER_STATE,
    view: vm.defaultView,
    sortField: vm.defaultSort.field,
    sortDirection: vm.defaultSort.direction,
  };
  requestRerender();
}

function formatObservedCost(value: number, hasTotals: boolean): string {
  if (!Number.isFinite(value) || value < 0) {
    return "—";
  }
  if (hasTotals && value > 0 && value < 0.005) {
    return `$${value.toFixed(4)}`;
  }
  if (hasTotals && value === 0) {
    return "—";
  }
  return formatCost(value);
}

function formatObservedLatency(value: number | null | undefined, hasTotals: boolean): string {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return hasTotals ? "—" : "未接入";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} s`;
  }
  return `${Math.round(value)} ms`;
}

function trendLabel(series?: number[]) {
  if (!series || series.length < 2) {
    return "—";
  }
  const midpoint = Math.floor(series.length / 2);
  const previous = series.slice(0, midpoint).reduce((sum, value) => sum + value, 0) / midpoint;
  const current =
    series.slice(midpoint).reduce((sum, value) => sum + value, 0) / (series.length - midpoint);
  if (!Number.isFinite(previous) || previous === 0) {
    return "—";
  }
  const delta = Number((((current - previous) / previous) * 100).toFixed(1));
  if (Math.abs(delta) < 0.5) {
    return "持平";
  }
  return `${delta > 0 ? "↑" : "↓"} ${Math.abs(delta)}%`;
}

function flagsLabel(flags: Array<string> | undefined) {
  return flags && flags.length > 0 ? flags.join(" · ") : "正常";
}

function compareModelMetrics(
  left: ModelUsageMetric,
  right: ModelUsageMetric,
  field: ModelUsageAnalyticsVM["defaultSort"]["field"],
) {
  switch (field) {
    case "cost7d":
      return left.cost7d - right.cost7d;
    case "avgCostPerCall":
      return left.avgCostPerCall - right.avgCostPerCall;
    case "successRate":
      return (
        (left.taskSuccessRate ?? left.successRate) - (right.taskSuccessRate ?? right.successRate)
      );
    case "avgLatencyMs":
      return left.avgLatencyMs - right.avgLatencyMs;
    case "fallbackRate":
      return left.fallbackRate - right.fallbackRate;
    default:
      return left.calls7d - right.calls7d;
  }
}

function compareTaskMetrics(
  left: TaskUsageMetric,
  right: TaskUsageMetric,
  field: ModelUsageAnalyticsVM["defaultSort"]["field"],
) {
  switch (field) {
    case "cost7d":
      return left.cost7d - right.cost7d;
    case "successRate":
      return (left.taskSuccessRate ?? 0) - (right.taskSuccessRate ?? 0);
    case "manualOverrideRate":
      return (left.manualOverrideRate ?? -1) - (right.manualOverrideRate ?? -1);
    case "fallbackRate":
      return (
        (left.hardFailureRate ?? left.failureRate) - (right.hardFailureRate ?? right.failureRate)
      );
    default:
      return left.calls7d - right.calls7d;
  }
}

function comparePlanMetrics(
  left: PlanUsageMetric,
  right: PlanUsageMetric,
  field: ModelUsageAnalyticsVM["defaultSort"]["field"],
) {
  switch (field) {
    case "cost7d":
      return left.cost7d - right.cost7d;
    case "avgCostPerCall":
      return (left.avgCostPerCall ?? -1) - (right.avgCostPerCall ?? -1);
    case "manualOverrideRate":
      return (left.manualOverrideRate ?? -1) - (right.manualOverrideRate ?? -1);
    case "fallbackRate":
      return (left.fallbackRate ?? -1) - (right.fallbackRate ?? -1);
    default:
      return left.calls7d - right.calls7d;
  }
}

function renderSummary(vm: ModelUsageAnalyticsVM) {
  const hasTotals = vm.summary.totalCalls7d > 0 || vm.summary.totalCost7d > 0;
  const absent = hasTotals ? "—" : "未接入";
  const cards = [
    {
      label: "7 日总调用",
      value: String(vm.summary.totalCalls7d),
      helper: trendLabel(vm.summary.trends?.calls7d),
      onClick: () =>
        updateUsageFilters({ view: "byModel", sortField: "calls7d", sortDirection: "desc" }),
    },
    {
      label: "7 日总成本",
      value: formatObservedCost(vm.summary.totalCost7d, false),
      helper: trendLabel(vm.summary.trends?.cost7d),
      onClick: () =>
        updateUsageFilters({ view: "byModel", sortField: "cost7d", sortDirection: "desc" }),
    },
    {
      label: "平均单次成本",
      value: formatObservedCost(vm.summary.avgCostPerRequest, hasTotals),
      helper: vm.summary.highestCostModelId ?? absent,
      onClick: () =>
        updateUsageFilters({ view: "byModel", sortField: "avgCostPerCall", sortDirection: "desc" }),
    },
    {
      label: "平均任务成功率",
      value: vm.summary.avgTaskSuccessRate != null ? `${vm.summary.avgTaskSuccessRate}%` : absent,
      helper: trendLabel(vm.summary.trends?.success7d),
      onClick: () =>
        updateUsageFilters({ view: "byModel", sortField: "successRate", sortDirection: "asc" }),
    },
    {
      label: "平均延迟",
      value: formatObservedLatency(vm.summary.avgLatencyMs, hasTotals),
      helper: "按模型",
      onClick: () =>
        updateUsageFilters({ view: "byModel", sortField: "avgLatencyMs", sortDirection: "desc" }),
    },
    {
      label: "平均回退率",
      value: vm.summary.avgFallbackRate != null ? `${vm.summary.avgFallbackRate}%` : absent,
      helper: trendLabel(vm.summary.trends?.fallback7d),
      onClick: () =>
        updateUsageFilters({ view: "byModel", sortField: "fallbackRate", sortDirection: "desc" }),
    },
    {
      label: "平均人工改配率",
      value:
        vm.summary.avgManualOverrideRate != null ? `${vm.summary.avgManualOverrideRate}%` : absent,
      helper: trendLabel(vm.summary.trends?.manualOverride7d),
      onClick: () =>
        updateUsageFilters({
          view: "byTask",
          sortField: "manualOverrideRate",
          sortDirection: "desc",
        }),
    },
    {
      label: "超预算方案数",
      value: String(vm.summary.overBudgetPlanCount),
      helper: "按方案",
      onClick: () => updateUsageFilters({ view: "byPlan", budgetStatus: "over_budget" }),
    },
    {
      label: "高成本异常模型",
      value: String(vm.summary.highCostModelCount),
      helper: "异常入口",
      onClick: () =>
        updateUsageFilters({ view: "byModel", sortField: "cost7d", sortDirection: "desc" }),
    },
    {
      label: "高失败任务",
      value: String(vm.summary.highFailureTaskCount),
      helper: vm.summary.highestCostTaskProfileId ?? "异常入口",
      onClick: () =>
        updateUsageFilters({ view: "byTask", sortField: "successRate", sortDirection: "asc" }),
    },
    {
      label: "高回退方案",
      value: String(vm.summary.highFallbackPlanCount),
      helper: "异常入口",
      onClick: () =>
        updateUsageFilters({ view: "byPlan", sortField: "fallbackRate", sortDirection: "desc" }),
    },
  ];
  return html`
    <div class="stat-grid stat-grid--compact card-follow">
      ${cards.map(
        (card) => html`
          <button class="stat stat--compact" type="button" @click=${card.onClick}>
            <div class="stat-label">${card.label}</div>
            <div class="stat-value">${card.value}</div>
            <div class="stat-meta">${card.helper}</div>
          </button>
        `,
      )}
    </div>
  `;
}

function renderFilterBar(vm: ModelUsageAnalyticsVM, resultCount: number) {
  return html`
    <section class="card card-follow">
      <div class="row row--split row--top">
        <div>
          <div class="card-title">筛选与视图</div>
        </div>
        <div class="row row--tight row--wrap">
          <span class="chip">
            ${
              resultCount === 0 && (vm.summary.totalCalls7d > 0 || vm.summary.totalCost7d > 0)
                ? "当前视图无明细"
                : `当前结果 ${resultCount}`
            }
          </span>
          <button class="btn btn--sm" type="button" @click=${() => resetUsageFilters(vm)}>
            清空筛选
          </button>
        </div>
      </div>
      <div class="row row--tight card-follow row--wrap">
        ${(["byPlan", "byModel", "byTask"] as UsageAnalyticsView[]).map(
          (view) => html`
            <button
              class="btn btn--sm ${usageAnalyticsFilterState.view === view ? "btn--primary" : ""}"
              type="button"
              @click=${() => updateUsageFilters({ view })}
            >
              ${view === "byPlan" ? "按方案" : view === "byModel" ? "按模型" : "按任务"}
            </button>
          `,
        )}
      </div>
      <div class="grid grid-cols-3 card-follow">
        <label class="field">
          <span>搜索</span>
          <input
            .value=${usageAnalyticsFilterState.search}
            placeholder="modelId / taskProfileId / planId"
            @input=${(event: Event) =>
              updateUsageFilters({
                search:
                  event.currentTarget instanceof HTMLInputElement ? event.currentTarget.value : "",
              })}
          />
        </label>
        <label class="field">
          <span>Provider</span>
          <select
            .value=${usageAnalyticsFilterState.providerId}
            @change=${(event: Event) =>
              updateUsageFilters({
                providerId:
                  event.currentTarget instanceof HTMLSelectElement ? event.currentTarget.value : "",
              })}
          >
            <option value="">全部</option>
            ${vm.filters.providerIds.map(
              (providerId) => html`<option value=${providerId}>${providerId}</option>`,
            )}
          </select>
        </label>
        <label class="field">
          <span>预算状态</span>
          <select
            .value=${usageAnalyticsFilterState.budgetStatus}
            @change=${(event: Event) =>
              updateUsageFilters({
                budgetStatus:
                  event.currentTarget instanceof HTMLSelectElement
                    ? (event.currentTarget.value as UsageAnalyticsFilterState["budgetStatus"])
                    : "",
              })}
          >
            <option value="">全部</option>
            ${vm.filters.budgetStatuses.map(
              (budgetStatus) => html`<option value=${budgetStatus}>${budgetStatus}</option>`,
            )}
          </select>
        </label>
      </div>
    </section>
  `;
}

function renderByModelTable(
  metrics: ModelUsageMetric[],
  onNavigateTab: (tab: UsageAnalyticsNavigateTab, context?: PlatformModelsTabContext) => void,
) {
  return html`
    <section class="card card-follow">
      <div class="card-title">By Model</div>
      <div class="enterprise-data-table-wrap card-follow">
        <table class="enterprise-data-table">
          <thead>
            <tr>
              <th>模型</th>
              <th>7 日调用</th>
              <th>7 日成本</th>
              <th>平均单次成本</th>
              <th>执行 / 任务 / 接受</th>
              <th>平均延迟</th>
              <th>fallback</th>
              <th>异常</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${metrics.map(
              (metric) => html`
                <tr>
                  <td>
                    <div class="enterprise-data-table__strong">${metric.modelId}</div>
                    <div class="enterprise-data-table__sub">
                      ${metric.providerName ?? metric.providerId ?? "-"}
                    </div>
                  </td>
                  <td>
                    ${metric.calls7d}
                    <div class="enterprise-data-table__sub">
                      ${trendLabel(metric.trends?.calls7d)}
                    </div>
                  </td>
                  <td>
                    ${formatCost(metric.cost7d)}
                    <div class="enterprise-data-table__sub">
                      ${trendLabel(metric.trends?.cost7d)}
                    </div>
                  </td>
                  <td>${formatObservedCost(metric.avgCostPerCall, metric.calls7d > 0 || metric.cost7d > 0)}</td>
                  <td>
                    <div>
                      ${metric.executionSuccessRate != null ? `${metric.executionSuccessRate}%` : "未接入"}
                    </div>
                    <div class="enterprise-data-table__sub">
                      ${metric.taskSuccessRate != null ? `${metric.taskSuccessRate}%` : "-"} /
                      ${metric.userAcceptedRate != null ? `${metric.userAcceptedRate}%` : "-"}
                    </div>
                  </td>
                  <td>
                    ${formatObservedLatency(metric.avgLatencyMs, metric.calls7d > 0)}
                    <div class="enterprise-data-table__sub">
                      ${trendLabel(metric.trends?.latency7d)}
                    </div>
                  </td>
                  <td>
                    <div>${metric.fallbackRate}%</div>
                    <div class="enterprise-data-table__sub">
                      恢复
                      ${metric.fallbackRecoveredRate != null ? `${metric.fallbackRecoveredRate}%` : "未接入"}
                    </div>
                  </td>
                  <td>${flagsLabel(metric.flags)}</td>
                  <td>
                    <div class="row row--tight row--wrap">
                      <button
                        class="btn btn--sm"
                        type="button"
                        @click=${() => onNavigateTab("modelAssets", { modelId: metric.modelId })}
                      >
                        查看模型资产
                      </button>
                      <button
                        class="btn btn--sm"
                        type="button"
                        @click=${() => onNavigateTab("governance", { modelId: metric.modelId })}
                      >
                        查看治理告警
                      </button>
                    </div>
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderByTaskTable(
  metrics: TaskUsageMetric[],
  onNavigateTab: (tab: UsageAnalyticsNavigateTab, context?: PlatformModelsTabContext) => void,
) {
  return html`
    <section class="card card-follow">
      <div class="card-title">By Task</div>
      <div class="enterprise-data-table-wrap card-follow">
        <table class="enterprise-data-table">
          <thead>
            <tr>
              <th>任务画像</th>
              <th>7 日调用</th>
              <th>7 日成本</th>
              <th>模型分布</th>
              <th>失败率</th>
              <th>人工改配率</th>
              <th>异常</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${metrics.map(
              (metric) => html`
                <tr>
                  <td>
                    <div class="enterprise-data-table__strong">
                      ${metric.name ?? metric.taskProfileId}
                    </div>
                    <div class="enterprise-data-table__sub">${metric.taskProfileId}</div>
                  </td>
                  <td>
                    ${metric.calls7d}
                    <div class="enterprise-data-table__sub">
                      ${trendLabel(metric.trends?.calls7d)}
                    </div>
                  </td>
                  <td>
                    ${formatCost(metric.cost7d)}
                    <div class="enterprise-data-table__sub">
                      ${trendLabel(metric.trends?.cost7d)}
                    </div>
                  </td>
                  <td>
                    ${
                      metric.modelDistribution?.length
                        ? metric.modelDistribution
                            .map((item) => `${item.modelId} ${item.ratio}%`)
                            .join(" · ")
                        : metric.topModelIds.join(", ") || "未接入"
                    }
                  </td>
                  <td>
                    <div>${metric.hardFailureRate ?? metric.failureRate}%</div>
                    <div class="enterprise-data-table__sub">
                      任务成功
                      ${metric.taskSuccessRate != null ? `${metric.taskSuccessRate}%` : "未接入"}
                    </div>
                  </td>
                  <td>
                    ${metric.manualOverrideRate != null ? `${metric.manualOverrideRate}%` : "未接入"}
                    <div class="enterprise-data-table__sub">
                      ${trendLabel(metric.trends?.manualOverride7d)}
                    </div>
                  </td>
                  <td>${flagsLabel(metric.flags)}</td>
                  <td>
                    <div class="row row--tight row--wrap">
                      <button
                        class="btn btn--sm"
                        type="button"
                        @click=${() => onNavigateTab("taskPlans", { taskProfileId: metric.taskProfileId })}
                      >
                        查看任务方案
                      </button>
                      <button
                        class="btn btn--sm"
                        type="button"
                        @click=${() => onNavigateTab("smartRouting", { taskProfileId: metric.taskProfileId })}
                      >
                        查看智能路由
                      </button>
                    </div>
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderByPlanTable(
  metrics: PlanUsageMetric[],
  onNavigateTab: (tab: UsageAnalyticsNavigateTab, context?: PlatformModelsTabContext) => void,
) {
  return html`
    <section class="card card-follow">
      <div class="card-title">By Plan</div>
      <div class="enterprise-data-table-wrap card-follow">
        <table class="enterprise-data-table">
          <thead>
            <tr>
              <th>方案</th>
              <th>7 日调用</th>
              <th>7 日成本</th>
              <th>预算</th>
              <th>模型分布</th>
              <th>回退 / 改配</th>
              <th>异常</th>
              <th>推荐动作</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${metrics.map(
              (metric) => html`
                <tr>
                  <td>
                    <div class="enterprise-data-table__strong">${metric.name ?? metric.planId}</div>
                    <div class="enterprise-data-table__sub">${metric.planId}</div>
                  </td>
                  <td>
                    ${metric.calls7d}
                    <div class="enterprise-data-table__sub">
                      ${trendLabel(metric.trends?.calls7d)}
                    </div>
                  </td>
                  <td>
                    ${formatCost(metric.cost7d)}
                    <div class="enterprise-data-table__sub">
                      ${trendLabel(metric.trends?.cost7d)}
                    </div>
                  </td>
                  <td>
                    <div>${metric.budgetStatus}</div>
                    <div class="enterprise-data-table__sub">
                      ${metric.budget?.actualCostPerCall != null ? formatCost(metric.budget.actualCostPerCall) : "-"}
                      /
                      ${metric.budget?.targetCostPerCall != null ? formatCost(metric.budget.targetCostPerCall) : "-"}
                      ${metric.budget?.source ? ` · ${metric.budget.source}` : ""}
                    </div>
                  </td>
                  <td>
                    ${
                      metric.modelDistribution?.length
                        ? metric.modelDistribution
                            .map((item) => `${item.modelId} ${item.ratio}%`)
                            .join(" · ")
                        : "未接入"
                    }
                  </td>
                  <td>
                    <div>
                      ${metric.fallbackRate != null ? `${metric.fallbackRate}% fallback` : "未接入"}
                    </div>
                    <div class="enterprise-data-table__sub">
                      ${metric.manualOverrideRate != null ? `${metric.manualOverrideRate}% override` : "未接入"}
                    </div>
                  </td>
                  <td>${flagsLabel(metric.flags)}</td>
                  <td>${metric.recommendedAction ?? "-"}</td>
                  <td>
                    <div class="row row--tight row--wrap">
                      <button
                        class="btn btn--sm"
                        type="button"
                        @click=${() =>
                          onNavigateTab("taskPlans", {
                            planId: metric.planId,
                            ...(metric.taskProfileId
                              ? { taskProfileId: metric.taskProfileId }
                              : {}),
                          })}
                      >
                        查看任务方案
                      </button>
                      <button
                        class="btn btn--sm"
                        type="button"
                        @click=${() =>
                          onNavigateTab("smartRouting", {
                            ...(metric.planId ? { planId: metric.planId } : {}),
                            ...(metric.taskProfileId
                              ? { taskProfileId: metric.taskProfileId }
                              : {}),
                          })}
                      >
                        查看智能路由
                      </button>
                    </div>
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

export type ModelUsageAnalyticsSectionProps = {
  vm: ModelUsageAnalyticsVM;
  onNavigateTab: (tab: UsageAnalyticsNavigateTab, context?: PlatformModelsTabContext) => void;
  context?: PlatformModelsTabContext;
};

export function renderModelUsageAnalyticsSection(props: ModelUsageAnalyticsSectionProps) {
  const { vm, onNavigateTab, context } = props;
  ensureUsageDefaults(vm);
  syncUsageAnalyticsContext(context);

  if (vm.emptyState) {
    return html`
      <section class="card">
        <div class="card-title">${vm.emptyState.title}</div>
        <div class="card-sub">${vm.emptyState.description}</div>
        <div class="row row--tight card-follow">
          <button
            class="btn btn--primary"
            type="button"
            @click=${() => onNavigateTab("modelAssets")}
          >
            ${vm.emptyState.primaryActionLabel ?? "查看模型资产"}
          </button>
        </div>
      </section>
    `;
  }

  const search = usageAnalyticsFilterState.search.trim().toLowerCase();
  const filteredByModel = vm.byModel
    .filter((metric) => {
      if (
        usageAnalyticsFilterState.providerId &&
        metric.providerId !== usageAnalyticsFilterState.providerId
      ) {
        return false;
      }
      if (!search) {
        return true;
      }
      return [metric.modelId, metric.providerId ?? "", metric.providerName ?? ""]
        .map((value) => value.toLowerCase())
        .some((value) => value.includes(search));
    })
    .toSorted((left, right) => {
      const delta = compareModelMetrics(left, right, usageAnalyticsFilterState.sortField);
      return usageAnalyticsFilterState.sortDirection === "asc" ? delta : -delta;
    });
  const filteredByTask = vm.byTask
    .filter((metric) => {
      if (!search) {
        return true;
      }
      return [metric.taskProfileId, metric.name ?? ""]
        .map((value) => value.toLowerCase())
        .some((value) => value.includes(search));
    })
    .toSorted((left, right) => {
      const delta = compareTaskMetrics(left, right, usageAnalyticsFilterState.sortField);
      return usageAnalyticsFilterState.sortDirection === "asc" ? delta : -delta;
    });
  const filteredByPlan = vm.byPlan
    .filter((metric) => {
      if (
        usageAnalyticsFilterState.budgetStatus &&
        metric.budgetStatus !== usageAnalyticsFilterState.budgetStatus
      ) {
        return false;
      }
      if (!search) {
        return true;
      }
      return [metric.planId, metric.name ?? "", metric.taskProfileId ?? ""]
        .map((value) => value.toLowerCase())
        .some((value) => value.includes(search));
    })
    .toSorted((left, right) => {
      const delta = comparePlanMetrics(left, right, usageAnalyticsFilterState.sortField);
      return usageAnalyticsFilterState.sortDirection === "asc" ? delta : -delta;
    });

  const resultCount =
    usageAnalyticsFilterState.view === "byModel"
      ? filteredByModel.length
      : usageAnalyticsFilterState.view === "byTask"
        ? filteredByTask.length
        : filteredByPlan.length;

  return html`
    <section class="card">
      <div class="card-title">使用观测中心</div>
      <div class="row row--tight card-follow--sm row--wrap">
        <span class="chip">${vm.timeRange.label}</span>
        ${vm.summary.highestCostModelId ? html`<span class="chip">最高成本模型 ${vm.summary.highestCostModelId}</span>` : ""}
        ${vm.summary.highestCostTaskProfileId ? html`<span class="chip">最高成本任务 ${vm.summary.highestCostTaskProfileId}</span>` : ""}
      </div>
      ${renderSummary(vm)}
    </section>
    ${renderFilterBar(vm, resultCount)}
    ${
      usageAnalyticsFilterState.view === "byModel"
        ? filteredByModel.length > 0
          ? renderByModelTable(filteredByModel, onNavigateTab)
          : html`
              <section class="card card-follow">
                <div class="callout">暂无匹配的模型使用数据。</div>
              </section>
            `
        : usageAnalyticsFilterState.view === "byTask"
          ? filteredByTask.length > 0
            ? renderByTaskTable(filteredByTask, onNavigateTab)
            : html`
                <section class="card card-follow">
                  <div class="callout">
                  ${
                    vm.summary.totalCalls7d > 0
                      ? "当前视图没有任务明细。可切换到「按模型」查看已有调用。"
                      : "任务使用数据未接入或当前筛选无结果。"
                  }
                </div>
                </section>
              `
          : filteredByPlan.length > 0
            ? renderByPlanTable(filteredByPlan, onNavigateTab)
            : html`
                <section class="card card-follow">
                  <div class="callout">
                  ${
                    vm.summary.totalCalls7d > 0
                      ? "当前视图没有方案明细。可切换到「按模型」查看已有调用。"
                      : "方案使用数据未接入或当前筛选无结果。"
                  }
                </div>
                </section>
              `
    }
  `;
}
