import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import {
  documentKnowledgeNodeId,
  documentKnowledgeObjectId,
  findRelationshipNodeByObjectIdCandidates,
} from "../capability/knowledge-universe/object-id.ts";
import type {
  KnowledgeHomeFocusKind,
  WorkbenchKnowledgeSurface,
} from "../ports/employee/views/home-page-contracts.ts";
import { KNOWLEDGE_UNIVERSE_ANCHORS } from "./knowledge-universe-anchors.ts";
import {
  renderKnowledgeUniverseGraphCanvas,
  renderKnowledgeUniverseGraphToolbar,
} from "./knowledge-universe-graph-canvas.ts";
import { buildHomeCockpitInsights } from "./knowledge-universe-home-cockpit-insights.ts";
import { renderKnowledgeUniverseHomeDocumentReader } from "./knowledge-universe-home-document-reader.ts";
import { renderKnowledgeUniverseHomeGovernanceActions } from "./knowledge-universe-home-governance-actions.ts";
import { kuIconFile, kuIconLink } from "./knowledge-universe-icons.ts";

export type KnowledgeUniverseHomeRelationsCockpitOptions = {
  /** Opens the standalone relations panorama page. */
  onExpandRelations: () => void;
  /** Opens the governance secondary page. */
  onOpenGovernance: () => void;
};

function focusKindLabel(kind: KnowledgeHomeFocusKind): string {
  return t(`frontstage.workbench.knowledgeUniverse.home.focus.${kind}`);
}

const GOVERNANCE_TASK_LABEL_KEY: Record<string, string> = {
  duplicate: "taskDuplicate",
  conflict: "taskConflict",
  claim_conflict: "taskClaimConflict",
  stale: "taskStale",
  orphan: "taskOrphan",
};

function governanceTaskLabel(taskType: string): string {
  const key = GOVERNANCE_TASK_LABEL_KEY[taskType];
  return key ? t(`frontstage.workbench.knowledgeUniverse.governance.${key}`) : taskType;
}

/**
 * Derive the graph node that the current homeFocus points at (document / deliverable → the node
 * whose objectId or id matches). Returned to the canvas as the auto-center target so a left-side
 * click pans the topology to center on that node. Tasks are excluded (they drive the per-task
 * governance graph, not the home topology).
 */
function resolveHomeFocusNodeId(surface: WorkbenchKnowledgeSurface): string | null {
  const focus = surface.homeFocus;
  if (!focus) {
    return null;
  }
  if (focus.kind === "document") {
    // Prefer the focused document node; never fall back to a stale selectedNodeId that may
    // still point at a KB node from the previous panorama load.
    return (
      findRelationshipNodeByObjectIdCandidates(surface.graph, documentKnowledgeObjectId(focus.id))
        ?.id ??
      findRelationshipNodeByObjectIdCandidates(surface.graph, focus.id)?.id ??
      (surface.selectedNodeId === documentKnowledgeNodeId(focus.id)
        ? surface.selectedNodeId
        : documentKnowledgeNodeId(focus.id))
    );
  }
  if (focus.kind === "deliverable") {
    return (
      findRelationshipNodeByObjectIdCandidates(surface.graph, `obj:deliverable:${focus.id}`)?.id ??
      surface.selectedNodeId
    );
  }
  if (focus.kind === "knowledge-base") {
    // Library panorama: center on the first document node when present.
    return surface.graph?.nodes.find((node) => node.kind === "knowledge-object")?.id ?? null;
  }
  return null;
}

function documentHasCrossDocEdges(surface: WorkbenchKnowledgeSurface, docId: string): boolean {
  const nodeId =
    findRelationshipNodeByObjectIdCandidates(surface.graph, documentKnowledgeObjectId(docId))?.id ??
    documentKnowledgeNodeId(docId);
  return (surface.graph?.edges ?? []).some(
    (edge) => edge.sourceId === nodeId || edge.targetId === nodeId,
  );
}

/** Human-readable label for the current home anchor, resolved from the unified homeFocus. */
function resolveHomeFocusLabel(
  surface: WorkbenchKnowledgeSurface,
): { kindLabel: string; label: string } | null {
  const focus = surface.homeFocus;
  if (!focus) {
    return null;
  }
  if (focus.kind === "document") {
    const doc = surface.libraryWorkspaceDocuments.find((item) => item.docId === focus.id);
    if (doc) {
      return { kindLabel: focusKindLabel("document"), label: doc.title };
    }
    const node =
      findRelationshipNodeByObjectIdCandidates(
        surface.graph,
        documentKnowledgeObjectId(focus.id),
      ) ?? findRelationshipNodeByObjectIdCandidates(surface.graph, focus.id);
    if (node) {
      return { kindLabel: focusKindLabel("document"), label: node.title };
    }
    // Never substitute the knowledge-base folder title for a missing document title.
    return { kindLabel: focusKindLabel("document"), label: focus.id };
  }
  if (focus.kind === "deliverable") {
    const deliverable = surface.workspaceDeliverables.find(
      (item) => item.deliverableId === focus.id,
    );
    return { kindLabel: focusKindLabel("deliverable"), label: deliverable?.title ?? focus.id };
  }
  if (focus.kind === "knowledge-base") {
    const kb =
      surface.knowledgeBases?.find((item) => item.id === focus.id) ??
      surface.knowledgeBases?.find((item) => item.id === focus.kbId);
    return {
      kindLabel: focusKindLabel("knowledge-base"),
      label: kb?.title ?? focus.id,
    };
  }
  const task = surface.governanceTasks.find((item) => item.id === focus.id);
  return {
    kindLabel: focusKindLabel("task"),
    label: task ? governanceTaskLabel(task.taskType) : focus.id,
  };
}

/**
 * Right cockpit (75% column): relation topology dominates; pending governance items collapse
 * into a single scrolling ticker strip so the graph can claim the remaining height.
 */
export function renderKnowledgeUniverseHomeRelationsCockpit(
  surface: WorkbenchKnowledgeSurface,
  options: KnowledgeUniverseHomeRelationsCockpitOptions,
) {
  const focusLabel = resolveHomeFocusLabel(surface);
  const cockpitInsights = buildHomeCockpitInsights(surface);
  const activeTab = surface.homeCockpitTab === "document" ? "document" : "relations";
  const showGraphLoading = activeTab === "relations" && Boolean(surface.graphLoading);
  const showNoCrossDocHint =
    activeTab === "relations" &&
    !showGraphLoading &&
    surface.homeFocus?.kind === "document" &&
    !documentHasCrossDocEdges(surface, surface.homeFocus.id);
  const showEmptyLibraryHint =
    activeTab === "relations" &&
    !showGraphLoading &&
    surface.homeFocus?.kind === "knowledge-base" &&
    (surface.graph?.nodes.length ?? 0) === 0;

  return html`
    <section
      id=${KNOWLEDGE_UNIVERSE_ANCHORS.relations}
      class="ku-home-cockpit"
      data-testid="ku-home-relations-cockpit"
      aria-label=${
        activeTab === "document"
          ? t("frontstage.workbench.knowledgeUniverse.home.documentReader.title")
          : t("frontstage.workbench.knowledgeUniverse.home.relationsCockpit.title")
      }
    >
      <header class="ku-home-cockpit__head">
        <div class="ku-home-cockpit__head-main">
          <div class="ku-home-cockpit__head-row">
            <div class="ku-home-cockpit__tabs" role="tablist" data-testid="ku-home-cockpit-tabs">
              <button
                type="button"
                role="tab"
                class="ku-home-cockpit__tab ${activeTab === "relations" ? "is-active" : ""}"
                data-testid="ku-home-cockpit-tab-relations"
                aria-selected=${activeTab === "relations" ? "true" : "false"}
                @click=${() => surface.onHomeCockpitTabChange?.("relations")}
              >
                <span class="ku-home-cockpit__title-icon" aria-hidden="true">${kuIconLink()}</span>
                ${t("frontstage.workbench.knowledgeUniverse.home.relationsCockpit.title")}
              </button>
              <button
                type="button"
                role="tab"
                class="ku-home-cockpit__tab ${activeTab === "document" ? "is-active" : ""}"
                data-testid="ku-home-cockpit-tab-document"
                aria-selected=${activeTab === "document" ? "true" : "false"}
                @click=${() => surface.onHomeCockpitTabChange?.("document")}
              >
                <span class="ku-home-cockpit__title-icon" aria-hidden="true">${kuIconFile()}</span>
                ${t("frontstage.workbench.knowledgeUniverse.home.documentReader.title")}
              </button>
            </div>
            ${
              focusLabel
                ? html`<span
                    class="ku-home-cockpit__anchor"
                    data-testid="ku-home-cockpit-anchor"
                    title=${`${t(
                      "frontstage.workbench.knowledgeUniverse.home.relationsCockpit.anchorLabel",
                    )}: ${focusLabel.label}`}
                  >
                    <span class="ku-home-cockpit__anchor-kind">${focusLabel.kindLabel}</span>
                    <span class="ku-home-cockpit__anchor-value">${focusLabel.label}</span>
                  </span>`
                : html`<span class="ku-home-cockpit__anchor ku-home-cockpit__anchor--empty">
                    ${t("frontstage.workbench.knowledgeUniverse.home.relationsCockpit.noAnchor")}
                  </span>`
            }
          </div>
          ${
            showGraphLoading
              ? html`<p class="ku-home-cockpit__hint" data-testid="ku-home-cockpit-graph-loading">
                  ${t("frontstage.workbench.knowledgeUniverse.home.relationsCockpit.loadingGraph")}
                </p>`
              : showNoCrossDocHint
                ? html`<p class="ku-home-cockpit__hint" data-testid="ku-home-cockpit-no-cross-doc">
                  ${t(
                    "frontstage.workbench.knowledgeUniverse.home.relationsCockpit.noCrossDocRelations",
                  )}
                </p>`
                : showEmptyLibraryHint
                  ? html`<p class="ku-home-cockpit__hint" data-testid="ku-home-cockpit-empty-library">
                    ${t(
                      "frontstage.workbench.knowledgeUniverse.home.relationsCockpit.emptyLibraryPanorama",
                    )}
                  </p>`
                  : nothing
          }
        </div>
        <div class="ku-home-cockpit__head-actions">
          ${
            activeTab === "relations"
              ? renderKnowledgeUniverseGraphToolbar({
                  className: "ku-home-cockpit__graph-tools ku-home-cockpit__graph-tools--head",
                  onZoom: surface.onZoom,
                  onResetView: surface.onResetView,
                  onExpand: () => options.onExpandRelations(),
                })
              : nothing
          }
        </div>
      </header>

      ${
        activeTab === "document"
          ? renderKnowledgeUniverseHomeDocumentReader(surface)
          : html`
              <div class="ku-home-cockpit__topology" data-testid="ku-home-cockpit-topology">
                <div class="ku-home-cockpit__topology-stage">
                  ${renderKnowledgeUniverseGraphCanvas({
                    graph: surface.graph,
                    graphViewModel: surface.graphViewModel,
                    selectedNodeId: surface.selectedNodeId,
                    hoveredNodeId: surface.hoveredNodeId,
                    zoom: surface.graphZoom,
                    panX: surface.graphPanX,
                    panY: surface.graphPanY,
                    viewportId: "ku-home-graph-viewport",
                    autoCenterNodeId: resolveHomeFocusNodeId(surface),
                    showToolbar: false,
                    onSelectNode: (nodeId) => void surface.onSelectNode(nodeId),
                    onHoverNode: surface.onHoverNode,
                    onZoom: surface.onZoom,
                    onPan: surface.onPan,
                    onResetView: surface.onResetView,
                  })}
                </div>
              </div>
              ${renderKnowledgeUniverseHomeGovernanceActions(surface, options, cockpitInsights)}
            `
      }
    </section>
  `;
}
