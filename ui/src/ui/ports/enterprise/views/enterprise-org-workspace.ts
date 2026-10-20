import { html, nothing, type TemplateResult } from "lit";

export type OrganizationEditorPresentation = "modal" | "workspace";

export type OrganizationStructureWorkspaceContext = {
  seatOfferEditor?: { seatId?: string | null };
  handoverEditor?: { caseId?: string | null };
  createPositionEditor?: { open?: boolean };
  ownershipTransferEditor?: { open?: boolean };
  inviteOpen: boolean;
  departmentEditorOpen: boolean;
  importOpen: boolean;
  positionDetailOpen?: boolean;
};

export function isOrganizationStructureWorkspaceActive(
  context: OrganizationStructureWorkspaceContext,
): boolean {
  return !!(
    context.seatOfferEditor?.seatId ||
    context.handoverEditor?.caseId ||
    context.createPositionEditor?.open ||
    context.ownershipTransferEditor?.open ||
    context.departmentEditorOpen ||
    context.inviteOpen ||
    context.importOpen ||
    context.positionDetailOpen
  );
}

let organizationStructureRailManualCollapsed: boolean | null = null;

export function resolveOrganizationStructureRailCollapsed(workspaceActive: boolean): boolean {
  if (!workspaceActive) {
    organizationStructureRailManualCollapsed = null;
    return false;
  }
  // 操作区激活时不再自动隐藏左侧组织树：组织树是导航与映射的锚点，
  // 任何编辑都应在右侧操作区内就地完成，而不是用整页表单取代组织树。
  // 仅当用户主动点击折叠按钮时才收起；激活态下通过 grid 比例把更多空间让给操作区。
  if (organizationStructureRailManualCollapsed !== null) {
    return organizationStructureRailManualCollapsed;
  }
  return false;
}

export function expandOrganizationStructureRail() {
  organizationStructureRailManualCollapsed = false;
}

export function toggleOrganizationStructureRailCollapsed(workspaceActive: boolean) {
  const collapsed = resolveOrganizationStructureRailCollapsed(workspaceActive);
  organizationStructureRailManualCollapsed = !collapsed;
}

export function resetOrganizationStructureRailCollapsed() {
  organizationStructureRailManualCollapsed = null;
}

export function wrapOrganizationEditorPresentation(params: {
  presentation: OrganizationEditorPresentation;
  ariaLabel: string;
  onClose: () => void;
  content: TemplateResult;
  panelClass?: string;
}) {
  const panelClass =
    params.presentation === "workspace"
      ? `enterprise-org-workspace card enterprise-org-ws ${params.panelClass ?? ""}`.trim()
      : (params.panelClass ?? "enterprise-org-modal");

  const panel = html`
    <section
      class=${panelClass}
      role=${params.presentation === "workspace" ? "region" : "dialog"}
      aria-modal=${params.presentation === "workspace" ? nothing : "true"}
      aria-label=${params.ariaLabel}
      @click=${(event: Event) => event.stopPropagation()}
    >
      ${params.content}
    </section>
  `;

  if (params.presentation === "workspace") {
    return panel;
  }

  return html`
    <div
      class="enterprise-org-modal-overlay"
      @click=${(event: MouseEvent) => {
        if (event.target === event.currentTarget) {
          params.onClose();
        }
      }}
    >
      ${panel}
    </div>
  `;
}

export function renderOrganizationWorkspaceIdle() {
  return html`
    <section class="enterprise-org-workspace enterprise-org-workspace--idle card">
      <div class="enterprise-org-workspace__idle-icon" aria-hidden="true">◎</div>
      <strong>操作区</strong>
      <p>点击左侧部门或岗位查看详情与快捷操作；绑定成员、新建岗位、导入与编辑表单会在此区域展开。</p>
      <p>岗位的编辑、删除、交接与成员绑定均在详情页操作区完成。</p>
    </section>
  `;
}
