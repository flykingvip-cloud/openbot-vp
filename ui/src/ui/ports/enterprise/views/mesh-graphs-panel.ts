/**
 * Mesh capability / collaboration graphs — enterprise-global read view.
 * Interactive canvas + list legend.
 */

import { html } from "lit";
import type { AgentsListResult, CollaborationSpacesListResult } from "../../../types.ts";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import { followPortHref } from "./enterprise-surface-shared.ts";
import { buildMeshGraphModel, buildMeshObjectHref } from "./mesh-graphs-model.ts";
import "./mesh-graph-canvas.ts";

export type MeshGraphsPanelParams = {
  readModel: EnterprisePortReadModel;
  basePath: string;
  agentsList?: AgentsListResult | null;
  collaborationSpacesResult?: CollaborationSpacesListResult | null;
};

export {
  applyMeshNodePositions,
  buildMeshGraphEdgesFromNodes,
  buildMeshGraphModel,
  buildMeshObjectHref,
  filterMeshGraphModel,
  layoutMeshBipartiteGraph,
  meshGraphNodeKey,
  truncateMeshGraphLabel,
  type MeshBipartiteLayout,
  type MeshBipartiteLayoutEdge,
  type MeshBipartiteLayoutNode,
  type MeshGraphAgentNode,
  type MeshGraphEdge,
  type MeshGraphGroupNode,
  type MeshGraphModel,
  type MeshGraphViewFilter,
} from "./mesh-graphs-model.ts";

export function renderMeshGraphsPanel(params: MeshGraphsPanelParams) {
  const model = buildMeshGraphModel(params);
  const { readModel, basePath } = params;
  const tenantId = readModel.currentTenantId;

  return html`
    <div class="enterprise-mesh-graphs" data-mesh-panel="graphs">
      <div class="enterprise-mesh-graphs__head">
        <h3 class="enterprise-mesh-graphs__title">能力 / 协作图谱</h3>
        <p class="enterprise-mesh-graphs__sub">
          可拖拽 / 可筛选的关系画布 + 清单。节点与边来自企业机器人与协作组成员名册；不含能力安装/启停。
        </p>
      </div>

      <enterprise-mesh-graph-canvas
        data-mesh-graph="canvas"
        .model=${model}
        .basePath=${basePath}
        .tenantId=${tenantId}
      ></enterprise-mesh-graph-canvas>

      <div class="enterprise-mesh-graphs__grid">
        <section class="enterprise-mesh-graphs__card" data-mesh-graph="capability">
          <div class="enterprise-mesh-graphs__card-head">
            <h4>能力清单</h4>
            <span class="enterprise-mesh-graphs__count">${model.agents.length}</span>
          </div>
          <p class="enterprise-mesh-graphs__hint">机器人节点 · 按成本/会话强度排序</p>
          ${
            model.agents.length === 0
              ? html`
                  <p class="enterprise-mesh-graphs__empty">暂无机器人资产。</p>
                `
              : html`
                  <ul class="enterprise-mesh-graphs__list">
                    ${model.agents.slice(0, 24).map((agent) => {
                      const agentHref = buildMeshObjectHref(basePath, tenantId, "agents", agent.id);
                      return html`
                        <li>
                          <a
                            href=${agentHref}
                            @click=${(event: MouseEvent) => followPortHref(event, agentHref)}
                          >
                            <strong>${agent.name}</strong>
                            <span
                              >会话 ${agent.sessionCount} · 组关联 ${agent.groupCount} ·
                              ${agent.statusLabel}</span
                            >
                          </a>
                        </li>
                      `;
                    })}
                  </ul>
                `
          }
        </section>

        <section class="enterprise-mesh-graphs__card" data-mesh-graph="collaboration">
          <div class="enterprise-mesh-graphs__card-head">
            <h4>协作清单</h4>
            <span class="enterprise-mesh-graphs__count">${model.groups.length}</span>
          </div>
          <p class="enterprise-mesh-graphs__hint">
            协作组节点 · 成员边 ${model.edges.length} 条
          </p>
          ${
            model.groups.length === 0
              ? html`
                  <p class="enterprise-mesh-graphs__empty">暂无协作组资产。</p>
                `
              : html`
                  <ul class="enterprise-mesh-graphs__list">
                    ${model.groups.slice(0, 24).map((group) => {
                      const groupHref = buildMeshObjectHref(basePath, tenantId, "groups", group.id);
                      return html`
                        <li>
                          <a
                            href=${groupHref}
                            @click=${(event: MouseEvent) => followPortHref(event, groupHref)}
                          >
                            <strong>${group.name}</strong>
                            <span
                              >成员 ${group.humanCount} · 机器人 ${group.botCount} · 会话
                              ${group.sessionCount}</span
                            >
                          </a>
                        </li>
                      `;
                    })}
                  </ul>
                  ${
                    model.edges.length > 0
                      ? html`
                          <div class="enterprise-mesh-graphs__edges">
                            <div class="enterprise-mesh-graphs__hint">机器人 → 协作组</div>
                            <ul
                              class="enterprise-mesh-graphs__list enterprise-mesh-graphs__list--edges"
                            >
                              ${model.edges.slice(0, 24).map(
                                (link) => html`
                                  <li>
                                    <span class="enterprise-mesh-graphs__edge-from"
                                      >${link.agentName}</span
                                    >
                                    <span aria-hidden="true">→</span>
                                    <span class="enterprise-mesh-graphs__edge-to"
                                      >${link.groupName}</span
                                    >
                                  </li>
                                `,
                              )}
                            </ul>
                          </div>
                        `
                      : html`
                          <p class="enterprise-mesh-graphs__hint">协作组暂无机器人成员，完善成员名册后将显示连线。</p>
                        `
                  }
                `
          }
        </section>
      </div>
    </div>
  `;
}
