/**
 * Interactive mesh graph canvas — pan, node drag, search/kind filters.
 */

import { LitElement, html, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { pushAppHistoryState } from "../../../request-app-rerender.ts";
import { requestEnterpriseAppRerender } from "./enterprise-surface-shared.ts";
import {
  applyMeshNodePositions,
  buildMeshObjectHref,
  filterMeshGraphModel,
  layoutMeshBipartiteGraph,
  meshGraphNodeKey,
  truncateMeshGraphLabel,
  type MeshBipartiteLayoutNode,
  type MeshGraphModel,
  type MeshGraphViewFilter,
} from "./mesh-graphs-model.ts";

type DragState =
  | {
      mode: "pan";
      pointerId: number;
      startSvgX: number;
      startSvgY: number;
      originPanX: number;
      originPanY: number;
      moved: boolean;
    }
  | {
      mode: "node";
      pointerId: number;
      key: string;
      kind: "agent" | "group";
      id: string;
      startSvgX: number;
      startSvgY: number;
      originX: number;
      originY: number;
      moved: boolean;
    };

@customElement("enterprise-mesh-graph-canvas")
export class EnterpriseMeshGraphCanvas extends LitElement {
  @property({ attribute: false })
  model: MeshGraphModel = { agents: [], groups: [], edges: [] };

  @property({ type: String })
  basePath = "";

  @property({ attribute: false })
  tenantId: string | null = null;

  @state()
  private query = "";

  @state()
  private kind: MeshGraphViewFilter["kind"] = "all";

  @state()
  private connectedOnly = false;

  @state()
  private positions: Record<string, { x: number; y: number }> = {};

  @state()
  private pan = { x: 0, y: 0 };

  @state()
  private drag: DragState | null = null;

  protected createRenderRoot() {
    return this;
  }

  private get filter(): MeshGraphViewFilter {
    return {
      query: this.query,
      kind: this.kind,
      connectedOnly: this.connectedOnly,
    };
  }

  private resolveLayout() {
    const filtered = filterMeshGraphModel(this.model, this.filter);
    const base = layoutMeshBipartiteGraph(filtered);
    return applyMeshNodePositions(base, this.positions, filtered.edges);
  }

  private openHref(href: string) {
    if (typeof window === "undefined") {
      return;
    }
    pushAppHistoryState(href);
    requestEnterpriseAppRerender();
  }

  private resetView = () => {
    this.positions = {};
    this.pan = { x: 0, y: 0 };
    this.drag = null;
  };

  private resetFilters = () => {
    this.query = "";
    this.kind = "all";
    this.connectedOnly = false;
  };

  private clientToSvg(event: PointerEvent): { x: number; y: number } | null {
    const svgEl = this.querySelector("svg.enterprise-mesh-graphs__svg");
    if (!(svgEl instanceof SVGSVGElement)) {
      return null;
    }
    const point = svgEl.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svgEl.getScreenCTM();
    if (!matrix) {
      return null;
    }
    const local = point.matrixTransform(matrix.inverse());
    return { x: local.x, y: local.y };
  }

  private onPanPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as Element | null;
    if (target?.closest?.(".enterprise-mesh-graphs__node")) {
      return;
    }
    const svgPoint = this.clientToSvg(event);
    if (!svgPoint) {
      return;
    }
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    this.drag = {
      mode: "pan",
      pointerId: event.pointerId,
      startSvgX: svgPoint.x,
      startSvgY: svgPoint.y,
      originPanX: this.pan.x,
      originPanY: this.pan.y,
      moved: false,
    };
  };

  private onNodePointerDown = (event: PointerEvent, node: MeshBipartiteLayoutNode) => {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    const svgPoint = this.clientToSvg(event);
    if (!svgPoint) {
      return;
    }
    const svgEl = this.querySelector("svg.enterprise-mesh-graphs__svg");
    svgEl?.setPointerCapture?.(event.pointerId);
    this.drag = {
      mode: "node",
      pointerId: event.pointerId,
      key: meshGraphNodeKey(node.kind, node.id),
      kind: node.kind,
      id: node.id,
      startSvgX: svgPoint.x,
      startSvgY: svgPoint.y,
      originX: node.x,
      originY: node.y,
      moved: false,
    };
  };

  private onPointerMove = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const svgPoint = this.clientToSvg(event);
    if (!svgPoint) {
      return;
    }
    const dx = svgPoint.x - drag.startSvgX;
    const dy = svgPoint.y - drag.startSvgY;
    if (Math.hypot(dx, dy) > 3) {
      drag.moved = true;
    }
    if (drag.mode === "pan") {
      this.pan = {
        x: drag.originPanX + dx,
        y: drag.originPanY + dy,
      };
      return;
    }
    this.positions = {
      ...this.positions,
      [drag.key]: {
        x: drag.originX + dx,
        y: drag.originY + dy,
      },
    };
  };

  private onPointerUp = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const wasClick = !drag.moved && drag.mode === "node";
    const kind = drag.mode === "node" ? drag.kind : null;
    const id = drag.mode === "node" ? drag.id : null;
    this.drag = null;
    if (wasClick && kind && id) {
      this.openHref(
        buildMeshObjectHref(
          this.basePath,
          this.tenantId,
          kind === "agent" ? "agents" : "groups",
          id,
        ),
      );
    }
  };

  private renderToolbar(edgeCount: number, nodeCount: number) {
    return html`
      <div class="enterprise-mesh-graphs__canvas-head">
        <div>
          <h4>关系画布</h4>
          <p class="enterprise-mesh-graphs__hint">
            拖节点重排 · 拖空白平移 · 点击打开详情 · 可见 ${nodeCount} 节点 / ${edgeCount} 边
          </p>
        </div>
        <div class="enterprise-mesh-graphs__legend" aria-hidden="true">
          <span class="enterprise-mesh-graphs__legend-item enterprise-mesh-graphs__legend-item--agent"
            >机器人</span
          >
          <span class="enterprise-mesh-graphs__legend-item enterprise-mesh-graphs__legend-item--group"
            >协作组</span
          >
        </div>
      </div>
      <div class="enterprise-mesh-graphs__filters" role="toolbar" aria-label="图谱筛选">
        <input
          class="enterprise-mesh-graphs__search"
          type="search"
          placeholder="搜索机器人 / 协作组…"
          .value=${this.query}
          @input=${(event: Event) => {
            this.query = (event.target as HTMLInputElement).value;
          }}
        />
        <div class="enterprise-mesh-graphs__chips">
          ${(["all", "agent", "group"] as const).map((kind) => {
            const label = kind === "all" ? "全部" : kind === "agent" ? "机器人" : "协作组";
            return html`
              <button
                type="button"
                class="enterprise-mesh-graphs__chip ${this.kind === kind ? "is-active" : ""}"
                @click=${() => {
                  this.kind = kind;
                }}
              >
                ${label}
              </button>
            `;
          })}
          <button
            type="button"
            class="enterprise-mesh-graphs__chip ${this.connectedOnly ? "is-active" : ""}"
            ?disabled=${this.kind !== "all"}
            title=${this.kind !== "all" ? "仅在「全部」模式下可用" : "只显示有成员边的节点"}
            @click=${() => {
              this.connectedOnly = !this.connectedOnly;
            }}
          >
            仅已连接
          </button>
        </div>
        <div class="enterprise-mesh-graphs__filter-actions">
          <button type="button" class="btn" @click=${this.resetView}>重置布局</button>
          <button type="button" class="btn" @click=${this.resetFilters}>清空筛选</button>
        </div>
      </div>
    `;
  }

  render() {
    const layout = this.resolveLayout();
    if (this.model.agents.length === 0 && this.model.groups.length === 0) {
      return html`
        <section class="enterprise-mesh-graphs__canvas-card">
          <p class="enterprise-mesh-graphs__empty">暂无节点可绘制。先创建机器人或协作组。</p>
        </section>
      `;
    }

    return html`
      <section class="enterprise-mesh-graphs__canvas-card">
        ${this.renderToolbar(layout.visibleEdgeCount, layout.nodes.length)}
        ${
          layout.nodes.length === 0
            ? html`
                <p class="enterprise-mesh-graphs__empty">当前筛选无匹配节点，试试清空筛选。</p>
              `
            : html`
                <div
                  class="enterprise-mesh-graphs__canvas-scroll ${this.drag ? "is-dragging" : ""}"
                >
                  <svg
                    class="enterprise-mesh-graphs__svg"
                    viewBox=${`0 0 ${layout.width} ${layout.height}`}
                    width="100%"
                    role="img"
                    aria-label="能力与协作关系图谱"
                    @pointerdown=${this.onPanPointerDown}
                    @pointermove=${this.onPointerMove}
                    @pointerup=${this.onPointerUp}
                    @pointercancel=${this.onPointerUp}
                  >
                    <defs>
                      <marker
                        id="mesh-graph-arrow"
                        viewBox="0 0 10 10"
                        refX="8"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto-start-reverse"
                      >
                        <path
                          d="M 0 0 L 10 5 L 0 10 z"
                          class="enterprise-mesh-graphs__arrow"
                        ></path>
                      </marker>
                    </defs>
                    <rect
                      class="enterprise-mesh-graphs__pan-surface"
                      x="0"
                      y="0"
                      width=${layout.width}
                      height=${layout.height}
                      fill="transparent"
                    ></rect>
                    <g transform=${`translate(${this.pan.x} ${this.pan.y})`}>
                      ${layout.edges.map(
                        (edge) => svg`
                          <path
                            class="enterprise-mesh-graphs__edge"
                            d=${`M ${edge.x1} ${edge.y1} Q ${edge.cx} ${edge.cy} ${edge.x2} ${edge.y2}`}
                            fill="none"
                            marker-end="url(#mesh-graph-arrow)"
                          ></path>
                        `,
                      )}
                      ${layout.nodes.map((node) => {
                        const href = buildMeshObjectHref(
                          this.basePath,
                          this.tenantId,
                          node.kind === "agent" ? "agents" : "groups",
                          node.id,
                        );
                        const labelX =
                          node.kind === "agent" ? node.x - node.r - 8 : node.x + node.r + 8;
                        const anchor = node.kind === "agent" ? "end" : "start";
                        return svg`
                          <g
                            class="enterprise-mesh-graphs__node enterprise-mesh-graphs__node--${node.kind}"
                            role="button"
                            tabindex="0"
                            data-node-id=${node.id}
                            data-node-kind=${node.kind}
                            @pointerdown=${(event: PointerEvent) =>
                              this.onNodePointerDown(event, node)}
                            @click=${(event: MouseEvent) => {
                              event.preventDefault();
                            }}
                            @keydown=${(event: KeyboardEvent) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                this.openHref(href);
                              }
                            }}
                          >
                            <title>${node.name} · ${node.meta}</title>
                            <circle
                              cx=${node.x}
                              cy=${node.y}
                              r=${node.r + 4}
                              class="enterprise-mesh-graphs__node-halo"
                            ></circle>
                            <circle
                              cx=${node.x}
                              cy=${node.y}
                              r=${node.r}
                              class="enterprise-mesh-graphs__node-disk"
                            ></circle>
                            <text
                              x=${labelX}
                              y=${node.y - 4}
                              text-anchor=${anchor}
                              class="enterprise-mesh-graphs__node-label"
                            >${truncateMeshGraphLabel(node.name)}</text>
                            <text
                              x=${labelX}
                              y=${node.y + 12}
                              text-anchor=${anchor}
                              class="enterprise-mesh-graphs__node-meta"
                            >${truncateMeshGraphLabel(node.meta, 18)}</text>
                          </g>
                        `;
                      })}
                    </g>
                  </svg>
                </div>
              `
        }
        ${
          layout.truncatedAgents > 0 || layout.truncatedGroups > 0
            ? html`<p class="enterprise-mesh-graphs__hint">
                画布展示强度靠前的节点；另有 ${layout.truncatedAgents} 个机器人、
                ${layout.truncatedGroups} 个协作组见下方清单。
              </p>`
            : html`
                <p class="enterprise-mesh-graphs__hint">拖拽调整后可点「重置布局」恢复；筛选不影响下方完整清单。</p>
              `
        }
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "enterprise-mesh-graph-canvas": EnterpriseMeshGraphCanvas;
  }
}
