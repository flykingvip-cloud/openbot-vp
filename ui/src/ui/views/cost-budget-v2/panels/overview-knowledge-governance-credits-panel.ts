import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import type {
  DashboardResponse,
  KnowledgeGovernanceCreditsSummary,
} from "../../../capability/cost-budget-billing/index.ts";
import { renderEnterpriseKpiGrid, type EnterpriseKpiItem } from "../../enterprise-kpi-card.ts";

function hasGovernanceCreditsUsage(
  summary: KnowledgeGovernanceCreditsSummary | null | undefined,
): summary is KnowledgeGovernanceCreditsSummary {
  if (!summary) {
    return false;
  }
  return summary.llmCallCount > 0 || summary.creditsCharged > 0 || summary.totalTokens > 0;
}

function buildGovernanceCreditsShareHint(
  summary: KnowledgeGovernanceCreditsSummary,
  dashboard: DashboardResponse,
): string | null {
  const consumed = dashboard.creditsStatus?.creditsConsumed;
  if (consumed == null || consumed <= 0 || summary.creditsCharged <= 0) {
    return null;
  }
  const share = Math.round((summary.creditsCharged / consumed) * 100);
  return t("costBudget.v2.overviewSnapshot.governanceCreditsShare", { share });
}

export function renderKnowledgeGovernanceCreditsPanel(
  dashboard: DashboardResponse,
): TemplateResult | typeof nothing {
  const summary = dashboard.knowledgeGovernanceCredits;
  if (!hasGovernanceCreditsUsage(summary)) {
    return nothing;
  }

  const shareHint = buildGovernanceCreditsShareHint(summary, dashboard);
  const items: EnterpriseKpiItem[] = [
    {
      label: t("costBudget.v2.overviewSnapshot.governanceLlmCalls"),
      value: String(summary.llmCallCount),
      icon: "zap",
    },
    {
      label: t("costBudget.v2.overviewSnapshot.governanceCreditsCharged"),
      value: String(summary.creditsCharged),
      icon: "dollarSign",
    },
    {
      label: t("costBudget.v2.overviewSnapshot.governanceTokens"),
      value: String(summary.totalTokens),
      icon: "activity",
    },
  ];

  return html`
    <section
      class="enterprise-card cost-budget-v2-overview-panel cost-budget-v2-overview-panel--governance-credits"
      data-testid="cost-budget-governance-llm-credits"
    >
      <header class="cost-budget-v2-overview-panel__head">
        <h3 class="enterprise-section-title">
          ${t("costBudget.v2.overviewSnapshot.governanceCreditsTitle")}
        </h3>
        <p class="enterprise-hint cost-budget-v2-overview-panel__hint">
          ${t("costBudget.v2.overviewSnapshot.governanceCreditsHint")}
          ${shareHint ? html`<span> · ${shareHint}</span>` : nothing}
        </p>
      </header>
      ${renderEnterpriseKpiGrid(items, { variant: "compact" })}
    </section>
  `;
}
