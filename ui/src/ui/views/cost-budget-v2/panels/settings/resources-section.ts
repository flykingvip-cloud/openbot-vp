import { html, type TemplateResult } from "lit";
import { t } from "../../../../../i18n/index.ts";
import type { ResourcesSummaryResponse } from "../../../../capability/cost-budget-billing/index.ts";
import { renderCostBudgetKeyValueTable } from "../../../cost-budget/cost-budget-table.ts";
import { renderEnterpriseKpiGrid, type EnterpriseKpiItem } from "../../../enterprise-kpi-card.ts";

function formatCapacityLimit(limit: number): string {
  return limit > 0 ? String(limit) : t("costBudget.resourcesPanel.unlimited");
}

function formatCapacityUsage(used: number, limit: number): string {
  return `${used} / ${formatCapacityLimit(limit)}`;
}

function capacityTone(used: number, limit: number): EnterpriseKpiItem["tone"] {
  if (limit <= 0) {
    return "neutral";
  }
  const ratio = used / limit;
  if (ratio >= 1) {
    return "danger";
  }
  if (ratio >= 0.8) {
    return "warn";
  }
  return "neutral";
}

function buildResourcesKpis(r: ResourcesSummaryResponse): EnterpriseKpiItem[] {
  const botRatioPct = r.quota > 0 ? Math.round(r.ratio * 100) : null;
  const concurrencyRatioPct =
    r.concurrencyLimit > 0 ? Math.round((r.concurrencyUsed / r.concurrencyLimit) * 100) : null;
  return [
    { label: t("costBudget.resourcesPanel.botsUsed"), value: String(r.usedBots) },
    { label: t("costBudget.resourcesPanel.botQuota"), value: formatCapacityLimit(r.quota) },
    {
      label: t("costBudget.resourcesPanel.botRatio"),
      value: botRatioPct == null ? "—" : `${botRatioPct}%`,
      tone: capacityTone(r.usedBots, r.quota),
    },
    {
      label: t("costBudget.resourcesPanel.concurrencyActive"),
      value: formatCapacityUsage(r.concurrencyUsed, r.concurrencyLimit),
      tone: capacityTone(r.concurrencyUsed, r.concurrencyLimit),
    },
    {
      label: t("costBudget.resourcesPanel.concurrencyRatio"),
      value: concurrencyRatioPct == null ? "—" : `${concurrencyRatioPct}%`,
      tone: capacityTone(r.concurrencyUsed, r.concurrencyLimit),
    },
  ];
}

export function renderResourcesSettingsSection(
  resources: ResourcesSummaryResponse | null,
): TemplateResult {
  if (!resources) {
    return html`
      <div class="enterprise-empty" data-testid="cost-budget-v2-resources-empty">
        ${t("costBudget.v2.settings.resources.empty")}
      </div>
    `;
  }
  return html`
    <section class="cost-budget-v2-resources-section" data-testid="cost-budget-v2-resources-section">
      <h3 class="enterprise-section-title">${t("costBudget.resourcesPanel.workforceCapacity")}</h3>
      ${renderEnterpriseKpiGrid(buildResourcesKpis(resources))}
      <h3 class="enterprise-section-title">${t("costBudget.resourcesPanel.perUserBots")}</h3>
      ${renderCostBudgetKeyValueTable(
        Object.entries(resources.perUser).map(([userId, count]) => ({
          label: userId,
          value: t("costBudget.resourcesPanel.botCount", { count: String(count) }),
        })),
        { testId: "resources-per-user-bots" },
      )}
    </section>
  `;
}
