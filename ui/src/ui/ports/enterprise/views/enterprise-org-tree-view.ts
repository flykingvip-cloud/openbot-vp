import { html, nothing, type TemplateResult } from "lit";
import { renderIcon } from "../../../icons.ts";
import {
  buildDefaultChildOrderKeys,
  finalizeReorderKeysForServer,
  organizationChildDepartmentKey,
  organizationChildSeatKey,
  reorderOrganizationChildKeys,
  resolveDraggedChildKey,
  resolveDraggedChildParentPath,
  resolveTargetChildKey,
} from "./enterprise-org-child-order.ts";
import type { OrganizationTreeInlineEditState } from "./enterprise-org-inline-edit.ts";
import {
  matchesOrganizationTeamPath,
  resolveOrganizationDepartmentDropAction,
} from "./enterprise-org-path.ts";
import type {
  EnterpriseOrgDepartmentNode,
  EnterpriseOrgMemberNode,
  EnterpriseOrgPositionNode,
} from "./enterprise-org-tree-model.ts";
import { shouldExpandEnterpriseOrgDepartment } from "./enterprise-org-tree-model.ts";
import { shouldProceed } from "./enterprise-surface-shared.ts";

export type EnterpriseOrgTreeMode = "navigate" | "select-member";

function isOrgTreeMemberSelected(tree: EnterpriseOrgTreeRenderParams, user: string): boolean {
  if (tree.selectedMemberEmails) {
    return tree.selectedMemberEmails.has(user);
  }
  return tree.selectedMemberEmail === user;
}

export type EnterpriseOrgTreeRenderParams = {
  departments: EnterpriseOrgDepartmentNode[];
  mode: EnterpriseOrgTreeMode;
  activeTeam?: string;
  selectedSeatId?: string | null;
  selectedMemberEmail?: string | null;
  selectedMemberEmails?: ReadonlySet<string>;
  /** 岗位多选（批量删除等）；与导航选中 selectedSeatId 独立 */
  checkedSeatIds?: ReadonlySet<string>;
  assignedSeatUserIds?: ReadonlySet<string>;
  highlightSeatId?: string | null;
  focusTeamPath?: string | null;
  focusSeatId?: string | null;
  query?: string;
  disabled?: boolean;
  editable?: boolean;
  title?: string;
  hint?: string;
  emptyLabel?: string;
  showAllNode?: boolean;
  autoExpandAll?: boolean;
  onSelectAll?: () => void;
  onSelectTeam?: (teamLabel: string) => void;
  onSelectPosition?: (seatId: string, teamLabel: string) => void;
  onToggleSeatCheck?: (seatId: string) => void;
  isSeatCheckable?: (position: EnterpriseOrgPositionNode) => boolean;
  onSelectMember?: (user: string, seatId: string, teamLabel: string) => void;
  onSelectDepartmentMembers?: (departmentPath: string) => void;
  onCreateChildDepartment?: (parentPath: string) => void;
  onCreatePosition?: (parentPath: string) => void;
  onBindMember?: (seatId: string, teamPath: string, mode?: "offer" | "activation") => void;
  onRenameDepartment?: (path: string) => void;
  onDeleteDepartment?: (path: string) => void;
  inlineEdit?: OrganizationTreeInlineEditState | null;
  onInlineEditDraftChange?: (value: string) => void;
  onInlineEditCommit?: () => void;
  onInlineEditCancel?: () => void;
  onStartInlineEditDepartment?: (path: string, label: string) => void;
  onStartInlineEditPosition?: (seatId: string, title: string) => void;
  onMoveSeatToTeam?: (seatId: string, targetPath: string) => void;
  onMoveDepartmentToParent?: (path: string, parentPath: string) => void;
  onMergeDepartmentToTarget?: (sourcePath: string, targetPath: string) => void;
  onReorderChildren?: (parentPath: string, orderedKeys: string[]) => void;
  resolveChildOrderKeys?: (parentPath: string) => string[];
  isMemberSelectable?: (
    member: EnterpriseOrgMemberNode,
    position: EnterpriseOrgPositionNode,
  ) => boolean;
  renderPositionBadge?: (position: EnterpriseOrgPositionNode) => string | null;
  /** 覆盖岗位主标题。缺省为岗位名。 */
  formatPositionPrimary?: (position: EnterpriseOrgPositionNode) => string;
  /** 覆盖岗位副标题。缺省沿用组织树的在岗/空岗文案。 */
  formatPositionSecondary?: (position: EnterpriseOrgPositionNode) => string;
  billingRoleByUserId?: ReadonlyMap<string, string>;
  suggestedRoleByOrgSeatId?: ReadonlyMap<string, string>;
  formatBillingRoleLabel?: (role: string) => string;
};

const ORG_TREE_DRAG_SEAT_MIME = "application/x-openbot-org-seat";
const ORG_TREE_DRAG_SEAT_TEAM_MIME = "application/x-openbot-org-seat-team";
const ORG_TREE_DRAG_DEPARTMENT_MIME = "application/x-openbot-org-department";

type ActiveOrgTreeDrag = {
  seatId?: string;
  seatTeamLabel?: string;
  departmentPath?: string;
};

let activeOrgTreeDrag: ActiveOrgTreeDrag | null = null;

function setActiveOrgTreeDrag(payload: ActiveOrgTreeDrag) {
  activeOrgTreeDrag = payload;
  setOrgTreeDragSessionActive(true);
}

function clearActiveOrgTreeDrag() {
  activeOrgTreeDrag = null;
  setOrgTreeDragSessionActive(false);
  clearAllOrgTreeDropIndicators();
}

function setOrgTreeDragSessionActive(active: boolean) {
  if (typeof document === "undefined") {
    return;
  }
  for (const root of document.querySelectorAll(".enterprise-org-tree")) {
    root.classList.toggle("is-drag-reordering", active);
  }
}

function findNearestOrgTreeDropTarget(container: HTMLElement, clientY: number): HTMLElement | null {
  const candidates = [
    ...container.querySelectorAll<HTMLElement>(
      ":scope > details > .enterprise-org-tree__team-summary, :scope > .enterprise-org-tree__node--position",
    ),
  ];
  if (!candidates.length) {
    return null;
  }
  let closest = candidates[0] ?? null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect();
    const distance = Math.abs(clientY - (rect.top + rect.height / 2));
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = candidate;
    }
  }
  return closest;
}

function handleMixedChildrenDragOver(
  event: DragEvent,
  tree: EnterpriseOrgTreeRenderParams,
  params: { parentPath: string },
) {
  if (!tree.editable || tree.disabled) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer!.dropEffect = "move";
  const container = event.currentTarget as HTMLElement;
  const target = findNearestOrgTreeDropTarget(container, event.clientY);
  if (!target) {
    return;
  }
  updateSiblingDropIndicatorOnTarget(tree, params, target, event.clientY);
}

function handleMixedChildrenDrop(
  event: DragEvent,
  tree: EnterpriseOrgTreeRenderParams,
  params: { parentPath: string; currentKeys: string[] },
) {
  event.preventDefault();
  event.stopPropagation();
  clearAllOrgTreeDropIndicators();
  if (!tree.editable || tree.disabled) {
    return;
  }
  const container = event.currentTarget as HTMLElement;
  const target = findNearestOrgTreeDropTarget(container, event.clientY);
  if (!target) {
    return;
  }
  const targetKey = resolveTargetKeyFromDropElement(target);
  if (!targetKey) {
    return;
  }
  trySiblingReorderDrop(event, tree, {
    parentPath: params.parentPath,
    currentKeys: params.currentKeys,
    targetKey,
    insertBefore: resolveInsertBeforeOnTarget(target, event.clientY),
  });
}

function readDragSeatId(event: DragEvent): string | null {
  return (
    event.dataTransfer?.getData(ORG_TREE_DRAG_SEAT_MIME)?.trim() ||
    activeOrgTreeDrag?.seatId?.trim() ||
    null
  );
}

function readDragDepartmentPath(event: DragEvent): string | null {
  return (
    event.dataTransfer?.getData(ORG_TREE_DRAG_DEPARTMENT_MIME)?.trim() ||
    activeOrgTreeDrag?.departmentPath?.trim() ||
    null
  );
}

function readDragSeatTeamLabel(event: DragEvent): string | null {
  return (
    event.dataTransfer?.getData(ORG_TREE_DRAG_SEAT_TEAM_MIME)?.trim() ||
    activeOrgTreeDrag?.seatTeamLabel?.trim() ||
    null
  );
}

function resolveInsertBeforeOnTarget(target: HTMLElement, clientY: number): boolean {
  const row =
    target.querySelector<HTMLElement>(".enterprise-org-tree__label") ??
    target.querySelector<HTMLElement>(".enterprise-org-tree__primary") ??
    target;
  const rect = row.getBoundingClientRect();
  return clientY < rect.top + rect.height / 2;
}

function resolveInsertBefore(event: DragEvent): boolean {
  return resolveInsertBeforeOnTarget(event.currentTarget as HTMLElement, event.clientY);
}

function resolveTargetKeyFromDropElement(element: HTMLElement): string | null {
  if (element.classList.contains("enterprise-org-tree__node--position")) {
    const seatId = element.dataset.orgSeatId?.trim();
    return seatId ? organizationChildSeatKey(seatId) : null;
  }
  if (element.classList.contains("enterprise-org-tree__team-summary")) {
    const details = element.closest<HTMLElement>("details[data-org-team-path]");
    const path = details?.dataset.orgTeamPath?.trim();
    return path ? organizationChildDepartmentKey(path) : null;
  }
  return null;
}

function clearAllOrgTreeDropIndicators() {
  if (typeof document === "undefined") {
    return;
  }
  for (const node of document.querySelectorAll(
    ".enterprise-org-tree__team-summary.drag-insert-before, .enterprise-org-tree__team-summary.drag-insert-after, .enterprise-org-tree__node--position.drag-insert-before, .enterprise-org-tree__node--position.drag-insert-after, .enterprise-org-tree__team-summary.drag-over, .enterprise-org-tree__node--position.drag-over",
  )) {
    clearSiblingInsertIndicator(node as HTMLElement);
  }
}

function setOrgTreeInsertGap(element: HTMLElement, position: "before" | "after") {
  clearAllOrgTreeDropIndicators();
  element.classList.add(position === "before" ? "drag-insert-before" : "drag-insert-after");
}

function clearSiblingInsertIndicator(element: HTMLElement) {
  element.classList.remove("drag-over", "drag-insert-before", "drag-insert-after");
}

function normalizeOrgTreeParentPath(path: string): string {
  return path.trim();
}

function updateSiblingDropIndicatorOnTarget(
  tree: EnterpriseOrgTreeRenderParams,
  params: { parentPath: string },
  element: HTMLElement,
  clientY: number,
) {
  if (!tree.editable || tree.disabled) {
    return;
  }
  const sourceParent = resolveDraggedChildParentPath({
    departmentPath: activeOrgTreeDrag?.departmentPath ?? null,
    seatTeamLabel: activeOrgTreeDrag?.seatTeamLabel ?? null,
  });
  const canReorder =
    normalizeOrgTreeParentPath(sourceParent ?? "") ===
      normalizeOrgTreeParentPath(params.parentPath) &&
    Boolean(activeOrgTreeDrag?.seatId || activeOrgTreeDrag?.departmentPath);
  if (!canReorder) {
    clearAllOrgTreeDropIndicators();
    element.classList.add("drag-over");
    return;
  }
  setOrgTreeInsertGap(element, resolveInsertBeforeOnTarget(element, clientY) ? "before" : "after");
}

function updateSiblingDropIndicator(
  event: DragEvent,
  tree: EnterpriseOrgTreeRenderParams,
  params: { parentPath: string },
) {
  if (!tree.editable || tree.disabled) {
    return;
  }
  const element = event.currentTarget as HTMLElement;
  const sourceParent = resolveDraggedChildParentPath({
    departmentPath: activeOrgTreeDrag?.departmentPath ?? readDragDepartmentPath(event),
    seatTeamLabel: activeOrgTreeDrag?.seatTeamLabel ?? readDragSeatTeamLabel(event),
  });
  const canReorder =
    normalizeOrgTreeParentPath(sourceParent ?? "") ===
      normalizeOrgTreeParentPath(params.parentPath) &&
    Boolean(activeOrgTreeDrag?.seatId || activeOrgTreeDrag?.departmentPath);
  if (!canReorder) {
    clearAllOrgTreeDropIndicators();
    handleDragOver(event, tree);
    element.classList.add("drag-over");
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer!.dropEffect = "move";
  updateSiblingDropIndicatorOnTarget(tree, params, element, event.clientY);
}

function trySiblingReorderDrop(
  event: DragEvent,
  tree: EnterpriseOrgTreeRenderParams,
  params: {
    parentPath: string;
    currentKeys: string[];
    targetKey: string;
    insertBefore?: boolean;
  },
): boolean {
  if (!tree.editable || tree.disabled) {
    return false;
  }
  const departmentPath = readDragDepartmentPath(event);
  const seatId = readDragSeatId(event);
  const seatTeamLabel = readDragSeatTeamLabel(event);
  const sourceParent = resolveDraggedChildParentPath({
    departmentPath,
    seatTeamLabel,
  });
  if (
    normalizeOrgTreeParentPath(sourceParent ?? "") !== normalizeOrgTreeParentPath(params.parentPath)
  ) {
    return false;
  }
  const dragKey = resolveDraggedChildKey({ departmentPath, seatId });
  if (!dragKey) {
    return false;
  }
  const orderedKeys = reorderOrganizationChildKeys({
    currentKeys: params.currentKeys,
    dragKey,
    targetKey: params.targetKey,
    insertBefore: params.insertBefore ?? resolveInsertBefore(event),
  });
  if (!orderedKeys) {
    return false;
  }
  const allKeys = resolveServerSiblingOrderKeys(tree, params.parentPath, params.currentKeys);
  const finalKeys =
    allKeys.length > 0
      ? (finalizeReorderKeysForServer(orderedKeys, allKeys) ?? orderedKeys)
      : orderedKeys;
  if (!finalKeys?.length) {
    return false;
  }
  tree.onReorderChildren?.(params.parentPath, finalKeys);
  return true;
}

function handleDragOver(event: DragEvent, tree: EnterpriseOrgTreeRenderParams) {
  if (!tree.editable || tree.disabled) {
    return;
  }
  event.preventDefault();
  event.dataTransfer!.dropEffect = "move";
}

function handleDragEnter(event: DragEvent, tree: EnterpriseOrgTreeRenderParams) {
  if (!tree.editable || tree.disabled) {
    return;
  }
  event.preventDefault();
  (event.currentTarget as HTMLElement).classList.add("drag-over");
}

function handleDragLeave(event: DragEvent) {
  const current = event.currentTarget as HTMLElement;
  const related = event.relatedTarget as Node | null;
  if (related && current.contains(related)) {
    return;
  }
  clearSiblingInsertIndicator(current);
  if (!related || !current.closest(".enterprise-org-tree")?.contains(related)) {
    clearAllOrgTreeDropIndicators();
  }
}

function clearDragOver(event: DragEvent) {
  clearSiblingInsertIndicator(event.currentTarget as HTMLElement);
}

function childOrderKeysFromDepartment(department: EnterpriseOrgDepartmentNode): string[] {
  if (department.orderedChildren.length > 0) {
    return department.orderedChildren.map((child) =>
      child.kind === "department"
        ? organizationChildDepartmentKey(child.department.fullPath)
        : organizationChildSeatKey(child.position.seatId),
    );
  }
  return buildDefaultChildOrderKeys(department);
}

function resolveDisplayedSiblingOrderKeys(
  tree: EnterpriseOrgTreeRenderParams,
  parentPath: string,
  department?: EnterpriseOrgDepartmentNode,
): string[] {
  if (department) {
    return childOrderKeysFromDepartment(department);
  }
  return tree.departments.map((entry) => organizationChildDepartmentKey(entry.fullPath));
}

function resolveServerSiblingOrderKeys(
  tree: EnterpriseOrgTreeRenderParams,
  parentPath: string,
  displayedKeys: string[],
): string[] {
  return tree.resolveChildOrderKeys?.(parentPath) ?? displayedKeys;
}

function isSiblingDropContext(event: DragEvent, parentPath: string): boolean {
  const sourceParent = resolveDraggedChildParentPath({
    departmentPath: readDragDepartmentPath(event),
    seatTeamLabel: readDragSeatTeamLabel(event),
  });
  return normalizeOrgTreeParentPath(sourceParent ?? "") === normalizeOrgTreeParentPath(parentPath);
}

function handleDepartmentDrop(
  event: DragEvent,
  tree: EnterpriseOrgTreeRenderParams,
  targetPath: string,
  siblingContext?: {
    parentPath: string;
    currentKeys: string[];
    targetKey: string;
  },
) {
  event.preventDefault();
  event.stopPropagation();
  clearDragOver(event);
  if (!tree.editable || tree.disabled) {
    return;
  }
  if (
    siblingContext &&
    trySiblingReorderDrop(event, tree, {
      parentPath: siblingContext.parentPath,
      currentKeys: siblingContext.currentKeys,
      targetKey: siblingContext.targetKey,
      insertBefore: resolveInsertBeforeOnTarget(event.currentTarget as HTMLElement, event.clientY),
    })
  ) {
    return;
  }
  if (siblingContext && isSiblingDropContext(event, siblingContext.parentPath)) {
    return;
  }
  const seatId = readDragSeatId(event);
  if (seatId) {
    tree.onMoveSeatToTeam?.(seatId, targetPath);
    return;
  }
  const departmentPath = readDragDepartmentPath(event);
  if (!departmentPath) {
    return;
  }
  const action = resolveOrganizationDepartmentDropAction(departmentPath, targetPath);
  if (!action) {
    return;
  }
  if (action === "merge") {
    if (
      !shouldProceed(
        `将「${departmentPath}」合并到「${targetPath || "全部组织"}」？合并后源部门节点会被移除，其岗位与子部门会迁入目标部门。`,
      )
    ) {
      return;
    }
    tree.onMergeDepartmentToTarget?.(departmentPath, targetPath);
    return;
  }
  tree.onMoveDepartmentToParent?.(departmentPath, targetPath);
}

function handlePositionDrop(
  event: DragEvent,
  tree: EnterpriseOrgTreeRenderParams,
  params: {
    parentPath: string;
    currentKeys: string[];
    position: EnterpriseOrgPositionNode;
  },
) {
  event.preventDefault();
  event.stopPropagation();
  clearDragOver(event);
  if (!tree.editable || tree.disabled) {
    return;
  }
  const targetKey = resolveTargetChildKey({
    kind: "position",
    seatId: params.position.seatId,
  });
  if (
    targetKey &&
    trySiblingReorderDrop(event, tree, {
      parentPath: params.parentPath,
      currentKeys: params.currentKeys,
      targetKey,
      insertBefore: resolveInsertBeforeOnTarget(event.currentTarget as HTMLElement, event.clientY),
    })
  ) {
    return;
  }
  const seatId = readDragSeatId(event);
  if (seatId) {
    tree.onMoveSeatToTeam?.(seatId, params.parentPath);
    return;
  }
  const departmentPath = readDragDepartmentPath(event);
  if (departmentPath) {
    handleDepartmentDrop(event, tree, params.parentPath);
  }
}

function renderDepartmentMenu(departmentPath: string, tree: EnterpriseOrgTreeRenderParams) {
  if (!tree.editable || tree.disabled) {
    return nothing;
  }
  return html`
    <details class="enterprise-org-tree__menu" @click=${(event: Event) => event.stopPropagation()}>
      <summary class="enterprise-org-tree__menu-trigger" aria-label="部门操作">⋯</summary>
      <div class="enterprise-org-tree__menu-panel">
        <button type="button" @click=${() => tree.onCreateChildDepartment?.(departmentPath)}>
          新建子部门
        </button>
        ${
          tree.onCreatePosition
            ? html`<button type="button" @click=${() => tree.onCreatePosition?.(departmentPath)}>
                新建岗位
              </button>`
            : nothing
        }
        <button type="button" @click=${() => tree.onRenameDepartment?.(departmentPath)}>重命名</button>
        <button type="button" @click=${() => tree.onDeleteDepartment?.(departmentPath)}>删除</button>
      </div>
    </details>
  `;
}

/** @deprecated Use departments */
export type EnterpriseOrgTreeLegacyParams = EnterpriseOrgTreeRenderParams & {
  teams?: EnterpriseOrgDepartmentNode[];
};

function countDepartmentSelectableMembers(
  department: EnterpriseOrgDepartmentNode,
  tree: EnterpriseOrgTreeRenderParams,
): number {
  let count = 0;
  const seen = new Set<string>();
  const visit = (node: EnterpriseOrgDepartmentNode) => {
    for (const position of node.positions) {
      const member = position.member;
      if (!member) {
        continue;
      }
      const key = member.user.trim().toLowerCase();
      if (!key || seen.has(key)) {
        continue;
      }
      if (tree.assignedSeatUserIds?.has(key)) {
        continue;
      }
      const selectable = tree.isMemberSelectable?.(member, position) ?? member.status === "active";
      if (!selectable) {
        continue;
      }
      seen.add(key);
      count += 1;
    }
    for (const child of node.childDepartments) {
      visit(child);
    }
  };
  visit(department);
  return count;
}

function renderOrgTreeGuide(isLastSibling: boolean) {
  return html`<span
    class="enterprise-org-tree__guide ${isLastSibling ? "is-last" : ""}"
    aria-hidden="true"
  ></span>`;
}

function organizationPositionSecondaryLabel(
  position: EnterpriseOrgPositionNode,
  mode: EnterpriseOrgTreeMode,
): string {
  if (!position.member) {
    return "空岗";
  }
  if (mode === "select-member") {
    return position.seatTitle;
  }
  if (mode === "navigate") {
    return "已绑定";
  }
  return position.member.displayLabel;
}

function isDepartmentInlineEditing(
  tree: EnterpriseOrgTreeRenderParams,
  departmentPath: string,
): boolean {
  return (
    tree.inlineEdit?.kind === "department" && tree.inlineEdit.departmentPath === departmentPath
  );
}

function isPositionInlineEditing(tree: EnterpriseOrgTreeRenderParams, seatId: string): boolean {
  return tree.inlineEdit?.kind === "position" && tree.inlineEdit.seatId === seatId;
}

function renderOrgTreeInlineInput(params: {
  value: string;
  disabled?: boolean;
  ariaLabel: string;
  onInput: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return html`
    <input
      class="enterprise-org-tree__inline-input"
      type="text"
      .value=${params.value}
      aria-label=${params.ariaLabel}
      ?disabled=${params.disabled}
      @input=${(event: Event) => params.onInput((event.target as HTMLInputElement).value)}
      @keydown=${(event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          params.onCommit();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          params.onCancel();
        }
      }}
      @click=${(event: Event) => event.stopPropagation()}
    />
  `;
}

function renderEnterpriseOrgTreeMember(params: {
  member: EnterpriseOrgMemberNode;
  position: EnterpriseOrgPositionNode;
  tree: EnterpriseOrgTreeRenderParams;
}) {
  const { member, position, tree } = params;
  const selected = isOrgTreeMemberSelected(tree, member.user);
  const alreadyAssigned = tree.assignedSeatUserIds?.has(member.user.trim().toLowerCase()) ?? false;
  const focused =
    tree.focusSeatId === position.seatId ||
    (tree.selectedMemberEmails
      ? tree.selectedMemberEmails.has(member.user)
      : tree.selectedMemberEmail === member.user);
  const selectable =
    tree.mode === "select-member" &&
    !alreadyAssigned &&
    (tree.isMemberSelectable?.(member, position) ?? member.status === "active");
  const active =
    tree.mode === "navigate" &&
    (tree.selectedSeatId === position.seatId || tree.selectedMemberEmail === member.user);

  const billingRole = tree.billingRoleByUserId?.get(member.user.trim().toLowerCase());
  const suggestedRole =
    !billingRole && !alreadyAssigned
      ? tree.suggestedRoleByOrgSeatId?.get(position.seatId)
      : undefined;
  const roleBadgeLabel = billingRole
    ? (tree.formatBillingRoleLabel?.(billingRole) ?? billingRole)
    : suggestedRole
      ? (tree.formatBillingRoleLabel?.(suggestedRole) ?? suggestedRole)
      : null;
  const roleBadgeKind = billingRole ? "assigned" : suggestedRole ? "suggested" : null;

  return html`
    <div
      class="enterprise-org-tree__node enterprise-org-tree__node--member ${
        active || selected ? "is-active" : ""
      } ${focused ? "is-focused" : ""}"
      role="treeitem"
      data-org-member-user=${member.user}
      data-org-seat-id=${position.seatId}
    >
      ${renderOrgTreeGuide(true)}
      <span class="enterprise-org-tree__icon" aria-hidden="true">
        ${renderIcon("user", "enterprise-org-tree__icon-svg")}
      </span>
      <button
        class="enterprise-org-tree__label enterprise-org-tree__label--button enterprise-org-tree__label--member"
        type="button"
        ?disabled=${tree.disabled}
        @click=${() => {
          if (tree.mode === "navigate") {
            tree.onSelectPosition?.(position.seatId, position.teamLabel);
            return;
          }
          if (selectable) {
            tree.onSelectMember?.(member.user, position.seatId, position.teamLabel);
          }
        }}
      >
        <span class="enterprise-org-tree__primary">${member.displayLabel}</span>
        ${
          roleBadgeLabel && roleBadgeKind
            ? html`
                <span class="enterprise-org-tree__meta">
                  <span
                    class="enterprise-org-tree__badge enterprise-org-tree__badge--billing enterprise-org-tree__badge--${roleBadgeKind}"
                    >${roleBadgeLabel}</span
                  >
                </span>
              `
            : nothing
        }
        <span class="enterprise-org-tree__secondary">${member.user}</span>
      </button>
      ${
        tree.mode === "select-member"
          ? selectable
            ? html`
                <button
                  class="btn btn--sm enterprise-org-tree__action ${selected ? "btn--primary" : ""}"
                  type="button"
                  ?disabled=${tree.disabled}
                  @click=${() =>
                    tree.onSelectMember?.(member.user, position.seatId, position.teamLabel)}
                >
                  ${selected ? "已选择" : "选择"}
                </button>
              `
            : html`
                <span class="enterprise-org-tree__muted">
                  ${alreadyAssigned ? "已分配席位" : "不可选"}
                </span>
              `
          : nothing
      }
    </div>
  `;
}

function renderEnterpriseOrgTreePosition(params: {
  position: EnterpriseOrgPositionNode;
  tree: EnterpriseOrgTreeRenderParams;
  parentDepartment: EnterpriseOrgDepartmentNode;
  isLastSibling: boolean;
}) {
  const { position, tree, parentDepartment, isLastSibling } = params;
  const active = tree.selectedSeatId === position.seatId;
  const highlighted = tree.highlightSeatId === position.seatId;
  const focused = tree.focusSeatId === position.seatId;
  const badge = tree.renderPositionBadge?.(position) ?? null;
  const parentPath = parentDepartment.fullPath;
  const currentKeys = childOrderKeysFromDepartment(parentDepartment);

  return html`
    <div
      class="enterprise-org-tree__node enterprise-org-tree__node--position ${
        active ? "is-active" : ""
      } ${highlighted ? "is-highlighted" : ""} ${focused ? "is-focused" : ""} ${
        tree.editable ? "is-draggable is-drop-target" : ""
      } ${tree.mode === "select-member" && position.member ? "is-seat-picker-row" : ""}"
      role="treeitem"
      aria-expanded=${tree.mode === "select-member" && position.member ? "true" : "false"}
      data-org-seat-id=${position.seatId}
      data-org-team-path=${position.teamLabel}
      draggable=${tree.editable && !tree.disabled ? "true" : "false"}
      @dragstart=${(event: DragEvent) => {
        if (!tree.editable || tree.disabled) {
          return;
        }
        setActiveOrgTreeDrag({
          seatId: position.seatId,
          seatTeamLabel: position.teamLabel,
        });
        event.dataTransfer?.setData(ORG_TREE_DRAG_SEAT_MIME, position.seatId);
        event.dataTransfer?.setData(ORG_TREE_DRAG_SEAT_TEAM_MIME, position.teamLabel);
        event.dataTransfer?.setData("text/plain", position.seatTitle);
        event.dataTransfer!.effectAllowed = "move";
      }}
      @dragend=${() => clearActiveOrgTreeDrag()}
      @dragenter=${(event: DragEvent) => updateSiblingDropIndicator(event, tree, { parentPath })}
      @dragleave=${handleDragLeave}
      @dragover=${(event: DragEvent) => updateSiblingDropIndicator(event, tree, { parentPath })}
      @drop=${(event: DragEvent) =>
        handlePositionDrop(event, tree, {
          parentPath,
          currentKeys,
          position,
        })}
    >
      ${renderOrgTreeGuide(isLastSibling)}
      ${
        tree.onToggleSeatCheck && (tree.isSeatCheckable?.(position) ?? true)
          ? html`
              <input
                class="enterprise-org-tree__seat-check"
                type="checkbox"
                aria-label=${`选择岗位 ${position.seatTitle}`}
                .checked=${tree.checkedSeatIds?.has(position.seatId) ?? false}
                ?disabled=${tree.disabled}
                @click=${(event: MouseEvent) => event.stopPropagation()}
                @change=${(event: Event) => {
                  event.stopPropagation();
                  tree.onToggleSeatCheck?.(position.seatId);
                }}
              />
            `
          : nothing
      }
      <span class="enterprise-org-tree__icon" aria-hidden="true">
        ${renderIcon("layers", "enterprise-org-tree__icon-svg")}
      </span>
      ${
        isPositionInlineEditing(tree, position.seatId)
          ? html`
              <div class="enterprise-org-tree__inline-field">
                ${renderOrgTreeInlineInput({
                  value: tree.inlineEdit?.draft ?? position.seatTitle,
                  disabled: tree.disabled,
                  ariaLabel: "岗位名称",
                  onInput: (value) => tree.onInlineEditDraftChange?.(value),
                  onCommit: () => tree.onInlineEditCommit?.(),
                  onCancel: () => tree.onInlineEditCancel?.(),
                })}
              </div>
            `
          : html`
              <button
                class="enterprise-org-tree__label enterprise-org-tree__label--button"
                type="button"
                ?disabled=${tree.disabled}
                @click=${() => tree.onSelectPosition?.(position.seatId, position.teamLabel)}
                @dblclick=${(event: Event) => {
                  if (!tree.editable || tree.disabled) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  tree.onStartInlineEditPosition?.(position.seatId, position.seatTitle);
                }}
              >
                <span class="enterprise-org-tree__primary">
                  ${tree.formatPositionPrimary?.(position) ?? position.seatTitle}
                  ${badge ? html`<span class="enterprise-org-tree__badge">${badge}</span>` : nothing}
                </span>
                <span class="enterprise-org-tree__secondary">
                  ${
                    tree.formatPositionSecondary?.(position) ??
                    organizationPositionSecondaryLabel(position, tree.mode)
                  }
                </span>
              </button>
            `
      }
      ${
        tree.mode === "select-member" && position.member
          ? html`
              <div
                class="enterprise-org-tree__children enterprise-org-tree__children--member enterprise-org-tree__children--lined"
                role="group"
              >
                ${renderEnterpriseOrgTreeMember({ member: position.member, position, tree })}
              </div>
            `
          : tree.editable && tree.onBindMember && !position.member
            ? html`
                <button
                  class="enterprise-org-tree__bind-member"
                  type="button"
                  ?disabled=${tree.disabled}
                  @click=${(event: Event) => {
                    event.stopPropagation();
                    tree.onBindMember?.(position.seatId, position.teamLabel);
                  }}
                >
                  邀请入职
                </button>
              `
            : !position.member && !tree.formatPositionSecondary
              ? html`
                  <span class="enterprise-org-tree__muted enterprise-org-tree__vacant">空岗</span>
                `
              : nothing
      }
    </div>
  `;
}

function renderEnterpriseOrgTreeDepartment(params: {
  department: EnterpriseOrgDepartmentNode;
  tree: EnterpriseOrgTreeRenderParams;
  siblingContext: { parentPath: string; currentKeys: string[] };
  isLastSibling: boolean;
}): TemplateResult {
  const { department, tree, siblingContext, isLastSibling } = params;
  const activeTeam = tree.activeTeam ?? "all";
  const expanded = shouldExpandEnterpriseOrgDepartment({
    department,
    activeTeam,
    selectedSeatId: tree.selectedSeatId ?? null,
    query: tree.query?.trim() ?? "",
    autoExpandAll: tree.autoExpandAll ?? false,
    focusTeamPath: tree.focusTeamPath ?? null,
    focusSeatId: tree.focusSeatId ?? null,
  });
  const departmentActive =
    activeTeam !== "all" &&
    matchesOrganizationTeamPath(department.fullPath, activeTeam) &&
    !tree.selectedSeatId;
  const departmentFocused =
    tree.focusTeamPath != null && department.fullPath === tree.focusTeamPath;
  const childKeys = childOrderKeysFromDepartment(department);
  const childSiblingContext = {
    parentPath: department.fullPath,
    currentKeys: childKeys,
  };
  const targetKey = organizationChildDepartmentKey(department.fullPath);
  const departmentSelectableCount =
    tree.mode === "select-member" && tree.onSelectDepartmentMembers
      ? countDepartmentSelectableMembers(department, tree)
      : 0;

  return html`
    <details
      class="enterprise-org-tree__team enterprise-org-tree__team--nested ${
        departmentActive ? "is-active" : ""
      } ${departmentFocused ? "is-focused" : ""} ${tree.editable ? "is-editable" : ""}"
      style=${`--org-tree-level: ${department.level}`}
      ?open=${expanded}
      data-org-team-path=${department.fullPath}
    >
      <summary
        class="enterprise-org-tree__team-summary ${tree.editable ? "is-drop-target" : ""}"
        role="treeitem"
        aria-expanded=${String(expanded)}
        draggable=${tree.editable && !tree.disabled ? "true" : "false"}
        @dragstart=${(event: DragEvent) => {
          if (!tree.editable || tree.disabled) {
            return;
          }
          event.stopPropagation();
          setActiveOrgTreeDrag({ departmentPath: department.fullPath });
          event.dataTransfer?.setData(ORG_TREE_DRAG_DEPARTMENT_MIME, department.fullPath);
          event.dataTransfer?.setData("text/plain", department.fullPath);
          event.dataTransfer!.effectAllowed = "move";
        }}
        @dragend=${() => clearActiveOrgTreeDrag()}
        @dragenter=${(event: DragEvent) =>
          updateSiblingDropIndicator(event, tree, {
            parentPath: siblingContext.parentPath,
          })}
        @dragleave=${handleDragLeave}
        @dragover=${(event: DragEvent) =>
          updateSiblingDropIndicator(event, tree, {
            parentPath: siblingContext.parentPath,
          })}
        @drop=${(event: DragEvent) =>
          handleDepartmentDrop(event, tree, department.fullPath, {
            parentPath: siblingContext.parentPath,
            currentKeys: siblingContext.currentKeys,
            targetKey,
          })}
      >
        ${renderOrgTreeGuide(isLastSibling)}
        <span class="enterprise-org-tree__toggle" aria-hidden="true">
          ${renderIcon("chevronRight", "enterprise-org-tree__toggle-icon")}
        </span>
        <span class="enterprise-org-tree__icon" aria-hidden="true">
          ${renderIcon("folder", "enterprise-org-tree__icon-svg")}
        </span>
        ${
          isDepartmentInlineEditing(tree, department.fullPath)
            ? html`
                <div class="enterprise-org-tree__inline-field">
                  ${renderOrgTreeInlineInput({
                    value: tree.inlineEdit?.draft ?? department.label,
                    disabled: tree.disabled,
                    ariaLabel: "部门名称",
                    onInput: (value) => tree.onInlineEditDraftChange?.(value),
                    onCommit: () => tree.onInlineEditCommit?.(),
                    onCancel: () => tree.onInlineEditCancel?.(),
                  })}
                </div>
              `
            : html`
                <button
                  class="enterprise-org-tree__label enterprise-org-tree__label--button"
                  type="button"
                  ?disabled=${tree.disabled}
                  @click=${(event: Event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    tree.onSelectTeam?.(department.fullPath);
                  }}
                  @dblclick=${(event: Event) => {
                    if (!tree.editable || tree.disabled) {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    tree.onStartInlineEditDepartment?.(department.fullPath, department.label);
                  }}
                >
                  <span class="enterprise-org-tree__primary">${department.label}</span>
                  <span class="enterprise-org-tree__secondary">
                    ${department.positions.length} 个岗位
                    ${
                      department.childDepartments.length
                        ? ` · ${department.childDepartments.length} 个子部门`
                        : nothing
                    }
                  </span>
                </button>
              `
        }
        ${
          tree.mode === "select-member" && tree.onSelectDepartmentMembers
            ? html`
                <button
                  class="btn btn--sm enterprise-org-tree__action"
                  type="button"
                  title=${
                    departmentSelectableCount > 0
                      ? `全选 ${department.label} 及子部门下 ${departmentSelectableCount} 名可分配成员`
                      : "该部门下暂无可分配成员"
                  }
                  ?disabled=${tree.disabled || departmentSelectableCount === 0}
                  @click=${(event: Event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    tree.onSelectDepartmentMembers?.(department.fullPath);
                  }}
                >
                  全选${departmentSelectableCount > 0 ? ` (${departmentSelectableCount})` : ""}
                </button>
              `
            : nothing
        }
        ${renderDepartmentMenu(department.fullPath, tree)}
      </summary>
      <div
        class="enterprise-org-tree__children enterprise-org-tree__children--mixed enterprise-org-tree__children--lined"
        role="group"
        @dragenter=${(event: DragEvent) => event.preventDefault()}
        @dragover=${(event: DragEvent) => handleMixedChildrenDragOver(event, tree, childSiblingContext)}
        @dragleave=${handleDragLeave}
        @drop=${(event: DragEvent) => handleMixedChildrenDrop(event, tree, childSiblingContext)}
      >
        ${department.orderedChildren.map((child, index, children) => {
          const childIsLast = index === children.length - 1;
          return child.kind === "department"
            ? renderEnterpriseOrgTreeDepartment({
                department: child.department,
                tree,
                siblingContext: childSiblingContext,
                isLastSibling: childIsLast,
              })
            : renderEnterpriseOrgTreePosition({
                position: child.position,
                tree,
                parentDepartment: department,
                isLastSibling: childIsLast,
              });
        })}
      </div>
    </details>
  `;
}

export function renderEnterpriseOrgTree(params: EnterpriseOrgTreeRenderParams) {
  const departments = params.departments;
  const activeTeam = params.activeTeam ?? "all";
  const autoExpandAll = params.autoExpandAll ?? departments.length <= 6;

  if (!departments.length) {
    return html`
      <section class="enterprise-org-tree-panel">
        ${
          params.title
            ? html`
                <div class="enterprise-org-tree-panel__header">
                  <div class="enterprise-org-tree-panel__title">${params.title}</div>
                  ${params.hint ? html`<div class="enterprise-org-tree-panel__hint">${params.hint}</div>` : nothing}
                </div>
              `
            : nothing
        }
        <div class="enterprise-empty enterprise-empty--compact">
          ${params.emptyLabel ?? "暂无组织目录数据。"}
        </div>
      </section>
    `;
  }

  return html`
    <section class="enterprise-org-tree-panel">
      ${
        params.title
          ? html`
              <div class="enterprise-org-tree-panel__header">
                <div class="enterprise-org-tree-panel__title">${params.title}</div>
                ${params.hint ? html`<div class="enterprise-org-tree-panel__hint">${params.hint}</div>` : nothing}
              </div>
            `
          : nothing
      }
      <div
        class="enterprise-org-tree"
        role="tree"
        aria-label=${params.title ?? "组织目录"}
        @dragend=${() => clearActiveOrgTreeDrag()}
      >
        ${
          params.showAllNode
            ? html`
                <button
                  class="enterprise-org-tree__node enterprise-org-tree__node--root ${
                    activeTeam === "all" && !params.selectedSeatId ? "is-active" : ""
                  } ${params.editable ? "is-drop-target" : ""}"
                  type="button"
                  role="treeitem"
                  ?disabled=${params.disabled}
                  @click=${() => params.onSelectAll?.()}
                  @dragenter=${(event: DragEvent) => handleDragEnter(event, params)}
                  @dragleave=${handleDragLeave}
                  @dragover=${(event: DragEvent) => handleDragOver(event, params)}
                  @drop=${(event: DragEvent) => {
                    if (!params.editable || params.disabled) {
                      return;
                    }
                    handleDepartmentDrop(event, params, "");
                  }}
                >
                  <span class="enterprise-org-tree__icon" aria-hidden="true">
                    ${renderIcon("building", "enterprise-org-tree__icon-svg")}
                  </span>
                  <span class="enterprise-org-tree__primary">全部组织</span>
                </button>
              `
            : nothing
        }
        ${(() => {
          const rootSiblingContext = {
            parentPath: "",
            currentKeys: resolveDisplayedSiblingOrderKeys(params, ""),
          };
          return html`
            <div
              class="enterprise-org-tree__children enterprise-org-tree__children--mixed enterprise-org-tree__children--root enterprise-org-tree__children--lined"
              role="group"
              @dragenter=${(event: DragEvent) => event.preventDefault()}
              @dragover=${(event: DragEvent) =>
                handleMixedChildrenDragOver(event, params, rootSiblingContext)}
              @dragleave=${handleDragLeave}
              @drop=${(event: DragEvent) =>
                handleMixedChildrenDrop(event, params, rootSiblingContext)}
            >
              ${departments.map((department, index, list) =>
                renderEnterpriseOrgTreeDepartment({
                  department,
                  tree: { ...params, autoExpandAll },
                  siblingContext: rootSiblingContext,
                  isLastSibling: index === list.length - 1,
                }),
              )}
            </div>
          `;
        })()}
      </div>
    </section>
  `;
}
