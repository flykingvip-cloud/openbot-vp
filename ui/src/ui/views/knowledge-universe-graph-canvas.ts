import { html, nothing, svg } from "lit";
import { t } from "../../i18n/index.ts";
import { formatGraphNodeLabelLines } from "../capability/knowledge-universe/graph-layout.ts";
import { findNeighborNodeIds } from "../capability/knowledge-universe/graph-view-model.ts";
import {
  graphCategoryLabel,
  graphGovernanceStatusLabel,
  relationshipEdgeTypeLabel,
} from "../capability/knowledge-universe/node-kind-labels.ts";
import type {
  GraphViewModel,
  GraphViewNodeCategory,
  RelationshipEdgeType,
  RelationshipGraph,
  RelationshipNodeGovernanceStatus,
} from "../capability/knowledge-universe/types.ts";
import {
  kuIconExpand,
  kuIconResetView,
  kuIconZoomIn,
  kuIconZoomOut,
} from "./knowledge-universe-icons.ts";

function categoryClass(category: GraphViewModel["nodes"][number]["category"]) {
  return `knowledge-universe__graph-node--${category}`;
}

/**
 * Focus-driven auto-centering. When the home cockpit anchor (homeFocus) resolves to a graph node,
 * the canvas pans so that node sits at the viewport center. We measure real on-screen geometry and
 * feed the delta back through `onPan` (which is additive screen-px), so centering stays correct at
 * any zoom without re-deriving the viewBox↔pixel mapping. State is keyed per viewport so it runs
 * once per focus change and never fights the user's subsequent manual pan/zoom.
 */
const graphAutoCenterDone = new Map<string, string>();
const graphAutoCenterScheduled = new Map<string, string>();

/**
 * Pan-vs-click disambiguation for the pannable viewport.
 *
 * The viewport handles drag-to-pan via pointer events. We intentionally do NOT call
 * `setPointerCapture` on the viewport: capturing the pointer there retargets the trailing
 * synthesized `click` away from the node `<g>` (to the viewport), which silently broke node
 * selection entirely (clicking a node never populated the detail panel). Panning still works via
 * the window-level pointermove/pointerup listeners, so capture is unnecessary.
 *
 * The remaining edge is that a genuine pan-drag also ends in a `click`; if it lands on a node it
 * would select it. So when the pointer travels past this threshold between pointerdown and
 * pointerup we flag the interaction as a pan and skip that one node click.
 */
const GRAPH_DRAG_CLICK_THRESHOLD_PX = 6;
let graphPanSuppressNodeClick = false;

/** Test-only: clear the per-viewport auto-center memo so specs start from a clean slate. */
export function resetGraphAutoCenterStateForTests() {
  graphAutoCenterDone.clear();
  graphAutoCenterScheduled.clear();
  graphPanSuppressNodeClick = false;
}

function scheduleGraphAutoCenter(
  viewportId: string,
  nodeId: string,
  onPan: (dx: number, dy: number) => void,
) {
  if (graphAutoCenterDone.get(viewportId) === nodeId) {
    return;
  }
  if (graphAutoCenterScheduled.get(viewportId) === nodeId) {
    return;
  }
  if (typeof requestAnimationFrame !== "function") {
    return;
  }
  graphAutoCenterScheduled.set(viewportId, nodeId);
  requestAnimationFrame(() => {
    graphAutoCenterScheduled.delete(viewportId);
    const viewport = document.getElementById(viewportId);
    if (!viewport) {
      return;
    }
    let nodeEl: Element | null = null;
    for (const candidate of viewport.querySelectorAll("[data-node-id]")) {
      if (candidate.getAttribute("data-node-id") === nodeId) {
        nodeEl = candidate.querySelector("circle") ?? candidate;
        break;
      }
    }
    if (!nodeEl) {
      // Node not painted yet (e.g. graph still loading for a freshly selected space); a later
      // render will reschedule once it appears.
      return;
    }
    graphAutoCenterDone.set(viewportId, nodeId);
    const viewportRect = viewport.getBoundingClientRect();
    const nodeRect = nodeEl.getBoundingClientRect();
    const dx = viewportRect.left + viewportRect.width / 2 - (nodeRect.left + nodeRect.width / 2);
    const dy = viewportRect.top + viewportRect.height / 2 - (nodeRect.top + nodeRect.height / 2);
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      onPan(dx, dy);
    }
  });
}

const LEGEND_CATEGORY_ORDER: GraphViewNodeCategory[] = [
  "knowledge",
  "knowledge-base",
  "deliverable",
  "data",
  "agent",
  "project",
  "owner",
];
const LEGEND_RELATION_ORDER: RelationshipEdgeType[] = [
  "related",
  "supports",
  "derived-from",
  "archived-into",
  "used-by",
  "recommended-for",
  "owned-by",
  "conflicts",
];
const LEGEND_STATUS_ORDER: RelationshipNodeGovernanceStatus[] = [
  "conflict",
  "attention",
  "dormant",
];

/**
 * Relations with no inherent direction render as plain lines; every other relation is directional
 * (lineage / flow / ownership) and gets an arrowhead pointing at the target so the knowledge flow
 * is legible on the canvas (e.g. 成果 --沉淀入--> 知识库).
 */
const SYMMETRIC_RELATIONS = new Set<RelationshipEdgeType>(["related", "conflicts"]);

/**
 * Graph legend — makes the semantic encoding legible: node color = knowledge type, line
 * style/color = relation type (引用/相似/冲突/继承/来源…), corner dot = governance status. Only the
 * types/relations/statuses actually present in the current graph are shown, and each glyph reuses
 * the real node/edge/badge CSS classes so the legend can never drift from the rendered graph.
 */
function renderGraphLegend(viewModel: GraphViewModel) {
  const presentCategories = new Set(viewModel.nodes.map((node) => node.category));
  const presentRelations = new Set(viewModel.edges.map((edge) => edge.relationType));
  const presentStatuses = new Set(
    viewModel.nodes
      .map((node) => node.governance?.status)
      .filter((status): status is RelationshipNodeGovernanceStatus => !!status),
  );
  const categories = LEGEND_CATEGORY_ORDER.filter((category) => presentCategories.has(category));
  const relations = LEGEND_RELATION_ORDER.filter((relation) => presentRelations.has(relation));
  const statuses = LEGEND_STATUS_ORDER.filter((status) => presentStatuses.has(status));
  return html`
    <div class="knowledge-universe__graph-legend" data-testid="ku-graph-legend">
      <div class="knowledge-universe__graph-legend-group">
        <span class="knowledge-universe__graph-legend-title"
          >${t("frontstage.workbench.knowledgeUniverse.graph.legend.nodes")}</span
        >
        ${categories.map(
          (category) => html`
            <span class="knowledge-universe__graph-legend-item">
              <svg
                class="knowledge-universe__graph-legend-glyph"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <g class=${`knowledge-universe__graph-node ${categoryClass(category)}`}>
                  <circle cx="8" cy="8" r="6"></circle>
                </g>
              </svg>
              ${graphCategoryLabel(category)}
            </span>
          `,
        )}
      </div>
      <div class="knowledge-universe__graph-legend-group">
        <span class="knowledge-universe__graph-legend-title"
          >${t("frontstage.workbench.knowledgeUniverse.graph.legend.relations")}</span
        >
        ${relations.map(
          (relation) => html`
            <span class="knowledge-universe__graph-legend-item">
              <svg
                class="knowledge-universe__graph-legend-line"
                viewBox="0 0 24 8"
                aria-hidden="true"
              >
                <line
                  class=${`knowledge-universe__graph-edge knowledge-universe__graph-edge--${relation} ${relation === "conflicts" ? "is-conflict" : ""}`}
                  x1="1"
                  y1="4"
                  x2="23"
                  y2="4"
                ></line>
              </svg>
              ${relationshipEdgeTypeLabel(relation)}
            </span>
          `,
        )}
      </div>
      ${
        statuses.length
          ? html`<div class="knowledge-universe__graph-legend-group">
              <span class="knowledge-universe__graph-legend-title"
                >${t("frontstage.workbench.knowledgeUniverse.graph.legend.status")}</span
              >
              ${statuses.map(
                (status) => html`
                  <span class="knowledge-universe__graph-legend-item">
                    <svg
                      class="knowledge-universe__graph-legend-glyph"
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                    >
                      <g class="knowledge-universe__graph-node">
                        <circle
                          class=${`knowledge-universe__graph-node-badge knowledge-universe__graph-node-badge--${status}`}
                          cx="8"
                          cy="8"
                          r="5"
                        ></circle>
                      </g>
                    </svg>
                    ${graphGovernanceStatusLabel(status)}
                  </span>
                `,
              )}
            </div>`
          : nothing
      }
    </div>
  `;
}

/** Icon-only zoom / reset (/ optional expand) controls for the graph chrome. */
export function renderKnowledgeUniverseGraphToolbar(params: {
  onZoom: (delta: number) => void;
  onResetView: () => void;
  onExpand?: () => void;
  className?: string;
}) {
  return html`
    <div
      class=${params.className ?? "knowledge-universe__graph-toolbar"}
      data-testid="ku-graph-toolbar"
      role="toolbar"
      aria-label=${t("frontstage.workbench.knowledgeUniverse.graph.toolbarLabel")}
    >
      <button
        type="button"
        class="ku-graph-tool-btn"
        data-testid="ku-graph-zoom-in"
        title=${t("frontstage.workbench.knowledgeUniverse.graph.zoomIn")}
        aria-label=${t("frontstage.workbench.knowledgeUniverse.graph.zoomIn")}
        @click=${() => params.onZoom(0.1)}
      >
        ${kuIconZoomIn("ku-graph-tool-btn__icon")}
      </button>
      <button
        type="button"
        class="ku-graph-tool-btn"
        data-testid="ku-graph-zoom-out"
        title=${t("frontstage.workbench.knowledgeUniverse.graph.zoomOut")}
        aria-label=${t("frontstage.workbench.knowledgeUniverse.graph.zoomOut")}
        @click=${() => params.onZoom(-0.1)}
      >
        ${kuIconZoomOut("ku-graph-tool-btn__icon")}
      </button>
      <button
        type="button"
        class="ku-graph-tool-btn"
        data-testid="ku-graph-reset"
        title=${t("frontstage.workbench.knowledgeUniverse.graph.reset")}
        aria-label=${t("frontstage.workbench.knowledgeUniverse.graph.reset")}
        @click=${() => params.onResetView()}
      >
        ${kuIconResetView("ku-graph-tool-btn__icon")}
      </button>
      ${
        params.onExpand
          ? html`
              <button
                type="button"
                class="ku-graph-tool-btn"
                data-testid="ku-home-cockpit-expand"
                title=${t(
                  "frontstage.workbench.knowledgeUniverse.home.relationsCockpit.expandPanorama",
                )}
                aria-label=${t(
                  "frontstage.workbench.knowledgeUniverse.home.relationsCockpit.expandPanorama",
                )}
                @click=${() => params.onExpand?.()}
              >
                ${kuIconExpand("ku-graph-tool-btn__icon")}
              </button>
            `
          : nothing
      }
    </div>
  `;
}

export function renderKnowledgeUniverseGraphCanvas(params: {
  graph: RelationshipGraph | null;
  graphViewModel: GraphViewModel | null;
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  zoom: number;
  panX: number;
  panY: number;
  onSelectNode: (nodeId: string) => void;
  onHoverNode: (nodeId: string | null) => void;
  onZoom: (delta: number) => void;
  onPan: (dx: number, dy: number) => void;
  onResetView: () => void;
  /** DOM id placed on the viewport so focus-driven auto-centering can measure it. */
  viewportId?: string;
  /** When set (and mapped to a rendered node), the canvas pans to center that node once. */
  autoCenterNodeId?: string | null;
  /** When false, omit the inline toolbar (e.g. home cockpit lifts it into the header). */
  showToolbar?: boolean;
}) {
  const viewModel = params.graphViewModel;
  if (!viewModel || !params.graph) {
    return html`
      <section class="knowledge-universe__graph-shell">
        <div class="knowledge-universe__graph-empty">
          ${t("frontstage.workbench.knowledgeUniverse.graph.loading")}
        </div>
      </section>
    `;
  }

  const isEmptyGraph =
    viewModel.edges.length === 0 &&
    viewModel.nodes.filter((node) => node.id !== "node:me").length === 0;
  if (isEmptyGraph) {
    return html`
      <section class="knowledge-universe__graph-shell">
        <div class="knowledge-universe__graph-empty">
          ${t("frontstage.workbench.knowledgeUniverse.graph.empty")}
        </div>
      </section>
    `;
  }

  const focusId = params.hoveredNodeId ?? params.selectedNodeId;
  const highlighted = findNeighborNodeIds(params.graph, focusId);
  const nodeById = new Map(viewModel.nodes.map((node) => [node.id, node]));

  if (params.viewportId && params.autoCenterNodeId) {
    scheduleGraphAutoCenter(params.viewportId, params.autoCenterNodeId, params.onPan);
  }

  const showToolbar = params.showToolbar !== false;

  return html`
    <section class="knowledge-universe__graph-shell">
      ${
        showToolbar
          ? renderKnowledgeUniverseGraphToolbar({
              onZoom: params.onZoom,
              onResetView: params.onResetView,
            })
          : nothing
      }
      <div
        class="knowledge-universe__graph-viewport"
        id=${params.viewportId ?? nothing}
        @wheel=${(event: WheelEvent) => {
          event.preventDefault();
          params.onZoom(event.deltaY < 0 ? 0.08 : -0.08);
        }}
        @pointerdown=${(event: PointerEvent) => {
          let lastX = event.clientX;
          let lastY = event.clientY;
          let traveled = 0;
          // A fresh press starts as a potential click; only a drag past the threshold turns it
          // into a pan (and suppresses the trailing node click).
          graphPanSuppressNodeClick = false;
          const move = (moveEvent: PointerEvent) => {
            const dx = moveEvent.clientX - lastX;
            const dy = moveEvent.clientY - lastY;
            traveled += Math.abs(dx) + Math.abs(dy);
            if (traveled > GRAPH_DRAG_CLICK_THRESHOLD_PX) {
              graphPanSuppressNodeClick = true;
            }
            params.onPan(dx, dy);
            lastX = moveEvent.clientX;
            lastY = moveEvent.clientY;
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      >
        <svg
          class="knowledge-universe__graph-canvas"
          viewBox="0 0 ${viewModel.width} ${viewModel.height}"
          style=${`transform: translate(${params.panX}px, ${params.panY}px) scale(${params.zoom});`}
        >
          <defs>
            <marker
              id="ku-graph-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0,0 L10,5 L0,10 Z" fill="context-stroke"></path>
            </marker>
          </defs>
          <g class="knowledge-universe__graph-edges">
            ${viewModel.edges.map((edge) => {
              const source = nodeById.get(edge.sourceId);
              const target = nodeById.get(edge.targetId);
              if (!source || !target) {
                return nothing;
              }
              const touchesFocus =
                !!focusId && (edge.sourceId === focusId || edge.targetId === focusId);
              const active =
                focusId &&
                (touchesFocus ||
                  (highlighted.has(edge.sourceId) && highlighted.has(edge.targetId)));
              const isConflict = edge.relationType === "conflicts";
              // Label edges touching the focused node (and always conflicts) so users can read
              // *why* two nodes connect, without cluttering the whole graph with labels.
              const showLabel = touchesFocus || isConflict;
              // Directional relations get an arrowhead at the target; pull the endpoint back to the
              // node's edge so the arrow sits at the boundary instead of hidden under the circle.
              const directed = !SYMMETRIC_RELATIONS.has(edge.relationType);
              let targetX = target.x;
              let targetY = target.y;
              if (directed) {
                const dx = target.x - source.x;
                const dy = target.y - source.y;
                const len = Math.hypot(dx, dy) || 1;
                const gap = target.radius + 4;
                targetX = target.x - (dx / len) * gap;
                targetY = target.y - (dy / len) * gap;
              }
              return svg`
                <g class="knowledge-universe__graph-edge-group">
                  <line
                    class=${`knowledge-universe__graph-edge knowledge-universe__graph-edge--${edge.relationType} ${active ? "is-active" : ""} ${isConflict ? "is-conflict" : ""}`}
                    x1=${source.x}
                    y1=${source.y}
                    x2=${targetX}
                    y2=${targetY}
                    marker-end=${directed ? "url(#ku-graph-arrow)" : nothing}
                  ></line>
                  ${
                    showLabel
                      ? svg`<text
                          class=${`knowledge-universe__graph-edge-label ${isConflict ? "is-conflict" : ""}`}
                          x=${(source.x + target.x) / 2}
                          y=${(source.y + target.y) / 2}
                          text-anchor="middle"
                          dominant-baseline="central"
                          >${relationshipEdgeTypeLabel(edge.relationType)}</text
                        >`
                      : nothing
                  }
                </g>
              `;
            })}
          </g>
          <g class="knowledge-universe__graph-nodes">
            ${viewModel.nodes.map((node) => {
              const active =
                node.id === params.selectedNodeId ||
                node.id === params.hoveredNodeId ||
                (focusId ? highlighted.has(node.id) : false);
              // Phase 2 → aligned overlay: the type hue stays the node fill; governance now shows
              // as a status ring (via --gov-* stroke) plus a corner badge dot, so a node reads as
              // BOTH what it is (type color) and how healthy it is (status) instead of going
              // monochrome. Healthy nodes carry no badge to avoid clutter.
              const govStatus = node.governance?.status;
              const govClass = govStatus ? `knowledge-universe__graph-node--gov-${govStatus}` : "";
              const badgeStatus = govStatus && govStatus !== "healthy" ? govStatus : null;
              const badgeRadius = Math.max(4, node.radius * 0.3);
              return svg`
                <g
                  class=${`knowledge-universe__graph-node ${categoryClass(node.category)} ${govClass} ${active ? "is-active" : ""}`}
                  data-node-id=${node.id}
                  transform=${`translate(${node.x} ${node.y})`}
                  @click=${() => {
                    // Ignore the click that trails a pan-drag so panning doesn't select a node.
                    if (graphPanSuppressNodeClick) {
                      graphPanSuppressNodeClick = false;
                      return;
                    }
                    params.onSelectNode(node.id);
                  }}
                  @mouseenter=${() => params.onHoverNode(node.id)}
                  @mouseleave=${() => params.onHoverNode(null)}
                >
                  <circle r=${node.radius}></circle>
                  ${
                    badgeStatus
                      ? svg`<circle
                          class=${`knowledge-universe__graph-node-badge knowledge-universe__graph-node-badge--${badgeStatus}`}
                          cx=${node.radius * 0.72}
                          cy=${-node.radius * 0.72}
                          r=${badgeRadius}
                          data-badge-status=${badgeStatus}
                        ></circle>`
                      : nothing
                  }
                  <text
                    class="knowledge-universe__graph-node-label"
                    y=${node.radius + 14}
                    text-anchor="middle"
                  >
                    ${formatGraphNodeLabelLines(node.label).map(
                      (line, lineIndex) => svg`
                        <tspan x="0" dy=${lineIndex === 0 ? 0 : 13}>${line}</tspan>
                      `,
                    )}
                  </text>
                </g>
              `;
            })}
          </g>
        </svg>
      </div>
      ${renderGraphLegend(viewModel)}
    </section>
  `;
}
