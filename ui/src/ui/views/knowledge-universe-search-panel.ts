import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../i18n/index.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import {
  clearKnowledgeUniverseSearchPanelDismiss,
  registerKnowledgeUniverseSearchPanelDismiss,
} from "./knowledge-universe-search-focus.ts";

export function shouldOpenKnowledgeUniverseSearchPanel(
  surface: WorkbenchKnowledgeSurface,
): boolean {
  return Boolean(surface.query.trim());
}

export function isKnowledgeUniverseSearchPanelVisible(surface: WorkbenchKnowledgeSurface): boolean {
  return surface.searchPanelOpen && shouldOpenKnowledgeUniverseSearchPanel(surface);
}

export function resolveKnowledgeUniverseSearchPanelTitle(
  surface: WorkbenchKnowledgeSurface,
): string {
  const scope = surface.searchScope;
  const selectedKb =
    surface.knowledgeBases.find((item) => item.id === surface.selectedKnowledgeBaseId) ?? null;
  if (scope === "library" && selectedKb) {
    return t("frontstage.workbench.knowledgeUniverse.search.panelTitleLibrary", {
      title: selectedKb.title,
    });
  }
  return t("frontstage.workbench.knowledgeUniverse.search.panelTitle");
}

export function resolveKnowledgeUniverseSearchPanelSummary(
  surface: WorkbenchKnowledgeSurface,
): string | null {
  const trimmedQuery = surface.query.trim();
  if (!trimmedQuery) {
    return null;
  }
  const graphNodeCount = surface.graph?.nodes.length ?? 0;
  const loading = surface.searchScope === "library" ? surface.workspaceBusy : surface.loading;

  if (loading) {
    return t("frontstage.workbench.knowledgeUniverse.search.feedbackLoading", {
      query: trimmedQuery,
    });
  }

  if (surface.searchScope === "library") {
    const hasResults =
      surface.kbSearchEvidence.length > 0 || surface.kbSearchSubstringResults.length > 0;
    if (hasResults) {
      const count = surface.kbSearchEvidence.length + surface.kbSearchSubstringResults.length;
      return t("frontstage.workbench.knowledgeUniverse.search.panelSummaryLibraryHits", {
        query: trimmedQuery,
        count,
      });
    }
    if (surface.kbSearchMode !== null) {
      return t("frontstage.workbench.knowledgeUniverse.search.feedbackLibraryEmpty", {
        query: trimmedQuery,
      });
    }
    return null;
  }

  const groupedHits = surface.workspaceSearchGroups.filter((group) => group.hits.length > 0);
  const useGrouped = groupedHits.length > 0 || surface.workspaceSearchTotalCount > 0;
  const hitCount = useGrouped ? surface.workspaceSearchTotalCount : surface.searchResults.length;

  if (hitCount > 0) {
    return t("frontstage.workbench.knowledgeUniverse.search.feedbackHits", {
      query: trimmedQuery,
      count: hitCount,
      graphCount: graphNodeCount,
    });
  }

  return t("frontstage.workbench.knowledgeUniverse.search.feedbackEmpty", {
    query: trimmedQuery,
    graphCount: graphNodeCount,
  });
}

export function renderKnowledgeUniverseSearchPanel(params: {
  surface: WorkbenchKnowledgeSurface;
  body: TemplateResult | typeof nothing;
}) {
  const { surface, body } = params;
  const summary = resolveKnowledgeUniverseSearchPanelSummary(surface);
  const close = () => surface.onSearchPanelOpenChange(false);
  registerKnowledgeUniverseSearchPanelDismiss(close);

  return html`
    <div
      class="knowledge-universe__search-scrim"
      aria-hidden="true"
      @click=${close}
    ></div>
    <div
      class="knowledge-universe__search-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ku-search-panel-title"
      @click=${(event: Event) => event.stopPropagation()}
    >
      <header class="knowledge-universe__search-panel-head">
        <div class="knowledge-universe__search-panel-head-text">
          <h3 id="ku-search-panel-title" class="knowledge-universe__search-panel-title">
            ${resolveKnowledgeUniverseSearchPanelTitle(surface)}
          </h3>
          ${summary ? html`<p class="knowledge-universe__search-panel-summary">${summary}</p>` : nothing}
        </div>
        <button
          type="button"
          class="knowledge-universe__search-panel-close"
          aria-label=${t("frontstage.workbench.knowledgeUniverse.search.panelCloseAria")}
          @click=${close}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div class="knowledge-universe__search-panel-body">${body}</div>
    </div>
  `;
}

export function bindKnowledgeUniverseSearchPanelLifecycle(visible: boolean): void {
  if (!visible) {
    clearKnowledgeUniverseSearchPanelDismiss();
  }
}
