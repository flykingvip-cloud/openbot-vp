import { html, nothing, type TemplateResult } from "lit";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import { splitOrganizationPath } from "./enterprise-org-path.ts";
import {
  orgWsBody,
  orgWsFooter,
  orgWsHeader,
  orgWsKvGrid,
  orgWsSection,
} from "./enterprise-org-workspace-template.ts";

export type { OrganizationPositionDetailRow } from "./enterprise-org-position-detail.ts";
export {
  renderOrganizationPositionDetail,
  resolveSeatDeleteEligibility,
} from "./enterprise-org-position-detail.ts";

function summarizeDepartment(path: string, readModel: EnterprisePortReadModel) {
  const normalizedPath = path.trim();
  const label = splitOrganizationPath(normalizedPath).at(-1) ?? normalizedPath;
  const departmentPaths = readModel.organizationDepartmentPaths ?? [];
  const childDepartments = departmentPaths.filter((entry) => {
    const parent = splitOrganizationPath(entry).slice(0, -1).join("/");
    return parent === normalizedPath;
  });
  const positions = readModel.seatSummaries.filter(
    (seat) => (seat.teamLabel?.trim() || "未分组") === normalizedPath,
  );
  const occupiedCount = positions.filter((seat) => seat.status === "occupied").length;
  return {
    path: normalizedPath,
    label,
    childDepartments,
    positions,
    occupiedCount,
    vacantCount: positions.length - occupiedCount,
  };
}

export function isOrganizationStructureSelectionActive(params: {
  team: string;
  selectedSeatId: string | null;
}): boolean {
  return Boolean(params.selectedSeatId) || (params.team.trim() !== "" && params.team !== "all");
}

export function renderOrganizationStructureDepartmentInspector(params: {
  departmentPath: string;
  readModel: EnterprisePortReadModel;
  busy?: boolean;
  onSelectPosition: (seatId: string, teamLabel: string) => void;
  onSelectDepartment: (teamLabel: string) => void;
  onCreateChildDepartment: (parentPath: string) => void;
  onCreatePosition: (teamPath: string) => void;
  onRenameDepartment: (path: string) => void;
  onMoveDepartment: (path: string) => void;
  onMergeDepartment: (path: string) => void;
  onDeleteDepartment: (path: string) => void;
  onClose: () => void;
}): TemplateResult {
  const summary = summarizeDepartment(params.departmentPath, params.readModel);
  return html`
    <section
      class="enterprise-org-workspace enterprise-org-ws enterprise-org-ws--flat enterprise-org-structure-inspector"
    >
      ${orgWsHeader({
        title: summary.label,
        subtitle: summary.path,
        onClose: params.onClose,
      })}
      ${orgWsBody(html`
        ${orgWsKvGrid([
          { label: "岗位", value: String(summary.positions.length) },
          { label: "已绑定", value: String(summary.occupiedCount) },
          { label: "空岗", value: String(summary.vacantCount) },
          { label: "子部门", value: String(summary.childDepartments.length) },
        ])}
        ${orgWsSection({
          title: "部门岗位",
          content:
            summary.positions.length > 0
              ? html`
                  <ul class="enterprise-org-structure-inspector__list">
                    ${summary.positions.map(
                      (seat) => html`
                        <li>
                          <button
                            class="enterprise-org-structure-inspector__list-item"
                            type="button"
                            ?disabled=${params.busy}
                            @click=${() => params.onSelectPosition(seat.seatId, summary.path)}
                          >
                            <strong>${seat.title}</strong>
                            <span
                              >${seat.status === "occupied" ? (seat.currentEmployeeLabel ?? "已绑定") : "空岗"}</span
                            >
                          </button>
                        </li>
                      `,
                    )}
                  </ul>
                `
              : html`
                  <div class="enterprise-org-ws__empty">该部门暂无岗位。</div>
                `,
        })}
        ${
          summary.childDepartments.length
            ? orgWsSection({
                title: "子部门",
                content: html`
                  <div class="chip-row">
                    ${summary.childDepartments.map(
                      (childPath) => html`
                        <button
                          class="chip enterprise-org-structure-inspector__child"
                          type="button"
                          title=${childPath}
                          data-inspector-child-department=${childPath}
                          ?disabled=${params.busy}
                          @click=${() => params.onSelectDepartment(childPath)}
                        >
                          ${splitOrganizationPath(childPath).at(-1) ?? childPath}
                        </button>
                      `,
                    )}
                  </div>
                `,
              })
            : nothing
        }
      `)}
      ${orgWsFooter({
        extraStart: html`
          <div class="enterprise-org-ws__footer-inline-actions">
            <button
              class="btn btn--sm"
              type="button"
              ?disabled=${params.busy}
              @click=${() => params.onCreateChildDepartment(summary.path)}
            >
              新建子部门
            </button>
            <button
              class="btn btn--sm"
              type="button"
              ?disabled=${params.busy}
              @click=${() => params.onCreatePosition(summary.path)}
            >
              新建岗位
            </button>
            <button
              class="btn btn--sm"
              type="button"
              ?disabled=${params.busy}
              @click=${() => params.onRenameDepartment(summary.path)}
            >
              重命名
            </button>
            <button
              class="btn btn--sm"
              type="button"
              ?disabled=${params.busy}
              @click=${() => params.onMoveDepartment(summary.path)}
            >
              移动
            </button>
            <button
              class="btn btn--sm"
              type="button"
              ?disabled=${params.busy}
              @click=${() => params.onMergeDepartment(summary.path)}
            >
              合并
            </button>
            <button
              class="btn btn--sm btn--danger"
              type="button"
              ?disabled=${params.busy}
              @click=${() => params.onDeleteDepartment(summary.path)}
            >
              删除
            </button>
          </div>
        `,
      })}
    </section>
  `;
}
