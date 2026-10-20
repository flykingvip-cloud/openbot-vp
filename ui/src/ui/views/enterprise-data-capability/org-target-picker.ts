/**
 * 企业数据能力中心 — 组织架构目标选择器（授权策略 / 能力授予共用）。
 *
 * 复用「组织与数字人」组织目录的数据构建（buildEnterpriseOrgTree），在其上渲染
 * 一棵带「点选框」的自有勾选树：每个部门、每个岗位前都有 checkbox，管理员可精准
 * 多选——可同时勾选多个部门与多个岗位。不修改共享组织目录组件（多 agent 安全）。
 *
 * 选择模型（两个独立集合）：
 *   - selectedDepartmentPaths：勾选的部门（部门级授权目标，含其子部门下岗位）。
 *   - selectedSeatIds：勾选的岗位（岗位级授权目标）。
 */

import { html, type TemplateResult } from "lit";
import "../../../styles/enterprise-data-capability.css";
import { renderIcon } from "../../icons.ts";
import type { EnterprisePortReadModel } from "../../ports/enterprise/semantic/enterprise-read-model.ts";
import {
  buildEnterpriseOrgTree,
  type EnterpriseOrgDepartmentNode,
  type EnterpriseOrgPositionNode,
} from "../../ports/enterprise/views/enterprise-org-tree-model.ts";

/** 递归收集某部门（含子部门）下所有岗位 seatId。 */
export function collectDepartmentSeatIds(department: EnterpriseOrgDepartmentNode): string[] {
  const ids: string[] = department.positions.map((position) => position.seatId);
  for (const child of department.childDepartments) {
    ids.push(...collectDepartmentSeatIds(child));
  }
  return ids;
}

/** 按 fullPath 在树中定位部门节点。 */
export function findOrgDepartmentByPath(
  departments: EnterpriseOrgDepartmentNode[],
  path: string,
): EnterpriseOrgDepartmentNode | null {
  for (const department of departments) {
    if (department.fullPath === path) {
      return department;
    }
    const found = findOrgDepartmentByPath(department.childDepartments, path);
    if (found) {
      return found;
    }
  }
  return null;
}

/** 末段部门名（用于 chip 显示）。 */
function departmentLeafLabel(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

export type OrgTargetPickerProps = {
  readModel: EnterprisePortReadModel;
  query: string;
  selectedSeatIds: ReadonlySet<string>;
  selectedDepartmentPaths: ReadonlySet<string>;
  disabled?: boolean;
  hint?: string;
  onQueryChange: (value: string) => void;
  onToggleSeat: (seatId: string) => void;
  onToggleDepartment: (departmentPath: string) => void;
  onRemoveSeat: (seatId: string) => void;
  onRemoveDepartment: (departmentPath: string) => void;
  onClearAll: () => void;
};

function renderSeatRow(position: EnterpriseOrgPositionNode, props: OrgTargetPickerProps) {
  const checked = props.selectedSeatIds.has(position.seatId);
  return html`
    <label class="edc-org-tree__row edc-org-tree__row--seat ${checked ? "is-checked" : ""}">
      <input
        type="checkbox"
        class="edc-org-tree__checkbox"
        .checked=${checked}
        ?disabled=${props.disabled}
        @change=${() => props.onToggleSeat(position.seatId)}
      />
      <span class="edc-org-tree__icon" aria-hidden="true">
        ${renderIcon("layers", "edc-org-tree__icon-svg")}
      </span>
      <span class="edc-org-tree__label">${position.seatTitle}</span>
      <span class="edc-org-tree__muted">${position.member ? "已绑定" : "空岗"}</span>
    </label>
  `;
}

function renderDepartmentNode(
  department: EnterpriseOrgDepartmentNode,
  props: OrgTargetPickerProps,
): TemplateResult {
  const checked = props.selectedDepartmentPaths.has(department.fullPath);
  return html`
    <details class="edc-org-tree__dept" open>
      <summary class="edc-org-tree__row edc-org-tree__row--dept ${checked ? "is-checked" : ""}">
        <input
          type="checkbox"
          class="edc-org-tree__checkbox"
          title="选择整个部门（含子部门下全部岗位）"
          .checked=${checked}
          ?disabled=${props.disabled}
          @click=${(event: Event) => event.stopPropagation()}
          @change=${() => props.onToggleDepartment(department.fullPath)}
        />
        <span class="edc-org-tree__toggle" aria-hidden="true">
          ${renderIcon("chevronRight", "edc-org-tree__toggle-svg")}
        </span>
        <span class="edc-org-tree__icon" aria-hidden="true">
          ${renderIcon("folder", "edc-org-tree__icon-svg")}
        </span>
        <span class="edc-org-tree__label">${department.label}</span>
        <span class="edc-org-tree__muted">
          ${department.positions.length} 个岗位${
            department.childDepartments.length
              ? ` · ${department.childDepartments.length} 个子部门`
              : ""
          }
        </span>
      </summary>
      <div class="edc-org-tree__children">
        ${department.childDepartments.map((child) => renderDepartmentNode(child, props))}
        ${department.positions.map((position) => renderSeatRow(position, props))}
      </div>
    </details>
  `;
}

/** 将组织选择器中的部门路径展开为岗位 ID，与显式勾选的岗位合并（去重）。 */
export function resolvePolicySeatIdsFromPicker(params: {
  readModel: EnterprisePortReadModel;
  selectedSeatIds: Iterable<string>;
  selectedDepartmentPaths: Iterable<string>;
}): string[] {
  const seatIdSet = new Set(
    [...params.selectedSeatIds].map((entry) => entry.trim()).filter(Boolean),
  );
  const departments = buildEnterpriseOrgTree({
    readModel: params.readModel,
    includeVacantPositions: true,
  });
  for (const path of params.selectedDepartmentPaths) {
    const normalized = path.trim();
    if (!normalized) {
      continue;
    }
    const department = findOrgDepartmentByPath(departments, normalized);
    if (!department) {
      continue;
    }
    for (const seatId of collectDepartmentSeatIds(department)) {
      seatIdSet.add(seatId);
    }
  }
  return [...seatIdSet];
}

export function renderOrgTargetPicker(props: OrgTargetPickerProps): TemplateResult {
  const seatSummaries = props.readModel.seatSummaries ?? [];
  if (seatSummaries.length === 0) {
    return html`
      <div class="enterprise-data-capability__hint">
        未获取到组织架构数据。请确认企业已在「组织与数字人」中开通部门与席位。
      </div>
    `;
  }

  const departments = buildEnterpriseOrgTree({
    readModel: props.readModel,
    query: props.query.trim() || undefined,
    includeVacantPositions: true,
  });

  const seatTitleById = new Map(seatSummaries.map((seat) => [seat.seatId, seat.title] as const));
  const seatChips = [...props.selectedSeatIds].map((seatId) => ({
    seatId,
    title: seatTitleById.get(seatId) ?? seatId,
  }));
  const departmentChips = [...props.selectedDepartmentPaths].map((path) => ({
    path,
    label: departmentLeafLabel(path),
  }));
  const hasSelection = seatChips.length > 0 || departmentChips.length > 0;

  return html`
    <div class="enterprise-data-capability__org-picker">
      <input
        class="input enterprise-data-capability__org-picker-search"
        type="search"
        placeholder="搜索部门 / 岗位…"
        .value=${props.query}
        ?disabled=${props.disabled}
        @input=${(event: Event) => props.onQueryChange((event.target as HTMLInputElement).value)}
      />
      <div class="enterprise-data-capability__org-picker-tree edc-org-tree" role="tree">
        ${
          props.hint
            ? html`<div class="enterprise-data-capability__hint edc-org-tree__hint">${props.hint}</div>`
            : html``
        }
        ${
          departments.length > 0
            ? departments.map((department) => renderDepartmentNode(department, props))
            : html`
                <div class="enterprise-data-capability__hint">未找到匹配的部门或岗位。</div>
              `
        }
      </div>
      <div class="enterprise-data-capability__org-picker-selection">
        ${
          hasSelection
            ? html`
                <span class="enterprise-data-capability__hint">已选目标：</span>
                ${departmentChips.map(
                  (chip) => html`
                    <button
                      class="chip ok"
                      type="button"
                      ?disabled=${props.disabled}
                      title="移除该部门"
                      @click=${() => props.onRemoveDepartment(chip.path)}
                    >
                      部门：${chip.label} ✕
                    </button>
                  `,
                )}
                ${seatChips.map(
                  (chip) => html`
                    <button
                      class="chip ok"
                      type="button"
                      ?disabled=${props.disabled}
                      title="移除该岗位"
                      @click=${() => props.onRemoveSeat(chip.seatId)}
                    >
                      ${chip.title} ✕
                    </button>
                  `,
                )}
                <button
                  class="btn btn--sm"
                  type="button"
                  ?disabled=${props.disabled}
                  @click=${() => props.onClearAll()}
                >
                  清空
                </button>
              `
            : html`
                <span class="enterprise-data-capability__hint">尚未选择授权目标。</span>
              `
        }
      </div>
    </div>
  `;
}
