/**
 * 企业数据能力中心 — 数据资产全景图（DataAssetLandscapeGraph，Task 3.3）。
 *
 * 列式四层关系图（数据源→能力→知识→部门/岗位/角色），SVG 渲染。
 * 节点点击 → onOpenNode(nodeId)。空数据降级为引导卡。
 *
 * @module enterprise-data-capability/data-asset-landscape-graph
 */

import { html, nothing, svg, type TemplateResult } from "lit";
import type { AssetLandscapeGraph } from "../../capability/enterprise-data-capability/types.ts";
import {
  buildLandscapeViewModel,
  landscapeNodeTone,
  LANDSCAPE_NODE_HEIGHT,
  LANDSCAPE_NODE_WIDTH,
} from "../../controllers/enterprise-data-capability/landscape-view-model.ts";

export type DataAssetLandscapeGraphProps = {
  graph: AssetLandscapeGraph | null;
  loading: boolean;
  error: string | null;
  /** 选中节点 id（高亮）。 */
  selectedNodeId?: string | null;
  onOpenNode: (nodeId: string) => void;
};

const COLUMN_TITLES = ["数据源", "数据能力", "知识供给", "开放对象"] as const;
const COLUMN_X = [90, 320, 550, 790] as const;

function renderColumnHeaders(): TemplateResult[] {
  return COLUMN_TITLES.map(
    (title, index) =>
      svg`<text x=${COLUMN_X[index] + LANDSCAPE_NODE_WIDTH / 2} y="24" text-anchor="middle"
      class="enterprise-data-capability__graph-coltitle">${title}</text>`,
  );
}

export function renderDataAssetLandscapeGraph(props: DataAssetLandscapeGraphProps): TemplateResult {
  let body: TemplateResult;
  if (props.error && !props.graph) {
    body = html`<div class="enterprise-data-capability__hint" role="alert">${props.error}</div>`;
  } else if (props.loading && !props.graph) {
    body = html`
      <div class="enterprise-data-capability__hint" aria-busy="true">加载中…</div>
    `;
  } else if (!props.graph || props.graph.nodes.length === 0) {
    body = html`
      <div class="enterprise-data-capability__hint">暂无资产关系数据，先接入数据源并配置能力与授权。</div>
    `;
  } else {
    const vm = buildLandscapeViewModel(props.graph);
    body = html`
      <div class="enterprise-data-capability__graph-scroll">
        <svg
          class="enterprise-data-capability__graph-svg"
          viewBox=${`0 0 ${vm.width} ${vm.height}`}
          width=${vm.width}
          height=${vm.height}
          role="img"
          aria-label="数据资产全景图"
        >
          ${renderColumnHeaders()}
          ${vm.edges.map(
            (edge) => svg`<line
              x1=${edge.x1} y1=${edge.y1} x2=${edge.x2} y2=${edge.y2}
              class="enterprise-data-capability__graph-edge enterprise-data-capability__graph-edge--${edge.relation}"
            />`,
          )}
          ${vm.nodes.map((node) => {
            const selected = props.selectedNodeId === node.id;
            return svg`<g
              class="enterprise-data-capability__graph-node enterprise-data-capability__graph-node--${landscapeNodeTone(node.kind)} ${selected ? "is-selected" : ""}"
              role="button"
              tabindex="0"
              @click=${() => props.onOpenNode(node.id)}
              @keydown=${(event: KeyboardEvent) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  props.onOpenNode(node.id);
                }
              }}
            >
              <rect x=${node.x} y=${node.y} rx="6" ry="6"
                width=${LANDSCAPE_NODE_WIDTH} height=${LANDSCAPE_NODE_HEIGHT} />
              <text x=${node.x + 10} y=${node.y + LANDSCAPE_NODE_HEIGHT / 2 + 4}
                class="enterprise-data-capability__graph-nodelabel">${node.label}</text>
            </g>`;
          })}
        </svg>
      </div>
      ${
        props.graph.truncated
          ? html`
              <div class="enterprise-data-capability__hint">图谱已按规模截断，仅展示部分能力。</div>
            `
          : nothing
      }
    `;
  }

  return html`
    <section
      class="enterprise-card enterprise-data-capability__panel enterprise-data-capability__graph"
      aria-label="数据资产全景图"
    >
      <div class="enterprise-data-capability__panel-title">企业数据资产全景图</div>
      ${body}
    </section>
  `;
}
