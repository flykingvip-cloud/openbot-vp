/**
 * 企业数据能力中心 — 资产全景图节点 Drawer（Task 3.4，v1 邻居视图）。
 *
 * v1：从已加载的图就地展示节点邻居（来源/生成/开放），不发起额外 RPC。
 * 能力节点：来源数据源（incoming source）+ 知识供给（outgoing generate）。
 * 数据源节点：能力（outgoing source）+ 开放对象（outgoing open）。
 * 「最近运行」等富字段待 Phase 4（独立 runtime/audit 汇总）。
 *
 * @module enterprise-data-capability/node-detail-drawer
 */

import { html, nothing, type TemplateResult } from "lit";
import type { AssetLandscapeGraph } from "../../capability/enterprise-data-capability/types.ts";
import {
  resolveLandscapeNeighbors,
  type LandscapeNeighbors,
} from "../../controllers/enterprise-data-capability/landscape-view-model.ts";

export type NodeDetailDrawerProps = {
  graph: AssetLandscapeGraph | null;
  selectedNodeId: string | null;
  onClose: () => void;
};

const KIND_LABEL: Record<string, string> = {
  source: "数据源",
  capability: "数据能力",
  knowledge: "知识供给",
  department: "部门",
  seat: "岗位",
  role: "角色",
};

const RELATION_LABEL: Record<string, string> = {
  source: "来源数据源",
  generate: "知识供给",
  open: "开放对象",
};

function renderGroup(
  title: string,
  entries: LandscapeNeighbors["incoming"],
): TemplateResult | typeof nothing {
  if (entries.length === 0) {
    return nothing;
  }
  return html`
    <div class="enterprise-data-capability__drawer-group">
      <div class="enterprise-data-capability__drawer-group-title">${title}</div>
      <ul>
        ${entries.map(
          (entry) =>
            html`<li>${entry.node.label}<span> · ${KIND_LABEL[entry.node.kind] ?? entry.node.kind}</span></li>`,
        )}
      </ul>
    </div>
  `;
}

export function renderNodeDetailDrawer(props: NodeDetailDrawerProps): TemplateResult {
  if (!props.selectedNodeId || !props.graph) {
    return html``;
  }
  const neighbors = resolveLandscapeNeighbors(props.graph, props.selectedNodeId);
  if (!neighbors) {
    return html``;
  }

  // 入边按 relation=source 视为「来源」，出边按 relation 分组（generate=知识供给 / open=开放）。
  const sources = neighbors.incoming.filter((entry) => entry.relation === "source");
  const knowledge = neighbors.outgoing.filter((entry) => entry.relation === "generate");
  const opened = neighbors.outgoing.filter((entry) => entry.relation === "open");
  const downstreamCapabilities = neighbors.outgoing.filter((entry) => entry.relation === "source");
  const generatedBy = neighbors.incoming.filter((entry) => entry.relation === "generate");

  return html`
    <aside class="enterprise-data-capability__drawer" role="dialog" aria-label="节点详情">
      <div class="enterprise-data-capability__drawer-head">
        <div>
          <div class="enterprise-data-capability__drawer-kind">
            ${KIND_LABEL[neighbors.node.kind] ?? neighbors.node.kind}
          </div>
          <div class="enterprise-data-capability__drawer-title">${neighbors.node.label}</div>
        </div>
        <button
          type="button"
          class="btn btn--sm"
          @click=${() => props.onClose()}
          aria-label="关闭"
        >
          关闭
        </button>
      </div>
      <div class="enterprise-data-capability__drawer-body">
        ${renderGroup(RELATION_LABEL.source, sources)}
        ${renderGroup("下游能力", downstreamCapabilities)}
        ${renderGroup(RELATION_LABEL.generate, knowledge)}
        ${renderGroup("生成自能力", generatedBy)}
        ${renderGroup(RELATION_LABEL.open, opened)}
        ${
          sources.length === 0 &&
          knowledge.length === 0 &&
          opened.length === 0 &&
          downstreamCapabilities.length === 0 &&
          generatedBy.length === 0
            ? html`
                <div class="enterprise-data-capability__hint">该节点暂无关联关系。</div>
              `
            : nothing
        }
      </div>
    </aside>
  `;
}
