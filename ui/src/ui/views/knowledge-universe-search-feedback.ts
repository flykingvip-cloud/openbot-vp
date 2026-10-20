import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { resolveNodeIdForObject } from "../capability/knowledge-universe/node-kind-labels.ts";
import type { KnowledgeObject, RelationshipGraph } from "../capability/knowledge-universe/types.ts";
import type {
  WorkspaceSearchGroup,
  WorkspaceSearchHit,
  WorkspaceSearchMode,
} from "../capability/knowledge-universe/workspace-endpoints.ts";
import { renderSearchHitTrustBadges } from "./knowledge-universe-trust-badges.ts";

const GROUP_I18N_KEY: Record<WorkspaceSearchGroup["group"], string> = {
  knowledge: "frontstage.workbench.knowledgeUniverse.search.groups.knowledge",
  enterprise: "frontstage.workbench.knowledgeUniverse.search.groups.enterprise",
  deliverables: "frontstage.workbench.knowledgeUniverse.search.groups.deliverables",
  capabilities: "frontstage.workbench.knowledgeUniverse.search.groups.capabilities",
  agents: "frontstage.workbench.knowledgeUniverse.search.groups.agents",
  owners: "frontstage.workbench.knowledgeUniverse.search.groups.owners",
};

function resolveHitNodeId(hit: WorkspaceSearchHit, graph: RelationshipGraph | null): string | null {
  if (hit.nodeId) {
    return hit.nodeId;
  }
  if (hit.objectId && graph) {
    return resolveNodeIdForObject(graph, hit.objectId) ?? null;
  }
  return null;
}

function renderHitButton(params: {
  hit: WorkspaceSearchHit;
  graph: RelationshipGraph | null;
  selectedHitId: string | null;
  onSelectHit: (hit: WorkspaceSearchHit) => void;
}) {
  const nodeId = resolveHitNodeId(params.hit, params.graph);
  const clickable = Boolean(
    nodeId ||
    params.hit.objectId ||
    params.hit.deliverableId ||
    params.hit.capabilityId ||
    params.hit.docId,
  );
  const content = html`
    <span class="knowledge-universe__search-hit-title">${params.hit.title}</span>
    ${
      params.hit.subtitle
        ? html`<span class="knowledge-universe__search-hit-subtitle">${params.hit.subtitle}</span>`
        : nothing
    }
    ${renderSearchHitTrustBadges(params.hit)}
  `;
  if (!clickable) {
    return html`<div class="knowledge-universe__search-hit knowledge-universe__search-hit--static">${content}</div>`;
  }
  return html`
    <button
      type="button"
      class="knowledge-universe__search-hit ${params.selectedHitId === params.hit.id ? "is-selected" : ""}"
      @click=${() => params.onSelectHit({ ...params.hit, nodeId: nodeId ?? params.hit.nodeId })}
    >
      ${content}
    </button>
  `;
}

export function renderKnowledgeUniverseSearchFeedback(params: {
  query: string;
  loading: boolean;
  searchResults: KnowledgeObject[];
  workspaceSearchGroups: WorkspaceSearchGroup[];
  workspaceSearchTotalCount: number;
  workspaceSearchMode: WorkspaceSearchMode | null;
  selectedWorkspaceSearchHitId: string | null;
  graph: RelationshipGraph | null;
  onSelectHit: (hit: WorkspaceSearchHit) => void;
  onSelectNode: (nodeId: string) => void;
  compact?: boolean;
}) {
  const trimmedQuery = params.query.trim();
  if (!trimmedQuery && !params.loading) {
    return nothing;
  }

  const groupedHits = params.workspaceSearchGroups.filter((group) => group.hits.length > 0);
  const useGrouped = groupedHits.length > 0 || params.workspaceSearchTotalCount > 0;
  const hitCount = useGrouped ? params.workspaceSearchTotalCount : params.searchResults.length;
  const graphNodeCount = params.graph?.nodes.length ?? 0;

  return html`
    <div
      class="knowledge-universe__search-feedback ${params.compact ? "knowledge-universe__search-feedback--compact" : ""}"
      role="status"
      aria-live="polite"
    >
      ${
        params.loading
          ? params.compact
            ? nothing
            : html`<div class="knowledge-universe__search-feedback-line">
                ${t("frontstage.workbench.knowledgeUniverse.search.feedbackLoading", {
                  query: trimmedQuery,
                })}
              </div>`
          : hitCount > 0
            ? html`
                ${
                  params.compact
                    ? nothing
                    : html`<div class="knowledge-universe__search-feedback-line">
                        ${t("frontstage.workbench.knowledgeUniverse.search.feedbackHits", {
                          query: trimmedQuery,
                          count: hitCount,
                          graphCount: graphNodeCount,
                        })}
                        ${
                          params.workspaceSearchMode
                            ? html`<span class="knowledge-universe__search-feedback-mode">
                                ${t(
                                  `frontstage.workbench.knowledgeUniverse.search.mode.${params.workspaceSearchMode}`,
                                )}
                              </span>`
                            : nothing
                        }
                      </div>`
                }
                ${
                  params.compact && params.workspaceSearchMode
                    ? html`<div class="knowledge-universe__search-feedback-mode-row">
                        <span class="knowledge-universe__search-feedback-mode">
                          ${t(
                            `frontstage.workbench.knowledgeUniverse.search.mode.${params.workspaceSearchMode}`,
                          )}
                        </span>
                      </div>`
                    : nothing
                }
                ${
                  useGrouped
                    ? groupedHits.map(
                        (group) => html`
                          <section class="knowledge-universe__search-group">
                            <div class="knowledge-universe__search-group-heading">
                              ${t(GROUP_I18N_KEY[group.group])}
                              <span class="knowledge-universe__search-group-count">${group.hits.length}</span>
                            </div>
                            <ul class="knowledge-universe__search-feedback-list">
                              ${group.hits.map(
                                (hit) => html`
                                  <li>
                                    ${renderHitButton({
                                      hit,
                                      graph: params.graph,
                                      selectedHitId: params.selectedWorkspaceSearchHitId,
                                      onSelectHit: params.onSelectHit,
                                    })}
                                  </li>
                                `,
                              )}
                            </ul>
                          </section>
                        `,
                      )
                    : html`
                        <ul class="knowledge-universe__search-feedback-list">
                          ${params.searchResults.slice(0, 5).map((item) => {
                            const nodeId = resolveNodeIdForObject(params.graph, item.id);
                            return html`
                              <li>
                                ${
                                  nodeId
                                    ? html`
                                        <button
                                          type="button"
                                          class="knowledge-universe__search-feedback-item"
                                          @click=${() => params.onSelectNode(nodeId)}
                                        >
                                          <span>${item.title}</span>
                                        </button>
                                      `
                                    : html`<span class="knowledge-universe__search-feedback-item">${item.title}</span>`
                                }
                              </li>
                            `;
                          })}
                        </ul>
                      `
                }
              `
            : params.compact
              ? nothing
              : html`<div class="knowledge-universe__search-feedback-line knowledge-universe__search-feedback-line--empty">
                  ${t("frontstage.workbench.knowledgeUniverse.search.feedbackEmpty", {
                    query: trimmedQuery,
                    graphCount: graphNodeCount,
                  })}
                </div>`
      }
    </div>
  `;
}
