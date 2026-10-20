import { html } from "lit";
import { requestPlatformSurfaceRerender } from "../../shared/surface.ts";
import type { PlatformModelsActions } from "../actions.ts";
import type {
  GovernanceInsight,
  GovernanceRisk,
  LegacyPlatformModelsVM,
  ModelGovernanceVM,
  ModelIssueAction,
  PlatformModelsTabContext,
} from "../view-model.ts";
import { renderModelIssueSection } from "./ModelIssueSection.ts";

type GovernanceNavigateTab =
  | "overview"
  | "modelAssets"
  | "taskPlans"
  | "smartRouting"
  | "usageAnalytics"
  | "governance";

type GovernanceFilterState = {
  search: string;
  severity: "" | "critical" | "warning" | "info";
  issueType: string;
  quickBucket: "" | "critical" | "high_cost" | "routing_failure" | "high_override";
  selectedIssueId: string | null;
};

const DEFAULT_GOVERNANCE_FILTER_STATE: GovernanceFilterState = {
  search: "",
  severity: "",
  issueType: "",
  quickBucket: "",
  selectedIssueId: null,
};

let governanceFilterState: GovernanceFilterState = { ...DEFAULT_GOVERNANCE_FILTER_STATE };
let lastGovernanceContextKey = "";
const ignoredIssueIds = new Set<string>();
const resolvedIssueIds = new Set<string>();

function requestRerender() {
  requestPlatformSurfaceRerender();
}

function syncGovernanceContext(context?: PlatformModelsTabContext) {
  const contextKey = JSON.stringify(context ?? {});
  if (contextKey === lastGovernanceContextKey) {
    return;
  }
  lastGovernanceContextKey = contextKey;
  const search =
    context?.modelId ?? context?.planId ?? context?.taskProfileId ?? context?.policyId ?? "";
  if (!search) {
    return;
  }
  governanceFilterState = {
    ...governanceFilterState,
    search,
  };
}

function updateGovernanceFilters(next: Partial<GovernanceFilterState>) {
  governanceFilterState = {
    ...governanceFilterState,
    ...next,
  };
  requestRerender();
}

function resetGovernanceFilters() {
  governanceFilterState = { ...DEFAULT_GOVERNANCE_FILTER_STATE };
  requestRerender();
}

function severityLabel(value: "critical" | "warning" | "info") {
  return value === "critical" ? "Critical" : value === "warning" ? "Warning" : "Info";
}

function issueContext(issue: ModelGovernanceVM["issues"][number]): PlatformModelsTabContext {
  return {
    ...(issue.context.modelId ? { modelId: issue.context.modelId } : {}),
    ...(issue.context.modelId ? { sourceModelId: issue.context.modelId } : {}),
    ...(issue.context.planId ? { planId: issue.context.planId } : {}),
    ...(issue.context.taskProfileId ? { taskProfileId: issue.context.taskProfileId } : {}),
    ...(issue.context.policyId ? { policyId: issue.context.policyId } : {}),
  };
}

function issueActionTarget(action: ModelIssueAction): GovernanceNavigateTab | null {
  switch (action.type) {
    case "go_to_model_asset":
    case "replace_model":
      return "modelAssets";
    case "go_to_task_plan":
      return "taskPlans";
    case "go_to_routing":
    case "add_fallback":
    case "adjust_policy":
      return "smartRouting";
    case "go_to_usage":
      return "usageAnalytics";
    default:
      return null;
  }
}

function issueBucket(issue: ModelGovernanceVM["issues"][number]) {
  if (issue.severity === "critical") {
    return "critical";
  }
  if (issue.type === "cost_spike" || issue.type === "high_cost_low_usage") {
    return "high_cost";
  }
  if (issue.type === "missing_fallback" || issue.type === "task_without_candidate") {
    return "routing_failure";
  }
  if (issue.type === "manual_override_high") {
    return "high_override";
  }
  return "";
}

function payloadStr(payload: ModelIssueAction["payload"], key: string): string | undefined {
  const value = (payload as Record<string, string | undefined> | undefined)?.[key];
  return value != null ? String(value) : undefined;
}

function runIssueAction(
  action: ModelIssueAction,
  issue: ModelGovernanceVM["issues"][number],
  onNavigateTab: (tab: GovernanceNavigateTab, context?: PlatformModelsTabContext) => void,
) {
  if (action.type === "mark_ignored") {
    ignoredIssueIds.add(issue.issueId);
    if (governanceFilterState.selectedIssueId === issue.issueId) {
      governanceFilterState = { ...governanceFilterState, selectedIssueId: null };
    }
    requestRerender();
    return;
  }
  const target = issueActionTarget(action);
  if (!target) {
    return;
  }
  const suggestedModelId = payloadStr(action.payload, "suggestedModelId");
  const sourceModelId = issue.context.modelId;
  const planId = payloadStr(action.payload, "planId");
  const taskProfileId = payloadStr(action.payload, "taskProfileId");
  const policyId = payloadStr(action.payload, "policyId");
  const modelId = payloadStr(action.payload, "modelId");
  onNavigateTab(target, {
    ...issueContext(issue),
    ...(action.type === "replace_model" && suggestedModelId
      ? { modelId: suggestedModelId }
      : modelId
        ? { modelId }
        : {}),
    ...(sourceModelId ? { sourceModelId } : {}),
    ...(planId ? { planId } : {}),
    ...(taskProfileId ? { taskProfileId } : {}),
    ...(policyId ? { policyId } : {}),
    ...(action.payload?.actionHint
      ? { actionHint: action.payload.actionHint as PlatformModelsTabContext["actionHint"] }
      : {}),
    ...(suggestedModelId ? { suggestedModelId } : {}),
  });
}

function runGovernanceAction(
  action: ModelIssueAction,
  onNavigateTab: (tab: GovernanceNavigateTab, context?: PlatformModelsTabContext) => void,
) {
  const target = issueActionTarget(action);
  if (!target) {
    return;
  }
  onNavigateTab(target, {
    ...(payloadStr(action.payload, "modelId")
      ? { modelId: payloadStr(action.payload, "modelId") }
      : {}),
    ...(payloadStr(action.payload, "planId")
      ? { planId: payloadStr(action.payload, "planId") }
      : {}),
    ...(payloadStr(action.payload, "taskProfileId")
      ? { taskProfileId: payloadStr(action.payload, "taskProfileId") }
      : {}),
    ...(payloadStr(action.payload, "policyId")
      ? { policyId: payloadStr(action.payload, "policyId") }
      : {}),
    ...(payloadStr(action.payload, "suggestedModelId")
      ? { suggestedModelId: payloadStr(action.payload, "suggestedModelId") }
      : {}),
    ...(action.payload?.actionHint
      ? { actionHint: action.payload.actionHint as PlatformModelsTabContext["actionHint"] }
      : {}),
  });
}

function insightSeverityLabel(value: GovernanceInsight["severity"]) {
  return value === "high" ? "高" : value === "medium" ? "中" : "低";
}

function insightSeverityChip(value: GovernanceInsight["severity"]) {
  return value === "high" ? "danger" : value === "medium" ? "warn" : "";
}

function formatInsightImpact(insight: GovernanceInsight) {
  const parts: string[] = [];
  if (insight.impact.costSavingPotential != null) {
    parts.push(`潜在节省 ${insight.impact.costSavingPotential.toFixed(2)}`);
  }
  if (insight.impact.successRateImprovement != null) {
    parts.push(`成功率提升 ${insight.impact.successRateImprovement}%`);
  }
  return parts.join(" · ") || "长期优化建议";
}

function renderInsightCard(
  insight: GovernanceInsight,
  onNavigateTab: (tab: GovernanceNavigateTab, context?: PlatformModelsTabContext) => void,
) {
  const primary = insight.actions.find((action) => action.isPrimary) ?? insight.actions[0];
  const secondary = insight.actions.filter((action) => action !== primary).slice(0, 2);
  return html`
    <section class="card">
      <div class="row row--split row--top">
        <div>
          <div class="card-title">${insight.title}</div>
          <div class="card-sub">${insight.description}</div>
        </div>
        <span class="chip ${insightSeverityChip(insight.severity)}"
          >${insightSeverityLabel(insight.severity)}</span
        >
      </div>
      <div class="callout card-follow">
        ${insight.suggestion}
        <div class="card-follow--xs">${formatInsightImpact(insight)}</div>
      </div>
      <div class="row row--tight card-follow row--wrap">
        ${
          primary
            ? html`
                <button
                  class="btn btn--primary"
                  type="button"
                  @click=${() => runGovernanceAction(primary, onNavigateTab)}
                >
                  ${primary.label}
                </button>
              `
            : ""
        }
        ${secondary.map(
          (action) => html`
            <button
              class="btn btn--sm"
              type="button"
              @click=${() => runGovernanceAction(action, onNavigateTab)}
            >
              ${action.label}
            </button>
          `,
        )}
      </div>
    </section>
  `;
}

function renderRiskCard(
  risk: GovernanceRisk,
  onNavigateTab: (tab: GovernanceNavigateTab, context?: PlatformModelsTabContext) => void,
) {
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${risk.title}</div>
        <div class="list-sub">${risk.description}</div>
      </div>
      <div class="row row--tight">
        <span class="chip ${insightSeverityChip(risk.severity)}"
          >${insightSeverityLabel(risk.severity)}</span
        >
        <button
          class="btn btn--sm"
          type="button"
          @click=${() => onNavigateTab(risk.targetTab, risk.targetContext)}
        >
          查看
        </button>
      </div>
    </div>
  `;
}

function renderGovernanceOptimizationView(
  vm: ModelGovernanceVM,
  onNavigateTab: (tab: GovernanceNavigateTab, context?: PlatformModelsTabContext) => void,
) {
  const highlightInsights = vm.insights.slice(0, 3);
  return html`
    <section class="card card-follow">
      <div class="card-title">Governance Overview</div>
      <div class="stat-grid stat-grid--compact card-follow">
        <div class="stat stat--compact">
          <div class="stat-label">Optimization Insights</div>
          <div class="stat-value">${vm.summary.optimizationInsights}</div>
        </div>
        <div class="stat stat--compact">
          <div class="stat-label">Structural Risks</div>
          <div class="stat-value">${vm.summary.structuralRisks}</div>
        </div>
        <div class="stat stat--compact">
          <div class="stat-label">Model Optimizations</div>
          <div class="stat-value">${vm.assetOptimizations.length}</div>
        </div>
        <div class="stat stat--compact">
          <div class="stat-label">Plan Optimizations</div>
          <div class="stat-value">${vm.planOptimizations.length}</div>
        </div>
        <div class="stat stat--compact">
          <div class="stat-label">Policy Optimizations</div>
          <div class="stat-value">${vm.policyOptimizations.length}</div>
        </div>
      </div>
    </section>

    <section class="card card-follow">
      <div class="card-title">问题列表</div>
    </section>

    <section class="card card-follow">
      <div class="card-title">Optimization Insights</div>
      ${
        highlightInsights.length > 0
          ? html`
              <div class="grid grid-cols-3 card-follow">
                ${highlightInsights.map((insight) => renderInsightCard(insight, onNavigateTab))}
              </div>
            `
          : html`
              <div class="callout card-follow">当前没有新的系统级优化建议。</div>
            `
      }
    </section>

    <section class="card card-follow">
      <div class="card-title">Risk Detection</div>
      ${
        vm.risks.length > 0
          ? html`<div class="list card-follow">
              ${vm.risks.map((risk) => renderRiskCard(risk, onNavigateTab))}
            </div>`
          : html`
              <div class="callout card-follow">当前没有检测到明显的系统性风险。</div>
            `
      }
    </section>

    <div class="grid grid-cols-3 card-follow">
      <section class="card">
        <div class="card-title">Asset Optimization</div>
        ${
          vm.assetOptimizations.length > 0
            ? html`<div class="list card-follow">
                ${vm.assetOptimizations.slice(0, 4).map(
                  (insight) => html`
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">${insight.title}</div>
                        <div class="list-sub">${insight.suggestion}</div>
                      </div>
                      <button
                        class="btn btn--sm"
                        type="button"
                        @click=${() => runGovernanceAction(insight.actions[0], onNavigateTab)}
                      >
                        处理
                      </button>
                    </div>
                  `,
                )}
              </div>`
            : html`
                <div class="callout card-follow">当前没有模型层优化建议。</div>
              `
        }
      </section>
      <section class="card">
        <div class="card-title">Plan Optimization</div>
        ${
          vm.planOptimizations.length > 0
            ? html`<div class="list card-follow">
                ${vm.planOptimizations.slice(0, 4).map(
                  (insight) => html`
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">${insight.title}</div>
                        <div class="list-sub">${insight.suggestion}</div>
                      </div>
                      <button
                        class="btn btn--sm"
                        type="button"
                        @click=${() => runGovernanceAction(insight.actions[0], onNavigateTab)}
                      >
                        处理
                      </button>
                    </div>
                  `,
                )}
              </div>`
            : html`
                <div class="callout card-follow">当前没有方案层优化建议。</div>
              `
        }
      </section>
      <section class="card">
        <div class="card-title">Policy Optimization</div>
        ${
          vm.policyOptimizations.length > 0
            ? html`<div class="list card-follow">
                ${vm.policyOptimizations.slice(0, 4).map(
                  (insight) => html`
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">${insight.title}</div>
                        <div class="list-sub">${insight.suggestion}</div>
                      </div>
                      <button
                        class="btn btn--sm"
                        type="button"
                        @click=${() => runGovernanceAction(insight.actions[0], onNavigateTab)}
                      >
                        处理
                      </button>
                    </div>
                  `,
                )}
              </div>`
            : html`
                <div class="callout card-follow">当前没有策略层优化建议。</div>
              `
        }
      </section>
    </div>
  `;
}

function renderSummary(vm: ModelGovernanceVM) {
  const cards = [
    {
      label: "Critical Issues",
      value: vm.summary.criticalIssues,
      helper: "优先处理",
      filter: () => updateGovernanceFilters({ quickBucket: "critical", severity: "critical" }),
    },
    {
      label: "High Cost Problems",
      value: vm.summary.highCostProblems,
      helper: "成本异常",
      filter: () => updateGovernanceFilters({ quickBucket: "high_cost", severity: "" }),
    },
    {
      label: "Routing Failures",
      value: vm.summary.routingFailures,
      helper: "缺 fallback / 无候选",
      filter: () => updateGovernanceFilters({ quickBucket: "routing_failure", severity: "" }),
    },
    {
      label: "High Override",
      value: vm.summary.highOverrideProblems,
      helper: "默认策略失效",
      filter: () => updateGovernanceFilters({ quickBucket: "high_override", severity: "" }),
    },
  ];
  return html`
    <div class="stat-grid stat-grid--compact card-follow">
      ${cards.map(
        (card) => html`
          <button class="stat stat--compact" type="button" @click=${card.filter}>
            <div class="stat-label">${card.label}</div>
            <div class="stat-value">${card.value}</div>
            <div class="stat-meta">${card.helper}</div>
          </button>
        `,
      )}
    </div>
  `;
}

function renderIssueActions(
  issue: ModelGovernanceVM["issues"][number],
  onNavigateTab: (tab: GovernanceNavigateTab, context?: PlatformModelsTabContext) => void,
) {
  const primary =
    issue.suggestedActions.find((action) => action.isPrimary) ?? issue.suggestedActions[0];
  const secondary = issue.suggestedActions.filter((action) => action !== primary);
  return html`
    <div class="row row--tight row--wrap card-follow--sm">
      ${
        primary
          ? html`
              <button
                class="btn btn--primary"
                type="button"
                @click=${() => runIssueAction(primary, issue, onNavigateTab)}
              >
                ${primary.label}
              </button>
            `
          : ""
      }
      ${secondary.map(
        (action) => html`
          <button
            class="btn btn--sm"
            type="button"
            @click=${() => runIssueAction(action, issue, onNavigateTab)}
          >
            ${action.label}
          </button>
        `,
      )}
    </div>
  `;
}

function renderIssueDrawer(
  issue: ModelGovernanceVM["issues"][number] | null,
  onNavigateTab: (tab: GovernanceNavigateTab, context?: PlatformModelsTabContext) => void,
) {
  if (!issue) {
    return html``;
  }
  return html`
    <div
      class="model-assets-drawer-overlay"
      role="dialog"
      aria-modal="true"
      @click=${() => updateGovernanceFilters({ selectedIssueId: null })}
    >
      <aside class="model-assets-drawer" @click=${(event: Event) => event.stopPropagation()}>
        <div class="model-assets-drawer__header">
          <div>
            <div class="card-title">Issue Detail</div>
          </div>
          <button
            class="btn btn--sm"
            type="button"
            @click=${() => updateGovernanceFilters({ selectedIssueId: null })}
          >
            关闭
          </button>
        </div>
        <div class="model-assets-drawer__hero">
          <div>
            <div class="model-assets-drawer__title">${issue.title}</div>
            <div class="model-assets-drawer__sub">${issue.description}</div>
          </div>
          <div class="chip-row">
            <span
              class="chip ${issue.severity === "critical" ? "danger" : issue.severity === "warning" ? "warn" : ""}"
            >
              ${severityLabel(issue.severity)}
            </span>
            <span class="chip">${issue.type}</span>
          </div>
        </div>
        <div class="model-assets-drawer__body">
          <section class="model-assets-drawer__section">
            <div class="card-title">问题说明</div>
            <div class="list card-follow">
              <div class="list-item">
                <div class="list-main">
                  <div class="list-title">问题</div>
                  <div class="list-sub">${issue.title}</div>
                </div>
              </div>
              <div class="list-item">
                <div class="list-main">
                  <div class="list-title">影响</div>
                  <div class="list-sub">${issue.description}</div>
                </div>
              </div>
            </div>
          </section>
          <section class="model-assets-drawer__section">
            <div class="card-title">影响范围</div>
            <div class="list card-follow">
              ${
                issue.context.taskProfileId
                  ? html`<div class="list-item">
                      <div class="list-main">
                        <div class="list-title">涉及任务</div>
                        <div class="list-sub">${issue.context.taskProfileId}</div>
                      </div>
                    </div>`
                  : ""
              }
              ${
                issue.context.planId
                  ? html`<div class="list-item">
                      <div class="list-main">
                        <div class="list-title">涉及方案</div>
                        <div class="list-sub">${issue.context.planId}</div>
                      </div>
                    </div>`
                  : ""
              }
              ${
                issue.context.modelId
                  ? html`<div class="list-item">
                      <div class="list-main">
                        <div class="list-title">涉及模型</div>
                        <div class="list-sub">${issue.context.modelId}</div>
                      </div>
                    </div>`
                  : ""
              }
              ${
                issue.metrics.cost7d != null ||
                issue.metrics.fallbackRate != null ||
                issue.metrics.successRate != null ||
                issue.metrics.overrideRate != null
                  ? html`
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">影响指标</div>
                          <div class="list-sub">
                            ${issue.metrics.cost7d != null ? `成本 ${issue.metrics.cost7d.toFixed(2)} · ` : ""}
                            ${issue.metrics.fallbackRate != null ? `Fallback ${issue.metrics.fallbackRate}% · ` : ""}
                            ${issue.metrics.successRate != null ? `成功率 ${issue.metrics.successRate}% · ` : ""}
                            ${issue.metrics.overrideRate != null ? `改配率 ${issue.metrics.overrideRate}%` : ""}
                          </div>
                        </div>
                      </div>
                    `
                  : ""
              }
            </div>
          </section>
          <section class="model-assets-drawer__section">
            <div class="card-title">根因分析</div>
            <div class="callout card-follow">${issue.rootCause ?? "当前没有额外根因说明。"}</div>
          </section>
          <section class="model-assets-drawer__section">
            <div class="card-title">可执行操作</div>
            ${renderIssueActions(issue, onNavigateTab)}
            <div class="row row--tight card-follow--sm">
              <button
                class="btn btn--sm"
                type="button"
                @click=${() => {
                  resolvedIssueIds.add(issue.issueId);
                  updateGovernanceFilters({ selectedIssueId: null });
                }}
              >
                标记已处理
              </button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  `;
}

export function renderModelGovernanceSection(params: {
  vm: ModelGovernanceVM;
  actions: PlatformModelsActions;
  compat?: LegacyPlatformModelsVM | null;
  onNavigateTab: (tab: GovernanceNavigateTab, context?: PlatformModelsTabContext) => void;
  context?: PlatformModelsTabContext;
  mode?: "issues" | "governance";
}) {
  const { vm, actions, compat, onNavigateTab, context, mode = "governance" } = params;
  syncGovernanceContext(context);

  const pageTitle = mode === "issues" ? "Issues & Fixes" : "治理工作台";
  const pageSubtitle =
    mode === "issues"
      ? "把分析结果转成可执行动作。每条问题都要回答：原因是什么、影响多大、下一步怎么修。"
      : "把使用数据转成系统级优化建议，持续优化模型供给、任务方案和路由策略。";

  if (vm.emptyState) {
    return html`
      <section class="card">
        <div class="card-title">${vm.emptyState.title}</div>
        <div class="card-sub">${vm.emptyState.description}</div>
        <div class="row row--tight card-follow">
          <button
            class="btn btn--primary"
            type="button"
            @click=${() => onNavigateTab("usageAnalytics")}
          >
            ${vm.emptyState.primaryActionLabel ?? "查看使用分析"}
          </button>
        </div>
      </section>
    `;
  }

  const activeIssues = vm.issues.filter(
    (issue) => !ignoredIssueIds.has(issue.issueId) && !resolvedIssueIds.has(issue.issueId),
  );
  const filteredIssues = activeIssues.filter((issue) => {
    const search = governanceFilterState.search.trim().toLowerCase();
    if (search) {
      const haystacks = [
        issue.title,
        issue.description,
        issue.type,
        issue.rootCause ?? "",
        ...(issue.targetIds ?? []),
      ].map((value) => value.toLowerCase());
      if (!haystacks.some((value) => value.includes(search))) {
        return false;
      }
    }
    if (governanceFilterState.severity && issue.severity !== governanceFilterState.severity) {
      return false;
    }
    if (governanceFilterState.issueType && issue.type !== governanceFilterState.issueType) {
      return false;
    }
    if (
      governanceFilterState.quickBucket &&
      issueBucket(issue) !== governanceFilterState.quickBucket
    ) {
      return false;
    }
    return true;
  });
  const selectedIssue =
    filteredIssues.find((issue) => issue.issueId === governanceFilterState.selectedIssueId) ??
    activeIssues.find((issue) => issue.issueId === governanceFilterState.selectedIssueId) ??
    null;

  return html`
    <section class="card">
      <div class="row row--split row--top">
        <div>
          <div class="card-title">${pageTitle}</div>
          <div class="card-sub">${pageSubtitle}</div>
        </div>
        <div class="row row--tight row--wrap">
          <button class="btn btn--sm" type="button" @click=${() => onNavigateTab("usageAnalytics")}>
            查看使用分析
          </button>
          <button class="btn btn--sm" type="button" @click=${() => onNavigateTab("smartRouting")}>
            查看智能路由
          </button>
        </div>
      </div>
      ${renderSummary(vm)}
    </section>

    ${
      mode === "governance"
        ? renderGovernanceOptimizationView(vm, onNavigateTab)
        : html`
            <section class="card card-follow">
              <div class="row row--split row--top">
                <div>
                  <div class="card-title">Issue List</div>
                </div>
                <div class="row row--tight row--wrap">
                  <span class="chip">当前结果 ${filteredIssues.length}</span>
                  <button class="btn btn--sm" type="button" @click=${resetGovernanceFilters}>
                    清空筛选
                  </button>
                </div>
              </div>
              <div class="grid grid-cols-3 card-follow">
                <label class="field">
                  <span>搜索</span>
                  <input
                    .value=${governanceFilterState.search}
                    placeholder="问题标题 / modelId / planId"
                    @input=${(event: Event) =>
                      updateGovernanceFilters({
                        search:
                          event.currentTarget instanceof HTMLInputElement
                            ? event.currentTarget.value
                            : "",
                      })}
                  />
                </label>
                <label class="field">
                  <span>严重度</span>
                  <select
                    .value=${governanceFilterState.severity}
                    @change=${(event: Event) =>
                      updateGovernanceFilters({
                        severity:
                          event.currentTarget instanceof HTMLSelectElement
                            ? (event.currentTarget.value as GovernanceFilterState["severity"])
                            : "",
                      })}
                  >
                    <option value="">全部</option>
                    ${vm.filters.severities.map((severity) => html`<option value=${severity}>${severity}</option>`)}
                  </select>
                </label>
                <label class="field">
                  <span>问题类型</span>
                  <select
                    .value=${governanceFilterState.issueType}
                    @change=${(event: Event) =>
                      updateGovernanceFilters({
                        issueType:
                          event.currentTarget instanceof HTMLSelectElement
                            ? event.currentTarget.value
                            : "",
                      })}
                  >
                    <option value="">全部</option>
                    ${vm.filters.issueTypes.map((issueType) => html`<option value=${issueType}>${issueType}</option>`)}
                  </select>
                </label>
              </div>
              <div class="list card-follow">
                ${filteredIssues.slice(0, 5).map(
                  (issue) => html`
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">${issue.title}</div>
                        <div class="list-sub">
                          ${issue.description}
                          <div class="card-follow--xs">
                            原因：${issue.rootCause ?? "当前没有额外根因说明。"}
                          </div>
                          ${
                            issue.metrics.cost7d != null ||
                            issue.metrics.fallbackRate != null ||
                            issue.metrics.successRate != null ||
                            issue.metrics.overrideRate != null
                              ? html`
                                  <div class="card-follow--xs">
                                    ${issue.metrics.cost7d != null ? `成本 ${issue.metrics.cost7d.toFixed(2)} · ` : ""}
                                    ${issue.metrics.fallbackRate != null ? `Fallback ${issue.metrics.fallbackRate}% · ` : ""}
                                    ${issue.metrics.successRate != null ? `成功率 ${issue.metrics.successRate}% · ` : ""}
                                    ${issue.metrics.overrideRate != null ? `改配率 ${issue.metrics.overrideRate}%` : ""}
                                  </div>
                                `
                              : ""
                          }
                          <div class="chip-row card-follow--xs">
                            <span
                              class="chip ${issue.severity === "critical" ? "danger" : issue.severity === "warning" ? "warn" : ""}"
                            >
                              ${severityLabel(issue.severity)}
                            </span>
                            <span class="chip">${issue.type}</span>
                          </div>
                        </div>
                        ${renderIssueActions(issue, onNavigateTab)}
                      </div>
                      <div class="row row--tight">
                        <button
                          class="btn btn--sm"
                          type="button"
                          @click=${() => updateGovernanceFilters({ selectedIssueId: issue.issueId })}
                        >
                          查看详情
                        </button>
                      </div>
                    </div>
                  `,
                )}
              </div>
            </section>

            <section class="card card-follow">
              <div class="card-title">Quick Actions</div>
              <div class="list card-follow">
                ${vm.recommendations.slice(0, 4).map(
                  (item) => html`
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">${item.title}</div>
                        <div class="list-sub">${item.action}</div>
                      </div>
                      <button
                        class="btn btn--sm"
                        type="button"
                        @click=${() =>
                          onNavigateTab(item.targetTab as GovernanceNavigateTab, {
                            ...(item.targetType === "model" ? { modelId: item.targetId } : {}),
                            ...(item.targetType === "taskProfile"
                              ? { taskProfileId: item.targetId }
                              : {}),
                            ...(item.targetType === "plan" ? { planId: item.targetId } : {}),
                            ...(item.targetType === "policy" ? { policyId: item.targetId } : {}),
                          })}
                      >
                        前往处理
                      </button>
                    </div>
                  `,
                )}
              </div>
            </section>
          `
    }
    ${
      compat
        ? html`
            <details class="platform-disclosure card-follow">
              <summary class="platform-disclosure__summary">
                <div>
                  <div class="card-title">历史治理视图</div>
                </div>
                <span class="chip">兼容区</span>
              </summary>
              ${renderModelIssueSection(compat, { models: actions } as never)}
            </details>
          `
        : ""
    }
    ${renderIssueDrawer(selectedIssue, onNavigateTab)}
  `;
}
