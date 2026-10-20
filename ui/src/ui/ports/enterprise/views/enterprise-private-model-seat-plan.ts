/**
 * 企业自供模型的席位配置：勾选组织树（全员 / 部门 / 席位），
 * 写入与「模型授权」相同的 SeatModelGrant。
 * 未勾选的模型只留在列表里，不进入任何席位授权。
 */

import { html, type TemplateResult } from "lit";
import type { EnterpriseOrgDepartmentNode } from "./enterprise-org-tree-model.ts";
import { renderEnterpriseOrgTree } from "./enterprise-org-tree-view.ts";

export type SeatGrantSlice = {
  seatId: string;
  grantedModelIds: readonly string[];
};

export type SeatGrantWrite = {
  subjectType: "seat";
  subjectId: string;
  grantedModelIds: string[];
  mergeMode: "union" | "replace";
};

export function planSeatModelGrantWrites(input: {
  modelId: string;
  seats: readonly SeatGrantSlice[];
  selectedSeatIds: ReadonlySet<string>;
}): SeatGrantWrite[] {
  const modelId = input.modelId.trim();
  if (!modelId) {
    return [];
  }
  const writes: SeatGrantWrite[] = [];
  const known = new Set<string>();
  for (const seat of input.seats) {
    const seatId = seat.seatId.trim();
    if (!seatId || known.has(seatId)) {
      continue;
    }
    known.add(seatId);
    const granted = seat.grantedModelIds.map((id) => id.trim()).filter((id) => id.length > 0);
    const hasModel = granted.includes(modelId);
    const selected = input.selectedSeatIds.has(seatId);
    if (selected && !hasModel) {
      writes.push({
        subjectType: "seat",
        subjectId: seatId,
        grantedModelIds: [modelId],
        mergeMode: "union",
      });
    } else if (!selected && hasModel) {
      writes.push({
        subjectType: "seat",
        subjectId: seatId,
        grantedModelIds: granted.filter((id) => id !== modelId),
        mergeMode: "replace",
      });
    }
  }
  for (const rawId of input.selectedSeatIds) {
    const seatId = rawId.trim();
    if (!seatId || known.has(seatId)) {
      continue;
    }
    writes.push({
      subjectType: "seat",
      subjectId: seatId,
      grantedModelIds: [modelId],
      mergeMode: "union",
    });
  }
  return writes;
}

export function seatIdsWithModel(
  modelId: string,
  grants: readonly {
    subjectType?: string;
    subjectId?: string;
    seatId?: string;
    status?: string;
    grantedModelIds?: readonly string[];
  }[],
): Set<string> {
  const ids = new Set<string>();
  for (const grant of grants) {
    if (grant.subjectType !== "seat" || grant.status === "revoked") {
      continue;
    }
    if (!(grant.grantedModelIds ?? []).includes(modelId)) {
      continue;
    }
    const seatId = (grant.seatId || grant.subjectId || "").trim();
    if (seatId) {
      ids.add(seatId);
    }
  }
  return ids;
}

function findDepartment(
  nodes: readonly EnterpriseOrgDepartmentNode[],
  fullPath: string,
): EnterpriseOrgDepartmentNode | null {
  for (const node of nodes) {
    if (node.fullPath === fullPath) {
      return node;
    }
    const child = findDepartment(node.childDepartments, fullPath);
    if (child) {
      return child;
    }
  }
  return null;
}

function collectSeatIds(node: EnterpriseOrgDepartmentNode): string[] {
  return [
    ...node.positions.map((position) => position.seatId),
    ...node.childDepartments.flatMap((child) => collectSeatIds(child)),
  ];
}

export function collectSeatIdsInDepartment(
  departments: readonly EnterpriseOrgDepartmentNode[],
  fullPath: string,
): string[] {
  const node = findDepartment(departments, fullPath);
  return node ? collectSeatIds(node) : [];
}

export function collectAllSeatIds(departments: readonly EnterpriseOrgDepartmentNode[]): string[] {
  return departments.flatMap((node) => collectSeatIds(node));
}

export function renderPrivateModelSeatPanel(params: {
  modelLabel: string;
  departments: EnterpriseOrgDepartmentNode[];
  checkedSeatIds: ReadonlySet<string>;
  busy: boolean;
  onToggleSeat: (seatId: string) => void;
  onToggleDepartment: (fullPath: string) => void;
  onToggleAll: () => void;
  onCancel: () => void;
  onSave: () => void;
}): TemplateResult {
  const tree =
    params.departments.length > 0
      ? renderEnterpriseOrgTree({
          departments: params.departments,
          mode: "navigate",
          checkedSeatIds: params.checkedSeatIds,
          showAllNode: true,
          autoExpandAll: true,
          disabled: params.busy,
          title: "分配席位",
          hint: "可选全部、部门或单个席位。保存后写入模型授权。",
          onSelectAll: params.onToggleAll,
          onSelectTeam: params.onToggleDepartment,
          onToggleSeatCheck: params.onToggleSeat,
        })
      : html`
          <p class="muted">组织席位尚未加载，无法配置。</p>
        `;
  return html`
    <div class="enterprise-seat-config" data-testid="enterprise-model-seat-panel">
      <p class="muted">${params.modelLabel} 尚未分配的席位不能调用该模型。</p>
      ${tree}
      <div class="row row--end row--tight">
        <button
          class="btn btn--sm"
          type="button"
          data-testid="enterprise-model-seat-cancel"
          ?disabled=${params.busy}
          @click=${params.onCancel}
        >
          取消
        </button>
        <button
          class="btn btn--sm btn--primary"
          type="button"
          data-testid="enterprise-model-seat-save"
          ?disabled=${params.busy || params.departments.length === 0}
          @click=${params.onSave}
        >
          保存席位
        </button>
      </div>
    </div>
  `;
}
