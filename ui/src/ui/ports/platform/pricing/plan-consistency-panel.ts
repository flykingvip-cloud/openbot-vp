/**
 * 套餐绑定一致性 Doctor 面板（总览 / 目录）。
 */

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { PlanConsistencyIssue } from "./plan-consistency-audit.ts";

export type PlanConsistencyPanelInput = {
  issues: readonly PlanConsistencyIssue[];
  loading?: boolean;
  onFixPlan?: (planId: string) => void;
};

function issueMessage(issue: PlanConsistencyIssue): string {
  if (issue.serverMessage) {
    return issue.serverMessage;
  }
  const planName = issue.planName ?? issue.planId ?? issue.versionId;
  switch (issue.code) {
    case "plan_binding_missing":
      return t("platformPricing.consistencyIssueMissing", { planName });
    case "plan_binding_empty":
      return t("platformPricing.consistencyIssueEmpty", { planName });
    case "plan_binding_invalid_catalog":
      return t("platformPricing.consistencyIssueInvalidCatalog", {
        planName,
        count: String(issue.invalidModelIds?.length ?? 0),
      });
    case "plan_binding_orphan":
      return t("platformPricing.consistencyIssueOrphan", { versionId: issue.versionId });
  }
}

export function renderPlanConsistencyPanel(input: PlanConsistencyPanelInput): TemplateResult {
  if (input.loading) {
    return html`
      <div class="platform-pricing__consistency-panel callout" data-testid="plan-consistency-panel">
        <div class="platform-pricing__consistency-title">${t("platformPricing.consistencyPanelTitle")}</div>
        <p class="muted platform-pricing__consistency-empty">${t("platformPricing.consistencyPanelLoading")}</p>
      </div>
    `;
  }

  const issues = input.issues;
  if (issues.length === 0) {
    return html`
      <div class="platform-pricing__consistency-panel callout" data-testid="plan-consistency-panel">
        <div class="platform-pricing__consistency-title">${t("platformPricing.consistencyPanelTitle")}</div>
        <p class="muted platform-pricing__consistency-empty" data-testid="plan-consistency-ok">
          ${t("platformPricing.consistencyPanelEmpty")}
        </p>
      </div>
    `;
  }

  return html`
    <div
      class="platform-pricing__consistency-panel callout warning"
      data-testid="plan-consistency-panel"
    >
      <div class="platform-pricing__consistency-title">${t("platformPricing.consistencyPanelTitle")}</div>
      <ul class="platform-pricing__consistency-list">
        ${issues.map(
          (issue) => html`
            <li class="platform-pricing__consistency-item" data-testid="plan-consistency-issue">
              <span class="platform-pricing__consistency-message">${issueMessage(issue)}</span>
              ${
                input.onFixPlan && issue.planId
                  ? html`
                      <button
                        type="button"
                        class="btn btn--sm platform-pricing__consistency-fix"
                        data-testid="plan-consistency-fix"
                        data-plan-id=${issue.planId}
                        @click=${() => input.onFixPlan?.(issue.planId!)}
                      >
                        ${t("platformPricing.consistencyFixAction")}
                      </button>
                    `
                  : nothing
              }
            </li>
          `,
        )}
      </ul>
    </div>
  `;
}
