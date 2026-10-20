import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  KnowledgeUniverseSearchScope,
  WorkbenchKnowledgeSurface,
} from "../ports/employee/views/home-page-contracts.ts";
import {
  kuIconChart,
  kuIconDatabase,
  kuIconDocumentUpload,
  kuIconSearch,
  kuIconShield,
} from "./knowledge-universe-icons.ts";
import { renderKnowledgeUniverseSearchFeedback } from "./knowledge-universe-search-feedback.ts";
import { KNOWLEDGE_UNIVERSE_SEARCH_INPUT_ID } from "./knowledge-universe-search-focus.ts";
import {
  bindKnowledgeUniverseSearchPanelLifecycle,
  isKnowledgeUniverseSearchPanelVisible,
  renderKnowledgeUniverseSearchPanel,
} from "./knowledge-universe-search-panel.ts";
import { renderKnowledgeUniverseLibrarySearchResults } from "./knowledge-universe-workspace-panels.ts";

export type KnowledgeUniverseHomeCommandBarOptions = {
  /** Opens the unified import / upload entry. */
  onUploadKnowledge: () => void;
  /** Opens the 数字能力 (data capability) supply page. */
  onOpenDataCapability: () => void;
  /** Opens the 我的资产 secondary page. */
  onOpenMyAssets: () => void;
  /** Opens the 知识治理 secondary page. */
  onOpenGovernance: () => void;
};

function resolveEffectiveSearchScope(
  surface: WorkbenchKnowledgeSurface,
): KnowledgeUniverseSearchScope {
  if (!surface.selectedKnowledgeBaseId) {
    return "workspace";
  }
  return surface.searchScope;
}

function renderSearchPanelBody(surface: WorkbenchKnowledgeSurface) {
  const scope = resolveEffectiveSearchScope(surface);
  const trimmedQuery = surface.query.trim();

  if (scope === "library") {
    const loading = surface.workspaceBusy && Boolean(trimmedQuery);
    const hasAttemptedSearch = surface.kbSearchMode !== null;
    const hasResults =
      surface.kbSearchEvidence.length > 0 || surface.kbSearchSubstringResults.length > 0;
    if (!trimmedQuery && !loading && !hasAttemptedSearch) {
      return nothing;
    }
    return html`
      <div class="knowledge-universe__search-feedback knowledge-universe__search-feedback--library knowledge-universe__search-feedback--compact">
        ${loading || !hasResults ? nothing : renderKnowledgeUniverseLibrarySearchResults(surface)}
      </div>
    `;
  }

  const showWorkspaceFeedback = Boolean(trimmedQuery) || surface.loading;
  if (!showWorkspaceFeedback) {
    return nothing;
  }

  return renderKnowledgeUniverseSearchFeedback({
    query: surface.query,
    loading: surface.loading,
    searchResults: surface.searchResults,
    workspaceSearchGroups: surface.workspaceSearchGroups,
    workspaceSearchTotalCount: surface.workspaceSearchTotalCount,
    workspaceSearchMode: surface.workspaceSearchMode,
    selectedWorkspaceSearchHitId: surface.selectedWorkspaceSearchHitId,
    graph: surface.graph,
    onSelectHit: (hit) => void surface.onSelectWorkspaceSearchHit(hit),
    onSelectNode: (nodeId) => void surface.onSelectNode(nodeId),
    compact: true,
  });
}

/**
 * Home cockpit command rail: 搜索框 + 五动作位 (搜索 / 上传知识 / 数字能力 / 我的资产 / 知识治理).
 * The page title was dropped; the search box keeps the existing ⌘K shortcut, scope handling, and
 * dropdown panel so the homepage rebuild reuses the proven search behaviour instead of forking it.
 */
export function renderKnowledgeUniverseHomeCommandBar(
  surface: WorkbenchKnowledgeSurface,
  options: KnowledgeUniverseHomeCommandBarOptions,
) {
  const scope = resolveEffectiveSearchScope(surface);
  const selectedKb =
    surface.knowledgeBases.find((item) => item.id === surface.selectedKnowledgeBaseId) ?? null;
  const placeholder =
    scope === "library" && selectedKb
      ? t("frontstage.workbench.knowledgeUniverse.search.placeholderLibrary", {
          title: selectedKb.title,
        })
      : t("frontstage.workbench.knowledgeUniverse.search.placeholder");
  const submitting = scope === "workspace" ? surface.loading : surface.workspaceBusy;
  const panelVisible = isKnowledgeUniverseSearchPanelVisible(surface);
  bindKnowledgeUniverseSearchPanelLifecycle(panelVisible);

  return html`
    <section
      class="ku-home__command-bar ${panelVisible ? "is-panel-open" : ""}"
      data-testid="ku-home-command-bar"
      aria-label=${t("frontstage.workbench.knowledgeUniverse.search.label")}
    >
      <div class="ku-home__command-search">
        <div class="knowledge-universe__search-input-wrap ku-home__command-search-input">
          <input
            id=${KNOWLEDGE_UNIVERSE_SEARCH_INPUT_ID}
            class="knowledge-universe__search-input"
            type="search"
            .value=${surface.query}
            placeholder=${placeholder}
            aria-keyshortcuts="Meta+K Control+K"
            @input=${(event: Event) =>
              surface.onQueryChange((event.target as HTMLInputElement).value)}
            @keydown=${(event: KeyboardEvent) => {
              if (event.key === "Enter") {
                surface.onSearchPanelOpenChange(true);
                void surface.onSearch();
              }
            }}
          />
          <kbd class="knowledge-universe__search-kbd" aria-hidden="true">⌘K</kbd>
        </div>
        ${
          panelVisible
            ? renderKnowledgeUniverseSearchPanel({ surface, body: renderSearchPanelBody(surface) })
            : nothing
        }
      </div>
      <div class="ku-home__command-actions" role="group">
        <button
          type="button"
          class="ku-home__command-action ku-home__command-action--primary"
          data-testid="ku-home-action-search"
          ?disabled=${submitting}
          @click=${() => {
            surface.onSearchPanelOpenChange(true);
            void surface.onSearch();
          }}
        >
          <span class="ku-home__command-action-icon" aria-hidden="true">${kuIconSearch()}</span>
          <span class="ku-home__command-action-label">
            ${
              submitting
                ? t("frontstage.workbench.knowledgeUniverse.search.loading")
                : t("frontstage.workbench.knowledgeUniverse.search.action")
            }
          </span>
        </button>
        <button
          type="button"
          class="ku-home__command-action"
          data-testid="ku-home-action-upload"
          @click=${() => options.onUploadKnowledge()}
        >
          <span class="ku-home__command-action-icon" aria-hidden="true"
            >${kuIconDocumentUpload()}</span
          >
          <span class="ku-home__command-action-label">
            ${t("frontstage.workbench.knowledgeUniverse.home.commandBar.upload")}
          </span>
        </button>
        <button
          type="button"
          class="ku-home__command-action"
          data-testid="ku-home-action-data-capability"
          @click=${() => options.onOpenDataCapability()}
        >
          <span class="ku-home__command-action-icon" aria-hidden="true">${kuIconDatabase()}</span>
          <span class="ku-home__command-action-label">
            ${t("frontstage.workbench.knowledgeUniverse.home.commandBar.dataCapability")}
          </span>
        </button>
        <button
          type="button"
          class="ku-home__command-action"
          data-testid="ku-home-action-assets"
          @click=${() => options.onOpenMyAssets()}
        >
          <span class="ku-home__command-action-icon" aria-hidden="true">${kuIconChart()}</span>
          <span class="ku-home__command-action-label">
            ${t("frontstage.workbench.knowledgeUniverse.home.commandBar.myAssets")}
          </span>
        </button>
        <button
          type="button"
          class="ku-home__command-action"
          data-testid="ku-home-action-governance"
          @click=${() => options.onOpenGovernance()}
        >
          <span class="ku-home__command-action-icon" aria-hidden="true">${kuIconShield()}</span>
          <span class="ku-home__command-action-label">
            ${t("frontstage.workbench.knowledgeUniverse.home.commandBar.governance")}
          </span>
        </button>
      </div>
    </section>
  `;
}
