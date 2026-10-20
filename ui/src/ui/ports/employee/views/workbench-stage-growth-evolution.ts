/**
 * Agent Growth OS — Evolution Report 摘要（spec: agent-growth-lifecycle, P2 14.2 / design §9）。
 */

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { GrowthStatusView } from "../semantic/view-controller-facade.ts";
import { normalizeGrowthReport, renderGrowthReportSummary } from "./workbench-growth-report.ts";
import { renderGrowthStepper } from "./workbench-stage-growth-prelude.ts";

export function shouldShowEvolutionReport(view: GrowthStatusView | null | undefined): boolean {
  if (!view || view.lifecycleState !== "evolution") {
    return false;
  }
  return Boolean(view.growthReport);
}

export type EvolutionGrowthPreludeProps = {
  view: GrowthStatusView;
  roleName?: string;
};

export function renderEvolutionGrowthPrelude(props: EvolutionGrowthPreludeProps): TemplateResult {
  const report = normalizeGrowthReport(props.view.growthReport);
  if (!report) {
    return nothing as unknown as TemplateResult;
  }
  const role = props.roleName?.trim() || t("frontstage.workbench.growth.defaultRoleName");

  return html`<section class="workbench-growth-evolution" data-growth-prelude="evolution">
    <header class="workbench-growth-evolution__head">
      <h3 class="workbench-growth-evolution__title">
        ${t("frontstage.workbench.growth.evolution.title", { role })}
      </h3>
      <p class="workbench-growth-evolution__subtitle">
        ${t("frontstage.workbench.growth.evolution.subtitle", {
          days: String(report.periodDays),
        })}
      </p>
    </header>

    ${renderGrowthStepper(props.view)}
    ${renderGrowthReportSummary(report)}
  </section>`;
}
