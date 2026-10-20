import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { KNOWLEDGE_UNIVERSE_ANCHORS } from "./knowledge-universe-anchors.ts";
import { renderKnowledgeUniverseDetailPreview } from "./knowledge-universe-detail-preview.ts";
import { renderKnowledgeUniverseGraphCanvas } from "./knowledge-universe-graph-canvas.ts";

export function renderKnowledgeUniverseRelationsSection(
  surface: WorkbenchKnowledgeSurface,
  options?: {
    variant?: "collapsed" | "expanded" | "preview";
    open?: boolean;
    /** Suppress the inline heading (title/subtitle/collapse). Used by the standalone
     * relations page, where the secondary shell already supplies the page title. */
    hideHeading?: boolean;
  },
) {
  const variant = options?.variant ?? "collapsed";
  const relationsOpen = options?.open ?? false;
  const graphCanvas = renderKnowledgeUniverseGraphCanvas({
    graph: surface.graph,
    graphViewModel: surface.graphViewModel,
    selectedNodeId: surface.selectedNodeId,
    hoveredNodeId: surface.hoveredNodeId,
    zoom: surface.graphZoom,
    panX: surface.graphPanX,
    panY: surface.graphPanY,
    onSelectNode: (nodeId) => void surface.onSelectNode(nodeId),
    onHoverNode: surface.onHoverNode,
    onZoom: surface.onZoom,
    onPan: surface.onPan,
    onResetView: surface.onResetView,
  });

  const body = html`
    <div class="knowledge-universe__relations-body">
      <div class="knowledge-universe__main">
        ${graphCanvas}
        ${renderKnowledgeUniverseDetailPreview({
          selectedNodeId: surface.selectedNodeId,
          selectedObject: surface.selectedObject,
          graph: surface.graph,
          relatedGroups: surface.relatedGroups,
          actionSuggestions: surface.actionSuggestions,
          onExecuteKnowledgeAction: (action) => void surface.onExecuteKnowledgeAction(action),
          personalVersions: surface.personalVersions,
          viewerOwnerLabel: surface.viewerOwnerLabel,
          onCreatePublishIntent: surface.onCreatePublishIntent
            ? (params) =>
                surface.onCreatePublishIntent?.({
                  ...params,
                  // Channel chosen in the detail-preview picker; fall back to GitHub issue.
                  provider: params.provider ?? "github-personal",
                  suggestedAction: params.suggestedAction ?? "create_issue",
                })
            : undefined,
        })}
      </div>
    </div>
  `;

  if (variant === "preview") {
    return html`
      <article
        id=${KNOWLEDGE_UNIVERSE_ANCHORS.relations}
        class="knowledge-universe__insight-card ku-relations-preview"
        data-testid="ku-relations-preview"
      >
        <header class="knowledge-universe__insight-card-head">
          <h3 class="knowledge-universe__insight-card-title">
            ${t("frontstage.workbench.knowledgeUniverse.relations.heading")}
          </h3>
          <button
            type="button"
            class="knowledge-universe__insight-link"
            data-testid="ku-relations-expand"
            @click=${() => surface.onRelationsInsightExpandedChange(true)}
          >
            ${t("frontstage.workbench.knowledgeUniverse.relations.expandPreview")}
          </button>
        </header>
        <p class="knowledge-universe__insight-card-sub">
          ${t("frontstage.workbench.knowledgeUniverse.relations.subtitle")}
        </p>
        <div class="ku-relations-preview__canvas" aria-hidden="true">${graphCanvas}</div>
      </article>
    `;
  }

  if (variant === "expanded") {
    return html`
      <section
        id=${KNOWLEDGE_UNIVERSE_ANCHORS.relations}
        class="knowledge-universe__relations knowledge-universe__relations--expanded ku-relations-preview--expanded"
        data-testid="ku-relations-expanded"
      >
        ${
          options?.hideHeading
            ? nothing
            : html`
                <div class="knowledge-universe__relations-heading">
                  <span class="knowledge-universe__relations-title">
                    ${t("frontstage.workbench.knowledgeUniverse.relations.heading")}
                  </span>
                  <span class="knowledge-universe__relations-subtitle">
                    ${t("frontstage.workbench.knowledgeUniverse.relations.subtitle")}
                  </span>
                  <button
                    type="button"
                    class="knowledge-universe__insight-link"
                    data-testid="ku-relations-collapse"
                    @click=${() => surface.onRelationsInsightExpandedChange(false)}
                  >
                    ${t("frontstage.workbench.knowledgeUniverse.relations.collapsePreview")}
                  </button>
                </div>
              `
        }
        ${body}
      </section>
    `;
  }

  return html`
    <details
      id=${KNOWLEDGE_UNIVERSE_ANCHORS.relations}
      class="knowledge-universe__relations knowledge-universe__expansion-panel"
      ?open=${relationsOpen}
      @toggle=${(event: Event) => {
        const details = event.currentTarget as HTMLDetailsElement;
        surface.onRelationsInsightExpandedChange(details.open);
      }}
    >
      <summary class="knowledge-universe__relations-summary">
        <span class="knowledge-universe__expansion-panel-head">
          <span class="knowledge-universe__relations-title">
            ${t("frontstage.workbench.knowledgeUniverse.relations.heading")}
          </span>
          <span class="knowledge-universe__relations-subtitle">
            ${t("frontstage.workbench.knowledgeUniverse.relations.subtitle")}
          </span>
        </span>
        <span class="knowledge-universe__expansion-panel-chevron" aria-hidden="true"></span>
      </summary>
      ${relationsOpen ? body : nothing}
    </details>
  `;
}
