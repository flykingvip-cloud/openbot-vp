import { html } from "lit";
import { t } from "../../i18n/index.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { renderGovernanceInsightCard } from "./knowledge-universe-governance-page.ts";
import {
  renderHomeInsightsDegradedNotice,
  renderNextActionsWidget,
} from "./knowledge-universe-insights-grid.ts";
import { renderKnowledgeUniverseRelationsSection } from "./knowledge-universe-relations-section.ts";

export function renderKnowledgeIntelligenceBand(
  surface: WorkbenchKnowledgeSurface,
  options: { onExpandGovernance: () => void },
) {
  const relationsExpanded = surface.relationsInsightExpanded;

  return html`
    <section
      class="ku-intelligence-band"
      aria-label=${t("frontstage.workbench.knowledgeUniverse.intelligenceBand.heading")}
      data-testid="ku-intelligence-band"
    >
      <header class="ku-intelligence-band__head">
        <h2 class="ku-intelligence-band__title">
          ${t("frontstage.workbench.knowledgeUniverse.intelligenceBand.heading")}
        </h2>
        <p class="ku-intelligence-band__sub">
          ${t("frontstage.workbench.knowledgeUniverse.intelligenceBand.subtitle")}
        </p>
      </header>

      ${renderHomeInsightsDegradedNotice(surface)}

      <div
        class="ku-intelligence-band__grid ${relationsExpanded ? "ku-intelligence-band__grid--relations-expanded" : ""}"
      >
        <div class="ku-intelligence-band__cell ku-intelligence-band__cell--relations">
          ${renderKnowledgeUniverseRelationsSection(surface, {
            variant: relationsExpanded ? "expanded" : "preview",
            open: relationsExpanded,
          })}
        </div>
        <div class="ku-intelligence-band__cell ku-intelligence-band__cell--actions">
          ${renderNextActionsWidget(surface, options.onExpandGovernance)}
        </div>
        <div class="ku-intelligence-band__cell ku-intelligence-band__cell--governance">
          ${renderGovernanceInsightCard(surface, options.onExpandGovernance)}
        </div>
      </div>
    </section>
  `;
}
