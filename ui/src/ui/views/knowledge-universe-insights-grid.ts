import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  KnowledgeActionSuggestion,
  KnowledgeRecommendationItem,
} from "../capability/knowledge-universe/types.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { renderGovernanceInsightCard } from "./knowledge-universe-governance-page.ts";
import { hasKnowledgeRecommendationContext } from "./knowledge-universe-recommendation-context.ts";
import {
  enterKnowledgeUniverseGovernance,
  focusKnowledgeUniverseDeliverables,
} from "./knowledge-universe-workspace-nav.ts";

function actionButtonLabel(action: KnowledgeActionSuggestion): string {
  const key = `frontstage.workbench.knowledgeUniverse.actions.button.${action.actionType}`;
  const translated = t(key);
  return translated === key ? action.title : translated;
}

function resolveActionSourceLabel(
  surface: WorkbenchKnowledgeSurface,
  action: KnowledgeActionSuggestion,
): string | null {
  const kbId = action.context.knowledgeBaseId;
  if (kbId) {
    const kb = surface.knowledgeBases.find((item) => item.id === kbId);
    if (kb?.title?.trim()) {
      return kb.title.trim();
    }
  }
  return null;
}

function isConflictAction(action: KnowledgeActionSuggestion): boolean {
  return action.actionType === "review_conflict" || action.actionType === "merge_duplicate";
}

// Cross-panel linkage: a conflict card lights up when it belongs to the currently selected
// deliverable (workspace search hit) or the selected knowledge base (tree leaf), so clicking
// a row/leaf above visibly anchors the matching card in the slider.
function isActionLinkedToSelection(
  surface: WorkbenchKnowledgeSurface,
  action: KnowledgeActionSuggestion,
): boolean {
  const { deliverableId, knowledgeBaseId } = action.context;
  if (
    surface.selectedWorkspaceSearchDeliverableId &&
    deliverableId === surface.selectedWorkspaceSearchDeliverableId
  ) {
    return true;
  }
  if (surface.selectedKnowledgeBaseId && knowledgeBaseId === surface.selectedKnowledgeBaseId) {
    return true;
  }
  return false;
}

function renderActionConflictCard(
  surface: WorkbenchKnowledgeSurface,
  action: KnowledgeActionSuggestion,
) {
  const sourceLabel = resolveActionSourceLabel(surface, action);
  const conflict = isConflictAction(action);
  const linked = isActionLinkedToSelection(surface, action);
  return html`
    <article
      class="ku-action-card ${conflict ? "ku-action-card--conflict" : ""} ${
        linked ? "is-linked" : ""
      }"
      role="listitem"
      data-testid="ku-action-card"
      data-action-type=${action.actionType}
      data-action-deliverable=${action.context.deliverableId ?? nothing}
      data-action-kb=${action.context.knowledgeBaseId ?? nothing}
    >
      <header class="ku-action-card__head">
        ${
          sourceLabel
            ? html`<span class="ku-action-card__source" title=${sourceLabel}>${sourceLabel}</span>`
            : html`<span class="ku-action-card__source ku-action-card__source--muted">
                ${t("frontstage.workbench.knowledgeUniverse.actions.heading")}
              </span>`
        }
      </header>
      <div class="ku-action-card__body">
        <p class="ku-action-card__title">${action.title}</p>
        <p class="ku-action-card__reason">
          ${action.evidence?.[0] ?? action.reason}
        </p>
      </div>
      <footer class="ku-action-card__foot">
        <button
          type="button"
          class="knowledge-universe__insight-action-btn ku-action-card__btn ${
            conflict ? "ku-action-card__btn--review" : ""
          }"
          ?disabled=${!action.executable}
          @click=${() => void surface.onExecuteKnowledgeAction(action)}
        >
          ${actionButtonLabel(action)}
        </button>
      </footer>
    </article>
  `;
}

// Horizontal "下一步行动" conflict card slider: each suggestion is a self-contained card
// (source tag + summary + review pill) instead of a dense text row.
function renderActionSlider(
  surface: WorkbenchKnowledgeSurface,
  items: KnowledgeActionSuggestion[],
) {
  return html`
    <div class="ku-action-slider" role="list" data-testid="ku-action-slider">
      ${items.map((item) => renderActionConflictCard(surface, item))}
    </div>
  `;
}

export function renderNextActionsWidget(
  surface: WorkbenchKnowledgeSurface,
  onExpandGovernance: () => void,
) {
  const items = surface.actionSuggestions.slice(0, 4);
  const recommendations = surface.recommendations.slice(0, 3);
  const indexed = surface.governanceSummary?.indexedChunkCount ?? 0;
  return html`
    <section class="knowledge-universe__insight-card" data-testid="ku-insights-actions-card">
      <header class="knowledge-universe__insight-card-head">
        <h3 class="knowledge-universe__insight-card-title">
          ${t("frontstage.workbench.knowledgeUniverse.actions.heading")}
        </h3>
        <button
          type="button"
          class="knowledge-universe__insight-link"
          ?disabled=${!surface.onRefreshHome}
          @click=${() => void surface.onRefreshHome?.()}
        >
          ${t("frontstage.workbench.knowledgeUniverse.insights.refreshRecommendations")}
        </button>
      </header>
      <p class="knowledge-universe__insight-card-sub">
        ${t("frontstage.workbench.knowledgeUniverse.actions.subtitle")}
      </p>
      <div class="knowledge-universe__insight-card-body">
        ${
          items.length === 0
            ? html`<div class="knowledge-universe__insight-empty-block">
                <p class="knowledge-universe__insight-empty">
                  ${t("frontstage.workbench.knowledgeUniverse.actions.empty")}
                </p>
                <div class="knowledge-universe__insight-empty-actions">
                  ${
                    indexed > 0
                      ? html`<button
                          type="button"
                          class="knowledge-universe__insight-empty-cta"
                          data-testid="ku-actions-empty-governance-cta"
                          @click=${() =>
                            enterKnowledgeUniverseGovernance(surface, onExpandGovernance)}
                        >
                          ${t("frontstage.workbench.knowledgeUniverse.actions.emptyCtaGovernance")}
                        </button>`
                      : nothing
                  }
                  <button
                    type="button"
                    class="knowledge-universe__insight-empty-cta knowledge-universe__insight-empty-cta--secondary"
                    data-testid="ku-actions-empty-deliverables-cta"
                    @click=${() => focusKnowledgeUniverseDeliverables(surface)}
                  >
                    ${t("frontstage.workbench.knowledgeUniverse.actions.emptyCtaDeliverables")}
                  </button>
                </div>
              </div>`
            : renderActionSlider(surface, items)
        }
        ${
          hasKnowledgeRecommendationContext(surface)
            ? renderRelatedKnowledgeSection(surface, recommendations)
            : nothing
        }
      </div>
    </section>
  `;
}

export function renderHomeInsightsDegradedNotice(surface: WorkbenchKnowledgeSurface) {
  if (!surface.homeInsightsDegraded || surface.homeInsightsNoticeDismissed) {
    return nothing;
  }
  return html`
    <div
      class="knowledge-universe__insights-notice"
      role="status"
      data-testid="ku-insights-degraded-notice"
    >
      <p class="knowledge-universe__insights-notice-copy">
        ${t("frontstage.workbench.knowledgeUniverse.insights.degradedNotice")}
      </p>
      <button
        type="button"
        class="knowledge-universe__insights-notice-dismiss"
        data-testid="ku-insights-degraded-dismiss"
        @click=${() => surface.onDismissHomeInsightsNotice()}
      >
        ${t("frontstage.workbench.knowledgeUniverse.insights.degradedDismiss")}
      </button>
    </div>
  `;
}

function renderRelatedKnowledgeSection(
  surface: WorkbenchKnowledgeSurface,
  recommendations: KnowledgeRecommendationItem[],
) {
  if (recommendations.length === 0) {
    return nothing;
  }
  return html`
    <div class="knowledge-universe__insight-subsection" data-testid="ku-insights-related-knowledge">
      <h4 class="knowledge-universe__insight-subsection-title">
        ${t("frontstage.workbench.knowledgeUniverse.recommendations.heading")}
      </h4>
      <p class="knowledge-universe__insight-subsection-sub">
        ${t("frontstage.workbench.knowledgeUniverse.insights.recommendationsSub")}
      </p>
      <ul class="knowledge-universe__insight-list">
        ${recommendations.map(
          (item) => html`
            <li>
              <button
                type="button"
                class="knowledge-universe__insight-list-item"
                title=${item.reason}
                @click=${() => void surface.onSelectKnowledgeObject(item.object.id)}
              >
                <span class="knowledge-universe__insight-list-copy">
                  <span class="knowledge-universe__insight-list-title">${item.object.title}</span>
                  <span class="knowledge-universe__insight-list-sub">${item.reason}</span>
                </span>
                <span class="knowledge-universe__insight-tag knowledge-universe__insight-tag--recommended"
                  >${t("frontstage.workbench.knowledgeUniverse.insights.recommendedTag")}</span
                >
              </button>
            </li>
          `,
        )}
      </ul>
    </div>
  `;
}

export function renderKnowledgeUniverseInsightsGrid(
  surface: WorkbenchKnowledgeSurface,
  options: { onExpandGovernance: () => void },
) {
  return html`
    <section
      class="knowledge-universe__insights-grid"
      aria-label=${t("frontstage.workbench.knowledgeUniverse.insights.heading")}
      data-testid="ku-insights-grid"
    >
      ${renderHomeInsightsDegradedNotice(surface)}
      ${renderGovernanceInsightCard(surface, options.onExpandGovernance)}
      ${renderNextActionsWidget(surface, options.onExpandGovernance)}
    </section>
  `;
}
