import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../i18n/index.ts";
import type { KnowledgeSourceSummary } from "../capability/knowledge-universe/types.ts";
import { navigateKnowledgeUniverseAnchor } from "./knowledge-universe-anchor-nav.ts";
import { KNOWLEDGE_UNIVERSE_ANCHORS } from "./knowledge-universe-anchors.ts";
import { renderKnowledgeUniverseSourcePaletteClass } from "./knowledge-universe-source-palette.ts";

type SourceCardKind = "personal" | "enterprise" | "data";

function renderSourceCard(params: {
  kind: SourceCardKind;
  anchorId: string;
  title: string;
  metric: TemplateResult;
  sub: TemplateResult;
  action: string;
  flat: boolean;
}) {
  const cardClass = renderKnowledgeUniverseSourcePaletteClass(
    params.kind,
    "knowledge-universe__source-card",
  );
  return html`
    <article
      class="${cardClass} knowledge-universe__source-card--action ${params.flat ? "knowledge-universe__source-card--flat" : ""}"
      role="button"
      tabindex="0"
      title=${t("frontstage.workbench.knowledgeUniverse.sources.openHint")}
      @click=${() => navigateKnowledgeUniverseAnchor(params.anchorId)}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigateKnowledgeUniverseAnchor(params.anchorId);
        }
      }}
    >
      <div class="knowledge-universe__source-card-title">${params.title}</div>
      <div class="knowledge-universe__source-card-metric">${params.metric}</div>
      <div class="knowledge-universe__source-card-sub">${params.sub}</div>
      <div class="knowledge-universe__source-card-action">
        <span class="knowledge-universe__source-card-action-label">${params.action}</span>
        <span class="knowledge-universe__source-card-action-arrow" aria-hidden="true">→</span>
      </div>
    </article>
  `;
}

export function renderKnowledgeUniverseSourceCards(
  summary: KnowledgeSourceSummary | null,
  options?: { variant?: "default" | "flat" },
) {
  if (!summary) {
    return nothing;
  }
  const flat = options?.variant === "flat";
  return html`
    <section
      class="knowledge-universe__source-cards-section ${flat ? "knowledge-universe__source-cards-section--flat" : ""}"
      aria-label=${t("frontstage.workbench.knowledgeUniverse.sources.heading")}
    >
      <div class="knowledge-universe__source-cards ${flat ? "knowledge-universe__source-cards--flat" : ""}">
        ${renderSourceCard({
          kind: "personal",
          flat,
          anchorId: KNOWLEDGE_UNIVERSE_ANCHORS.personal,
          title: t("frontstage.workbench.knowledgeUniverse.sources.personal"),
          metric: html`
            ${summary.personal.documentCount}
            ${t("frontstage.workbench.knowledgeUniverse.metrics.documents")}
          `,
          sub: html`
            ${t("frontstage.workbench.knowledgeUniverse.metrics.recentUpdates", {
              count: summary.personal.recentUpdates,
            })}
          `,
          action: t("frontstage.workbench.knowledgeUniverse.sources.personalAction"),
        })}
        ${renderSourceCard({
          kind: "enterprise",
          flat,
          anchorId: KNOWLEDGE_UNIVERSE_ANCHORS.enterprise,
          title: t("frontstage.workbench.knowledgeUniverse.sources.enterprise"),
          metric: html`
            ${summary.enterprise.libraryCount}
            ${t("frontstage.workbench.knowledgeUniverse.metrics.libraries")}
          `,
          sub: html`
            ${t("frontstage.workbench.knowledgeUniverse.metrics.accessible", {
              count: summary.enterprise.accessibleCount,
            })}
          `,
          action: t("frontstage.workbench.knowledgeUniverse.sources.enterpriseAction"),
        })}
        ${renderSourceCard({
          kind: "data",
          flat,
          anchorId: KNOWLEDGE_UNIVERSE_ANCHORS.capabilityCenter,
          title: t("frontstage.workbench.knowledgeUniverse.sources.data"),
          metric: html`
            ${summary.data.grantedCount}
            ${t("frontstage.workbench.knowledgeUniverse.metrics.grantedCapabilities")}
          `,
          sub: html`
            ${t("frontstage.workbench.knowledgeUniverse.metrics.pendingCapabilities", {
              count: summary.data.requestableCount,
            })}
            ·
            ${t("frontstage.workbench.knowledgeUniverse.metrics.externalSources", {
              count: summary.data.externalSourceCount,
            })}
          `,
          action: t("frontstage.workbench.knowledgeUniverse.sources.dataAction"),
        })}
      </div>
    </section>
  `;
}
