import { html, nothing, type TemplateResult } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { t } from "../../../../i18n/index.ts";
import type {
  BillingReconciliationResult,
  CommercialRuntimeDriftSnapshot,
  ConsumptionForecast,
  DashboardResponse,
  GovernancePendingApprovalItem,
  OverAllocationState,
} from "../../../capability/cost-budget-billing/index.ts";
import { pathForTab } from "../../../navigation.ts";
import { buildCostBudgetV2UsageHref } from "../shell/cost-budget-v2-routes.ts";

export type GovernanceApprovalDecideHandler = (
  approvalId: string,
  decision: "approved" | "rejected",
) => Promise<{ ok: boolean; error?: string }>;

type GovernanceAlert = {
  id: string;
  message: string;
  testId?: string;
};

type GovernanceAction = {
  id: string;
  label: string;
  href?: string;
  testId?: string;
};

function blockedActionLabel(action: string): string {
  switch (action) {
    case "assign_seat":
      return "禁止新增团队成员";
    case "create_bot":
    case "duplicate_bot":
      return "禁止新建 AI 员工";
    case "upgrade_seat_profile":
      return "禁止升级席位 AI 能力档位";
    case "run_high_tier":
      return "高档位能力已降级";
    default:
      return action;
  }
}

function governanceStatusBadge(
  status: NonNullable<DashboardResponse["commercialGovernanceStatus"]>,
  aiGovernance: DashboardResponse["aiGovernance"],
): { label: string; tone: string } {
  if (status === "over_allocated") {
    return {
      label: t("costBudget.v2.overviewSnapshot.governanceCard.statusOverAllocated"),
      tone: "danger",
    };
  }
  if (aiGovernance?.complianceStatus === "action_required") {
    return {
      label: t("costBudget.v2.overviewSnapshot.governanceCard.statusActionRequired"),
      tone: "danger",
    };
  }
  if (aiGovernance?.complianceStatus === "attention") {
    return {
      label: t("costBudget.v2.overviewSnapshot.governanceCard.statusAttention"),
      tone: "warning",
    };
  }
  return {
    label: t("costBudget.v2.overviewSnapshot.governanceCard.statusNormal"),
    tone: "success",
  };
}

function buildGovernanceApprovalsHref(tenantId: string, basePath?: string): string {
  return `${pathForTab("enterpriseDataGovernanceCenter", basePath ?? "", { tenantId })}#approvals`;
}

function collectHighPriorityAlerts(params: {
  dashboard: DashboardResponse;
  overAllocation: OverAllocationState | null | undefined;
  forecast: ConsumptionForecast | null;
  reconciliation: BillingReconciliationResult | null;
  runtimeDrift: CommercialRuntimeDriftSnapshot | null;
  aiGovernance: DashboardResponse["aiGovernance"];
}): GovernanceAlert[] {
  const alerts: GovernanceAlert[] = [];
  const { overAllocation, forecast, reconciliation, runtimeDrift, aiGovernance } = params;
  const status = params.dashboard.commercialGovernanceStatus ?? "normal";

  if (status === "over_allocated" && overAllocation) {
    if (overAllocation.seatsOver > 0) {
      alerts.push({ id: "seats-over", message: `超额团队成员 ${overAllocation.seatsOver}` });
    }
    if (overAllocation.botsOver > 0) {
      alerts.push({ id: "bots-over", message: `超额 AI 员工 ${overAllocation.botsOver}` });
    }
    if (overAllocation.seatProfilesOver > 0) {
      alerts.push({
        id: "profiles-over",
        message: `超额能力档位 ${overAllocation.seatProfilesOver}`,
      });
    }
    if (overAllocation.privateModelsOver > 0) {
      alerts.push({
        id: "models-over",
        message: `私有模型超额 ${overAllocation.privateModelsOver}`,
      });
    }
    for (const action of overAllocation.blockedActions) {
      alerts.push({
        id: `blocked-${action}`,
        message: blockedActionLabel(action),
        testId: action === "create_bot" ? "cost-budget-governance-overallocation" : undefined,
      });
    }
  }

  if (aiGovernance) {
    if (!aiGovernance.creditsV2Enabled) {
      alerts.push({
        id: "credits-v1",
        message: "AI 工作额度计价 v1",
      });
    }
    if (aiGovernance.pendingApprovalsCount > 0) {
      alerts.push({
        id: "pending-approvals",
        message: `待审批治理请求 ${aiGovernance.pendingApprovalsCount} 条`,
      });
    }
    if (aiGovernance.tenantAllowPrivateModels && !aiGovernance.privateModelsCompliant) {
      alerts.push({
        id: "private-models",
        message: `私有模型超配 ${aiGovernance.privateModelsOver}`,
      });
    }
    for (const issue of aiGovernance.complianceIssues ?? []) {
      alerts.push({ id: `issue-${issue}`, message: issue });
    }
  }

  if (forecast) {
    if (forecast.creditsEtaDays != null && forecast.monthlyCredits > 0) {
      alerts.push({
        id: "credits-eta",
        message: `按当前速率，AI 工作额度约 ${forecast.creditsEtaDays} 天后耗尽`,
      });
    }
    if (forecast.concurrencyRiskMessage && forecast.concurrencyRisk !== "none") {
      alerts.push({ id: "concurrency-risk", message: forecast.concurrencyRiskMessage });
    }
    if (forecast.botQuotaRiskMessage && forecast.botQuotaRisk !== "none") {
      alerts.push({ id: "bot-risk", message: forecast.botQuotaRiskMessage });
    }
  }

  if (reconciliation) {
    alerts.push({
      id: "pricing-engine",
      message: `AI 工作额度账本分列：v1 ${reconciliation.ledgerCreditsV1} · v2 ${reconciliation.ledgerCreditsV2}`,
      testId: "cost-budget-governance-pricing-engine",
    });
    if (!reconciliation.aligned) {
      alerts.push({
        id: "reconciliation-drift",
        message: `AI 工作额度对账偏差 ${reconciliation.driftCredits}`,
        testId: "cost-budget-governance-reconciliation-drift",
      });
      for (const line of reconciliation.details) {
        alerts.push({ id: `recon-${line}`, message: line });
      }
    }
  }

  if (runtimeDrift && !runtimeDrift.reconciliationAligned) {
    alerts.push({
      id: "runtime-drift",
      message: `计价监控对账偏差 ${runtimeDrift.reconciliationDriftCredits}`,
      testId: "cost-budget-governance-runtime-drift",
    });
  }

  return alerts;
}

function collectSuggestedActions(params: {
  dashboard: DashboardResponse;
  tenantId?: string;
  basePath?: string;
  aiGovernance: DashboardResponse["aiGovernance"];
}): GovernanceAction[] {
  const actions: GovernanceAction[] = [];
  const { aiGovernance, tenantId, basePath } = params;
  const status = params.dashboard.commercialGovernanceStatus ?? "normal";

  if (aiGovernance && !aiGovernance.mfaEnabled) {
    actions.push({
      id: "enable-mfa",
      label: t("costBudget.v2.overviewSnapshot.governanceCard.actionEnableMfa"),
    });
  }
  if (aiGovernance && !aiGovernance.ssoEnabled) {
    actions.push({
      id: "enable-sso",
      label: t("costBudget.v2.overviewSnapshot.governanceCard.actionEnableSso"),
    });
  }

  if (tenantId) {
    actions.push({
      id: "budget-rules",
      label: t("costBudget.v2.overviewSnapshot.governanceCard.actionBudgetRules"),
      href: buildCostBudgetV2UsageHref(basePath ?? "", tenantId, {
        route: "settings",
        settingsPanel: "budget",
        hash: "#budget",
      }),
      testId: "cost-budget-governance-budget-rules",
    });
    if ((aiGovernance?.pendingApprovalsCount ?? 0) > 0) {
      actions.push({
        id: "approvals",
        label: t("costBudget.v2.overviewSnapshot.governanceCard.actionApprovals"),
        href: buildGovernanceApprovalsHref(tenantId, basePath),
        testId: "cost-budget-governance-approvals-link",
      });
    }
  }

  if (status === "over_allocated") {
    actions.push({
      id: "change-plan",
      label: t("costBudget.v2.overviewSnapshot.governanceCard.actionUpgradePlan"),
      href: tenantId
        ? buildCostBudgetV2UsageHref(basePath ?? "", tenantId, {
            route: "plan-orders",
            planOrdersPanel: "catalog",
          })
        : undefined,
    });
  }

  return actions;
}

function renderRecentPendingApprovalsInline(
  items: GovernancePendingApprovalItem[],
  opts: {
    onDecideApproval?: GovernanceApprovalDecideHandler;
    onApprovalDecided?: () => void;
  },
): TemplateResult {
  return html`
    <ul
      class="cost-budget-v2-governance-approvals-inline"
      data-testid="cost-budget-governance-approvals-inline"
    >
      ${items.map(
        (item) => html`
          <li class="cost-budget-v2-governance-approvals-inline__row">
            <div>
              <strong>${item.displayName}</strong>
            </div>
            ${
              opts.onDecideApproval
                ? html`
                    <div class="cost-budget-v2-governance-approvals-inline__actions">
                      <button
                        type="button"
                        class="btn btn--sm btn--primary"
                        data-testid="cost-budget-governance-approve-${item.approvalId}"
                        @click=${async (e: Event) => {
                          const btn = e.currentTarget as HTMLButtonElement;
                          btn.disabled = true;
                          try {
                            const result = await opts.onDecideApproval!(
                              item.approvalId,
                              "approved",
                            );
                            if (result.ok) {
                              opts.onApprovalDecided?.();
                            }
                          } finally {
                            btn.disabled = false;
                          }
                        }}
                      >
                        批准
                      </button>
                      <button
                        type="button"
                        class="btn btn--sm"
                        data-testid="cost-budget-governance-reject-${item.approvalId}"
                        @click=${async (e: Event) => {
                          const btn = e.currentTarget as HTMLButtonElement;
                          btn.disabled = true;
                          try {
                            const result = await opts.onDecideApproval!(
                              item.approvalId,
                              "rejected",
                            );
                            if (result.ok) {
                              opts.onApprovalDecided?.();
                            }
                          } finally {
                            btn.disabled = false;
                          }
                        }}
                      >
                        拒绝
                      </button>
                    </div>
                  `
                : nothing
            }
          </li>
        `,
      )}
    </ul>
  `;
}

export function renderDashboardGovernancePanel(
  dashboard: DashboardResponse,
  opts?: {
    tenantId?: string;
    basePath?: string;
    onDecideApproval?: GovernanceApprovalDecideHandler;
    onApprovalDecided?: () => void;
  },
): TemplateResult | typeof nothing {
  const status = dashboard.commercialGovernanceStatus ?? "normal";
  const overAllocation = dashboard.overAllocation;
  const forecast = dashboard.consumptionForecast ?? null;
  const reconciliation = dashboard.creditsReconciliation ?? null;
  const runtimeDrift = dashboard.commercialRuntimeDrift ?? null;
  const aiGovernance = dashboard.aiGovernance ?? null;
  const showPanel =
    status === "over_allocated" ||
    forecast != null ||
    reconciliation != null ||
    runtimeDrift != null ||
    aiGovernance != null;

  if (!showPanel && status === "normal") {
    return nothing;
  }

  const badge = governanceStatusBadge(status, aiGovernance);
  const alerts = collectHighPriorityAlerts({
    dashboard,
    overAllocation,
    forecast,
    reconciliation,
    runtimeDrift,
    aiGovernance,
  });
  const actions = collectSuggestedActions({
    dashboard,
    tenantId: opts?.tenantId,
    basePath: opts?.basePath,
    aiGovernance,
  });

  return html`
    <section
      class="enterprise-card cost-budget-v2-overview-panel cost-budget-v2-governance-card"
      data-testid="cost-budget-governance-panel"
    >
      <header class="cost-budget-v2-governance-card__header">
        <h3 class="cost-budget-v2-governance-card__title">
          ${t("costBudget.v2.overviewSnapshot.governanceCard.title")}
        </h3>
        <span class="enterprise-status-badge enterprise-status-badge--${badge.tone}" data-testid="cost-budget-governance-status-badge">
          ${t("costBudget.v2.overviewSnapshot.governanceCard.statusLabel", { status: badge.label })}
        </span>
      </header>

      ${
        alerts.length > 0
          ? html`
              <div class="cost-budget-v2-governance-card__section" data-testid="cost-budget-governance-ai">
                <h4 class="cost-budget-v2-governance-card__section-title">
                  ${t("costBudget.v2.overviewSnapshot.governanceCard.highPriority")}
                </h4>
                <ul class="cost-budget-v2-governance-card__alert-list">
                  ${alerts.map(
                    (alert) => html`
                      <li
                        class="cost-budget-v2-governance-card__alert-item"
                        data-testid=${ifDefined(alert.testId)}
                      >
                        ${alert.message}
                      </li>
                    `,
                  )}
                </ul>
              </div>
            `
          : html`
              <p class="enterprise-hint cost-budget-v2-governance-card__empty-hint">
                ${t("costBudget.v2.overviewSnapshot.governanceCard.noAlerts")}
              </p>
            `
      }

      ${
        actions.length > 0
          ? html`
              <div class="cost-budget-v2-governance-card__section">
                <h4 class="cost-budget-v2-governance-card__section-title">
                  ${t("costBudget.v2.overviewSnapshot.governanceCard.suggestedActions")}
                </h4>
                <ul class="cost-budget-v2-governance-card__action-list">
                  ${actions.map(
                    (action) => html`
                      <li>
                        ${
                          action.href
                            ? html`
                                <a
                                  class="enterprise-link cost-budget-v2-governance-card__action-link"
                                  href=${action.href}
                                  data-testid=${ifDefined(action.testId)}
                                  >${action.label}</a
                                >
                              `
                            : html`
                                <span
                                  class="cost-budget-v2-governance-card__action-text"
                                  data-testid=${ifDefined(action.testId)}
                                  >${action.label}</span
                                >
                              `
                        }
                      </li>
                    `,
                  )}
                </ul>
              </div>
            `
          : nothing
      }

      ${
        (aiGovernance?.recentPendingApprovals?.length ?? 0) > 0
          ? renderRecentPendingApprovalsInline(aiGovernance!.recentPendingApprovals ?? [], {
              onDecideApproval: opts?.onDecideApproval,
              onApprovalDecided: opts?.onApprovalDecided,
            })
          : nothing
      }
    </section>
  `;
}
