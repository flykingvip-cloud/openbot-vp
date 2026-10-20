import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../../i18n/index.ts";
import type { BillingReconciliationResult } from "../../../../capability/cost-budget-billing/endpoints.ts";
import { renderEnterpriseKpiGrid, type EnterpriseKpiItem } from "../../../enterprise-kpi-card.ts";

function fmtCredits(value: number): string {
  return value.toLocaleString();
}

function buildReconciliationIssues(reconciliation: BillingReconciliationResult): string[] {
  const issues: string[] = [];
  const legacy = reconciliation.legacyBalance;
  if (legacy) {
    if (legacy.monthlyCredits !== reconciliation.bucketGranted) {
      issues.push(
        t("costBudget.v2.reconciliation.issueGrantMismatch", {
          legacy: fmtCredits(legacy.monthlyCredits),
          bucket: fmtCredits(reconciliation.bucketGranted),
        }),
      );
    }
    if (legacy.creditsConsumed !== reconciliation.bucketConsumed) {
      issues.push(
        t("costBudget.v2.reconciliation.issueConsumedMismatch", {
          legacy: fmtCredits(legacy.creditsConsumed),
          bucket: fmtCredits(reconciliation.bucketConsumed),
        }),
      );
    }
  }
  if (reconciliation.bucketConsumed !== reconciliation.ledgerCreditsCharged) {
    issues.push(
      t("costBudget.v2.reconciliation.issueLedgerMismatch", {
        bucket: fmtCredits(reconciliation.bucketConsumed),
        ledger: fmtCredits(reconciliation.ledgerCreditsCharged),
      }),
    );
  }
  if (issues.length === 0 && reconciliation.details.length > 0) {
    return reconciliation.details;
  }
  return issues;
}

function buildReconciliationKpis(reconciliation: BillingReconciliationResult): EnterpriseKpiItem[] {
  const legacy = reconciliation.legacyBalance;
  const driftAbs = Math.abs(reconciliation.driftCredits);
  const items: EnterpriseKpiItem[] = [
    {
      label: t("costBudget.v2.reconciliation.kpiBucketGranted"),
      value: fmtCredits(reconciliation.bucketGranted),
      detail: legacy
        ? t("costBudget.v2.reconciliation.kpiLegacyGrantedDetail", {
            value: fmtCredits(legacy.monthlyCredits),
          })
        : undefined,
    },
    {
      label: t("costBudget.v2.reconciliation.kpiBucketConsumed"),
      value: fmtCredits(reconciliation.bucketConsumed),
      detail: legacy
        ? t("costBudget.v2.reconciliation.kpiLegacyConsumedDetail", {
            value: fmtCredits(legacy.creditsConsumed),
          })
        : undefined,
    },
    {
      label: t("costBudget.v2.reconciliation.kpiLedgerCharged"),
      value: fmtCredits(reconciliation.ledgerCreditsCharged),
      detail: t("costBudget.v2.reconciliation.kpiLedgerEngineDetail", {
        v1: fmtCredits(reconciliation.ledgerCreditsV1),
        v2: fmtCredits(reconciliation.ledgerCreditsV2),
      }),
    },
    {
      label: t("costBudget.v2.reconciliation.kpiDrift"),
      value: fmtCredits(driftAbs),
      tone: driftAbs > 0 ? "danger" : "ok",
      detail:
        reconciliation.driftCredits === 0
          ? t("costBudget.v2.reconciliation.kpiDriftAligned")
          : t("costBudget.v2.reconciliation.kpiDriftHint"),
    },
  ];
  return items;
}

export type CreditsReconciliationAlertOptions = {
  reconciliation: BillingReconciliationResult;
  testId?: string;
  compact?: boolean;
};

export function renderCreditsReconciliationAlert(
  options: CreditsReconciliationAlertOptions,
): TemplateResult | typeof nothing {
  const { reconciliation } = options;
  if (reconciliation.aligned) {
    return nothing;
  }

  const issues = buildReconciliationIssues(reconciliation);
  const testId = options.testId ?? "cost-budget-reconciliation-drift";

  return html`
    <section
      class="enterprise-card cost-budget-v2-reconciliation-alert is-warn"
      data-testid=${testId}
    >
      <header class="cost-budget-v2-reconciliation-alert__header">
        <div class="cost-budget-v2-reconciliation-alert__title-block">
          <h3 class="cost-budget-v2-reconciliation-alert__title">
            ${t("costBudget.v2.reconciliation.title")}
          </h3>
          <p class="cost-budget-v2-reconciliation-alert__subtitle">
            ${t("costBudget.v2.reconciliation.subtitle")}
          </p>
        </div>
        <span
          class="enterprise-status-badge enterprise-status-badge--warn cost-budget-v2-reconciliation-alert__badge"
        >
          ${t("costBudget.v2.reconciliation.driftBadge", {
            drift: fmtCredits(Math.abs(reconciliation.driftCredits)),
          })}
        </span>
      </header>

      ${
        options.compact
          ? nothing
          : html`
              <div class="cost-budget-v2-reconciliation-alert__kpis">
                ${renderEnterpriseKpiGrid(buildReconciliationKpis(reconciliation))}
              </div>
            `
      }

      ${
        issues.length > 0
          ? html`
              <div class="cost-budget-v2-reconciliation-alert__issues">
                <h4 class="cost-budget-v2-reconciliation-alert__issues-title">
                  ${t("costBudget.v2.reconciliation.issuesTitle")}
                </h4>
                <ul class="cost-budget-v2-reconciliation-alert__issue-list">
                  ${issues.map(
                    (issue) => html`
                      <li class="cost-budget-v2-reconciliation-alert__issue-item">${issue}</li>
                    `,
                  )}
                </ul>
              </div>
            `
          : nothing
      }

      <p class="cost-budget-v2-reconciliation-alert__footnote">
        ${t("costBudget.v2.reconciliation.footnote")}
      </p>
    </section>
  `;
}
