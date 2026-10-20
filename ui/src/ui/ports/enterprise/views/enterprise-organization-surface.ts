import JSZip from "jszip";
import { html, nothing } from "lit";
import { t } from "../../../../i18n/index.ts";
import { readOrganizationMonthlyUsageLoadState } from "../../../controllers/enterprise-organization-monthly-usage.ts";
import type { PlatformEmployeeProvisionInput } from "../../../controllers/platform-auth.ts";
import { renderIcon, type IconName } from "../../../icons.ts";
import { pathForTab } from "../../../navigation.ts";
import { isOpenBotProductionHost } from "../../../routing/subdomain-resolver.ts";
import {
  type EnterpriseKpiItem,
  renderEnterpriseKpiGrid,
} from "../../../views/enterprise-kpi-card.ts";
import { renderEnterpriseModuleHeader } from "../../../views/enterprise-module-header.ts";
import { formatCost, formatTokens } from "../../../views/usage-metrics.ts";
import {
  formatEnterpriseRoleLabel,
  formatEnterpriseRuntimeLabel,
  formatEnterpriseStatusLabel,
} from "../enterprise-connection-copy.ts";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import {
  isOrganizationInactiveStatus,
  organizationStatusMatchesInactiveFilter,
  partitionOrganizationActivationSelection,
} from "../semantic/organization-inactive-activation.ts";
import {
  aggregateSeatAgentUsage,
  collectUniqueSeatAgentIds,
  mergePositionMonthlyUsage,
  resolveEmployeeUsageForSeat,
  type OrganizationMonthlyUsageLoadState,
  type OrganizationPositionUsageAggregate,
} from "../semantic/organization-position-usage.ts";
import {
  isOrganizationSeatDeletable,
  partitionOrganizationSeatDeletionSelection,
} from "../semantic/organization-seat-deletion.ts";
import { renderHandoverEditor } from "./enterprise-handover-editor.ts";
import { handoverStatusLabel } from "./enterprise-handover-status.ts";
import { buildDirectChildOrderKeysFromReadModel } from "./enterprise-org-child-order.ts";
import {
  createOrganizationDepartmentEditorState,
  renderOrganizationDepartmentEditor,
  type OrganizationDepartmentEditorState,
} from "./enterprise-org-department-editor.ts";
import {
  clearOrganizationImportPreviewMount,
  mountOrganizationImportPreviewPanel,
  type OrganizationImportPreviewTab,
} from "./enterprise-org-import-preview-view.ts";
import {
  buildOrganizationImportPreview,
  organizationImportPreviewToSubmitRows,
  type OrganizationImportPreview,
} from "./enterprise-org-import-preview.ts";
import { downloadOrganizationImportTemplate } from "./enterprise-org-import-template.ts";
import {
  focusOrganizationTreeInlineInput,
  type OrganizationTreeInlineEditState,
  uniqueDefaultDepartmentLabel,
} from "./enterprise-org-inline-edit.ts";
import { splitOrganizationPath } from "./enterprise-org-path.ts";
import {
  filterEnterpriseOrgDepartmentsByScope,
  organizationRowVisibleUnderScope,
  organizationScopeBlocksDepartmentManagement,
  resolveOrganizationDepartmentScope,
} from "./enterprise-org-scope.ts";
import {
  renderOrganizationStructureDepartmentInspector,
  renderOrganizationPositionDetail,
} from "./enterprise-org-structure-inspector.ts";
import { scrollEnterpriseOrgTreeToFocus } from "./enterprise-org-tree-focus.ts";
import {
  buildEnterpriseOrgTree,
  matchesOrganizationTeamPath,
  resolveEnterpriseOrgTreeSearchQuery,
  searchEnterpriseOrgDirectory,
} from "./enterprise-org-tree-model.ts";
import { renderEnterpriseOrgTree } from "./enterprise-org-tree-view.ts";
import {
  ORG_WS_WORKSPACE_SUB,
  orgWsBody,
  orgWsCheckboxGrid,
  orgWsField,
  orgWsFooter,
  orgWsHeader,
  orgWsKvGrid,
  orgWsNotice,
  orgWsRadioRow,
  orgWsSection,
  orgWsTrail,
} from "./enterprise-org-workspace-template.ts";
import {
  expandOrganizationStructureRail,
  isOrganizationStructureWorkspaceActive,
  renderOrganizationWorkspaceIdle,
  resetOrganizationStructureRailCollapsed,
  resolveOrganizationStructureRailCollapsed,
  toggleOrganizationStructureRailCollapsed,
  type OrganizationEditorPresentation,
  wrapOrganizationEditorPresentation,
} from "./enterprise-org-workspace.ts";
import {
  buildOrganizationMemberDisplayLookup,
  resolveOrganizationDigitalHumanName,
  resolveOrganizationMemberDisplayLabel,
  resolveOrganizationSeatDisplayName,
} from "./enterprise-organization-display-label.ts";
import {
  ENTERPRISE_ADMIN_INVITE_PICK_PARAM,
  followDelegatedPortHref,
  followPortHref,
  renderOwnershipTransferEditor,
  renderEnterpriseSeatLimitNotice,
  renderOrganizationConnectionHint,
  renderMeshBadge,
  requestEnterpriseAppRerender,
  shouldProceed,
} from "./enterprise-surface-shared.ts";
import type { EnterpriseSurfaceProps } from "./enterprise-surface-types.ts";

let organizationImportPreviewCache: OrganizationImportPreview | null = null;
let organizationImportPreviewTab: OrganizationImportPreviewTab = "tree";
let organizationTreeFocus: {
  teamPath?: string | null;
  seatId?: string | null;
  memberUser?: string | null;
} | null = null;
let organizationDepartmentEditor: OrganizationDepartmentEditorState =
  createOrganizationDepartmentEditorState();
let organizationTreeInlineEdit: OrganizationTreeInlineEditState | null = null;
let organizationStructureImportOpen = false;
/** 导入成功后的一次性提示：落地邀请激活工作区时展示，关闭激活或离开结构页时清除。 */
let organizationImportSuccessNotice: string | null = null;
/** 岗位多选：治理队列激活发信 + 空岗/待激活批量删除（含组织目录勾选）。 */
let organizationActivationSelectedSeatIds = new Set<string>();
/** Per-email busy keys for invite-activation sends (`*` = all pending). */
let organizationActivationBusyEmails: string[] = [];
const ORGANIZATION_ACTIVATION_BUSY_ALL = "*";

function normalizeOrganizationActivationEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isOrganizationActivationEmailBusy(email: string | null | undefined): boolean {
  if (organizationActivationBusyEmails.length === 0) {
    return false;
  }
  if (organizationActivationBusyEmails.includes(ORGANIZATION_ACTIVATION_BUSY_ALL)) {
    return true;
  }
  const normalized = typeof email === "string" ? normalizeOrganizationActivationEmail(email) : "";
  return Boolean(normalized && organizationActivationBusyEmails.includes(normalized));
}

function isOrganizationActivationAnyBusy(): boolean {
  return organizationActivationBusyEmails.length > 0;
}

async function runOrganizationActivationEmailSend(
  onSend: (emails?: string[]) => unknown,
  emails?: string[],
): Promise<void> {
  const targets = Array.isArray(emails)
    ? emails.map(normalizeOrganizationActivationEmail).filter(Boolean)
    : [ORGANIZATION_ACTIVATION_BUSY_ALL];
  organizationActivationBusyEmails =
    targets.length > 0 ? targets : [ORGANIZATION_ACTIVATION_BUSY_ALL];
  requestEnterpriseAppRerender();
  try {
    await onSend(emails);
  } finally {
    organizationActivationBusyEmails = [];
    requestEnterpriseAppRerender();
  }
}

/** 批量删除结果汇总（成功/失败），渲染在 bulk bar 旁。 */
let organizationBulkDeleteFeedback: string | null = null;

export function formatOrganizationBulkSeatDeletionNotice(params: {
  succeeded: number;
  failed: Array<{ name: string; error: string }>;
}): string {
  const failed = params.failed;
  if (failed.length === 0) {
    return `已删除 ${params.succeeded} 个岗位。`;
  }
  const preview = failed
    .slice(0, 3)
    .map((entry) => `${entry.name}（${entry.error}）`)
    .join("；");
  const more = failed.length > 3 ? ` 等 ${failed.length} 个` : "";
  if (params.succeeded === 0) {
    return `批量删除失败：${preview}${more}`;
  }
  return `已删除 ${params.succeeded} 个岗位；${failed.length} 个失败：${preview}${more}`;
}

function isOrganizationSeatBulkSelectable(row: OrganizationPositionRow): boolean {
  return (
    isOrganizationInactiveStatus(row.status) ||
    Boolean(row.pendingEmployeeUser) ||
    isOrganizationSeatDeletable(row)
  );
}

function openOrganizationStructureImport(
  seatOfferEditor?: EnterpriseSurfaceProps["seatOfferEditor"],
) {
  organizationStructureImportOpen = true;
  seatOfferEditor?.onClose?.();
  requestEnterpriseAppRerender();
}

function closeOrganizationStructureImport() {
  organizationStructureImportOpen = false;
  requestEnterpriseAppRerender();
}

function dismissOrganizationStructureTreeNavigation(params: {
  seatOfferEditor?: EnterpriseSurfaceProps["seatOfferEditor"];
  createPositionEditor?: NonNullable<EnterpriseSurfaceProps["createPositionEditor"]>;
}) {
  organizationStructureImportOpen = false;
  if (organizationDepartmentEditor.open) {
    organizationDepartmentEditor = createOrganizationDepartmentEditorState();
  }
  params.seatOfferEditor?.onClose?.();
  params.createPositionEditor?.onClose?.();
}

export function resetOrganizationStructureTransientState() {
  organizationStructureImportOpen = false;
  organizationImportSuccessNotice = null;
  organizationTreeInlineEdit = null;
  organizationDepartmentEditor = createOrganizationDepartmentEditorState();
  organizationActivationSelectedSeatIds = new Set();
  organizationActivationBusyEmails = [];
  resetOrganizationStructureRailCollapsed();
}

type OrganizationNavEditors = {
  seatOfferEditor?: EnterpriseSurfaceProps["seatOfferEditor"];
  createPositionEditor?: EnterpriseSurfaceProps["createPositionEditor"];
  handoverEditor?: EnterpriseSurfaceProps["handoverEditor"];
};

function closeOrganizationWorkspaceEditors(editors?: OrganizationNavEditors) {
  resetOrganizationStructureTransientState();
  editors?.seatOfferEditor?.onClose?.();
  editors?.createPositionEditor?.onClose?.();
  editors?.handoverEditor?.onClose?.();
}

/** Clear structure + editors and return to the governance module home (KPI + tables). */
function goOrganizationModuleHome(editors?: OrganizationNavEditors) {
  closeOrganizationWorkspaceEditors(editors);
  updateOrganizationSearchParams({
    organizationSurface: null,
    organizationSeat: null,
    organizationTeam: "all",
    organizationInvite: null,
    organizationPage: 1,
    organizationFrom: null,
  });
}

/** Stay on structure catalog with an idle workspace (no seat / invite / editor). */
function goOrganizationStructureCatalog(editors?: OrganizationNavEditors) {
  closeOrganizationWorkspaceEditors(editors);
  updateOrganizationSearchParams({
    organizationSurface: "structure",
    organizationSeat: null,
    organizationTeam: "all",
    organizationInvite: null,
    organizationPage: 1,
    organizationFrom: null,
  });
}

function resolveOrganizationStructureTrailCurrent(params: {
  inviteOpen: boolean;
  selectedSeatId: string | null;
  positionRows: OrganizationPositionRow[];
  team: string;
  createPositionEditor: NonNullable<EnterpriseSurfaceProps["createPositionEditor"]>;
  seatOfferEditor: NonNullable<EnterpriseSurfaceProps["seatOfferEditor"]>;
  handoverEditor: EnterpriseSurfaceProps["handoverEditor"];
  ownershipTransferEditor?: EnterpriseSurfaceProps["ownershipTransferEditor"];
}): string | null {
  if (params.seatOfferEditor?.seatId) {
    return params.seatOfferEditor.mode === "activation" ? "邀请新成员" : "分配在职成员";
  }
  if (params.handoverEditor?.caseId) {
    return "岗位交接";
  }
  if (params.ownershipTransferEditor?.open) {
    return "归属转移";
  }
  if (params.createPositionEditor?.open) {
    return params.createPositionEditor.seatId ? "编辑岗位" : "新建岗位";
  }
  if (organizationDepartmentEditor.open && organizationDepartmentEditor.mode) {
    switch (organizationDepartmentEditor.mode) {
      case "create":
        return "新建部门";
      case "rename":
        return "重命名部门";
      case "move":
        return "移动部门";
      case "merge":
        return "合并部门";
      case "delete":
        return "删除部门";
    }
  }
  if (params.inviteOpen) {
    return "邀请激活";
  }
  if (organizationStructureImportOpen) {
    return "从 Excel 导入";
  }
  if (params.selectedSeatId) {
    const row = params.positionRows.find((entry) => entry.seatId === params.selectedSeatId);
    return row?.name ?? "岗位详情";
  }
  if (params.team.trim() && params.team !== "all") {
    return params.team;
  }
  return null;
}

function toggleOrganizationActivationSeatSelection(seatId: string) {
  const next = new Set(organizationActivationSelectedSeatIds);
  if (next.has(seatId)) {
    next.delete(seatId);
  } else {
    next.add(seatId);
  }
  organizationActivationSelectedSeatIds = next;
  requestEnterpriseAppRerender();
}

function setOrganizationActivationSeatSelection(seatIds: readonly string[]) {
  organizationActivationSelectedSeatIds = new Set(seatIds);
  requestEnterpriseAppRerender();
}

function clearOrganizationActivationSeatSelection() {
  const hadSelection = organizationActivationSelectedSeatIds.size > 0;
  const hadFeedback = Boolean(organizationBulkDeleteFeedback);
  if (!hadSelection && !hadFeedback) {
    return;
  }
  organizationActivationSelectedSeatIds = new Set();
  organizationBulkDeleteFeedback = null;
  requestEnterpriseAppRerender();
}

/**
 * 治理台四张表（岗位/成员/数字人/协作组）行级「查看岗位」统一入口：
 * 与岗位表行点击一致，进入组织结构操作区中的岗位详情，并在 URL 上
 * 记录 organizationFrom=governance，保证刷新后仍能「返回模块首页」。
 */
function openOrganizationSeatDetailFromGovernance(params: {
  seatId: string;
  teamLabel?: string | null;
}) {
  updateOrganizationSearchParams({
    organizationSurface: "structure",
    organizationView: "position",
    organizationTeam: params.teamLabel?.trim() ? params.teamLabel : "all",
    organizationSeat: params.seatId,
    organizationPage: 1,
    organizationFrom: "governance",
  });
}

function openOrganizationSeatArchiveForActivation(params: {
  row: OrganizationPositionRow;
  seatOfferEditor: NonNullable<EnterpriseSurfaceProps["seatOfferEditor"]>;
}) {
  const onGovernanceHome = resolveOrganizationSurface(window.location.search) !== "structure";
  updateOrganizationSearchParams({
    organizationSurface: "structure",
    organizationView: "position",
    organizationTeam: params.row.teamLabel,
    organizationSeat: params.row.seatId,
    organizationInvite: null,
    organizationPage: 1,
    organizationFrom: onGovernanceHome ? "governance" : null,
  });
  params.seatOfferEditor.onOpen({
    mode: "activation",
    seatId: params.row.seatId,
    seatTitle: params.row.name,
    seatStatus: params.row.seatStatus,
    defaultAgentId: params.row.defaultAgentId,
    availableAgentIds: params.row.agentIds,
    defaultSpaceIds: params.row.defaultSpaceIds,
    memoryScopeAvailable: params.row.memoryScopeIds.length > 0,
    employeeEmail: params.row.pendingEmployeeUser,
  });
}

function runOrganizationBulkActivationSend(params: {
  rows: OrganizationPositionRow[];
  actions: EnterpriseSurfaceProps["actions"];
  seatOfferEditor: NonNullable<EnterpriseSurfaceProps["seatOfferEditor"]>;
}) {
  const partitioned = partitionOrganizationActivationSelection({
    rows: params.rows,
    selectedSeatIds: organizationActivationSelectedSeatIds,
  });
  if (partitioned.emailsToSend.length > 0) {
    void runOrganizationActivationEmailSend(
      params.actions.organization.onSendActivationEmails,
      partitioned.emailsToSend,
    );
  }
  const needingEmail = partitioned.seatsNeedingEmail[0];
  if (needingEmail) {
    const fullRow = params.rows.find((row) => row.seatId === needingEmail.seatId);
    if (fullRow) {
      openOrganizationSeatArchiveForActivation({
        row: fullRow,
        seatOfferEditor: params.seatOfferEditor,
      });
    }
  }
  clearOrganizationActivationSeatSelection();
}

function openOrganizationStructureCreatePosition(
  createPositionEditor: NonNullable<EnterpriseSurfaceProps["createPositionEditor"]>,
  teamPath = "",
  seatOfferEditor?: EnterpriseSurfaceProps["seatOfferEditor"],
) {
  organizationStructureImportOpen = false;
  updateOrganizationSearchParams({ organizationInvite: null });
  seatOfferEditor?.onClose?.();
  createPositionEditor.onOpen({
    teamLabel: teamPath,
    seatTitle: "新岗位",
  });
}

function openOrganizationBuilder() {
  updateOrganizationSearchParams({ organizationSurface: "structure" });
}

function listOrganizationDepartmentParentOptions(readModel: EnterprisePortReadModel): string[] {
  return [...(readModel.organizationDepartmentPaths ?? [])]
    .filter((path) => path !== "未分组")
    .toSorted((left, right) => left.localeCompare(right, "zh-CN"));
}

function openOrganizationDepartmentEditor(params: {
  mode: NonNullable<OrganizationDepartmentEditorState["mode"]>;
  path?: string;
  parentPath?: string;
  targetPath?: string;
  label?: string;
}) {
  organizationStructureImportOpen = false;
  organizationDepartmentEditor = {
    open: true,
    mode: params.mode,
    path: params.path ?? "",
    parentPath: params.parentPath ?? "",
    targetPath: params.targetPath ?? "",
    label: params.label ?? splitOrganizationPath(params.path).at(-1) ?? "",
    busy: false,
    error: null,
  };
  requestEnterpriseAppRerender();
}

function closeOrganizationDepartmentEditor() {
  organizationDepartmentEditor = createOrganizationDepartmentEditorState();
  requestEnterpriseAppRerender();
}

function cancelOrganizationTreeInlineEdit() {
  organizationTreeInlineEdit = null;
  requestEnterpriseAppRerender();
}

function startOrganizationTreeInlineEditDepartment(path: string, label: string) {
  organizationTreeInlineEdit = {
    kind: "department",
    departmentPath: path,
    draft: label,
    original: label,
  };
  requestEnterpriseAppRerender();
  focusOrganizationTreeInlineInput();
}

function startOrganizationTreeInlineEditPosition(seatId: string, title: string) {
  organizationTreeInlineEdit = {
    kind: "position",
    seatId,
    draft: title,
    original: title,
  };
  requestEnterpriseAppRerender();
  focusOrganizationTreeInlineInput();
}

async function createOrganizationDepartmentInline(params: {
  tenantId: string | null;
  actions: EnterpriseSurfaceProps["actions"];
  readModel: EnterprisePortReadModel;
  parentPath: string;
}) {
  if (!params.tenantId) {
    return;
  }
  organizationStructureImportOpen = false;
  const label = uniqueDefaultDepartmentLabel(
    params.parentPath,
    params.readModel.organizationDepartmentPaths ?? [],
  );
  const result = await params.actions.organization.onMutateOrganizationDepartment?.(
    params.tenantId,
    {
      action: "create",
      label,
      parentPath: params.parentPath.trim() || null,
    },
  );
  if (!result) {
    return;
  }
  const nextPath =
    typeof result.fullPath === "string"
      ? result.fullPath
      : params.parentPath.trim()
        ? `${params.parentPath.trim()}/${label}`
        : label;
  organizationTreeInlineEdit = {
    kind: "department",
    departmentPath: nextPath,
    draft: label,
    original: label,
  };
  organizationTreeFocus = { teamPath: nextPath };
  updateOrganizationSearchParams({
    organizationTeam: nextPath,
    organizationSeat: null,
    organizationPage: 1,
  });
  requestEnterpriseAppRerender();
  queueMicrotask(() => scrollEnterpriseOrgTreeToFocus({ teamLabel: nextPath }));
  focusOrganizationTreeInlineInput();
}

async function commitOrganizationTreeInlineEdit(params: {
  tenantId: string | null;
  actions: EnterpriseSurfaceProps["actions"];
}) {
  const edit = organizationTreeInlineEdit;
  if (!edit || !params.tenantId) {
    return;
  }
  const value = edit.draft.trim();
  if (!value) {
    organizationTreeInlineEdit = { ...edit, draft: edit.original };
    requestEnterpriseAppRerender();
    focusOrganizationTreeInlineInput();
    return;
  }
  if (value === edit.original) {
    organizationTreeInlineEdit = null;
    requestEnterpriseAppRerender();
    return;
  }
  if (edit.kind === "department" && edit.departmentPath) {
    const result = await params.actions.organization.onMutateOrganizationDepartment?.(
      params.tenantId,
      {
        action: "rename",
        path: edit.departmentPath,
        label: value,
      },
    );
    if (!result) {
      return;
    }
    const nextPath = typeof result.fullPath === "string" ? result.fullPath : edit.departmentPath;
    organizationTreeFocus = { teamPath: nextPath };
    updateOrganizationSearchParams({
      organizationTeam: nextPath,
      organizationSeat: null,
      organizationPage: 1,
    });
  } else if (edit.kind === "position" && edit.seatId) {
    // onUpdateSeatProfile resolves to void per the AppViewState slice; success or
    // failure is surfaced via platformAuthError, so just await and refresh below.
    await params.actions.organization.onUpdateSeatProfile?.(params.tenantId, edit.seatId, {
      seatTitle: value,
    });
  }
  organizationTreeInlineEdit = null;
  requestEnterpriseAppRerender();
}

async function submitOrganizationDepartmentEditor(params: {
  tenantId: string | null;
  actions: EnterpriseSurfaceProps["actions"];
  readModel: EnterprisePortReadModel;
}) {
  const editor = organizationDepartmentEditor;
  if (!editor.open || !editor.mode || !params.tenantId) {
    return;
  }
  organizationDepartmentEditor = { ...editor, busy: true, error: null };
  requestEnterpriseAppRerender();
  const mutation =
    editor.mode === "create"
      ? {
          action: "create" as const,
          label: editor.label.trim(),
          parentPath: editor.parentPath.trim() || null,
        }
      : editor.mode === "rename"
        ? {
            action: "rename" as const,
            path: editor.path,
            label: editor.label.trim(),
          }
        : editor.mode === "move"
          ? {
              action: "move" as const,
              path: editor.path,
              parentPath: editor.parentPath.trim() || null,
            }
          : editor.mode === "merge"
            ? {
                action: "merge" as const,
                path: editor.path,
                targetPath: editor.targetPath.trim(),
              }
            : editor.mode === "delete"
              ? { action: "delete" as const, path: editor.path }
              : null;
  if (!mutation) {
    return;
  }
  if ((editor.mode === "create" || editor.mode === "rename") && !editor.label.trim()) {
    organizationDepartmentEditor = {
      ...organizationDepartmentEditor,
      busy: false,
      error: "请填写部门名称。",
    };
    requestEnterpriseAppRerender();
    return;
  }
  if (editor.mode === "merge" && !editor.targetPath.trim()) {
    organizationDepartmentEditor = {
      ...organizationDepartmentEditor,
      busy: false,
      error: "请选择合并目标部门。",
    };
    requestEnterpriseAppRerender();
    return;
  }
  const result = await params.actions.organization.onMutateOrganizationDepartment?.(
    params.tenantId,
    mutation,
  );
  if (result === undefined) {
    const liveError =
      params.actions.organization.getOrganizationDepartmentMutationError?.()?.trim() || null;
    organizationDepartmentEditor = {
      ...organizationDepartmentEditor,
      busy: false,
      error: liveError || "部门变更失败，请稍后重试。",
    };
    requestEnterpriseAppRerender();
    return;
  }
  const nextPath =
    "fullPath" in (result ?? {}) && typeof result?.fullPath === "string"
      ? result.fullPath
      : editor.path;
  closeOrganizationDepartmentEditor();
  if (nextPath) {
    organizationTreeFocus = { teamPath: nextPath };
    updateOrganizationSearchParams({
      organizationTeam: nextPath,
      organizationSeat: null,
      organizationPage: 1,
    });
  }
}

async function moveOrganizationSeatToTeam(params: {
  tenantId: string | null;
  actions: EnterpriseSurfaceProps["actions"];
  seatId: string;
  targetPath: string;
}) {
  if (!params.tenantId) {
    return;
  }
  await params.actions.organization.onMutateOrganizationDepartment?.(params.tenantId, {
    action: "move-seat",
    seatId: params.seatId,
    targetPath: params.targetPath,
  });
  organizationTreeFocus = { teamPath: params.targetPath, seatId: params.seatId };
  updateOrganizationSearchParams({
    organizationView: "position",
    organizationTeam: params.targetPath,
    organizationSeat: params.seatId,
    organizationPage: 1,
  });
  queueMicrotask(() =>
    scrollEnterpriseOrgTreeToFocus({ teamLabel: params.targetPath, seatId: params.seatId }),
  );
}

async function deleteOrganizationSeat(params: {
  tenantId: string | null;
  actions: EnterpriseSurfaceProps["actions"];
  seatId: string;
  seatTitle: string;
  teamPath: string;
}) {
  if (!params.tenantId) {
    return;
  }
  await params.actions.organization.onDeleteSeat?.(params.tenantId, params.seatId);
  organizationTreeFocus = { teamPath: params.teamPath };
  updateOrganizationSearchParams({
    organizationView: "position",
    organizationTeam: params.teamPath,
    organizationSeat: null,
    organizationPage: 1,
  });
}

async function deleteOrganizationSeatAndMember(params: {
  tenantId: string | null;
  actions: EnterpriseSurfaceProps["actions"];
  seatId: string;
  teamPath: string;
}) {
  if (!params.tenantId) {
    return;
  }
  const result = await params.actions.organization.onDeleteSeatAndMember?.(
    params.tenantId,
    params.seatId,
  );
  if (!result) {
    return;
  }
  organizationTreeFocus = { teamPath: params.teamPath };
  updateOrganizationSearchParams({
    organizationView: "position",
    organizationTeam: params.teamPath,
    organizationSeat: null,
    organizationPage: 1,
  });
}

async function runOrganizationBulkSeatDeletion(params: {
  rows: OrganizationPositionRow[];
  actions: EnterpriseSurfaceProps["actions"];
  tenantId: string | null;
}) {
  if (!params.tenantId) {
    return;
  }
  const partitioned = partitionOrganizationSeatDeletionSelection({
    rows: params.rows,
    selectedSeatIds: organizationActivationSelectedSeatIds,
  });
  if (partitioned.deletable.length === 0) {
    return;
  }
  const preview = partitioned.deletable
    .slice(0, 5)
    .map((row) => row.name)
    .join("、");
  const more = partitioned.deletable.length > 5 ? ` 等 ${partitioned.deletable.length} 个` : "";
  if (
    !shouldProceed(
      `确认删除 ${partitioned.deletable.length} 个岗位（${preview}${more}）？待激活邀请将一并撤回，此操作不可撤销。`,
    )
  ) {
    return;
  }
  const focusTeam = partitioned.deletable[0]?.teamLabel ?? "all";
  const succeeded: string[] = [];
  const failed: Array<{ seatId: string; name: string; error: string }> = [];
  for (const row of partitioned.deletable) {
    try {
      const result = await params.actions.organization.onDeleteSeat?.(params.tenantId, row.seatId);
      if (result == null) {
        failed.push({
          seatId: row.seatId,
          name: row.name,
          error: "删除失败",
        });
        continue;
      }
      succeeded.push(row.seatId);
    } catch (error) {
      failed.push({
        seatId: row.seatId,
        name: row.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  organizationBulkDeleteFeedback = formatOrganizationBulkSeatDeletionNotice({
    succeeded: succeeded.length,
    failed: failed.map((entry) => ({ name: entry.name, error: entry.error })),
  });
  if (failed.length > 0) {
    organizationActivationSelectedSeatIds = new Set(failed.map((entry) => entry.seatId));
  } else {
    organizationActivationSelectedSeatIds = new Set();
  }
  organizationTreeFocus = { teamPath: focusTeam };
  updateOrganizationSearchParams({
    organizationView: "position",
    organizationTeam: focusTeam,
    organizationSeat: null,
    organizationPage: 1,
  });
  requestEnterpriseAppRerender();
}

function renderOrganizationBulkSelectionBar(params: {
  selectedCount: number;
  deletableCount: number;
  activationEmailCount: number;
  seatsNeedingEmailCount: number;
  showActivationActions: boolean;
  feedback?: string | null;
  onSendActivation?: () => void;
  onDeleteVacant: () => void;
  onClear: () => void;
}) {
  if (params.selectedCount <= 0 && !params.feedback) {
    return nothing;
  }
  return html`
    <div
      class="enterprise-org-bulk-bar"
      data-organization-bulk-bar
      data-organization-bulk-activation
      role="region"
      aria-label="岗位批量操作"
    >
      <div>
        ${
          params.selectedCount > 0
            ? html`
                <div class="enterprise-org-bulk-bar__meta">已选 ${params.selectedCount} 个岗位</div>
              `
            : nothing
        }
        ${
          params.deletableCount > 0 && params.deletableCount < params.selectedCount
            ? html`
                <div class="enterprise-org-bulk-bar__hint">
                  其中 ${params.deletableCount} 个可删除（空岗壳或未注册待激活岗）
                </div>
              `
            : nothing
        }
        ${
          params.feedback
            ? html`
                <div class="enterprise-org-bulk-bar__hint" data-organization-bulk-delete-feedback>
                  ${params.feedback}
                </div>
              `
            : nothing
        }
      </div>
      <div class="enterprise-org-bulk-bar__actions">
        ${
          params.selectedCount > 0 && params.showActivationActions
            ? html`
                <button
                  class="btn btn--primary"
                  type="button"
                  ?disabled=${
                    params.activationEmailCount === 0 && params.seatsNeedingEmailCount === 0
                  }
                  @click=${() => params.onSendActivation?.()}
                >
                  发送激活邮件
                  ${params.activationEmailCount ? `（${params.activationEmailCount}）` : nothing}
                </button>
                ${
                  params.seatsNeedingEmailCount
                    ? html`
                        <span class="enterprise-org-ws__hint">无邮箱将打开档案补全</span>
                      `
                    : nothing
                }
              `
            : nothing
        }
        ${
          params.selectedCount > 0
            ? html`
                <button
                  class="btn btn--danger"
                  type="button"
                  data-organization-bulk-delete
                  ?disabled=${params.deletableCount === 0}
                  title=${
                    params.deletableCount === 0
                      ? "所选岗位均不可删除（需为空岗壳或未注册待激活岗；在岗/待确认/交接中不可删）"
                      : `删除 ${params.deletableCount} 个岗位（空岗壳或未注册待激活岗）`
                  }
                  @click=${params.onDeleteVacant}
                >
                  删除所选岗位 ${params.deletableCount ? `（${params.deletableCount}）` : nothing}
                </button>
              `
            : nothing
        }
        <button class="btn" type="button" @click=${params.onClear}>
          ${params.selectedCount > 0 ? "清除选择" : "关闭"}
        </button>
      </div>
    </div>
  `;
}

async function moveOrganizationDepartmentToParent(params: {
  tenantId: string | null;
  actions: EnterpriseSurfaceProps["actions"];
  path: string;
  parentPath: string;
}) {
  if (!params.tenantId || params.path === params.parentPath) {
    return;
  }
  if (params.parentPath && params.path.startsWith(`${params.parentPath}/`)) {
    return;
  }
  const result = await params.actions.organization.onMutateOrganizationDepartment?.(
    params.tenantId,
    {
      action: "move",
      path: params.path,
      parentPath: params.parentPath || null,
    },
  );
  const nextPath = result && typeof result.fullPath === "string" ? result.fullPath : params.path;
  organizationTreeFocus = { teamPath: nextPath };
  updateOrganizationSearchParams({
    organizationTeam: nextPath,
    organizationSeat: null,
    organizationPage: 1,
  });
}

async function mergeOrganizationDepartmentToTarget(params: {
  tenantId: string | null;
  actions: EnterpriseSurfaceProps["actions"];
  sourcePath: string;
  targetPath: string;
}) {
  if (!params.tenantId || !params.sourcePath.trim() || !params.targetPath.trim()) {
    return;
  }
  const result = await params.actions.organization.onMutateOrganizationDepartment?.(
    params.tenantId,
    {
      action: "merge",
      path: params.sourcePath,
      targetPath: params.targetPath,
    },
  );
  if (!result) {
    return;
  }
  organizationTreeFocus = { teamPath: params.targetPath };
  updateOrganizationSearchParams({
    organizationTeam: params.targetPath,
    organizationSeat: null,
    organizationPage: 1,
  });
}

async function reorderOrganizationChildren(params: {
  tenantId: string | null;
  actions: EnterpriseSurfaceProps["actions"];
  parentPath: string;
  orderedKeys: string[];
}) {
  if (!params.tenantId || params.orderedKeys.length === 0) {
    return;
  }
  const result = await params.actions.organization.onMutateOrganizationDepartment?.(
    params.tenantId,
    {
      action: "reorder-children",
      parentPath: params.parentPath,
      orderedKeys: params.orderedKeys,
    },
  );
  if (result) {
    requestEnterpriseAppRerender();
    return;
  }
  requestEnterpriseAppRerender();
}

function handoverOpenActionLabel(status: string): string {
  switch (status) {
    case "draft":
      return "指定继任者";
    case "asset_review":
      return "继续审查";
    case "pending_approval":
      return "进入审批";
    case "frozen":
      return "发送确认";
    case "rebound":
    case "completed":
      return "查看结果";
    default:
      return "查看交接";
  }
}

function handoverOpenActionIcon(status: string): IconName {
  switch (status) {
    case "draft":
      return "user";
    case "asset_review":
      return "clipboardCheck";
    case "pending_approval":
      return "shieldCheck";
    case "frozen":
      return "checkCircle";
    case "rebound":
    case "completed":
      return "eye";
    default:
      return "fileText";
  }
}

function buildOrganizationEmployeeInviteHref(
  basePath: string,
  code: string,
  params?: { email?: string; name?: string },
) {
  const homePath = pathForTab("me", basePath);
  // Employee entry is www public home — never biz/admin (or gw workbench).
  const origin =
    typeof window !== "undefined" && isOpenBotProductionHost(window.location.host)
      ? "https://www.openbot.love"
      : typeof window !== "undefined"
        ? window.location.origin
        : "https://www.openbot.love";
  const url = new URL(homePath, origin);
  url.searchParams.set("authMode", "employee-register");
  const email = params?.email?.trim();
  if (email) {
    url.searchParams.set("email", email);
  }
  const name = params?.name?.trim();
  if (name && (!email || name.toLowerCase() !== email.toLowerCase())) {
    url.searchParams.set("name", name);
  }
  url.searchParams.set("code", code);
  url.hash = "auth";
  // Absolute URL on production hosts; relative fallback elsewhere.
  if (typeof window !== "undefined" && isOpenBotProductionHost(window.location.host)) {
    return url.toString();
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

type XlsxZipFile = {
  async(type: "string"): Promise<string>;
};

type XlsxZipArchive = {
  file(path: string): XlsxZipFile | null;
};

async function readOrganizationImportTable(file: File): Promise<string[][]> {
  const fileName = file.name.toLowerCase();
  if (fileName.endsWith(".csv") || file.type.includes("csv")) {
    return parseOrganizationCsvTable(await file.text());
  }
  if (fileName.endsWith(".xlsx")) {
    return parseOrganizationXlsxTable(file);
  }
  throw new Error("暂只支持 .xlsx 和 .csv 组织名录。");
}

function mapOrganizationImportRows(table: string[][]): PlatformEmployeeProvisionInput[] {
  const preview = buildOrganizationImportPreview(table);
  if (preview.errorCount > 0) {
    const samples = preview.rows
      .filter((row) => row.status === "error")
      .slice(0, 4)
      .map((row) => `第 ${row.rowNumber} 行：${row.errorMessage}`);
    throw new Error(samples.join("；"));
  }
  return organizationImportPreviewToSubmitRows(preview);
}

async function refreshOrganizationImportPreview(modal: HTMLElement, file: File | null) {
  const mount = modal.querySelector<HTMLElement>("[data-import-preview-root]");
  if (!mount) {
    return;
  }
  if (!file) {
    organizationImportPreviewCache = null;
    organizationImportPreviewTab = "tree";
    clearOrganizationImportPreviewMount(mount);
    return;
  }
  try {
    const preview = buildOrganizationImportPreview(await readOrganizationImportTable(file));
    organizationImportPreviewCache = preview;
    organizationImportPreviewTab = preview.errorCount > 0 ? "errors" : "tree";
    mountOrganizationImportPreviewPanel(mount, preview, organizationImportPreviewTab, (tab) => {
      organizationImportPreviewTab = tab;
    });
  } catch (error) {
    organizationImportPreviewCache = null;
    clearOrganizationImportPreviewMount(mount);
    showOrganizationImportError(error);
  }
}

function parseOrganizationCsvTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    const next = text[index + 1] ?? "";
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell.trim());
      if (row.some((entry) => entry.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  if (row.some((entry) => entry.length > 0)) {
    rows.push(row);
  }
  return rows;
}

function parseXmlDocument(xml: string, label: string): Document {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error(`${label} 解析失败。`);
  }
  return document;
}

function xmlTextContent(element: Element, tagName: string) {
  const target = element.getElementsByTagName(tagName)[0];
  return target?.textContent ?? "";
}

function readXlsxSharedStrings(document: Document): string[] {
  return Array.from(document.getElementsByTagName("si")).map((item) =>
    Array.from(item.getElementsByTagName("t"))
      .map((node) => node.textContent ?? "")
      .join(""),
  );
}

function resolveXlsxSheetPath(workbook: Document, relationships: Document): string {
  const firstSheet = workbook.getElementsByTagName("sheet")[0];
  const relationshipId = firstSheet?.getAttribute("r:id") ?? firstSheet?.getAttribute("id");
  const relationship = relationshipId
    ? Array.from(relationships.getElementsByTagName("Relationship")).find(
        (entry) => entry.getAttribute("Id") === relationshipId,
      )
    : null;
  const target = relationship?.getAttribute("Target") ?? "worksheets/sheet1.xml";
  const normalized = target.replace(/^\/+/, "").replace(/^\.\//, "");
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized}`;
}

function xlsxColumnIndex(cellRef: string) {
  const letters = cellRef.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "";
  if (!letters) {
    return -1;
  }
  return Array.from(letters).reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function readXlsxCell(cell: Element, sharedStrings: string[]) {
  const type = cell.getAttribute("t");
  if (type === "inlineStr") {
    return Array.from(cell.getElementsByTagName("t"))
      .map((node) => node.textContent ?? "")
      .join("")
      .trim();
  }
  const value = xmlTextContent(cell, "v").trim();
  if (type === "s") {
    const sharedIndex = Number.parseInt(value, 10);
    return Number.isFinite(sharedIndex) ? (sharedStrings[sharedIndex] ?? "") : "";
  }
  if (type === "b") {
    return value === "1" ? "TRUE" : "FALSE";
  }
  return value;
}

async function parseOrganizationXlsxTable(file: File): Promise<string[][]> {
  const zip = (await JSZip.loadAsync(await file.arrayBuffer())) as XlsxZipArchive;
  const workbookFile = zip.file("xl/workbook.xml");
  const relationshipFile = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbookFile || !relationshipFile) {
    throw new Error("Excel 文件缺少工作簿信息，请确认上传的是 .xlsx 文件。");
  }
  const workbook = parseXmlDocument(await workbookFile.async("string"), "工作簿");
  const relationships = parseXmlDocument(await relationshipFile.async("string"), "工作表关系");
  const sharedStringsFile = zip.file("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsFile
    ? readXlsxSharedStrings(parseXmlDocument(await sharedStringsFile.async("string"), "共享字符串"))
    : [];
  const sheetPath = resolveXlsxSheetPath(workbook, relationships);
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) {
    throw new Error("Excel 文件缺少第一个工作表。");
  }
  const sheet = parseXmlDocument(await sheetFile.async("string"), "工作表");
  return Array.from(sheet.getElementsByTagName("row")).map((rowElement) => {
    const row: string[] = [];
    Array.from(rowElement.getElementsByTagName("c")).forEach((cell) => {
      const columnIndex = xlsxColumnIndex(cell.getAttribute("r") ?? "");
      row[columnIndex >= 0 ? columnIndex : row.length] = readXlsxCell(cell, sharedStrings);
    });
    return row.map((entry) => entry ?? "");
  });
}

async function parseOrganizationImportFile(
  file: File | null,
): Promise<PlatformEmployeeProvisionInput[]> {
  if (!file) {
    throw new Error("请选择组织名录文件。");
  }
  return mapOrganizationImportRows(await readOrganizationImportTable(file));
}

function showOrganizationImportError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (typeof window !== "undefined" && typeof window.alert === "function") {
    window.alert(message);
  }
}

async function submitOrganizationImportFile(
  event: Event,
  actions: EnterpriseSurfaceProps["actions"],
) {
  const button = event.currentTarget as HTMLButtonElement;
  const root = button.closest("[data-org-builder-root]");
  const input = root?.querySelector<HTMLInputElement>('input[type="file"]') ?? null;
  button.disabled = true;
  try {
    const rows = organizationImportPreviewCache
      ? organizationImportPreviewToSubmitRows(organizationImportPreviewCache)
      : await parseOrganizationImportFile(input?.files?.[0] ?? null);
    if (!shouldProceed(`确认导入 ${rows.length} 条组织身份吗？导入不会发送激活邮件。`)) {
      return;
    }
    await actions.organization.onImportOrganizationRows(rows);
    organizationImportPreviewCache = null;
    // 导入成功后收起导入面板，落地邀请激活工作区并给出明确的成功文案。
    organizationStructureImportOpen = false;
    organizationImportSuccessNotice = `已导入 ${rows.length} 条组织身份，岗位数字人已生成，成员仍待邀请激活。`;
    updateOrganizationSearchParams({ organizationInvite: true });
  } catch (error) {
    showOrganizationImportError(error);
  } finally {
    button.disabled = false;
  }
}

function renderOrganizationBuilderImportPanel() {
  if (organizationImportPreviewCache) {
    queueMicrotask(() => {
      const mount = document.querySelector<HTMLElement>(
        "[data-org-builder-root] [data-import-preview-root]",
      );
      if (mount && organizationImportPreviewCache) {
        mountOrganizationImportPreviewPanel(
          mount,
          organizationImportPreviewCache,
          organizationImportPreviewTab,
          (tab) => {
            organizationImportPreviewTab = tab;
          },
        );
      }
    });
  }
  return html`
    <div class="enterprise-org-import">
      <div class="enterprise-org-import-cards">
        <article class="enterprise-org-import-card">
          <div class="enterprise-org-import-card__head">
            <span class="enterprise-org-import-card__icon" aria-hidden="true"
              >${renderIcon("download")}</span
            >
            <h3 class="enterprise-org-import-card__title">下载模版</h3>
          </div>
          <p class="enterprise-org-import-card__desc">
            下载标准 Excel 模版，按列填写部门路径、岗位名称与职责说明。
          </p>
          <ul class="enterprise-org-import-card__hints">
            <li>支持多级部门路径（如「销售部/华东区」）</li>
            <li>模版内含字段说明与示例行</li>
          </ul>
          <div class="enterprise-org-import-card__action">
            <button
              class="btn btn--sm"
              type="button"
              @click=${() => downloadOrganizationImportTemplate()}
            >
              ${renderIcon("download")}下载 Excel 模版
            </button>
          </div>
        </article>
        <article class="enterprise-org-import-card">
          <div class="enterprise-org-import-card__head">
            <span class="enterprise-org-import-card__icon" aria-hidden="true"
              >${renderIcon("fileText")}</span
            >
            <h3 class="enterprise-org-import-card__title">上传模版</h3>
          </div>
          <p class="enterprise-org-import-card__desc">
            选择已填写的组织名录文件，系统会先预览并校验，确认无误后再导入。
          </p>
          <label class="enterprise-org-import-card__upload">
            <input
              type="file"
              accept=".xlsx,.csv"
              @change=${(event: Event) => {
                const input = event.currentTarget as HTMLInputElement;
                const root = input.closest<HTMLElement>("[data-org-builder-root]");
                const label = input
                  .closest(".enterprise-org-import-card__upload")
                  ?.querySelector<HTMLElement>("[data-import-file-name]");
                if (label) {
                  label.textContent = input.files?.[0]?.name ?? "点击选择或拖拽文件到此处";
                }
                if (root) {
                  void refreshOrganizationImportPreview(root, input.files?.[0] ?? null);
                }
              }}
            />
            <span class="enterprise-org-import-card__upload-label">选择文件</span>
            <strong class="enterprise-org-import-card__upload-name" data-import-file-name>
              点击选择或拖拽文件到此处
            </strong>
            <small class="enterprise-org-import-card__upload-meta">支持 .xlsx、.csv</small>
          </label>
        </article>
      </div>
      <div data-import-preview-root class="enterprise-org-import-preview-mount"></div>
    </div>
  `;
}

function organizationIsEmpty(readModel: EnterprisePortReadModel): boolean {
  return readModel.seatCount === 0 && (readModel.organizationDepartmentPaths?.length ?? 0) === 0;
}

function renderOrganizationEmptyState(params: {
  busy: boolean;
  editors?: OrganizationNavEditors;
  /** structure 工作区内复用时：已在结构页，手工搭建改为直接打开新建部门编辑器。 */
  onManualBuild?: () => void;
}) {
  return html`
    <section class="enterprise-org-empty-state card">
      <div class="enterprise-org-empty-state__icon" aria-hidden="true">
        ${renderIcon("building", "enterprise-org-empty-state__icon-svg")}
      </div>
      <div class="enterprise-org-empty-state__body">
        <strong>还没有组织名录</strong>
        <p>搭建部门与岗位后，再邀请成员激活。</p>
      </div>
      <div class="enterprise-org-empty-state__actions">
        <button
          class="btn btn--primary"
          type="button"
          ?disabled=${params.busy}
          @click=${() =>
            params.onManualBuild
              ? params.onManualBuild()
              : goOrganizationStructureCatalog(params.editors)}
        >
          ${renderIcon("penLine")}手工搭建
        </button>
        <button
          class="btn"
          type="button"
          ?disabled=${params.busy}
          @click=${() => {
            openOrganizationStructureImport(params.editors?.seatOfferEditor);
            params.editors?.createPositionEditor?.onClose?.();
            updateOrganizationSearchParams({ organizationSurface: "structure" });
          }}
        >
          ${renderIcon("download")}从 Excel 导入
        </button>
      </div>
    </section>
  `;
}

function renderOrganizationSurfaceBar(params: {
  surface: OrganizationSurfaceMode;
  query: string;
  createPositionEditor: NonNullable<EnterpriseSurfaceProps["createPositionEditor"]>;
  seatOfferEditor?: NonNullable<EnterpriseSurfaceProps["seatOfferEditor"]>;
}) {
  return html`
    <div class="enterprise-org-surface-bar">${renderOrganizationWorkforceToolbar(params)}</div>
  `;
}

function renderOrganizationWorkforceToolbar(params: {
  query: string;
  surface: OrganizationSurfaceMode;
  createPositionEditor: NonNullable<EnterpriseSurfaceProps["createPositionEditor"]>;
  seatOfferEditor?: NonNullable<EnterpriseSurfaceProps["seatOfferEditor"]>;
}) {
  const isStructure = params.surface === "structure";
  return html`
    <div class="enterprise-org-workforce-header__toolbar">
      <input
        class="input enterprise-org-workforce-header__search"
        type="search"
        .value=${params.query}
        placeholder=${isStructure ? "搜索部门 / 岗位 / 成员" : "搜索岗位 / 数字人 / 成员 / 团队"}
        @input=${(event: Event) =>
          updateOrganizationSearchParams({
            organizationSearch: (event.currentTarget as HTMLInputElement).value.trim(),
            organizationSeat: null,
            organizationPage: 1,
          })}
      />
      ${
        isStructure
          ? nothing
          : html`
              <button
                class="btn btn--primary"
                type="button"
                @click=${() => openOrganizationBuilder()}
              >
                ${renderIcon("building")}搭建组织
              </button>
            `
      }
      <button
        class="btn"
        type="button"
        @click=${() => {
          if (isStructure) {
            organizationStructureImportOpen = false;
            params.seatOfferEditor?.onClose?.();
            updateOrganizationSearchParams({ organizationInvite: null });
            openOrganizationStructureCreatePosition(
              params.createPositionEditor,
              "",
              params.seatOfferEditor,
            );
            return;
          }
          params.createPositionEditor.onOpen();
        }}
      >
        ${renderIcon("folder")}添加岗位
      </button>
      <button
        class="btn"
        type="button"
        @click=${() => {
          if (isStructure) {
            organizationStructureImportOpen = false;
            params.seatOfferEditor?.onClose?.();
            params.createPositionEditor.onClose();
          }
          updateOrganizationSearchParams({ organizationInvite: true });
        }}
      >
        ${renderIcon("user")}邀请激活
      </button>
    </div>
  `;
}

function bindOrganizationSeatMember(params: {
  seatId: string;
  teamPath: string;
  readModel: EnterprisePortReadModel;
  seatOfferEditor: NonNullable<EnterpriseSurfaceProps["seatOfferEditor"]>;
  createPositionEditor?: NonNullable<EnterpriseSurfaceProps["createPositionEditor"]>;
  /** activation=邀请新人注册自动绑定；offer=分配给已激活成员待确认。默认 activation。 */
  mode?: "offer" | "activation";
}) {
  const seat = params.readModel.seatSummaries.find((entry) => entry.seatId === params.seatId);
  organizationTreeFocus = { teamPath: params.teamPath, seatId: params.seatId };
  updateOrganizationSearchParams({
    organizationTeam: params.teamPath,
    organizationSeat: params.seatId,
    organizationInvite: null,
  });
  organizationStructureImportOpen = false;
  params.createPositionEditor?.onClose?.();
  params.seatOfferEditor.onOpen({
    mode: params.mode ?? "activation",
    seatId: params.seatId,
    seatTitle: seat?.title ?? "",
    seatStatus: seat?.status ?? "vacant",
    defaultAgentId: seat?.defaultAgentId ?? null,
    availableAgentIds: seat?.agentIds ?? [],
    defaultSpaceIds: seat?.defaultSpaceIds ?? [],
    memoryScopeAvailable: (seat?.memoryScopeIds?.length ?? 0) > 0,
    employeeEmail: seat?.pendingEmployeeUser ?? null,
  });
  queueMicrotask(() =>
    scrollEnterpriseOrgTreeToFocus({ teamLabel: params.teamPath, seatId: params.seatId }),
  );
}

function renderOrganizationImportWorkspace(params: {
  actions: EnterpriseSurfaceProps["actions"];
  busy: boolean;
}) {
  return html`
    <section
      class="enterprise-org-workspace enterprise-org-ws enterprise-org-ws--flat"
      data-org-builder-root
    >
      ${orgWsHeader({
        title: "从 Excel 导入",
        subtitle: ORG_WS_WORKSPACE_SUB,
        onClose: closeOrganizationStructureImport,
      })}
      ${orgWsBody(renderOrganizationBuilderImportPanel())}
      ${orgWsFooter({
        primaryLabel: "导入组织名录",
        onPrimary: (event) =>
          void submitOrganizationImportFile(event ?? new Event("click"), params.actions),
        primaryDisabled:
          !organizationImportPreviewCache || organizationImportPreviewCache.errorCount > 0,
        busy: params.busy,
      })}
    </section>
  `;
}

function renderOrganizationStructureWorkspace(props: {
  readModel: EnterprisePortReadModel;
  actions: EnterpriseSurfaceProps["actions"];
  basePath: string;
  positionRows: OrganizationPositionRow[];
  team: string;
  selectedSeatId: string | null;
  inviteOpen: boolean;
  activationBusy: boolean;
  activationError: string | null;
  activationNotice: string | null;
  busy: boolean;
  createPositionEditor: NonNullable<EnterpriseSurfaceProps["createPositionEditor"]>;
  seatOfferEditor: NonNullable<EnterpriseSurfaceProps["seatOfferEditor"]>;
  handoverEditor: EnterpriseSurfaceProps["handoverEditor"];
  ownershipTransferEditor: EnterpriseSurfaceProps["ownershipTransferEditor"];
  openedFromGovernance?: boolean;
  onBindMember: (seatId: string, teamPath: string, mode?: "offer" | "activation") => void;
  onCreateChildDepartment: (parentPath: string) => void;
  onCreatePosition: (teamPath: string) => void;
  onRenameDepartment: (path: string) => void;
  onMoveDepartment: (path: string) => void;
  onMergeDepartment: (path: string) => void;
  onDeleteDepartment: (path: string) => void;
  onSelectPosition: (seatId: string, teamLabel: string) => void;
  onSelectDepartment: (teamLabel: string) => void;
}) {
  const workspacePresentation: OrganizationEditorPresentation = "workspace";
  // The workspace props are a structural subset of EnterpriseSurfaceProps; the
  // editor renderers only read the shared fields (readModel/actions/editors/client),
  // so bridge to the full surface prop type once here.
  const surfaceProps = props as unknown as EnterpriseSurfaceProps;

  if (props.seatOfferEditor?.seatId) {
    return renderSeatOfferEditor(surfaceProps);
  }
  if (props.handoverEditor?.caseId) {
    return renderHandoverEditor(surfaceProps, {
      presentation: workspacePresentation,
    });
  }
  if (props.ownershipTransferEditor?.open) {
    return renderOwnershipTransferEditor(surfaceProps, {
      presentation: workspacePresentation,
    });
  }
  if (props.createPositionEditor?.open) {
    return renderCreatePositionEditor(surfaceProps);
  }
  if (organizationDepartmentEditor.open && organizationDepartmentEditor.mode) {
    return renderOrganizationDepartmentEditor({
      editor: organizationDepartmentEditor,
      parentOptions: listOrganizationDepartmentParentOptions(props.readModel),
      targetOptions: listOrganizationDepartmentParentOptions(props.readModel),
      onClose: closeOrganizationDepartmentEditor,
      onLabelChange: (value) => {
        organizationDepartmentEditor = { ...organizationDepartmentEditor, label: value };
        requestEnterpriseAppRerender();
      },
      onParentPathChange: (value) => {
        organizationDepartmentEditor = { ...organizationDepartmentEditor, parentPath: value };
        requestEnterpriseAppRerender();
      },
      onTargetPathChange: (value) => {
        organizationDepartmentEditor = { ...organizationDepartmentEditor, targetPath: value };
        requestEnterpriseAppRerender();
      },
      onSubmit: () => {
        void submitOrganizationDepartmentEditor({
          tenantId: props.readModel.currentTenantId,
          actions: props.actions,
          readModel: props.readModel,
        });
      },
    });
  }
  if (props.inviteOpen) {
    return renderOrganizationActivationWorkspace({
      readModel: props.readModel,
      basePath: props.basePath,
      actions: props.actions,
      positionRows: props.positionRows,
      seatOfferEditor: props.seatOfferEditor,
      activationBusy: props.activationBusy,
      activationError: props.activationError,
      activationNotice: props.activationNotice,
    });
  }
  if (organizationStructureImportOpen) {
    return renderOrganizationImportWorkspace({
      actions: props.actions,
      busy: props.busy,
    });
  }
  const selectedPositionRow = props.selectedSeatId
    ? (props.positionRows.find((row) => row.seatId === props.selectedSeatId) ?? null)
    : null;
  if (selectedPositionRow) {
    return renderOrganizationPositionDetail({
      row: selectedPositionRow,
      readModel: props.readModel,
      client: surfaceProps.client,
      actions: props.actions,
      seatOfferEditor: props.seatOfferEditor,
      createPositionEditor: props.createPositionEditor,
      handoverEditor: props.handoverEditor,
      ownershipTransferEditor: props.ownershipTransferEditor,
      onBindMember: props.onBindMember,
      activationBusy: props.activationBusy || isOrganizationActivationAnyBusy(),
      activationError: props.activationError,
      activationNotice: props.activationNotice,
      onSendActivationEmails: (emails) =>
        runOrganizationActivationEmailSend(
          props.actions.organization.onSendActivationEmails,
          emails,
        ),
      onDeleteSeat: (seatId, seatTitle, teamPath) => {
        void deleteOrganizationSeat({
          tenantId: props.readModel.currentTenantId,
          actions: props.actions,
          seatId,
          seatTitle,
          teamPath,
        });
      },
      onDeleteSeatAndMember: (seatId, _seatTitle, teamPath) => {
        void deleteOrganizationSeatAndMember({
          tenantId: props.readModel.currentTenantId,
          actions: props.actions,
          seatId,
          teamPath,
        });
      },
      onClose: () => {
        updateOrganizationSearchParams({ organizationSeat: null, organizationFrom: null });
      },
      onBackToGovernance: props.openedFromGovernance
        ? () =>
            goOrganizationModuleHome({
              seatOfferEditor: props.seatOfferEditor,
              createPositionEditor: props.createPositionEditor,
              handoverEditor: props.handoverEditor,
            })
        : undefined,
    });
  }
  if (props.team.trim() !== "" && props.team !== "all") {
    return renderOrganizationStructureDepartmentInspector({
      departmentPath: props.team,
      readModel: props.readModel,
      busy: props.busy,
      onSelectPosition: props.onSelectPosition,
      onSelectDepartment: props.onSelectDepartment,
      onCreateChildDepartment: props.onCreateChildDepartment,
      onCreatePosition: props.onCreatePosition,
      onRenameDepartment: props.onRenameDepartment,
      onMoveDepartment: props.onMoveDepartment,
      onMergeDepartment: props.onMergeDepartment,
      onDeleteDepartment: props.onDeleteDepartment,
      onClose: () =>
        updateOrganizationSearchParams({
          organizationTeam: "all",
          organizationSeat: null,
          organizationPage: 1,
        }),
    });
  }
  // 空租户直接打开 ?organizationSurface=structure 时保留首跑入口：
  // 手工搭建（就地新建部门）与从 Excel 导入仍然可用，而不是只剩闲置文案。
  if (
    organizationIsEmpty(props.readModel) &&
    !organizationScopeBlocksDepartmentManagement(
      resolveOrganizationDepartmentScope(props.readModel),
    )
  ) {
    return renderOrganizationEmptyState({
      busy: props.busy,
      editors: {
        seatOfferEditor: props.seatOfferEditor,
        createPositionEditor: props.createPositionEditor,
        handoverEditor: props.handoverEditor,
      },
      onManualBuild: () => openOrganizationDepartmentEditor({ mode: "create" }),
    });
  }
  return renderOrganizationWorkspaceIdle();
}

function renderOrganizationStructurePage(params: {
  readModel: EnterprisePortReadModel;
  actions: EnterpriseSurfaceProps["actions"];
  basePath: string;
  positionRows: OrganizationPositionRow[];
  inviteOpen: boolean;
  activationBusy: boolean;
  activationError: string | null;
  activationNotice: string | null;
  team: string;
  query: string;
  selectedSeatId: string | null;
  busy: boolean;
  createPositionEditor: NonNullable<EnterpriseSurfaceProps["createPositionEditor"]>;
  seatOfferEditor: NonNullable<EnterpriseSurfaceProps["seatOfferEditor"]>;
  handoverEditor: EnterpriseSurfaceProps["handoverEditor"];
  ownershipTransferEditor: EnterpriseSurfaceProps["ownershipTransferEditor"];
  openedFromGovernance?: boolean;
}) {
  const { readModel, actions, busy } = params;
  const departmentScope = resolveOrganizationDepartmentScope(readModel);
  const structureEditable = !organizationScopeBlocksDepartmentManagement(departmentScope) && !busy;
  const workspaceContext = {
    seatOfferEditor: params.seatOfferEditor,
    handoverEditor: params.handoverEditor,
    createPositionEditor: params.createPositionEditor,
    ownershipTransferEditor: params.ownershipTransferEditor,
    inviteOpen: params.inviteOpen,
    departmentEditorOpen:
      organizationDepartmentEditor.open && Boolean(organizationDepartmentEditor.mode),
    importOpen: organizationStructureImportOpen,
    positionDetailOpen: Boolean(params.selectedSeatId),
  };
  const workspaceActive = isOrganizationStructureWorkspaceActive(workspaceContext);
  const railCollapsed = resolveOrganizationStructureRailCollapsed(workspaceActive);
  return html`
    <section
      class="enterprise-org-layout enterprise-org-layout--structure ${
        railCollapsed ? "is-rail-collapsed" : ""
      } ${workspaceActive ? "is-workspace-active" : ""}"
    >
      <aside class="enterprise-org-layout__rail card ${railCollapsed ? "is-collapsed" : ""}">
        <div class="enterprise-org-layout__rail-head">
          ${
            railCollapsed
              ? nothing
              : html`
                  <span class="enterprise-org-layout__rail-title">组织目录</span>
                `
          }
          <button
            class="btn btn--sm btn--ghost enterprise-org-layout__rail-toggle"
            type="button"
            title=${railCollapsed ? "展开组织目录" : "收起组织目录"}
            aria-label=${railCollapsed ? "展开组织目录" : "收起组织目录"}
            aria-expanded=${String(!railCollapsed)}
            @click=${() => {
              toggleOrganizationStructureRailCollapsed(workspaceActive);
              requestEnterpriseAppRerender();
            }}
          >
            ${renderIcon(railCollapsed ? "chevronRight" : "chevronLeft")}
          </button>
        </div>
        ${
          railCollapsed
            ? html`
                <button
                  class="enterprise-org-layout__rail-reopen"
                  type="button"
                  title="展开组织目录"
                  @click=${() => {
                    expandOrganizationStructureRail();
                    requestEnterpriseAppRerender();
                  }}
                >
                  ${renderIcon("building", "enterprise-org-layout__rail-reopen-icon")}
                  <span>组织目录</span>
                </button>
              `
            : html`
                ${
                  structureEditable
                    ? html`
                        <div class="enterprise-org-layout__rail-actions">
                          <button
                            class="btn btn--sm"
                            type="button"
                            ?disabled=${busy}
                            @click=${() => openOrganizationStructureImport(params.seatOfferEditor)}
                          >
                            ${renderIcon("download")} 从 Excel 导入
                          </button>
                        </div>
                      `
                    : nothing
                }
                ${renderOrganizationBulkSelectionBar({
                  selectedCount: organizationActivationSelectedSeatIds.size,
                  deletableCount: partitionOrganizationSeatDeletionSelection({
                    rows: params.positionRows,
                    selectedSeatIds: organizationActivationSelectedSeatIds,
                  }).deletable.length,
                  activationEmailCount: 0,
                  seatsNeedingEmailCount: 0,
                  showActivationActions: false,
                  feedback: organizationBulkDeleteFeedback,
                  onDeleteVacant: () => {
                    void runOrganizationBulkSeatDeletion({
                      rows: params.positionRows,
                      actions,
                      tenantId: readModel.currentTenantId,
                    });
                  },
                  onClear: () => clearOrganizationActivationSeatSelection(),
                })}
                ${renderOrganizationDirectoryTree({
                  readModel,
                  team: params.team,
                  selectedSeatId: params.selectedSeatId,
                  query: params.query,
                  positionRows: params.positionRows,
                  actions,
                  busy,
                  createPositionEditor: params.createPositionEditor,
                  seatOfferEditor: params.seatOfferEditor,
                  onBindMember: (seatId, teamPath, mode) =>
                    bindOrganizationSeatMember({
                      seatId,
                      teamPath,
                      readModel,
                      seatOfferEditor: params.seatOfferEditor,
                      createPositionEditor: params.createPositionEditor,
                      mode,
                    }),
                })}
              `
        }
      </aside>
      <div class="enterprise-org-layout__workspace">
        ${renderOrganizationStructureTrail({
          inviteOpen: params.inviteOpen,
          selectedSeatId: params.selectedSeatId,
          positionRows: params.positionRows,
          team: params.team,
          createPositionEditor: params.createPositionEditor,
          seatOfferEditor: params.seatOfferEditor,
          handoverEditor: params.handoverEditor,
          ownershipTransferEditor: params.ownershipTransferEditor,
        })}
        ${renderOrganizationStructureWorkspace({
          readModel,
          actions,
          basePath: params.basePath,
          positionRows: params.positionRows,
          team: params.team,
          selectedSeatId: params.selectedSeatId,
          inviteOpen: params.inviteOpen,
          activationBusy: params.activationBusy,
          activationError: params.activationError,
          activationNotice: params.activationNotice,
          busy,
          createPositionEditor: params.createPositionEditor,
          seatOfferEditor: params.seatOfferEditor,
          handoverEditor: params.handoverEditor,
          ownershipTransferEditor: params.ownershipTransferEditor,
          openedFromGovernance: params.openedFromGovernance,
          onBindMember: (seatId, teamPath, mode) =>
            bindOrganizationSeatMember({
              seatId,
              teamPath,
              readModel,
              seatOfferEditor: params.seatOfferEditor,
              createPositionEditor: params.createPositionEditor,
              mode,
            }),
          onCreateChildDepartment: (parentPath) =>
            void createOrganizationDepartmentInline({
              tenantId: readModel.currentTenantId,
              actions,
              readModel,
              parentPath,
            }),
          onCreatePosition: (teamPath) =>
            openOrganizationStructureCreatePosition(
              params.createPositionEditor,
              teamPath,
              params.seatOfferEditor,
            ),
          onRenameDepartment: (path) => openOrganizationDepartmentEditor({ mode: "rename", path }),
          onMoveDepartment: (path) => openOrganizationDepartmentEditor({ mode: "move", path }),
          onMergeDepartment: (path) => openOrganizationDepartmentEditor({ mode: "merge", path }),
          onDeleteDepartment: (path) => openOrganizationDepartmentEditor({ mode: "delete", path }),
          onSelectPosition: (seatId, teamLabel) => {
            dismissOrganizationStructureTreeNavigation({
              seatOfferEditor: params.seatOfferEditor,
              createPositionEditor: params.createPositionEditor,
            });
            organizationTreeFocus = { teamPath: teamLabel, seatId };
            updateOrganizationSearchParams({
              organizationView: "position",
              organizationTeam: teamLabel,
              organizationSeat: seatId,
              organizationPage: 1,
              organizationFrom: null,
            });
            queueMicrotask(() => scrollEnterpriseOrgTreeToFocus({ teamLabel, seatId }));
          },
          onSelectDepartment: (teamLabel) => {
            dismissOrganizationStructureTreeNavigation({
              seatOfferEditor: params.seatOfferEditor,
              createPositionEditor: params.createPositionEditor,
            });
            organizationTreeFocus = { teamPath: teamLabel };
            updateOrganizationSearchParams({
              organizationTeam: teamLabel,
              organizationSeat: null,
              organizationPage: 1,
              organizationFrom: null,
            });
          },
        })}
      </div>
    </section>
  `;
}

function renderOrganizationStructureTrail(params: {
  inviteOpen: boolean;
  selectedSeatId: string | null;
  positionRows: OrganizationPositionRow[];
  team: string;
  createPositionEditor: NonNullable<EnterpriseSurfaceProps["createPositionEditor"]>;
  seatOfferEditor: NonNullable<EnterpriseSurfaceProps["seatOfferEditor"]>;
  handoverEditor: EnterpriseSurfaceProps["handoverEditor"];
  ownershipTransferEditor?: EnterpriseSurfaceProps["ownershipTransferEditor"];
}) {
  const editors: OrganizationNavEditors = {
    seatOfferEditor: params.seatOfferEditor,
    createPositionEditor: params.createPositionEditor,
    handoverEditor: params.handoverEditor,
  };
  const current = resolveOrganizationStructureTrailCurrent(params);
  const moduleTitle = t("tabs.enterpriseOrganization");
  return orgWsTrail([
    {
      label: moduleTitle,
      onClick: () => goOrganizationModuleHome(editors),
    },
    current
      ? {
          label: "组织目录",
          onClick: () => goOrganizationStructureCatalog(editors),
        }
      : { label: "组织目录" },
    ...(current ? [{ label: current }] : []),
  ]);
}

function renderOrganizationActivationTableRow(params: {
  position: string;
  email: string;
  team: string;
  status: string;
  actions: ReturnType<typeof html>;
}) {
  return html`
    <span
      class="enterprise-org-activation-table__cell enterprise-org-activation-table__cell--position"
      title=${params.position}
    >
      ${params.position}
    </span>
    <span
      class="enterprise-org-activation-table__cell enterprise-org-activation-table__cell--email"
      title=${params.email}
    >
      ${params.email}
    </span>
    <span
      class="enterprise-org-activation-table__cell enterprise-org-activation-table__cell--team"
      title=${params.team}
    >
      ${params.team}
    </span>
    <span class="enterprise-org-activation-table__cell">${params.status}</span>
    <span
      class="enterprise-org-activation-table__cell enterprise-org-activation-table__cell--actions"
    >
      ${params.actions}
    </span>
  `;
}

/** 邀请表岗位列：邮箱占位标题回退为「未命名岗位」，避免把邮箱当岗位名。 */
function resolveOrganizationActivationPositionLabel(row: OrganizationPositionRow): string {
  const title = row.name?.trim() || "";
  const email = (row.pendingEmployeeUser ?? "").trim().toLowerCase();
  const display = row.pendingEmployeeDisplayName?.trim() || "";
  const titleLooksLikeEmail = title.includes("@") && !title.includes(" ");
  if (titleLooksLikeEmail) {
    if (display && display.toLowerCase() !== email && !display.includes("@")) {
      return display;
    }
    return "未命名岗位";
  }
  return title || "未命名岗位";
}

/** 邀请激活工作区：仅工作区呈现（模态分支已随治理台收敛移除）。 */
function renderOrganizationActivationWorkspace(params: {
  readModel: EnterprisePortReadModel;
  basePath: string;
  actions: EnterpriseSurfaceProps["actions"];
  positionRows: OrganizationPositionRow[];
  seatOfferEditor: EnterpriseSurfaceProps["seatOfferEditor"];
  activationBusy: boolean;
  activationError: string | null;
  activationNotice: string | null;
}) {
  const code = params.readModel.latestInviteCode?.trim() ?? "";
  const inviteHref = code ? buildOrganizationEmployeeInviteHref(params.basePath, code) : null;
  const activationRows = params.positionRows.filter(
    (row) => row.pendingEmployeeUser || (!row.offer && row.status === "VACANT"),
  );
  const confirmationRows = params.positionRows.filter((row) => Boolean(row.offer));
  const pendingActivationEmails = [
    ...new Set(
      activationRows
        .map((row) => row.pendingEmployeeUser ?? null)
        .filter((email): email is string => Boolean(email?.trim())),
    ),
  ];
  const closeInvite = () => {
    organizationImportSuccessNotice = null;
    updateOrganizationSearchParams({ organizationInvite: null });
  };

  return wrapOrganizationEditorPresentation({
    presentation: "workspace",
    ariaLabel: "邀请激活",
    panelClass:
      "enterprise-org-workspace--panel enterprise-org-ws--flat enterprise-org-modal--activation",
    onClose: closeInvite,
    content: html`
      ${orgWsHeader({
        title: "邀请激活",
        subtitle: "批量查看待激活成员；单条操作会切换到右侧绑定表单。",
        onClose: closeInvite,
      })}
      ${orgWsBody(html`
        ${
          organizationImportSuccessNotice
            ? orgWsNotice({
                kind: "ok",
                content: html`<span data-organization-import-success
                  >${organizationImportSuccessNotice}</span
                >`,
              })
            : nothing
        }
        ${
          params.activationError
            ? orgWsNotice({ kind: "danger", content: params.activationError })
            : nothing
        }
        ${
          params.activationNotice
            ? orgWsNotice({ kind: "ok", content: params.activationNotice })
            : nothing
        }
        <div class="enterprise-org-ws__section-title">待激活成员</div>
        <div class="enterprise-org-activation-table" role="table" aria-label="待激活成员">
          <div role="row" class="enterprise-org-activation-table__head">
            <span>岗位</span>
            <span>成员邮箱</span>
            <span>团队</span>
            <span>状态</span>
            <span>操作</span>
          </div>
          ${
            activationRows.length
              ? activationRows.map(
                  (row) => html`
                    <div role="row" class="enterprise-org-activation-table__row">
                      ${renderOrganizationActivationTableRow({
                        position: resolveOrganizationActivationPositionLabel(row),
                        email: row.pendingEmployeeUser ?? row.memberLabel ?? "待补充邮箱",
                        team: row.teamLabel,
                        status: row.pendingEmployeeUser ? "未激活" : "待补充",
                        actions: row.pendingEmployeeUser
                          ? html`
                              <button
                                class="btn btn--sm"
                                type="button"
                                ?disabled=${isOrganizationActivationEmailBusy(
                                  row.pendingEmployeeUser,
                                )}
                                @click=${() =>
                                  void runOrganizationActivationEmailSend(
                                    params.actions.organization.onSendActivationEmails,
                                    [row.pendingEmployeeUser!],
                                  )}
                              >
                                ${
                                  isOrganizationActivationEmailBusy(row.pendingEmployeeUser)
                                    ? "处理中..."
                                    : "发送激活"
                                }
                              </button>
                            `
                          : html`
                              <button
                                class="btn btn--sm"
                                type="button"
                                @click=${() => {
                                  params.seatOfferEditor.onOpen({
                                    mode: "activation",
                                    seatId: row.seatId,
                                    seatTitle: row.name,
                                    seatStatus: row.seatStatus,
                                    defaultAgentId: row.defaultAgentId,
                                    availableAgentIds: row.agentIds,
                                    defaultSpaceIds: row.defaultSpaceIds,
                                    memoryScopeAvailable: row.memoryScopeIds.length > 0,
                                    employeeEmail: row.memberUserId ?? row.memberLabel,
                                  });
                                  updateOrganizationSearchParams({ organizationInvite: null });
                                }}
                              >
                                补邮箱并发送
                              </button>
                            `,
                      })}
                    </div>
                  `,
                )
              : html`
                  <div class="enterprise-empty enterprise-empty--compact">当前没有待激活成员。</div>
                `
          }
        </div>
        <div class="enterprise-org-ws__section-title">待确认成员</div>
        <div class="enterprise-org-activation-table" role="table" aria-label="待确认成员">
          <div role="row" class="enterprise-org-activation-table__head">
            <span>岗位</span>
            <span>成员邮箱</span>
            <span>团队</span>
            <span>状态</span>
            <span>操作</span>
          </div>
          ${
            confirmationRows.length
              ? confirmationRows.map(
                  (row) => html`
                    <div role="row" class="enterprise-org-activation-table__row">
                      ${renderOrganizationActivationTableRow({
                        position: resolveOrganizationActivationPositionLabel(row),
                        email: row.offer?.targetEmployeeUser ?? row.memberLabel ?? "待确认",
                        team: row.teamLabel,
                        status: "待确认",
                        actions: html`
                          <button
                            class="btn btn--sm"
                            type="button"
                            @click=${() => {
                              params.seatOfferEditor.onOpen({
                                seatId: row.seatId,
                                seatTitle: row.name,
                                seatStatus: row.seatStatus,
                                defaultAgentId: row.defaultAgentId,
                                availableAgentIds: row.agentIds,
                                defaultSpaceIds: row.defaultSpaceIds,
                                memoryScopeAvailable: row.memoryScopeIds.length > 0,
                                employeeEmail: row.offer?.targetEmployeeUser ?? null,
                              });
                              updateOrganizationSearchParams({ organizationInvite: null });
                            }}
                          >
                            查看确认
                          </button>
                          <button
                            class="btn btn--sm"
                            type="button"
                            ?disabled=${
                              isOrganizationActivationAnyBusy() ||
                              !params.readModel.currentTenantId ||
                              !row.offer
                            }
                            @click=${() => {
                              if (!params.readModel.currentTenantId || !row.offer) {
                                return;
                              }
                              if (
                                !shouldProceed(
                                  `确认向 ${row.offer.targetEmployeeUser} 重新发送岗位绑定提醒邮件吗？`,
                                )
                              ) {
                                return;
                              }
                              void params.actions.organization.onRemindSeatOffer(
                                params.readModel.currentTenantId,
                                row.offer.offerId,
                                row.offer.targetEmployeeUser,
                              );
                            }}
                          >
                            重新发送提醒
                          </button>
                        `,
                      })}
                    </div>
                  `,
                )
              : html`
                  <div class="enterprise-empty enterprise-empty--compact">当前没有待确认成员。</div>
                `
          }
        </div>
        ${
          code
            ? html`
                <div class="enterprise-org-invite-card">
                  <span>最新邀请码</span>
                  <strong class="mono">${code}</strong>
                  ${
                    params.readModel.latestInviteExpiresAt
                      ? html`<small
                          >有效期至
                          ${formatOrganizationChangeTime(params.readModel.latestInviteExpiresAt)}</small
                        >`
                      : nothing
                  }
                </div>
              `
            : nothing
        }
      `)}
      ${orgWsFooter({
        extraStart: inviteHref
          ? html`<a class="btn btn--sm" href=${inviteHref}>打开注册链接</a>`
          : undefined,
        primaryLabel: "批量发送激活",
        onPrimary: () =>
          void runOrganizationActivationEmailSend(
            params.actions.organization.onSendActivationEmails,
            pendingActivationEmails,
          ),
        primaryDisabled: pendingActivationEmails.length === 0,
        busy: isOrganizationActivationAnyBusy(),
      })}
    `,
  });
}

/** 组织操作区内的岗位绑定编辑器：仅工作区呈现（模态分支已随治理台收敛移除）。 */
function renderSeatOfferEditor(props: EnterpriseSurfaceProps) {
  const seatId = props.seatOfferEditor.seatId;
  if (!seatId) {
    return nothing;
  }
  const employeeEmail = props.seatOfferEditor.employeeEmail.trim();
  const isActivationMode = props.seatOfferEditor.mode === "activation";
  const editorTitle = isActivationMode ? "邀请新成员" : "分配在职成员";
  const isSelective = props.seatOfferEditor.inheritMode === "selective";
  const agentOptions = props.seatOfferEditor.availableAgentIds;
  const defaultSpaceIds = props.seatOfferEditor.defaultSpaceIds;
  const memoryScopeAvailable = props.seatOfferEditor.memoryScopeAvailable;
  const primaryLabel = isActivationMode ? "发送激活" : "发送绑定确认";
  const emailHint = isActivationMode
    ? "成员使用激活码注册后自动绑定本岗位，无需再确认绑定。"
    : "仅用于已激活成员；对方确认后完成岗位绑定。";

  return wrapOrganizationEditorPresentation({
    presentation: "workspace",
    ariaLabel: editorTitle,
    panelClass: "enterprise-org-workspace--panel",
    onClose: () => props.seatOfferEditor.onClose(),
    content: html`
      ${orgWsHeader({
        title: editorTitle,
        subtitle: ORG_WS_WORKSPACE_SUB,
        onClose: () => props.seatOfferEditor.onClose(),
      })}
      ${orgWsBody(html`
        ${orgWsKvGrid([
          { label: "岗位席位", value: props.seatOfferEditor.seatTitle },
          {
            label: "席位状态",
            value: rawSeatStatusLabel(props.seatOfferEditor.seatStatus),
          },
          { label: "岗位数字人", value: "随岗位自动生成" },
        ])}
        ${
          props.seatOfferEditor.error
            ? orgWsNotice({ kind: "danger", content: props.seatOfferEditor.error })
            : nothing
        }
        ${
          props.seatOfferEditor.notice
            ? orgWsNotice({
                kind: "ok",
                content: html`<strong>${props.seatOfferEditor.notice}</strong>`,
              })
            : nothing
        }
        ${orgWsField({
          label: "接收员工邮箱",
          content: html`
            <input
              .value=${props.seatOfferEditor.employeeEmail}
              type="email"
              ?disabled=${props.seatOfferEditor.busy}
              placeholder="successor@example.com"
              @input=${(event: Event) =>
                props.seatOfferEditor.onEmployeeEmailChange(
                  (event.target as HTMLInputElement).value,
                )}
            />
            <span class="enterprise-org-ws__field-hint">${emailHint}</span>
          `,
        })}
        ${
          isActivationMode
            ? nothing
            : html`
                ${orgWsRadioRow({
                  legend: "继承策略",
                  name: "seat-offer-inherit-mode-ws",
                  value: props.seatOfferEditor.inheritMode,
                  disabled: props.seatOfferEditor.busy,
                  options: [
                    { value: "full", label: "完整继承（默认）" },
                    { value: "selective", label: "自定义继承" },
                  ],
                  onChange: (value) =>
                    props.seatOfferEditor.onInheritModeChange(value as "full" | "selective"),
                })}
                ${
                  isSelective
                    ? html`
                        ${orgWsSection({
                          title: "机器人",
                          content: orgWsCheckboxGrid({
                            emptyLabel: "当前岗位没有默认机器人资产。",
                            items: agentOptions.map((agentId) => ({
                              id: agentId,
                              label: agentId,
                              checked: props.seatOfferEditor.selectedAgentIds.includes(agentId),
                              disabled: props.seatOfferEditor.busy,
                              onToggle: () => props.seatOfferEditor.onToggleAgentId(agentId),
                            })),
                          }),
                        })}
                        ${orgWsSection({
                          title: "协作空间",
                          content: orgWsCheckboxGrid({
                            emptyLabel: "当前岗位没有默认协作空间。",
                            items: defaultSpaceIds.map((spaceId) => ({
                              id: spaceId,
                              label: spaceId,
                              checked: props.seatOfferEditor.selectedSpaceIds.includes(spaceId),
                              disabled: props.seatOfferEditor.busy,
                              onToggle: () => props.seatOfferEditor.onToggleSpaceId(spaceId),
                            })),
                          }),
                        })}
                        ${orgWsSection({
                          title: "记忆范围",
                          content: orgWsCheckboxGrid({
                            items: [
                              {
                                id: "memory-scope",
                                label: "沿用岗位记忆范围",
                                checked: props.seatOfferEditor.inheritMemoryScope,
                                disabled: props.seatOfferEditor.busy || !memoryScopeAvailable,
                                onToggle: () =>
                                  props.seatOfferEditor.onInheritMemoryScopeChange(
                                    !props.seatOfferEditor.inheritMemoryScope,
                                  ),
                              },
                            ],
                          }),
                        })}
                      `
                    : nothing
                }
              `
        }
      `)}
      ${orgWsFooter({
        onCancel: () => props.seatOfferEditor.onClose(),
        primaryLabel,
        onPrimary: () => props.seatOfferEditor.onSubmit(),
        primaryDisabled: !employeeEmail,
        busy: props.seatOfferEditor.busy,
      })}
    `,
  });
}

/** 组织操作区内的创建/配置岗位编辑器：仅工作区呈现（模态分支已随治理台收敛移除）。 */
function renderCreatePositionEditor(props: EnterpriseSurfaceProps) {
  const editor = props.createPositionEditor;
  if (!editor?.open) {
    return nothing;
  }
  const seatTitle = editor.seatTitle.trim();
  const employeeEmail = editor.employeeEmail.trim();
  const isEditing = Boolean(editor.seatId);
  const editingSeat = editor.seatId
    ? (props.readModel.seatSummaries.find((seat) => seat.seatId === editor.seatId) ?? null)
    : null;
  // Align edit with create: show email for vacant / pending seats (inviteable shells).
  const showEmployeeEmailField =
    !isEditing ||
    !editingSeat ||
    editingSeat.status === "vacant" ||
    Boolean(editingSeat.pendingEmployeeUser?.trim()) ||
    !editingSeat.currentEmployeeUser;
  const createPrimaryLabel = employeeEmail ? "创建并邀请" : "创建岗位";
  const editPrimaryLabel = employeeEmail ? "保存并发送激活" : "保存配置";
  const digitalHumanPreview = resolveOrganizationDigitalHumanName(seatTitle || "岗位");
  const panelClass = "enterprise-org-workspace--panel enterprise-org-modal--create-position";
  const employeeEmailHint = isEditing
    ? "可补填或修改待激活邮箱；保存时发送/重发激活码，成员注册后自动绑定本岗位。"
    : "填写后发送激活码；成员注册后自动绑定本岗位，不会产生待确认绑定。";
  const employeeEmailField = showEmployeeEmailField
    ? orgWsField({
        label: "任职邮箱（可选）",
        content: html`
          <input
            .value=${editor.employeeEmail}
            type="email"
            ?disabled=${editor.busy}
            placeholder="newhire@example.com"
            data-create-position-email
            @input=${(event: Event) =>
              editor.onEmployeeEmailChange((event.target as HTMLInputElement).value)}
          />
          <span class="enterprise-org-ws__field-hint">${employeeEmailHint}</span>
        `,
      })
    : nothing;

  const wsTitle = isEditing ? "配置岗位" : "创建岗位";
  return wrapOrganizationEditorPresentation({
    presentation: "workspace",
    ariaLabel: wsTitle,
    panelClass,
    onClose: () => editor.onClose(),
    content: html`
      ${orgWsHeader({
        title: wsTitle,
        subtitle: ORG_WS_WORKSPACE_SUB,
        onClose: () => editor.onClose(),
      })}
      ${orgWsBody(html`
        ${orgWsField({
          label: "岗位名称",
          content: html`
            <input
              .value=${editor.seatTitle}
              type="text"
              ?disabled=${editor.busy}
              placeholder="销售负责人"
              @input=${(event: Event) =>
                editor.onSeatTitleChange((event.target as HTMLInputElement).value)}
            />
          `,
        })}
        ${orgWsField({
          label: "所属团队",
          content: html`
            <input
              .value=${editor.teamLabel}
              type="text"
              ?disabled=${editor.busy}
              placeholder="销售一组"
              @input=${(event: Event) =>
                editor.onTeamLabelChange((event.target as HTMLInputElement).value)}
            />
          `,
        })}
        ${orgWsField({
          label: "岗位职责",
          alignTop: true,
          content: html`
            <textarea
              .value=${editor.responsibility}
              ?disabled=${editor.busy}
              placeholder="负责销售线索跟进、客户会议记录和方案输出"
              @input=${(event: Event) =>
                editor.onResponsibilityChange((event.target as HTMLTextAreaElement).value)}
            ></textarea>
          `,
        })}
        ${employeeEmailField}
        <div class="enterprise-org-ws__preview">
          <div class="enterprise-org-ws__preview-title">数字人预览</div>
          ${orgWsKvGrid([
            { label: "岗位数字人", value: digitalHumanPreview },
            { label: "AI 工作空间", value: `${digitalHumanPreview}工作空间` },
            { label: "数字人状态", value: "未绑定" },
            { label: "Bot 额度", value: "最多 5 个" },
            { label: "协作组额度", value: "最多 5 个" },
          ])}
        </div>
        ${editor.error ? orgWsNotice({ kind: "danger", content: editor.error }) : nothing}
        ${
          editor.notice
            ? orgWsNotice({
                kind: "ok",
                content: html`<strong>${editor.notice}</strong>`,
              })
            : nothing
        }
      `)}
      ${orgWsFooter({
        onCancel: () => editor.onClose(),
        primaryLabel: isEditing ? editPrimaryLabel : createPrimaryLabel,
        onPrimary: () => editor.onSubmit(),
        primaryDisabled: !seatTitle,
        busy: editor.busy,
      })}
    `,
  });
}

type OrganizationView = "position" | "ai" | "member" | "group";
type OrganizationStatusFilter =
  | "all"
  | "inactive"
  | "normal"
  | "vacant"
  | "pending"
  | "activation"
  | "handover"
  | "error";
type OrganizationPositionStatus =
  | "NORMAL"
  | "VACANT"
  | "PENDING_CONFIRM"
  | "PENDING_ACTIVATION"
  | "HANDOVER"
  | "ERROR";
type OrganizationRuntimeTone = "ok" | "warn" | "danger" | "neutral";

type OrganizationPositionRow = {
  seatId: string;
  name: string;
  displayName: string;
  description: string | null;
  responsibility: string | null;
  pendingAssignmentId: string | null;
  memberUserId: string | null;
  memberDisplayLabel: string | null;
  memberLabel: string | null;
  pendingEmployeeUser: string | null;
  pendingEmployeeDisplayName: string | null;
  pendingActivationExpiresAt: string | null;
  memberStatus: string | null;
  roleCode: string | null;
  defaultAgentId: string | null;
  agentIds: string[];
  defaultSpaceIds: string[];
  memoryScopeIds: string[];
  aiEmployeeLabel: string;
  botCount: number;
  groupCount: number;
  runtimeLabel: string;
  runtimeTone: OrganizationRuntimeTone;
  runtimeHost: string | null;
  totalCost: number | null;
  totalTokens: number | null;
  sessionCount: number | null;
  usageDisplay: OrganizationPositionUsageAggregate["display"];
  usageErrorMessage: string | null;
  unmatchedAgentIds: string[];
  teamLabel: string;
  status: OrganizationPositionStatus;
  seatStatus: string;
  activityLabel: string;
  lastActiveAt: number | null;
  offer: EnterprisePortReadModel["offerSummaries"][number] | null;
  handover: EnterprisePortReadModel["handoverSummaries"][number] | null;
};

type OrganizationMemberRow = {
  user: string;
  displayLabel: string;
  membershipRole: string;
  /** Dual identity → both `enterprise-admin` and `member`. */
  membershipRoles: string[];
  adminInvitePendingExpiresAt: string | null;
  isCurrentUser: boolean;
  status: string;
  seatTitle: string | null;
  seatId: string | null;
  seatStatus: OrganizationPositionStatus | null;
  teamLabel: string | null;
  aiEmployeeLabel: string | null;
  handoverLabel: string;
};

type OrganizationAiEmployeeRow = {
  id: string;
  name: string;
  positionLabel: string;
  seatId: string | null;
  teamLabel: string | null;
  runtimeLabel: string;
  runtimeTone: OrganizationRuntimeTone;
  botCount: number;
  groupCount: number;
  totalCost: number | null;
  usageDisplay: OrganizationPositionUsageAggregate["display"];
  healthLabel: string;
  activityLabel: string;
  status: OrganizationPositionStatus;
};

type OrganizationGroupRow = {
  id: string;
  groupId: string;
  name: string;
  positionId: string;
  positionLabel: string;
  seatId: string | null;
  teamLabel: string | null;
  aiEmployeeLabel: string;
  runtimeLabel: string;
  runtimeTone: OrganizationRuntimeTone;
  sessionCount: number;
  totalCost: number;
  status: OrganizationPositionStatus;
  activityLabel: string;
  currentManagerUserId: string;
  currentManagerLabel: string;
};

type OrganizationSurfaceMode = "governance" | "structure";

function resolveOrganizationSurface(search: string): OrganizationSurfaceMode {
  return new URLSearchParams(search).get("organizationSurface") === "structure"
    ? "structure"
    : "governance";
}

function resolveOrganizationView(search: string): OrganizationView {
  const value = new URLSearchParams(search).get("organizationView");
  return value === "ai" || value === "member" || value === "group" ? value : "position";
}

function resolveOrganizationStatusFilter(search: string): OrganizationStatusFilter {
  const value = new URLSearchParams(search).get("organizationStatus");
  return value === "inactive" ||
    value === "normal" ||
    value === "vacant" ||
    value === "pending" ||
    value === "activation" ||
    value === "handover" ||
    value === "error"
    ? value
    : "all";
}

function resolveOrganizationSeat(search: string): string | null {
  const value = new URLSearchParams(search).get("organizationSeat")?.trim();
  return value || null;
}

function resolveOrganizationInviteOpen(search: string): boolean {
  return new URLSearchParams(search).get("organizationInvite") === "1";
}

/** 系统设置 →「邀请管理员」lands here to pick an employee for an admin invite. */
function resolveOrganizationAdminInvitePick(search: string): boolean {
  return new URLSearchParams(search).get(ENTERPRISE_ADMIN_INVITE_PICK_PARAM) === "1";
}

/** Directory action visibility for「邀请为管理员」. */
export function canInviteOrganizationMemberAsAdmin(row: {
  membershipRole: string;
  status: string;
  isCurrentUser?: boolean;
}): boolean {
  return row.membershipRole !== "enterprise-admin" && row.status === "active" && !row.isCurrentUser;
}

function formatOrganizationInviteExpiry(value: string | null): string {
  if (!value) {
    return "";
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return new Date(parsed).toLocaleString("zh-CN", { hour12: false });
}

/**
 * 岗位详情是否从治理台（模块首页）进入。持久化在 URL 上，
 * 刷新后「返回模块首页」仍然可用。
 */
function resolveOrganizationFrom(search: string): "governance" | null {
  return new URLSearchParams(search).get("organizationFrom") === "governance" ? "governance" : null;
}

function resolveOrganizationSearch(search: string): string {
  return new URLSearchParams(search).get("organizationSearch")?.trim() ?? "";
}

function resolveOrganizationTeam(search: string): string {
  return new URLSearchParams(search).get("organizationTeam")?.trim() ?? "all";
}

function resolveOrganizationPage(search: string): number {
  const value = Number.parseInt(new URLSearchParams(search).get("organizationPage") ?? "", 10);
  return Number.isFinite(value) && value > 1 ? value : 1;
}

function resolveOrganizationPageSize(search: string): 10 | 20 | 50 {
  const value = Number.parseInt(new URLSearchParams(search).get("organizationPageSize") ?? "", 10);
  return value === 20 || value === 50 ? value : 10;
}

type OrganizationRiskSort = "desc" | "asc";

function resolveOrganizationRiskSort(search: string): OrganizationRiskSort | null {
  const value = new URLSearchParams(search).get("organizationRiskSort");
  return value === "asc" || value === "desc" ? value : null;
}

function cycleOrganizationRiskSort(
  current: OrganizationRiskSort | null,
): OrganizationRiskSort | null {
  if (!current) {
    return "desc";
  }
  if (current === "desc") {
    return "asc";
  }
  return null;
}

function organizationRiskRank(row: OrganizationPositionRow): number {
  if (row.status === "VACANT" || row.status === "ERROR") {
    return 3;
  }
  if (
    row.status === "PENDING_CONFIRM" ||
    row.status === "PENDING_ACTIVATION" ||
    row.status === "HANDOVER"
  ) {
    return 2;
  }
  return 1;
}

function sortOrganizationPositionRowsByRisk(
  rows: OrganizationPositionRow[],
  sort: OrganizationRiskSort | null,
): OrganizationPositionRow[] {
  if (!sort) {
    return rows;
  }
  return [...rows].toSorted((left, right) => {
    const diff = organizationRiskRank(right) - organizationRiskRank(left);
    return sort === "desc" ? diff : -diff;
  });
}

function appendOrganizationSearchToHref(
  href: string,
  params: {
    view?: OrganizationView | null;
    status?: OrganizationStatusFilter | null;
    seatId?: string | null;
    query?: string | null;
    team?: string | null;
    page?: number | null;
    pageSize?: 10 | 20 | 50 | null;
    riskSort?: OrganizationRiskSort | null;
  },
) {
  try {
    const parsed = new URL(
      href,
      typeof window !== "undefined" ? window.location.href : "http://localhost",
    );
    if (params.view && params.view !== "position") {
      parsed.searchParams.set("organizationView", params.view);
    } else {
      parsed.searchParams.delete("organizationView");
    }
    if (params.status && params.status !== "all") {
      parsed.searchParams.set("organizationStatus", params.status);
    } else {
      parsed.searchParams.delete("organizationStatus");
    }
    if (params.seatId) {
      parsed.searchParams.set("organizationSeat", params.seatId);
    } else {
      parsed.searchParams.delete("organizationSeat");
    }
    if (params.query) {
      parsed.searchParams.set("organizationSearch", params.query);
    } else {
      parsed.searchParams.delete("organizationSearch");
    }
    if (params.team && params.team !== "all") {
      parsed.searchParams.set("organizationTeam", params.team);
    } else {
      parsed.searchParams.delete("organizationTeam");
    }
    if (params.page && params.page > 1) {
      parsed.searchParams.set("organizationPage", String(params.page));
    } else {
      parsed.searchParams.delete("organizationPage");
    }
    if (params.pageSize && params.pageSize !== 10) {
      parsed.searchParams.set("organizationPageSize", String(params.pageSize));
    } else {
      parsed.searchParams.delete("organizationPageSize");
    }
    if (params.riskSort) {
      parsed.searchParams.set("organizationRiskSort", params.riskSort);
    } else if ("riskSort" in params) {
      parsed.searchParams.delete("organizationRiskSort");
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const search = new URLSearchParams();
    if (params.view && params.view !== "position") {
      search.set("organizationView", params.view);
    }
    if (params.status && params.status !== "all") {
      search.set("organizationStatus", params.status);
    }
    if (params.seatId) {
      search.set("organizationSeat", params.seatId);
    }
    if (params.query) {
      search.set("organizationSearch", params.query);
    }
    if (params.team && params.team !== "all") {
      search.set("organizationTeam", params.team);
    }
    if (params.page && params.page > 1) {
      search.set("organizationPage", String(params.page));
    }
    if (params.pageSize && params.pageSize !== 10) {
      search.set("organizationPageSize", String(params.pageSize));
    }
    if (params.riskSort) {
      search.set("organizationRiskSort", params.riskSort);
    }
    const suffix = search.toString();
    return suffix ? `${href}${href.includes("?") ? "&" : "?"}${suffix}` : href;
  }
}

function updateOrganizationSearchParams(
  patch: Partial<{
    organizationSurface: OrganizationSurfaceMode | null;
    organizationView: OrganizationView | null;
    organizationStatus: OrganizationStatusFilter | null;
    organizationSeat: string | null;
    organizationSearch: string | null;
    organizationTeam: string | null;
    organizationPage: number | null;
    organizationPageSize: "10" | "20" | "50" | null;
    organizationInvite: boolean | null;
    organizationRiskSort: OrganizationRiskSort | null;
    organizationFrom: "governance" | null;
  }>,
) {
  if (typeof window === "undefined") {
    return;
  }
  const next = new URL(window.location.href);
  const assign = (key: string, value: string | null | undefined, defaultValue?: string) => {
    if (!value || (defaultValue && value === defaultValue)) {
      next.searchParams.delete(key);
      return;
    }
    next.searchParams.set(key, value);
  };
  if ("organizationSurface" in patch) {
    assign("organizationSurface", patch.organizationSurface, "governance");
  }
  if ("organizationView" in patch) {
    assign("organizationView", patch.organizationView, "position");
  }
  if ("organizationStatus" in patch) {
    assign("organizationStatus", patch.organizationStatus, "all");
  }
  if ("organizationSeat" in patch) {
    assign("organizationSeat", patch.organizationSeat);
  }
  if ("organizationSearch" in patch) {
    assign("organizationSearch", patch.organizationSearch);
  }
  if ("organizationTeam" in patch) {
    assign("organizationTeam", patch.organizationTeam, "all");
  }
  if ("organizationPage" in patch) {
    assign("organizationPage", patch.organizationPage ? String(patch.organizationPage) : null, "1");
  }
  if ("organizationPageSize" in patch) {
    assign("organizationPageSize", patch.organizationPageSize, "10");
  }
  if ("organizationInvite" in patch) {
    assign("organizationInvite", patch.organizationInvite ? "1" : null);
  }
  if ("organizationRiskSort" in patch) {
    assign("organizationRiskSort", patch.organizationRiskSort);
  }
  if ("organizationFrom" in patch) {
    assign("organizationFrom", patch.organizationFrom);
  }
  window.history.pushState({}, "", `${next.pathname}${next.search}${next.hash}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
  requestEnterpriseAppRerender();
}

function paginateOrganizationRows<T>(rows: T[], page: number, pageSize: number) {
  const totalCount = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (safePage - 1) * pageSize;
  return {
    totalCount,
    totalPages,
    currentPage: safePage,
    pageSize,
    rows: rows.slice(startIndex, startIndex + pageSize),
  };
}

function buildOrganizationPaginationItems(
  currentPage: number,
  totalPages: number,
): Array<number | "ellipsis"> {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  if (currentPage <= 3) {
    return [1, 2, 3, 4, "ellipsis", totalPages];
  }
  if (currentPage >= totalPages - 2) {
    return [1, "ellipsis", totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages];
}

function renderOrganizationTableFooter(params: {
  totalCount: number;
  currentPage: number;
  totalPages: number;
  pageSize: 10 | 20 | 50;
  baseHref: string;
  view: OrganizationView;
  status: OrganizationStatusFilter;
  query: string;
  team: string;
  riskSort?: OrganizationRiskSort | null;
}) {
  const pageItems = buildOrganizationPaginationItems(params.currentPage, params.totalPages);
  const submitPageJump = (rawValue: string) => {
    const value = Number.parseInt(rawValue.trim(), 10);
    if (!Number.isFinite(value)) {
      return;
    }
    updateOrganizationSearchParams({
      organizationPage: Math.min(params.totalPages, Math.max(1, value)),
    });
  };
  return html`
    <div class="enterprise-org-table-footer">
      <div class="enterprise-org-table-footer__summary">
        <span>共 ${params.totalCount} 条</span>
        <span>第 ${params.currentPage} / ${params.totalPages} 页</span>
        <label class="enterprise-org-table-footer__size">
          <span>每页</span>
          <select
            class="input enterprise-org-table-footer__select"
            .value=${String(params.pageSize)}
            @change=${(event: Event) =>
              updateOrganizationSearchParams({
                organizationPageSize: (event.currentTarget as HTMLSelectElement).value as
                  | "10"
                  | "20"
                  | "50",
                organizationPage: 1,
              })}
          >
            <option value="10">10 条/页</option>
            <option value="20">20 条/页</option>
            <option value="50">50 条/页</option>
          </select>
        </label>
      </div>
      <div class="enterprise-org-table-footer__pager">
        <button
          class="btn btn--sm"
          type="button"
          ?disabled=${params.currentPage <= 1}
          @click=${() =>
            updateOrganizationSearchParams({
              organizationPage: Math.max(1, params.currentPage - 1),
            })}
        >
          上一页
        </button>
        ${pageItems.map((item) =>
          item === "ellipsis"
            ? html`
                <span class="enterprise-org-table-footer__ellipsis">…</span>
              `
            : html`
                <a
                  class="enterprise-org-table-footer__page ${item === params.currentPage ? "is-active" : ""}"
                  href=${appendOrganizationSearchToHref(params.baseHref, {
                    view: params.view,
                    status: params.status,
                    query: params.query,
                    team: params.team,
                    page: item,
                    pageSize: params.pageSize,
                    riskSort: params.riskSort,
                  })}
                  @click=${(event: MouseEvent) =>
                    followPortHref(
                      event,
                      appendOrganizationSearchToHref(params.baseHref, {
                        view: params.view,
                        status: params.status,
                        query: params.query,
                        team: params.team,
                        page: item,
                        pageSize: params.pageSize,
                        riskSort: params.riskSort,
                      }),
                    )}
                >
                  ${item}
                </a>
              `,
        )}
        <button
          class="btn btn--sm"
          type="button"
          ?disabled=${params.currentPage >= params.totalPages}
          @click=${() =>
            updateOrganizationSearchParams({
              organizationPage: Math.min(params.totalPages, params.currentPage + 1),
            })}
        >
          下一页
        </button>
        <label class="enterprise-org-table-footer__jump">
          <span>前往</span>
          <input
            class="input enterprise-org-table-footer__jump-input"
            type="number"
            min="1"
            max=${String(params.totalPages)}
            .value=${String(params.currentPage)}
            @keydown=${(event: KeyboardEvent) => {
              if (event.key !== "Enter") {
                return;
              }
              submitPageJump((event.currentTarget as HTMLInputElement).value);
            }}
            @blur=${(event: FocusEvent) =>
              submitPageJump((event.currentTarget as HTMLInputElement).value)}
          />
          <span>页</span>
        </label>
      </div>
    </div>
  `;
}

function organizationStatusLabel(value: OrganizationPositionStatus) {
  switch (value) {
    case "VACANT":
      return "空岗";
    case "PENDING_CONFIRM":
      return "待确认";
    case "PENDING_ACTIVATION":
      return "待激活";
    case "HANDOVER":
      return "交接中";
    case "ERROR":
      return "异常";
    default:
      return "正常";
  }
}

function rawSeatStatusLabel(value: string | null | undefined): string {
  switch ((value ?? "").trim().toLowerCase()) {
    case "vacant":
      return "空岗";
    case "assigned":
      return "待激活";
    case "occupied":
      return "在职";
    case "handover_pending":
      return "交接中";
    case "frozen":
      return "已冻结";
    case "pending":
      return "待确认";
    default:
      return value?.trim() || "待确认";
  }
}

function organizationStatusTone(value: OrganizationPositionStatus): "ok" | "warn" | "danger" {
  switch (value) {
    case "VACANT":
    case "ERROR":
      return "danger";
    case "PENDING_CONFIRM":
    case "PENDING_ACTIVATION":
    case "HANDOVER":
      return "warn";
    default:
      return "ok";
  }
}

function organizationStatusMatches(
  value: OrganizationPositionStatus | null,
  filter: OrganizationStatusFilter,
) {
  if (filter === "all") {
    return true;
  }
  if (!value) {
    return false;
  }
  switch (filter) {
    case "inactive":
      return organizationStatusMatchesInactiveFilter(value);
    case "normal":
      return value === "NORMAL";
    case "vacant":
      return value === "VACANT";
    case "pending":
      return value === "PENDING_CONFIRM";
    case "activation":
      return value === "PENDING_ACTIVATION";
    case "handover":
      return value === "HANDOVER";
    case "error":
      return value === "ERROR";
  }
}

function organizationRuntimeTone(
  status: EnterprisePortReadModel["meshAgents"][number]["status"] | null | undefined,
): OrganizationRuntimeTone {
  if (status === "online") {
    return "ok";
  }
  if (status === "offline") {
    return "danger";
  }
  return "neutral";
}

function organizationRuntimeLabel(
  status: EnterprisePortReadModel["meshAgents"][number]["status"] | null | undefined,
) {
  if (status === "online") {
    return "ONLINE";
  }
  if (status === "offline") {
    return "OFFLINE";
  }
  return "UNKNOWN";
}

type MeshAgentRow = EnterprisePortReadModel["meshAgents"][number];

/** 跨岗位全部机器人聚合 mesh 运行态；任一 online 优先，再 offline，否则保留首个已知状态。 */
function aggregateSeatMeshRuntime(params: {
  agentIds: readonly string[];
  meshAgentById: ReadonlyMap<string, MeshAgentRow>;
}): {
  runtimeStatus: MeshAgentRow["status"] | null;
  runtimeHost: string | null;
  groupCount: number;
} {
  let runtimeStatus: MeshAgentRow["status"] | null = null;
  let runtimeHost: string | null = null;
  let groupCount = 0;
  for (const agentId of params.agentIds) {
    const trimmed = agentId.trim();
    if (!trimmed) {
      continue;
    }
    const agent =
      params.meshAgentById.get(trimmed) ?? params.meshAgentById.get(trimmed.toLowerCase()) ?? null;
    if (!agent) {
      continue;
    }
    groupCount += agent.groupCount ?? 0;
    if (agent.runtimeHost && !runtimeHost) {
      runtimeHost = agent.runtimeHost;
    }
    if (agent.status === "online") {
      runtimeStatus = "online";
    } else if (agent.status === "offline" && runtimeStatus !== "online") {
      runtimeStatus = "offline";
    } else if (runtimeStatus == null && agent.status === "unknown") {
      // online/offline already handled above; only unknown remains here (avoids TS2367).
      runtimeStatus = "unknown";
    }
  }
  return { runtimeStatus, runtimeHost, groupCount };
}

function renderOrganizationMonthlyUsageCell(params: {
  display: OrganizationPositionUsageAggregate["display"];
  totalCost: number | null;
  totalTokens: number | null;
  errorMessage?: string | null;
  unmatchedAgentIds?: readonly string[];
}) {
  if (params.display === "loading" || params.display === "unloaded") {
    return html`
      <div class="enterprise-org-row__cell enterprise-org-row__cell--cost">
        <strong>--</strong>
        <span>暂无数据</span>
      </div>
    `;
  }
  if (params.display === "error") {
    return html`
      <div
        class="enterprise-org-row__cell enterprise-org-row__cell--cost"
        title=${params.errorMessage ?? "用量加载失败"}
      >
        <strong>加载失败</strong>
        <span>请稍后重试</span>
      </div>
    `;
  }
  if (params.display === "unmatched") {
    const count = params.unmatchedAgentIds?.length ?? 0;
    return html`
      <div
        class="enterprise-org-row__cell enterprise-org-row__cell--cost"
        title=${`部分机器人 ID 无法归因（${count}）`}
      >
        <strong>${params.totalCost == null ? "--" : formatCost(params.totalCost)}</strong>
        <span>归因不完整</span>
      </div>
    `;
  }
  if (params.totalCost == null && params.totalTokens == null) {
    return html`
      <div class="enterprise-org-row__cell enterprise-org-row__cell--cost">
        <strong>--</strong>
        <span>暂无数据</span>
      </div>
    `;
  }
  return html`
    <div class="enterprise-org-row__cell enterprise-org-row__cell--cost">
      <strong>${formatCost(params.totalCost ?? 0)}</strong>
      <span>${formatTokens(params.totalTokens ?? 0)} tokens</span>
    </div>
  `;
}

function deriveAiEmployeeName(positionName: string) {
  return resolveOrganizationDigitalHumanName(positionName);
}

function deriveOrganizationPositionRows(
  readModel: EnterprisePortReadModel,
  monthlyUsageLoadState: OrganizationMonthlyUsageLoadState,
): OrganizationPositionRow[] {
  const memberDisplayLookup = buildOrganizationMemberDisplayLookup(readModel.memberSummaries);
  const offersBySeat = new Map(
    readModel.offerSummaries
      .filter((offer) => offer.status === "pending")
      .map((offer) => [offer.seatId, offer] as const),
  );
  const handoversBySeatId = new Map(
    readModel.handoverSummaries
      .filter((handover) => Boolean(handover.seatId?.trim()))
      .map((handover) => [handover.seatId!.trim(), handover] as const),
  );
  const handoversBySeatTitle = new Map(
    readModel.handoverSummaries.map((handover) => [handover.seatTitle, handover] as const),
  );
  const meshAgentById = new Map<string, (typeof readModel.meshAgents)[number]>();
  for (const agent of readModel.meshAgents) {
    const id = agent.agentId.trim();
    if (!id) {
      continue;
    }
    meshAgentById.set(id, agent);
    meshAgentById.set(id.toLowerCase(), agent);
  }
  const knownAgentIds = new Set(
    readModel.meshAgents.flatMap((agent) => {
      const id = agent.agentId.trim();
      return id ? [id, id.toLowerCase()] : [];
    }),
  );
  return readModel.seatSummaries.map((seat) => {
    const offer = offersBySeat.get(seat.seatId) ?? null;
    const handover =
      handoversBySeatId.get(seat.seatId) ?? handoversBySeatTitle.get(seat.title) ?? null;
    const pendingEmployeeLabel =
      seat.pendingEmployeeDisplayName ?? seat.pendingEmployeeUser ?? null;
    const seatAgentIds = collectUniqueSeatAgentIds({
      agentIds: seat.agentIds,
      defaultAgentId: seat.defaultAgentId,
    });
    const defaultAgent = seat.defaultAgentId
      ? (meshAgentById.get(seat.defaultAgentId) ?? null)
      : null;
    const meshRuntime = aggregateSeatMeshRuntime({
      agentIds: seatAgentIds,
      meshAgentById,
    });
    const seatUsage = aggregateSeatAgentUsage({
      seat: {
        seatId: seat.seatId,
        agentIds: seat.agentIds,
        defaultAgentId: seat.defaultAgentId,
      },
      loadState: monthlyUsageLoadState,
      knownAgentIds,
    });
    const outgoingUserId = handover?.outgoingEmployeeUser ?? null;
    const memberUserId = handover
      ? outgoingUserId
      : (seat.currentEmployeeUser ?? offer?.targetEmployeeUser ?? seat.pendingEmployeeUser ?? null);
    // 员工账号归因仅对已绑定在岗成员（交接中取离任人）；待激活/空岗不造数。
    const employeeAttributionUserId = handover
      ? outgoingUserId
      : seat.status === "occupied"
        ? (seat.currentEmployeeUser ?? null)
        : null;
    const employeeUsage = resolveEmployeeUsageForSeat({
      memberUserId: employeeAttributionUserId,
      loadState: monthlyUsageLoadState,
    });
    const usage = mergePositionMonthlyUsage({
      employeeAttributionUserId,
      seatUsage,
      employeeUsage,
    });
    // Runtime：月度聚合（通常为 null）→ 全岗位 mesh 聚合 → defaultAgent；不回退成本为 0。
    const runtimeStatus =
      usage.runtimeStatus ??
      meshRuntime.runtimeStatus ??
      (defaultAgent?.status === "online" ||
      defaultAgent?.status === "offline" ||
      defaultAgent?.status === "unknown"
        ? defaultAgent.status
        : null);
    let status: OrganizationPositionStatus = "NORMAL";
    if (handover) {
      status = "HANDOVER";
    } else if (offer) {
      status = "PENDING_CONFIRM";
    } else if (pendingEmployeeLabel || seat.status === "assigned") {
      status = "PENDING_ACTIVATION";
    } else if (seat.status === "frozen") {
      status = "PENDING_CONFIRM";
    } else if (seat.status === "vacant") {
      status = "VACANT";
    } else if (runtimeStatus === "offline") {
      status = "ERROR";
    }
    const memberDisplayLabel = resolveOrganizationMemberDisplayLabel({
      lookup: memberDisplayLookup,
      userId: memberUserId,
      explicitDisplayName: handover
        ? null
        : (seat.pendingEmployeeDisplayName ?? seat.currentEmployeeLabel ?? null),
    });
    const lastActiveAt = employeeAttributionUserId?.trim()
      ? (usage.lastActiveAt ?? defaultAgent?.lastActiveAt ?? null)
      : null;
    return {
      seatId: seat.seatId,
      name: seat.title,
      displayName: resolveOrganizationSeatDisplayName(seat.title),
      description: handover
        ? handoverStatusLabel(handover.status)
        : seat.currentEmployeeUser || seat.currentEmployeeLabel
          ? null
          : pendingEmployeeLabel
            ? "待成员激活"
            : "空岗",
      responsibility: seat.responsibility,
      pendingAssignmentId: seat.pendingAssignmentId ?? offer?.assignmentId ?? null,
      memberUserId,
      memberDisplayLabel,
      memberLabel: memberUserId,
      pendingEmployeeUser: seat.pendingEmployeeUser ?? null,
      pendingEmployeeDisplayName: seat.pendingEmployeeDisplayName ?? null,
      pendingActivationExpiresAt: seat.pendingActivationExpiresAt ?? null,
      memberStatus: handover
        ? handover.incomingEmployeeUser
          ? `交接中`
          : `待指定继任者`
        : offer
          ? "待确认"
          : pendingEmployeeLabel
            ? "待激活"
            : seat.currentEmployeeUser || seat.currentEmployeeLabel
              ? "正常"
              : "空岗",
      roleCode: seat.roleCode,
      defaultAgentId: seat.defaultAgentId,
      agentIds: seat.agentIds,
      defaultSpaceIds: seat.defaultSpaceIds,
      memoryScopeIds: seat.memoryScopeIds,
      aiEmployeeLabel: deriveAiEmployeeName(seat.title),
      botCount: seat.agentIds.length,
      groupCount: usage.groupCount || meshRuntime.groupCount || defaultAgent?.groupCount || 0,
      runtimeLabel: organizationRuntimeLabel(runtimeStatus),
      runtimeTone: organizationRuntimeTone(runtimeStatus),
      runtimeHost:
        usage.runtimeHost ?? meshRuntime.runtimeHost ?? defaultAgent?.runtimeHost ?? null,
      totalCost: usage.totalCost,
      totalTokens: usage.totalTokens,
      sessionCount: usage.sessionCount,
      usageDisplay: usage.display,
      usageErrorMessage: usage.errorMessage,
      unmatchedAgentIds: usage.unmatchedAgentIds,
      teamLabel: seat.teamLabel ?? "未分组",
      status,
      seatStatus: seat.status,
      activityLabel: handover
        ? handoverStatusLabel(handover.status)
        : offer
          ? "等待成员确认"
          : pendingEmployeeLabel
            ? "等待邀请激活"
            : seat.status === "vacant"
              ? "未绑定"
              : seat.agentIds.length === 0
                ? "等待负责人创建Bot"
                : lastActiveAt
                  ? formatOrganizationChangeTime(lastActiveAt)
                  : "组织已同步",
      lastActiveAt,
      offer,
      handover,
    };
  });
}

function deriveOrganizationMemberRows(
  readModel: EnterprisePortReadModel,
  positionRows: OrganizationPositionRow[],
): OrganizationMemberRow[] {
  const seatIdByTitle = new Map(positionRows.map((row) => [row.name, row.seatId] as const));
  const seatStatusByTitle = new Map(positionRows.map((row) => [row.name, row.status] as const));
  const teamLabelByTitle = new Map(positionRows.map((row) => [row.name, row.teamLabel] as const));
  const aiEmployeeByTitle = new Map(
    positionRows.map((row) => [row.name, row.aiEmployeeLabel] as const),
  );
  const handoverByTitle = new Map(
    positionRows.map(
      (row) =>
        [row.name, row.handover ? handoverStatusLabel(row.handover.status) : "稳定"] as const,
    ),
  );
  return readModel.memberSummaries.map((member) => ({
    user: member.user,
    displayLabel:
      resolveOrganizationMemberDisplayLabel({
        lookup: new Map(),
        userId: member.user,
        explicitDisplayName: member.displayLabel,
      }) ?? "未绑定成员",
    membershipRole: member.membershipRole,
    membershipRoles: member.membershipRoles?.length
      ? [...member.membershipRoles]
      : [member.membershipRole],
    adminInvitePendingExpiresAt: member.adminInvitePendingExpiresAt ?? null,
    isCurrentUser: member.isCurrentUser === true,
    status: member.status,
    seatTitle: member.seatTitle,
    seatId: member.seatTitle ? (seatIdByTitle.get(member.seatTitle) ?? null) : null,
    seatStatus: member.seatTitle ? (seatStatusByTitle.get(member.seatTitle) ?? null) : null,
    teamLabel: member.seatTitle ? (teamLabelByTitle.get(member.seatTitle) ?? null) : null,
    aiEmployeeLabel: member.seatTitle ? (aiEmployeeByTitle.get(member.seatTitle) ?? null) : null,
    handoverLabel: member.seatTitle ? (handoverByTitle.get(member.seatTitle) ?? "稳定") : "未绑定",
  }));
}

function deriveOrganizationAiEmployeeRows(
  readModel: EnterprisePortReadModel,
  positionRows: OrganizationPositionRow[],
): OrganizationAiEmployeeRow[] {
  const meshAgentById = new Map(
    readModel.meshAgents.map((agent) => [agent.agentId, agent] as const),
  );
  const rows = positionRows.map((position) => {
    const agent = position.defaultAgentId
      ? (meshAgentById.get(position.defaultAgentId) ?? null)
      : null;
    const status: OrganizationPositionStatus =
      position.status === "VACANT" ||
      position.status === "HANDOVER" ||
      position.status === "PENDING_CONFIRM" ||
      position.status === "PENDING_ACTIVATION"
        ? position.status
        : agent?.status === "offline"
          ? "ERROR"
          : "NORMAL";
    return {
      id: position.defaultAgentId ?? position.seatId,
      name: position.aiEmployeeLabel,
      positionLabel: position.name,
      seatId: position.seatId,
      teamLabel: position.teamLabel,
      runtimeLabel: organizationRuntimeLabel(agent?.status),
      runtimeTone: organizationRuntimeTone(agent?.status),
      botCount: position.botCount,
      groupCount: agent?.groupCount ?? position.groupCount,
      totalCost: position.totalCost,
      usageDisplay: position.usageDisplay,
      healthLabel: agent?.errorCount
        ? `${agent.errorCount} 个异常`
        : position.status === "VACANT"
          ? "UNBOUND"
          : agent?.status === "online"
            ? "稳定"
            : "待激活",
      activityLabel: agent?.lastActiveAt
        ? formatOrganizationChangeTime(agent.lastActiveAt)
        : position.activityLabel,
      status,
    };
  });
  return rows;
}

function deriveOrganizationGroupRows(
  readModel: EnterprisePortReadModel,
  positionRows: OrganizationPositionRow[],
): OrganizationGroupRow[] {
  const firstRuntimeHost = readModel.runtimeHosts[0] ?? null;
  const positionBySeatId = new Map(
    positionRows.map((position) => [position.seatId, position] as const),
  );
  return readModel.meshGroups.map((group) => {
    const matchingPosition =
      positionBySeatId.get(group.ownership.positionId) ??
      positionRows.find((position) => position.memberLabel === group.creatorLabel) ??
      null;
    const runtimeOnline = Boolean(firstRuntimeHost && group.sessionCount > 0);
    return {
      id: group.groupId,
      groupId: group.groupId,
      name: group.name,
      positionId: group.ownership.positionId,
      positionLabel: matchingPosition?.name ?? group.ownership.positionLabel ?? "待归属岗位",
      seatId: matchingPosition?.seatId ?? null,
      teamLabel: matchingPosition?.teamLabel ?? null,
      aiEmployeeLabel: `${group.agentCount} 个数字人`,
      runtimeLabel: runtimeOnline ? "ONLINE" : "UNKNOWN",
      runtimeTone: runtimeOnline ? "ok" : "neutral",
      sessionCount: group.sessionCount,
      totalCost: group.totalCost,
      status: group.incidentCount > 0 ? "ERROR" : "NORMAL",
      activityLabel: group.lastActiveAt
        ? formatOrganizationChangeTime(group.lastActiveAt)
        : "待复核",
      currentManagerUserId: group.ownership.currentManagerUserId,
      currentManagerLabel: group.ownership.currentManagerLabel,
    };
  });
}

function renderOrganizationStatusTag(status: OrganizationPositionStatus) {
  return renderMeshBadge(organizationStatusLabel(status), organizationStatusTone(status));
}

function initialsForLabel(value: string | null | undefined, fallback: string) {
  const label = value?.trim();
  if (!label) {
    return fallback;
  }
  const first = Array.from(label).slice(0, 2).join("");
  return first || fallback;
}

function organizationPrimaryActionLabel(row: OrganizationPositionRow) {
  if (row.handover) {
    return handoverOpenActionLabel(row.handover.status);
  }
  if (row.offer) {
    return "查看确认";
  }
  if (row.status === "VACANT") {
    return "补人";
  }
  if (row.status === "PENDING_CONFIRM") {
    return "查看确认";
  }
  if (row.status === "PENDING_ACTIVATION") {
    return row.pendingEmployeeUser ? "重发激活" : "补邮箱";
  }
  if (row.status === "ERROR") {
    return "处理异常";
  }
  return "交接";
}

function organizationPrimaryActionIcon(row: OrganizationPositionRow): IconName {
  if (row.handover) {
    return handoverOpenActionIcon(row.handover.status);
  }
  if (row.offer || row.status === "PENDING_CONFIRM") {
    return "eye";
  }
  if (row.status === "VACANT") {
    return "user";
  }
  if (row.status === "PENDING_ACTIVATION") {
    return row.pendingEmployeeUser ? "refreshCw" : "fileText";
  }
  if (row.status === "ERROR") {
    return "alertTriangle";
  }
  return "arrowRight";
}

function renderOrganizationRowIconButton(options: {
  label: string;
  icon: IconName;
  primary?: boolean;
  onClick: (event: MouseEvent) => void;
}) {
  const className = `btn btn--sm btn--icon enterprise-org-row__action-icon${
    options.primary ? " btn--primary" : ""
  }`;
  return html`
    <button
      class=${className}
      type="button"
      aria-label=${options.label}
      title=${options.label}
      @click=${options.onClick}
    >
      ${renderIcon(options.icon, "enterprise-org-row__action-icon__glyph")}
    </button>
  `;
}

function organizationRoleTone(role: string): "ok" | "warn" | "neutral" {
  if (role === "enterprise-admin") {
    return "warn";
  }
  if (role === "operator") {
    return "ok";
  }
  return "neutral";
}

function organizationActivityTone(
  status: OrganizationPositionStatus,
): "ok" | "warn" | "danger" | "neutral" {
  if (status === "VACANT" || status === "ERROR") {
    return "danger";
  }
  if (status === "PENDING_CONFIRM" || status === "PENDING_ACTIVATION" || status === "HANDOVER") {
    return "warn";
  }
  return "neutral";
}

function parseIsoTime(value: string | number | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatOrganizationChangeTime(value: string | number | null | undefined): string {
  const timestamp = parseIsoTime(value);
  if (!timestamp) {
    return "待复核";
  }
  const delta = Date.now() - timestamp;
  if (delta < 60_000) {
    return "刚刚";
  }
  if (delta < 3_600_000) {
    return `${Math.max(1, Math.floor(delta / 60_000))} 分钟前`;
  }
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

function clampOrganizationValue(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function formatOrganizationPercent(value: number) {
  return `${Math.round(clampOrganizationValue(value, 0, 1) * 100)}%`;
}

function renderOrganizationStatusTabs(params: {
  baseHref: string;
  current: OrganizationView;
  status: OrganizationStatusFilter;
  query: string;
  team: string;
  pageSize: 10 | 20 | 50;
}) {
  const items: Array<{ value: OrganizationStatusFilter; label: string }> = [
    { value: "all", label: "全部" },
    { value: "inactive", label: "未激活" },
    { value: "normal", label: "正常" },
    { value: "vacant", label: "空岗" },
    { value: "pending", label: "待确认" },
    { value: "activation", label: "待激活" },
    { value: "handover", label: "交接中" },
  ];
  return html`
    <div class="enterprise-org-status-tabs" role="tablist" aria-label="岗位生命周期筛选">
      ${items.map((item) => {
        // 状态筛选保持在当前视图（岗位/成员/数字人/协作组）内切换，不再强制跳回岗位队列。
        const href = appendOrganizationSearchToHref(params.baseHref, {
          view: params.current,
          status: item.value,
          query: params.query,
          team: params.team,
          seatId: null,
          page: 1,
          pageSize: params.pageSize,
        });
        return html`
          <a
            role="tab"
            aria-selected=${String(params.status === item.value)}
            class="enterprise-org-status-tabs__item ${params.status === item.value ? "is-active" : ""}"
            href=${href}
            @click=${(event: MouseEvent) => {
              if (item.value !== params.status) {
                clearOrganizationActivationSeatSelection();
              }
              followPortHref(event, href);
            }}
          >
            ${item.label}
          </a>
        `;
      })}
    </div>
  `;
}

function renderOrganizationTableFilters(params: {
  baseHref: string;
  current: OrganizationView;
  seatId: string | null;
  pageSize: 10 | 20 | 50;
  query: string;
  status: OrganizationStatusFilter;
  team: string;
  teamOptions: string[];
  actions: EnterpriseSurfaceProps["actions"];
}) {
  return html`
    <div class="enterprise-org-table-card__filters">
      ${renderOrganizationStatusTabs({
        baseHref: params.baseHref,
        current: params.current,
        pageSize: params.pageSize,
        query: params.query,
        status: params.status,
        team: params.team,
      })}
      <div class="enterprise-org-table-card__filter-selects">
        <select
          class="input enterprise-org-table-card__select"
          .value=${params.team}
          @change=${(event: Event) =>
            updateOrganizationSearchParams({
              organizationTeam: (event.currentTarget as HTMLSelectElement).value,
              organizationSeat: null,
              organizationPage: 1,
            })}
        >
          <option value="all">全部团队</option>
          ${params.teamOptions.map((teamLabel) => html`<option value=${teamLabel}>${teamLabel}</option>`)}
        </select>
      </div>
    </div>
  `;
}

function renderOrganizationViewTableHeader(params: {
  title: string;
  baseHref: string;
  current: OrganizationView;
  seatId: string | null;
  pageSize: 10 | 20 | 50;
  query: string;
  status: OrganizationStatusFilter;
  team: string;
  teamOptions: string[];
  actions: EnterpriseSurfaceProps["actions"];
}) {
  return html`
    <div class="enterprise-org-table-card__header enterprise-org-table-card__header--toolbar">
      <div class="enterprise-org-table-card__title">${params.title}</div>
      <div class="enterprise-org-table-card__toolbar">
        ${renderOrganizationTableFilters({
          baseHref: params.baseHref,
          current: params.current,
          seatId: params.seatId,
          pageSize: params.pageSize,
          query: params.query,
          status: params.status,
          team: params.team,
          teamOptions: params.teamOptions,
          actions: params.actions,
        })}
      </div>
    </div>
  `;
}

function renderOrganizationWorkforceHeader(params: {
  readModel: EnterprisePortReadModel;
  showHomeLink?: boolean;
  onTitleClick?: () => void;
}) {
  return html`
    <div class="enterprise-org-workforce-header">
      ${renderEnterpriseModuleHeader({
        title: t("tabs.enterpriseOrganization"),
        onTitleClick: params.showHomeLink ? params.onTitleClick : undefined,
      })}
      ${renderOrganizationConnectionHint(params.readModel)}
    </div>
  `;
}

function renderOrganizationRowMoreControl(
  href: string,
  options?: { onClick?: (event: MouseEvent) => void; asButton?: boolean },
) {
  const className =
    "btn btn--sm btn--icon enterprise-org-row__action-icon enterprise-org-row__more";
  const icon = renderIcon("moreHorizontal", "enterprise-org-row__action-icon__glyph");
  if (options?.asButton) {
    return html`
      <button
        class=${className}
        type="button"
        aria-label="更多"
        title="更多"
        @click=${(event: MouseEvent) => {
          event.stopPropagation();
          options.onClick?.(event);
        }}
      >
        ${icon}
      </button>
    `;
  }
  return html`
    <a
      class=${className}
      href=${href}
      aria-label="更多"
      title="更多"
      @click=${(event: MouseEvent) => {
        event.stopPropagation();
        if (options?.onClick) {
          options.onClick(event);
        } else {
          followPortHref(event, href);
        }
      }}
    >
      ${icon}
    </a>
  `;
}

function renderOrganizationRiskMarker(row: OrganizationPositionRow) {
  const tone =
    row.status === "VACANT" || row.status === "ERROR"
      ? "danger"
      : row.status === "PENDING_CONFIRM" ||
          row.status === "PENDING_ACTIVATION" ||
          row.status === "HANDOVER"
        ? "warn"
        : "ok";
  const label =
    row.status === "VACANT"
      ? "空岗风险"
      : row.status === "ERROR"
        ? "运行态异常"
        : row.status === "PENDING_CONFIRM"
          ? "待确认"
          : row.status === "PENDING_ACTIVATION"
            ? "待激活"
            : row.status === "HANDOVER"
              ? "交接中"
              : "稳定";
  const glyph = tone === "danger" ? "!" : tone === "warn" ? "△" : "●";
  return html`
    <span
      class="enterprise-org-risk-marker enterprise-org-risk-marker--${tone}"
      title=${label}
      aria-label=${label}
    >
      ${glyph}
    </span>
  `;
}

function renderOrganizationAssetCell(row: OrganizationPositionRow) {
  return html`
    <div
      class="enterprise-org-assets-cell enterprise-org-assets-cell--inline"
      aria-label="岗位 AI 资产"
    >
      <span class="enterprise-org-assets-cell__item"
        >${renderIcon("puzzle")} ${row.botCount}/5</span
      >
      <span class="enterprise-org-assets-cell__item"
        >${renderIcon("users")} ${row.groupCount}/5</span
      >
    </div>
  `;
}

function renderOrganizationPersonCell(row: OrganizationPositionRow) {
  const displayLabel = row.memberDisplayLabel ?? "未绑定成员";
  const title =
    row.memberUserId && row.memberUserId !== displayLabel ? row.memberUserId : displayLabel;
  return html`
    <strong class="enterprise-org-row__truncate enterprise-org-row__person-label" title=${title}>
      ${displayLabel}
    </strong>
  `;
}

function openOrganizationPositionPrimaryAction(params: {
  row: OrganizationPositionRow;
  readModel: EnterprisePortReadModel;
  seatOfferEditor: EnterpriseSurfaceProps["seatOfferEditor"];
  handoverEditor: EnterpriseSurfaceProps["handoverEditor"];
  actions: EnterpriseSurfaceProps["actions"];
}) {
  const { row } = params;
  if (row.handover) {
    params.handoverEditor.onOpen({
      handoverCaseId: row.handover.handoverCaseId,
      seatTitle: row.handover.seatTitle,
      status: row.handover.status,
      incomingEmployeeUser: row.handover.incomingEmployeeUser,
    });
    return;
  }
  if (row.status === "PENDING_ACTIVATION" && row.pendingEmployeeUser) {
    void runOrganizationActivationEmailSend(params.actions.organization.onSendActivationEmails, [
      row.pendingEmployeeUser,
    ]);
    return;
  }
  params.seatOfferEditor.onOpen({
    mode: row.status === "PENDING_ACTIVATION" ? "activation" : undefined,
    seatId: row.seatId,
    seatTitle: row.name,
    seatStatus: row.seatStatus,
    defaultAgentId: row.defaultAgentId,
    availableAgentIds: row.agentIds,
    defaultSpaceIds: row.defaultSpaceIds,
    memoryScopeAvailable: row.memoryScopeIds.length > 0,
    employeeEmail:
      row.offer?.targetEmployeeUser ??
      row.pendingEmployeeUser ??
      row.memberUserId ??
      row.memberLabel,
  });
}

function renderOrganizationPositionTable(params: {
  rows: OrganizationPositionRow[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
  pageSize: 10 | 20 | 50;
  readModel: EnterprisePortReadModel;
  baseHref: string;
  view: OrganizationView;
  status: OrganizationStatusFilter;
  query: string;
  team: string;
  teamOptions: string[];
  selectedSeatId: string | null;
  seatOfferEditor: EnterpriseSurfaceProps["seatOfferEditor"];
  handoverEditor: EnterpriseSurfaceProps["handoverEditor"];
  createPositionEditor: NonNullable<EnterpriseSurfaceProps["createPositionEditor"]>;
  actions: EnterpriseSurfaceProps["actions"];
  riskSort: OrganizationRiskSort | null;
}) {
  const riskSortLabel =
    params.riskSort === "desc"
      ? "风险：高到低"
      : params.riskSort === "asc"
        ? "风险：低到高"
        : "按风险排序";
  const selectedCount = organizationActivationSelectedSeatIds.size;
  const pageSelectableIds = params.rows
    .filter((row) => isOrganizationSeatBulkSelectable(row))
    .map((row) => row.seatId);
  const allPageSelected =
    pageSelectableIds.length > 0 &&
    pageSelectableIds.every((seatId) => organizationActivationSelectedSeatIds.has(seatId));
  const partitionedSelection = partitionOrganizationActivationSelection({
    rows: params.rows,
    selectedSeatIds: organizationActivationSelectedSeatIds,
  });
  const deletionSelection = partitionOrganizationSeatDeletionSelection({
    rows: params.rows,
    selectedSeatIds: organizationActivationSelectedSeatIds,
  });
  return html`
    <section class="enterprise-org-table-card">
      <div class="enterprise-org-table-card__header enterprise-org-table-card__header--toolbar">
        <div>
          <div class="enterprise-org-table-card__title">岗位数字人治理队列</div>
          <div class="enterprise-org-table-card__hint">
            岗位数字人随岗位自动生成，不能单独新建。
          </div>
        </div>
        <div class="enterprise-org-table-card__toolbar">
          ${renderOrganizationTableFilters({
            baseHref: params.baseHref,
            current: params.view,
            seatId: params.selectedSeatId,
            pageSize: params.pageSize,
            query: params.query,
            status: params.status,
            team: params.team,
            teamOptions: params.teamOptions,
            actions: params.actions,
          })}
          <div class="enterprise-org-table-card__actions">
            <button
              class="btn"
              type="button"
              @click=${() => params.actions.organization.onRefreshUsers()}
            >
              ${renderIcon("refreshCw")}刷新
            </button>
          </div>
        </div>
      </div>
      ${renderOrganizationBulkSelectionBar({
        selectedCount,
        deletableCount: deletionSelection.deletable.length,
        activationEmailCount: partitionedSelection.emailsToSend.length,
        seatsNeedingEmailCount: partitionedSelection.seatsNeedingEmail.length,
        showActivationActions: true,
        feedback: organizationBulkDeleteFeedback,
        onSendActivation: () => {
          if (!params.seatOfferEditor) {
            return;
          }
          runOrganizationBulkActivationSend({
            rows: params.rows,
            actions: params.actions,
            seatOfferEditor: params.seatOfferEditor,
          });
        },
        onDeleteVacant: () => {
          void runOrganizationBulkSeatDeletion({
            rows: params.rows,
            actions: params.actions,
            tenantId: params.readModel.currentTenantId,
          });
        },
        onClear: () => clearOrganizationActivationSeatSelection(),
      })}
      <div
        class="enterprise-org-table-scroll enterprise-org-table-scroll--position"
        tabindex="0"
        aria-label="岗位列表横向滚动区域"
      >
        <div class="enterprise-org-table-head">
          <button
            type="button"
            class="enterprise-org-table-head__cell enterprise-org-table-head__cell--risk enterprise-org-table-head__sort ${params.riskSort ? "is-active" : ""}"
            aria-label=${riskSortLabel}
            title=${riskSortLabel}
            @click=${(event: MouseEvent) => {
              event.stopPropagation();
              updateOrganizationSearchParams({
                organizationRiskSort: cycleOrganizationRiskSort(params.riskSort),
                organizationPage: 1,
              });
            }}
          >
            <input
              type="checkbox"
              aria-label="全选本页未激活岗位"
              .checked=${allPageSelected}
              ?disabled=${pageSelectableIds.length === 0}
              @click=${(event: MouseEvent) => event.stopPropagation()}
              @change=${(event: Event) => {
                event.stopPropagation();
                const checked = (event.currentTarget as HTMLInputElement).checked;
                setOrganizationActivationSeatSelection(checked ? pageSelectableIds : []);
              }}
            />
            <span>风险</span>
            ${
              params.riskSort === "desc"
                ? html`
                    <span class="enterprise-org-table-head__sort-indicator" aria-hidden="true">↓</span>
                  `
                : params.riskSort === "asc"
                  ? html`
                      <span class="enterprise-org-table-head__sort-indicator" aria-hidden="true">↑</span>
                    `
                  : nothing
            }
          </button>
          <div class="enterprise-org-table-head__cell">岗位</div>
          <div class="enterprise-org-table-head__cell">所属团队</div>
          <div class="enterprise-org-table-head__cell">负责人</div>
          <div class="enterprise-org-table-head__cell enterprise-org-table-head__cell--assets">
            AI资产
          </div>
          <div class="enterprise-org-table-head__cell enterprise-org-table-head__cell--lifecycle">
            办理状态
          </div>
          <div class="enterprise-org-table-head__cell">本月消耗</div>
          <div class="enterprise-org-table-head__cell">最近活动</div>
          <div class="enterprise-org-table-head__cell enterprise-org-table-head__cell--actions">
            操作
          </div>
        </div>
        <div class="enterprise-org-table-body">
          ${
            params.rows.length === 0
              ? html`
                  <div class="enterprise-empty">当前没有符合筛选条件的岗位。</div>
                `
              : params.rows.map((row) => {
                  const href = appendOrganizationSearchToHref(params.baseHref, {
                    view: params.view,
                    status: params.status,
                    seatId: row.seatId,
                    query: params.query,
                    team: params.team,
                    page: params.currentPage,
                    pageSize: params.pageSize,
                    riskSort: params.riskSort,
                  });
                  const selectable = isOrganizationSeatBulkSelectable(row);
                  const selected = organizationActivationSelectedSeatIds.has(row.seatId);
                  return html`
                    <div
                      class="enterprise-org-row ${params.selectedSeatId === row.seatId ? "is-active" : ""} enterprise-org-row--${row.status.toLowerCase()}"
                      role="button"
                      tabindex="0"
                      @click=${() => {
                        openOrganizationSeatDetailFromGovernance({
                          seatId: row.seatId,
                          teamLabel: row.teamLabel,
                        });
                      }}
                    >
                      <div
                        class="enterprise-org-row__risk"
                        @click=${(event: MouseEvent) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          aria-label=${`选择岗位 ${row.displayName}`}
                          .checked=${selected}
                          ?disabled=${!selectable}
                          @click=${(event: MouseEvent) => event.stopPropagation()}
                          @change=${(event: Event) => {
                            event.stopPropagation();
                            toggleOrganizationActivationSeatSelection(row.seatId);
                          }}
                        />
                        ${renderOrganizationRiskMarker(row)}
                      </div>
                      <div class="enterprise-org-row__name">
                        <div class="enterprise-org-row__stack">
                          <strong class="enterprise-org-row__truncate" title=${row.displayName}
                            >${row.displayName}</strong
                          >
                          <span
                            class="enterprise-org-row__truncate mono enterprise-org-row__identity-inline"
                            title=${row.aiEmployeeLabel}
                          >
                            ${row.aiEmployeeLabel}
                          </span>
                        </div>
                      </div>
                      <div class="enterprise-org-row__cell">
                        <strong class="enterprise-org-row__truncate" title=${row.teamLabel}
                          >${row.teamLabel}</strong
                        >
                      </div>
                      <div class="enterprise-org-row__cell">
                        ${renderOrganizationPersonCell(row)}
                      </div>
                      <div class="enterprise-org-row__cell">
                        ${renderOrganizationAssetCell(row)}
                      </div>
                      <div class="enterprise-org-row__cell">
                        ${renderOrganizationStatusTag(row.status)}
                      </div>
                      ${renderOrganizationMonthlyUsageCell({
                        display: row.usageDisplay,
                        totalCost: row.totalCost,
                        totalTokens: row.totalTokens,
                        errorMessage: row.usageErrorMessage,
                        unmatchedAgentIds: row.unmatchedAgentIds,
                      })}
                      <div class="enterprise-org-row__cell enterprise-org-row__cell--status">
                        <span>${row.activityLabel}</span>
                      </div>
                      <div class="enterprise-org-row__actions">
                        ${
                          row.handover
                            ? renderOrganizationRowIconButton({
                                label: organizationPrimaryActionLabel(row),
                                icon: organizationPrimaryActionIcon(row),
                                primary: true,
                                onClick: () => {
                                  params.handoverEditor.onOpen({
                                    handoverCaseId: row.handover!.handoverCaseId,
                                    seatTitle: row.handover!.seatTitle,
                                    status: row.handover!.status,
                                    incomingEmployeeUser: row.handover!.incomingEmployeeUser,
                                  });
                                },
                              })
                            : row.status === "VACANT" ||
                                row.status === "PENDING_CONFIRM" ||
                                row.status === "PENDING_ACTIVATION" ||
                                row.status === "ERROR"
                              ? renderOrganizationRowIconButton({
                                  label: organizationPrimaryActionLabel(row),
                                  icon: organizationPrimaryActionIcon(row),
                                  primary: true,
                                  onClick: () => {
                                    openOrganizationPositionPrimaryAction({
                                      row,
                                      readModel: params.readModel,
                                      seatOfferEditor: params.seatOfferEditor,
                                      handoverEditor: params.handoverEditor,
                                      actions: params.actions,
                                    });
                                  },
                                })
                              : renderOrganizationRowIconButton({
                                  label: organizationPrimaryActionLabel(row),
                                  icon: organizationPrimaryActionIcon(row),
                                  onClick: () => {
                                    if (!params.readModel.currentTenantId) {
                                      return;
                                    }
                                    if (!shouldProceed(`确认对岗位 ${row.name} 发起交接吗？`)) {
                                      return;
                                    }
                                    void params.actions.organization.onStartSeatHandover(
                                      params.readModel.currentTenantId,
                                      row.seatId,
                                    );
                                  },
                                })
                        }
                        ${
                          row.offer
                            ? renderOrganizationRowIconButton({
                                label: "提醒",
                                icon: "bell",
                                onClick: () => {
                                  const offer = row.offer;
                                  if (!params.readModel.currentTenantId || !offer) {
                                    return;
                                  }
                                  if (
                                    !shouldProceed(
                                      `确认向 ${offer.targetEmployeeUser} 发送岗位绑定提醒邮件吗？`,
                                    )
                                  ) {
                                    return;
                                  }
                                  void params.actions.organization.onRemindSeatOffer(
                                    params.readModel.currentTenantId,
                                    offer.offerId,
                                    offer.targetEmployeeUser,
                                  );
                                },
                              })
                            : nothing
                        }
                        ${renderOrganizationRowMoreControl(href)}
                      </div>
                    </div>
                  `;
                })
          }
        </div>
      </div>
      ${renderOrganizationTableFooter({
        totalCount: params.totalCount,
        currentPage: params.currentPage,
        totalPages: params.totalPages,
        pageSize: params.pageSize,
        baseHref: params.baseHref,
        view: params.view,
        status: params.status,
        query: params.query,
        team: params.team,
        riskSort: params.riskSort,
      })}
    </section>
  `;
}

function renderOrganizationMemberTable(params: {
  rows: OrganizationMemberRow[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
  pageSize: 10 | 20 | 50;
  baseHref: string;
  view: OrganizationView;
  status: OrganizationStatusFilter;
  query: string;
  team: string;
  teamOptions: string[];
  readModel: EnterprisePortReadModel;
  createPositionEditor: NonNullable<EnterpriseSurfaceProps["createPositionEditor"]>;
  actions: EnterpriseSurfaceProps["actions"];
  /** Arrived from 系统设置 →「邀请管理员」: highlight the invite action. */
  adminInvitePick?: boolean;
  feedback?: { busy: boolean; notice: string | null; error: string | null };
}) {
  const feedback = params.feedback;
  return html`
    <section class="enterprise-org-table-card">
      ${
        params.adminInvitePick
          ? html`
              <div
                class="callout info enterprise-org-admin-invite-hint enterprise-org-feedback-callout"
                data-testid="organization-admin-invite-hint"
              >
                <strong>邀请管理员：</strong>请在下方员工名录中选择员工，点击「邀请为管理员」发送管理员邀请邮件。
                对方使用原员工账号和密码从企业端登录即可接受；接受后同一账号拥有双重身份——企业端登录为管理员，员工端登录仍为员工，密码无需修改。
              </div>
            `
          : nothing
      }
      ${
        feedback?.notice
          ? html`<div class="callout success enterprise-org-feedback-callout" data-testid="organization-admin-invite-notice">${feedback.notice}</div>`
          : nothing
      }
      ${
        feedback?.error
          ? html`<div class="callout danger enterprise-org-feedback-callout" data-testid="organization-admin-invite-error">${feedback.error}</div>`
          : nothing
      }
      ${renderOrganizationViewTableHeader({
        title: `成员视图（共 ${params.totalCount} 个）`,
        baseHref: params.baseHref,
        current: params.view,
        seatId: null,
        pageSize: params.pageSize,
        query: params.query,
        status: params.status,
        team: params.team,
        teamOptions: params.teamOptions,
        actions: params.actions,
      })}
      <div
        class="enterprise-org-table-scroll enterprise-org-table-scroll--member"
        tabindex="0"
        aria-label="成员列表横向滚动区域"
      >
        <div class="enterprise-org-table-head enterprise-org-table-head--member">
          <div>成员</div>
          <div>岗位</div>
          <div>岗位数字人</div>
          <div>权限</div>
          <div>交接状态</div>
          <div>操作</div>
        </div>
        <div class="enterprise-org-table-body">
          ${
            params.rows.length === 0
              ? html`
                  <div class="enterprise-empty">当前没有符合筛选条件的成员。</div>
                `
              : params.rows.map((row) => {
                  return html`
                    <div class="enterprise-org-row enterprise-org-row--member">
                      <div class="enterprise-org-row__name">
                        <div class="enterprise-org-row__entity">
                          <span
                            class="enterprise-org-row__avatar enterprise-org-row__avatar--member"
                          >
                            ${initialsForLabel(row.displayLabel, "员")}
                          </span>
                          <div class="enterprise-org-row__stack">
                            <strong>${row.displayLabel}</strong>
                            <span>${row.user}</span>
                          </div>
                        </div>
                        <span>${row.status === "active" ? "当前可用" : "待处理"}</span>
                      </div>
                      <div class="enterprise-org-row__cell">
                        <div class="enterprise-org-row__stack">
                          <strong>${row.seatTitle ?? "未绑定岗位"}</strong>
                          <span>${row.teamLabel ?? "未分组"}</span>
                        </div>
                      </div>
                      <div class="enterprise-org-row__cell">
                        <div class="enterprise-org-row__stack">
                          <strong>${row.aiEmployeeLabel ?? "待绑定数字人"}</strong>
                          <span>${row.seatTitle ? "岗位继承" : "无岗位权限"}</span>
                        </div>
                      </div>
                      <div class="enterprise-org-row__cell">
                        <div class="enterprise-org-row__stack">
                          ${
                            row.membershipRoles.includes("enterprise-admin") &&
                            row.membershipRoles.includes("member")
                              ? renderMeshBadge("管理员 · 员工（双重身份）", "warn")
                              : renderMeshBadge(
                                  formatEnterpriseRoleLabel(row.membershipRole),
                                  organizationRoleTone(row.membershipRole),
                                )
                          }
                          ${
                            row.adminInvitePendingExpiresAt
                              ? html`<span data-testid="organization-admin-invite-pending"
                                  >管理员邀请待接受${
                                    formatOrganizationInviteExpiry(row.adminInvitePendingExpiresAt)
                                      ? `（${formatOrganizationInviteExpiry(row.adminInvitePendingExpiresAt)} 前有效）`
                                      : ""
                                  }</span
                                >`
                              : nothing
                          }
                        </div>
                      </div>
                      <div class="enterprise-org-row__cell">
                        ${
                          row.seatStatus
                            ? renderMeshBadge(
                                row.handoverLabel,
                                organizationActivityTone(row.seatStatus),
                              )
                            : renderMeshBadge(
                                formatEnterpriseStatusLabel(row.status),
                                row.status === "active" ? "ok" : "warn",
                              )
                        }
                      </div>
                      <div class="enterprise-org-row__actions">
                        ${
                          row.seatId
                            ? html`
                                <button
                                  class="btn btn--sm"
                                  type="button"
                                  @click=${() =>
                                    openOrganizationSeatDetailFromGovernance({
                                      seatId: row.seatId!,
                                      teamLabel: row.teamLabel,
                                    })}
                                >
                                  查看岗位
                                </button>
                              `
                            : nothing
                        }
                        ${
                          canInviteOrganizationMemberAsAdmin(row)
                            ? html`
                                <button
                                  class="btn btn--sm${params.adminInvitePick ? " btn--primary" : ""}"
                                  type="button"
                                  data-testid="organization-invite-admin"
                                  ?disabled=${feedback?.busy ?? false}
                                  @click=${() => {
                                    const resend = Boolean(row.adminInvitePendingExpiresAt);
                                    if (
                                      !shouldProceed(
                                        resend
                                          ? `确认向 ${row.displayLabel}（${row.user}）重新发送管理员邀请邮件吗？旧邀请链接将失效。`
                                          : `确认向 ${row.displayLabel}（${row.user}）发送管理员邀请邮件吗？对方接受后将同时拥有员工与企业管理员身份，登录密码保持不变。`,
                                      )
                                    ) {
                                      return;
                                    }
                                    void params.actions.organization.onInviteEnterpriseAdmin(
                                      row.user,
                                      resend ? { resend: true } : undefined,
                                    );
                                  }}
                                >
                                  ${row.adminInvitePendingExpiresAt ? "重发管理员邀请" : "邀请为管理员"}
                                </button>
                              `
                            : nothing
                        }
                        ${
                          row.membershipRole !== "enterprise-admin" && row.status === "active"
                            ? html`
                                <button
                                  class="btn btn--sm btn--danger"
                                  type="button"
                                  @click=${() => {
                                    if (
                                      !shouldProceed(
                                        `确认让 ${row.displayLabel} 离职解绑并进入岗位交接吗？`,
                                      )
                                    ) {
                                      return;
                                    }
                                    void params.actions.organization.onOffboardMember(row.user);
                                  }}
                                >
                                  离职解绑
                                </button>
                              `
                            : nothing
                        }
                      </div>
                    </div>
                  `;
                })
          }
        </div>
      </div>
      ${renderOrganizationTableFooter({
        totalCount: params.totalCount,
        currentPage: params.currentPage,
        totalPages: params.totalPages,
        pageSize: params.pageSize,
        baseHref: params.baseHref,
        view: params.view,
        status: params.status,
        query: params.query,
        team: params.team,
      })}
    </section>
  `;
}

function renderOrganizationAiEmployeeTable(params: {
  rows: OrganizationAiEmployeeRow[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
  pageSize: 10 | 20 | 50;
  baseHref: string;
  view: OrganizationView;
  status: OrganizationStatusFilter;
  query: string;
  team: string;
  teamOptions: string[];
  actions: EnterpriseSurfaceProps["actions"];
}) {
  return html`
    <section class="enterprise-org-table-card">
      ${renderOrganizationViewTableHeader({
        title: `数字人视图（共 ${params.totalCount} 个）`,
        baseHref: params.baseHref,
        current: params.view,
        seatId: null,
        pageSize: params.pageSize,
        query: params.query,
        status: params.status,
        team: params.team,
        teamOptions: params.teamOptions,
        actions: params.actions,
      })}
      <div
        class="enterprise-org-table-scroll enterprise-org-table-scroll--ai"
        tabindex="0"
        aria-label="数字人列表横向滚动区域"
      >
        <div class="enterprise-org-table-head">
          <div>岗位数字人</div>
          <div>所属岗位</div>
          <div>运行态</div>
          <div>Bot数量</div>
          <div>协作组</div>
          <div>Token成本</div>
          <div>健康度</div>
          <div>操作</div>
        </div>
        <div class="enterprise-org-table-body">
          ${
            params.rows.length === 0
              ? html`
                  <div class="enterprise-empty">当前没有符合筛选条件的数字人。</div>
                `
              : params.rows.map((row) => {
                  return html`
                    <div class="enterprise-org-row enterprise-org-row--${row.status.toLowerCase()}">
                      <div class="enterprise-org-row__name">
                        <div class="enterprise-org-row__entity">
                          <span
                            class="enterprise-org-row__avatar enterprise-org-row__avatar--agent"
                          >
                            ${initialsForLabel(row.name, "AI")}
                          </span>
                          <div class="enterprise-org-row__stack">
                            <strong>${row.name}</strong>
                            <span>${row.activityLabel}</span>
                          </div>
                        </div>
                      </div>
                      <div class="enterprise-org-row__cell">
                        <div class="enterprise-org-row__stack">
                          <strong>${row.positionLabel}</strong>
                          <span>${row.seatId ? "岗位数字化身" : "待归属"}</span>
                        </div>
                      </div>
                      <div class="enterprise-org-row__cell enterprise-org-row__cell--status">
                        ${renderMeshBadge(formatEnterpriseRuntimeLabel(row.runtimeLabel), row.runtimeTone)}
                      </div>
                      <div class="enterprise-org-row__cell">
                        <strong>${row.botCount}</strong>
                        <span>工具</span>
                      </div>
                      <div class="enterprise-org-row__cell">
                        <strong>${row.groupCount}</strong>
                        <span>协作</span>
                      </div>
                      <div class="enterprise-org-row__cell">
                        <strong>${row.totalCost == null ? "--" : formatCost(row.totalCost)}</strong>
                        <span
                          >${row.usageDisplay === "ready" || row.usageDisplay === "unmatched" ? "本月" : "暂无数据"}</span
                        >
                      </div>
                      <div class="enterprise-org-row__cell">
                        ${renderMeshBadge(row.healthLabel, organizationActivityTone(row.status))}
                      </div>
                      <div class="enterprise-org-row__actions">
                        ${
                          row.seatId
                            ? html`
                                <button
                                  class="btn btn--sm"
                                  type="button"
                                  @click=${() =>
                                    openOrganizationSeatDetailFromGovernance({
                                      seatId: row.seatId!,
                                      teamLabel: row.teamLabel,
                                    })}
                                >
                                  查看岗位
                                </button>
                              `
                            : nothing
                        }
                      </div>
                    </div>
                  `;
                })
          }
        </div>
      </div>
      ${renderOrganizationTableFooter({
        totalCount: params.totalCount,
        currentPage: params.currentPage,
        totalPages: params.totalPages,
        pageSize: params.pageSize,
        baseHref: params.baseHref,
        view: params.view,
        status: params.status,
        query: params.query,
        team: params.team,
      })}
    </section>
  `;
}

function renderOrganizationGroupTable(params: {
  rows: OrganizationGroupRow[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
  pageSize: 10 | 20 | 50;
  baseHref: string;
  basePath: string;
  view: OrganizationView;
  status: OrganizationStatusFilter;
  query: string;
  team: string;
  teamOptions: string[];
  readModel: EnterprisePortReadModel;
  ownershipTransferEditor: EnterpriseSurfaceProps["ownershipTransferEditor"];
  actions: EnterpriseSurfaceProps["actions"];
}) {
  const meshHref = pathForTab("enterpriseMesh", params.basePath, {
    tenantId: params.readModel.currentTenantId,
  });
  return html`
    <section class="enterprise-org-table-card">
      ${renderOrganizationViewTableHeader({
        title: `协作组视图（共 ${params.totalCount} 个）`,
        baseHref: params.baseHref,
        current: params.view,
        seatId: null,
        pageSize: params.pageSize,
        query: params.query,
        status: params.status,
        team: params.team,
        teamOptions: params.teamOptions,
        actions: params.actions,
      })}
      <div
        class="enterprise-org-table-scroll enterprise-org-table-scroll--group"
        tabindex="0"
        aria-label="协作组列表横向滚动区域"
      >
        <div class="enterprise-org-table-head">
          <div>协作组</div>
          <div>成员岗位</div>
          <div>岗位数字人</div>
          <div>运行态</div>
          <div>协同次数</div>
          <div>成本</div>
          <div>状态</div>
          <div>操作</div>
        </div>
        <div class="enterprise-org-table-body">
          ${
            params.rows.length === 0
              ? html`
                  <div class="enterprise-empty">当前没有符合筛选条件的协作组。</div>
                `
              : params.rows.map(
                  (row) => html`
                    <div class="enterprise-org-row enterprise-org-row--${row.status.toLowerCase()}">
                      <div class="enterprise-org-row__name">
                        <div class="enterprise-org-row__entity">
                          <span
                            class="enterprise-org-row__avatar enterprise-org-row__avatar--agent"
                          >
                            ${initialsForLabel(row.name, "组")}
                          </span>
                          <div class="enterprise-org-row__stack">
                            <strong>${row.name}</strong>
                            <span>${row.activityLabel}</span>
                          </div>
                        </div>
                      </div>
                      <div class="enterprise-org-row__cell">
                        <strong>${row.positionLabel}</strong>
                        <span>成员岗位</span>
                      </div>
                      <div class="enterprise-org-row__cell">
                        <strong>${row.aiEmployeeLabel}</strong>
                        <span>数字人成员</span>
                      </div>
                      <div class="enterprise-org-row__cell enterprise-org-row__cell--status">
                        ${renderMeshBadge(formatEnterpriseRuntimeLabel(row.runtimeLabel), row.runtimeTone)}
                      </div>
                      <div class="enterprise-org-row__cell">
                        <strong>${row.sessionCount}</strong>
                        <span>会话</span>
                      </div>
                      <div class="enterprise-org-row__cell">
                        <strong>${formatCost(row.totalCost)}</strong>
                        <span>本月</span>
                      </div>
                      <div class="enterprise-org-row__cell enterprise-org-row__cell--status">
                        ${renderOrganizationStatusTag(row.status)}
                      </div>
                      <div class="enterprise-org-row__actions">
                        ${
                          row.seatId
                            ? html`
                                <button
                                  class="btn btn--sm"
                                  type="button"
                                  @click=${() =>
                                    openOrganizationSeatDetailFromGovernance({
                                      seatId: row.seatId!,
                                      teamLabel: row.teamLabel,
                                    })}
                                >
                                  查看岗位
                                </button>
                              `
                            : nothing
                        }
                        <a
                          class="btn btn--sm"
                          href=${meshHref}
                          @click=${(event: MouseEvent) => followPortHref(event, meshHref)}
                        >
                          查看协作
                        </a>
                        ${
                          params.readModel.currentTenantId
                            ? html`
                                <button
                                  class="btn btn--sm"
                                  type="button"
                                  @click=${() => {
                                    if (!shouldProceed(`确认解绑协作组 ${row.name} 当前归属吗？`)) {
                                      return;
                                    }
                                    void params.actions.organization.onRevokeOwnership(
                                      params.readModel.currentTenantId!,
                                      "group",
                                      row.groupId,
                                      row.currentManagerUserId,
                                      row.currentManagerLabel,
                                      "organization group table manual revoke",
                                    );
                                  }}
                                >
                                  解绑小组归属
                                </button>
                                <button
                                  class="btn btn--sm btn--primary enterprise-org-row__action-primary"
                                  type="button"
                                  ?disabled=${!params.readModel.memberSummaries.some(
                                    (entry) =>
                                      entry.user !== row.currentManagerUserId && entry.seatTitle,
                                  )}
                                  @click=${() => {
                                    const nextOwner = params.readModel.memberSummaries.find(
                                      (entry) =>
                                        entry.user !== row.currentManagerUserId && entry.seatTitle,
                                    );
                                    params.ownershipTransferEditor.onOpen({
                                      tenantId: params.readModel.currentTenantId!,
                                      subjectKind: "group",
                                      subjectId: row.groupId,
                                      subjectLabel: row.name,
                                      positionId: row.positionId,
                                      positionLabel: row.positionLabel,
                                      currentManagerUserId: row.currentManagerUserId,
                                      currentManagerLabel: row.currentManagerLabel,
                                      suggestedUserId: nextOwner?.user ?? null,
                                    });
                                  }}
                                >
                                  转移小组归属
                                </button>
                              `
                            : nothing
                        }
                      </div>
                    </div>
                  `,
                )
          }
        </div>
      </div>
      ${renderOrganizationTableFooter({
        totalCount: params.totalCount,
        currentPage: params.currentPage,
        totalPages: params.totalPages,
        pageSize: params.pageSize,
        baseHref: params.baseHref,
        view: params.view,
        status: params.status,
        query: params.query,
        team: params.team,
      })}
    </section>
  `;
}

function focusOrganizationTreeNode(params: {
  teamPath?: string | null;
  seatId?: string | null;
  memberUser?: string | null;
}) {
  organizationTreeFocus = params;
  queueMicrotask(() => {
    scrollEnterpriseOrgTreeToFocus({
      teamLabel: params.teamPath,
      seatId: params.seatId,
      memberUser: params.memberUser,
    });
  });
}

function renderOrganizationSearchMatches(params: {
  readModel: EnterprisePortReadModel;
  query: string;
}) {
  const orgTreeQuery = resolveEnterpriseOrgTreeSearchQuery({
    input: params.query,
    readModel: params.readModel,
  });
  if (!orgTreeQuery) {
    return nothing;
  }
  const matches = searchEnterpriseOrgDirectory({
    readModel: params.readModel,
    query: orgTreeQuery,
  });
  if (!matches.length) {
    return html`
      <section class="enterprise-org-search-results card">
        <div class="enterprise-org-search-results__title">检索结果</div>
        <div class="enterprise-empty enterprise-empty--compact">未找到匹配的组织节点。</div>
      </section>
    `;
  }
  return html`
    <section class="enterprise-org-search-results card">
      <div class="enterprise-org-search-results__title">检索结果</div>
      <div class="enterprise-org-search-results__list">
        ${matches.map(
          (match) => html`
            <button
              class="enterprise-org-search-results__item"
              type="button"
              @click=${() => {
                focusOrganizationTreeNode({
                  teamPath: match.seatId ? match.teamLabel : match.teamLabel,
                  seatId: match.seatId,
                  memberUser: match.memberUser,
                });
                const onGovernanceHome =
                  resolveOrganizationSurface(window.location.search) !== "structure";
                updateOrganizationSearchParams({
                  organizationSurface: "structure",
                  organizationView: match.seatId ? "position" : null,
                  organizationTeam: match.teamLabel,
                  organizationSeat: match.seatId,
                  organizationPage: 1,
                  organizationFrom: onGovernanceHome && match.seatId ? "governance" : null,
                });
              }}
            >
              <span class="enterprise-org-search-results__label">${match.label}</span>
              <span class="enterprise-org-search-results__breadcrumb">${match.breadcrumb}</span>
              <span class="enterprise-org-search-results__meta">${match.secondary}</span>
            </button>
          `,
        )}
      </div>
    </section>
  `;
}

function renderOrganizationDirectoryTree(params: {
  readModel: EnterprisePortReadModel;
  team: string;
  selectedSeatId: string | null;
  query: string;
  positionRows?: OrganizationPositionRow[];
  actions: EnterpriseSurfaceProps["actions"];
  busy?: boolean;
  createPositionEditor?: NonNullable<EnterpriseSurfaceProps["createPositionEditor"]>;
  seatOfferEditor?: NonNullable<EnterpriseSurfaceProps["seatOfferEditor"]>;
  onCreatePosition?: (teamPath: string) => void;
  onBindMember?: (seatId: string, teamPath: string, mode?: "offer" | "activation") => void;
}) {
  const orgTreeQuery = resolveEnterpriseOrgTreeSearchQuery({
    input: params.query,
    readModel: params.readModel,
  });
  const departments = filterEnterpriseOrgDepartmentsByScope(
    buildEnterpriseOrgTree({
      readModel: params.readModel,
      query: orgTreeQuery || undefined,
      includeVacantPositions: true,
    }),
    resolveOrganizationDepartmentScope(params.readModel),
  );
  const departmentScope = resolveOrganizationDepartmentScope(params.readModel);
  const tenantId = params.readModel.currentTenantId;
  const structureEditable =
    !organizationScopeBlocksDepartmentManagement(departmentScope) && !params.busy;
  const selectedMemberEmail = params.selectedSeatId
    ? (params.readModel.memberSummaries.find(
        (member) =>
          member.seatTitle &&
          params.readModel.seatSummaries.find((seat) => seat.seatId === params.selectedSeatId)
            ?.title === member.seatTitle,
      )?.user ?? null)
    : null;
  const positionRowById = new Map((params.positionRows ?? []).map((row) => [row.seatId, row]));

  return renderEnterpriseOrgTree({
    departments,
    mode: "navigate",
    hint: departmentScope ? `当前可见范围：${departmentScope}` : undefined,
    showAllNode: !departmentScope,
    editable: structureEditable,
    disabled: params.busy,
    activeTeam: params.team,
    selectedSeatId: params.selectedSeatId,
    selectedMemberEmail,
    checkedSeatIds: organizationActivationSelectedSeatIds,
    onToggleSeatCheck: (seatId) => toggleOrganizationActivationSeatSelection(seatId),
    isSeatCheckable: (position) => {
      const row = positionRowById.get(position.seatId);
      if (row) {
        return isOrganizationSeatDeletable(row);
      }
      return position.seatStatus === "vacant" && !position.member;
    },
    focusTeamPath: organizationTreeFocus?.teamPath ?? null,
    focusSeatId: organizationTreeFocus?.seatId ?? null,
    query: orgTreeQuery,
    emptyLabel: "暂无组织岗位数据。",
    onCreateChildDepartment: (parentPath) =>
      void createOrganizationDepartmentInline({
        tenantId,
        actions: params.actions,
        readModel: params.readModel,
        parentPath,
      }),
    ...(structureEditable && params.createPositionEditor
      ? {
          onCreatePosition: (teamPath: string) =>
            openOrganizationStructureCreatePosition(
              params.createPositionEditor!,
              teamPath,
              params.seatOfferEditor,
            ),
        }
      : params.onCreatePosition
        ? { onCreatePosition: params.onCreatePosition }
        : {}),
    ...(structureEditable && params.onBindMember ? { onBindMember: params.onBindMember } : {}),
    onRenameDepartment: (path) => openOrganizationDepartmentEditor({ mode: "rename", path }),
    onDeleteDepartment: (path) => openOrganizationDepartmentEditor({ mode: "delete", path }),
    ...(structureEditable
      ? {
          inlineEdit: organizationTreeInlineEdit,
          onInlineEditDraftChange: (value: string) => {
            if (!organizationTreeInlineEdit) {
              return;
            }
            organizationTreeInlineEdit = { ...organizationTreeInlineEdit, draft: value };
            requestEnterpriseAppRerender();
          },
          onInlineEditCommit: () => {
            void commitOrganizationTreeInlineEdit({
              tenantId,
              actions: params.actions,
            });
          },
          onInlineEditCancel: cancelOrganizationTreeInlineEdit,
          onStartInlineEditDepartment: startOrganizationTreeInlineEditDepartment,
          onStartInlineEditPosition: startOrganizationTreeInlineEditPosition,
        }
      : {}),
    onMoveSeatToTeam: (seatId, targetPath) => {
      void moveOrganizationSeatToTeam({
        tenantId,
        actions: params.actions,
        seatId,
        targetPath,
      });
    },
    onMoveDepartmentToParent: (path, parentPath) => {
      void moveOrganizationDepartmentToParent({
        tenantId,
        actions: params.actions,
        path,
        parentPath,
      });
    },
    onMergeDepartmentToTarget: (sourcePath, targetPath) => {
      void mergeOrganizationDepartmentToTarget({
        tenantId,
        actions: params.actions,
        sourcePath,
        targetPath,
      });
    },
    onReorderChildren: (parentPath, orderedKeys) => {
      void reorderOrganizationChildren({
        tenantId,
        actions: params.actions,
        parentPath,
        orderedKeys,
      });
    },
    resolveChildOrderKeys: (parentPath) =>
      buildDirectChildOrderKeysFromReadModel(parentPath, {
        organizationDepartmentPaths: params.readModel.organizationDepartmentPaths,
        seatSummaries: params.readModel.seatSummaries,
      }),
    onSelectAll: () => {
      dismissOrganizationStructureTreeNavigation({
        seatOfferEditor: params.seatOfferEditor,
        createPositionEditor: params.createPositionEditor,
      });
      organizationTreeFocus = null;
      updateOrganizationSearchParams({
        organizationTeam: "all",
        organizationSeat: null,
        organizationPage: 1,
        organizationFrom: null,
      });
    },
    onSelectTeam: (teamLabel) => {
      dismissOrganizationStructureTreeNavigation({
        seatOfferEditor: params.seatOfferEditor,
        createPositionEditor: params.createPositionEditor,
      });
      organizationTreeFocus = { teamPath: teamLabel };
      updateOrganizationSearchParams({
        organizationTeam: teamLabel,
        organizationSeat: null,
        organizationPage: 1,
        organizationFrom: null,
      });
    },
    onSelectPosition: (seatId, teamLabel) => {
      dismissOrganizationStructureTreeNavigation({
        seatOfferEditor: params.seatOfferEditor,
        createPositionEditor: params.createPositionEditor,
      });
      organizationTreeFocus = { teamPath: teamLabel, seatId };
      updateOrganizationSearchParams({
        organizationView: "position",
        organizationTeam: teamLabel,
        organizationSeat: seatId,
        organizationPage: 1,
        organizationFrom: null,
      });
      queueMicrotask(() => scrollEnterpriseOrgTreeToFocus({ teamLabel, seatId }));
    },
  });
}

export function renderOrganizationControl(props: EnterpriseSurfaceProps) {
  const { readModel, actions, basePath } = props;
  const monthlyUsageLoadState = readOrganizationMonthlyUsageLoadState({
    enterpriseOrganizationMonthlyUsageLoading: props.organizationMonthlyUsageLoading === true,
    enterpriseOrganizationMonthlyUsageError: props.organizationMonthlyUsageError ?? null,
    enterpriseOrganizationMonthlyUsage: props.organizationMonthlyUsage
      ? {
          ...props.organizationMonthlyUsage,
          users: props.organizationMonthlyUsage.users ?? [],
        }
      : null,
  });
  const createPositionEditor = props.createPositionEditor ?? {
    open: false,
    seatId: null,
    seatTitle: "",
    teamLabel: "",
    responsibility: "",
    employeeEmail: "",
    defaultAgentId: "",
    agentIds: [],
    agentOptions: [],
    busy: false,
    error: null,
    notice: null,
    onOpen: () => undefined,
    onClose: () => undefined,
    onSeatTitleChange: () => undefined,
    onTeamLabelChange: () => undefined,
    onResponsibilityChange: () => undefined,
    onEmployeeEmailChange: () => undefined,
    onDefaultAgentIdChange: () => undefined,
    onToggleAgentId: () => undefined,
    onSubmit: () => undefined,
  };
  const search = typeof window !== "undefined" ? window.location.search : "";
  const surface = resolveOrganizationSurface(search);
  const view = resolveOrganizationView(search);
  const status = resolveOrganizationStatusFilter(search);
  const query = resolveOrganizationSearch(search);
  const team = resolveOrganizationTeam(search);
  const page = resolveOrganizationPage(search);
  const pageSize = resolveOrganizationPageSize(search);
  const riskSort = resolveOrganizationRiskSort(search);
  const selectedSeatId = resolveOrganizationSeat(search);
  const inviteModalOpen = resolveOrganizationInviteOpen(search);
  const adminInvitePick = resolveOrganizationAdminInvitePick(search);
  // 操作区是组织架构编辑的唯一最终界面：任何岗位/部门编辑器（含邀请激活）一旦打开，
  // 整个组织页都切换到「组织树 + 操作区」模式，让表单在右侧操作区内就地呈现，
  // 而不是脱离当前界面弹出整页模态。
  const structureEditorActive = Boolean(
    createPositionEditor.open ||
    props.seatOfferEditor?.seatId ||
    props.handoverEditor?.caseId ||
    props.ownershipTransferEditor?.open ||
    (organizationDepartmentEditor.open && organizationDepartmentEditor.mode) ||
    organizationStructureImportOpen ||
    inviteModalOpen,
  );
  const structureDetailActive = Boolean(selectedSeatId);
  const effectiveSurface =
    surface === "structure" || structureEditorActive || structureDetailActive
      ? "structure"
      : surface;
  const baseHref =
    typeof window !== "undefined"
      ? window.location.pathname
      : pathForTab("enterpriseOrganization", basePath, { tenantId: readModel.currentTenantId });
  const positionRows = deriveOrganizationPositionRows(readModel, monthlyUsageLoadState);
  const memberRows = deriveOrganizationMemberRows(readModel, positionRows);
  const aiRows = deriveOrganizationAiEmployeeRows(readModel, positionRows);
  const groupRows = deriveOrganizationGroupRows(readModel, positionRows);
  const departmentScope = resolveOrganizationDepartmentScope(readModel);
  const teamOptions = [
    ...new Set(positionRows.map((row) => row.teamLabel).filter(Boolean)),
  ].toSorted((left, right) => left.localeCompare(right, "zh-CN"));
  const filteredPositions = positionRows.filter((row) => {
    const haystack = [
      row.name,
      row.displayName,
      row.description ?? "",
      row.memberDisplayLabel ?? "",
      row.memberUserId ?? "",
      row.memberLabel ?? "",
      row.defaultAgentId ?? "",
      row.teamLabel,
    ]
      .join(" ")
      .toLowerCase();
    return (
      organizationStatusMatches(row.status, status) &&
      organizationRowVisibleUnderScope(row.teamLabel, departmentScope) &&
      (matchesOrganizationTeamPath(row.teamLabel, team) || team === "all") &&
      (!query || haystack.includes(query.toLowerCase()))
    );
  });
  const filteredAiRows = aiRows.filter((row) => {
    const position = positionRows.find((item) => item.seatId === row.seatId) ?? null;
    const haystack = [
      row.name,
      row.positionLabel,
      row.runtimeLabel,
      row.healthLabel,
      position?.teamLabel ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return (
      organizationStatusMatches(row.status, status) &&
      organizationRowVisibleUnderScope(position?.teamLabel ?? null, departmentScope) &&
      (team === "all" || matchesOrganizationTeamPath(position?.teamLabel ?? null, team)) &&
      (!query || haystack.includes(query.toLowerCase()))
    );
  });
  const filteredMembers = memberRows.filter((row) => {
    const haystack = [
      row.displayLabel,
      row.user,
      row.membershipRole,
      row.seatTitle ?? "",
      row.teamLabel ?? "",
      row.aiEmployeeLabel ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return (
      organizationStatusMatches(row.seatStatus, status) &&
      organizationRowVisibleUnderScope(row.teamLabel, departmentScope) &&
      (matchesOrganizationTeamPath(row.teamLabel, team) || team === "all") &&
      (!query || haystack.includes(query.toLowerCase()))
    );
  });
  const filteredGroups = groupRows.filter((row) => {
    const haystack = [
      row.name,
      row.positionLabel,
      row.aiEmployeeLabel,
      row.runtimeLabel,
      row.activityLabel,
      row.teamLabel ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return (
      organizationStatusMatches(row.status, status) &&
      organizationRowVisibleUnderScope(row.teamLabel, departmentScope) &&
      (matchesOrganizationTeamPath(row.teamLabel, team) || team === "all") &&
      (!query || haystack.includes(query.toLowerCase()))
    );
  });
  const sortedPositions = sortOrganizationPositionRowsByRisk(filteredPositions, riskSort);
  const pagedPositions = paginateOrganizationRows(sortedPositions, page, pageSize);
  const pagedAiRows = paginateOrganizationRows(filteredAiRows, page, pageSize);
  const pagedMembers = paginateOrganizationRows(filteredMembers, page, pageSize);
  const pagedGroups = paginateOrganizationRows(filteredGroups, page, pageSize);
  const pendingOfferCount = readModel.offerSummaries.filter(
    (offer) => offer.status === "pending",
  ).length;
  const pendingActivationCount = positionRows.filter(
    (row) => Boolean(row.pendingAssignmentId) && !row.offer,
  ).length;
  const pendingAppointmentCount = pendingOfferCount + pendingActivationCount;
  const botTotal = positionRows.reduce((total, row) => total + row.botCount, 0);
  const groupTotal = positionRows.reduce((total, row) => total + row.groupCount, 0);
  const botCapacity = Math.max(positionRows.length * 5, botTotal, 1);
  const groupCapacity = Math.max(positionRows.length * 5, groupTotal, 1);
  const onlineAiCount = aiRows.filter((row) => row.runtimeLabel === "ONLINE").length;
  const aiCoverageRate = aiRows.length > 0 ? onlineAiCount / aiRows.length : 0;
  // 运营概览仅保留本模块内可下钻的指标；归因/成本/机巢类指标见企业总览。
  const idleSeatCount = Math.max(0, readModel.seatCount - readModel.occupiedSeatCount);
  const governanceCards = [
    {
      label: "空岗岗位",
      value: idleSeatCount,
      detail: idleSeatCount > 0 ? `${idleSeatCount} 个岗位未占用` : "岗位均已占用",
      tone: idleSeatCount > 0 ? "warn" : "ok",
      icon: "user" as IconName,
      href: appendOrganizationSearchToHref(baseHref, {
        status: "vacant",
        query: null,
        seatId: null,
        page: 1,
        pageSize,
      }),
    },
    {
      label: "待确认任命",
      value: pendingAppointmentCount,
      detail:
        pendingAppointmentCount > 0
          ? `${pendingOfferCount} 待确认 · ${pendingActivationCount} 待激活`
          : "暂无待跟进任命",
      tone: pendingAppointmentCount > 0 ? "warn" : "ok",
      icon: "link" as IconName,
      href: appendOrganizationSearchToHref(baseHref, {
        status: "pending",
        query: null,
        seatId: null,
        page: 1,
        pageSize,
      }),
    },
  ];
  const kpis = [
    {
      label: "岗位总数",
      value: String(readModel.seatCount),
      detail: `${readModel.occupiedSeatCount} 已激活`,
      icon: "folder" as IconName,
      kind: "seats",
      view: "position" as const,
      status: "all" as const,
    },
    {
      label: "机器人（Bot）",
      value: `${botTotal} / ${botCapacity}`,
      detail: `创建上限使用率 ${formatOrganizationPercent(botTotal / botCapacity)}`,
      icon: "puzzle" as IconName,
      kind: "agent",
      view: "position" as const,
      status: "all" as const,
    },
    {
      label: "协作小组",
      value: `${groupTotal} / ${groupCapacity}`,
      detail: `活跃协作组 ${readModel.meshSummary.activeGroupCount} 个`,
      icon: "users" as IconName,
      kind: "group",
      view: "group" as const,
      status: "all" as const,
    },
    {
      label: "AI 运行覆盖率",
      value: formatOrganizationPercent(aiCoverageRate),
      detail: `在线 ${onlineAiCount} / ${aiRows.length}`,
      icon: "radio" as IconName,
      kind: "coverage",
      view: "ai" as const,
      status: "normal" as const,
    },
  ];

  const overviewKpiItems: EnterpriseKpiItem[] = [
    ...governanceCards.map((card) => ({
      label: card.label,
      value: String(card.value),
      href: card.href,
      icon: card.icon,
      tone: card.tone as EnterpriseKpiItem["tone"],
      drilldown: card.detail,
    })),
    ...kpis.map((kpi) => {
      const href = appendOrganizationSearchToHref(baseHref, {
        view: kpi.view,
        status: kpi.status,
        seatId: null,
        query,
        team,
        page: 1,
        pageSize,
      });
      const active = view === kpi.view && status === kpi.status;
      return {
        label: kpi.label,
        value: kpi.value,
        href,
        icon: kpi.icon,
        active,
        drilldown: kpi.detail,
      };
    }),
  ];

  return html`
    <div
      class="enterprise-surface enterprise-surface--organization"
      @click=${followDelegatedPortHref}
    >
      ${renderEnterpriseSeatLimitNotice({ authPanelProps: props.authPanelProps })}
      <section class="enterprise-org-shell">
        ${renderOrganizationWorkforceHeader({
          readModel,
          showHomeLink: effectiveSurface === "structure",
          onTitleClick: () =>
            goOrganizationModuleHome({
              seatOfferEditor: props.seatOfferEditor,
              createPositionEditor,
              handoverEditor: props.handoverEditor,
            }),
        })}
        ${renderOrganizationSearchMatches({ readModel, query })}
        ${renderOrganizationSurfaceBar({
          surface: effectiveSurface,
          query,
          createPositionEditor,
          seatOfferEditor: props.seatOfferEditor,
        })}
        ${
          effectiveSurface === "structure"
            ? renderOrganizationStructurePage({
                readModel,
                actions,
                basePath,
                positionRows,
                inviteOpen: inviteModalOpen,
                activationBusy: props.authPanelProps?.busy ?? false,
                activationError: props.authPanelProps?.error ?? null,
                activationNotice: props.authPanelProps?.notice ?? null,
                team,
                query,
                selectedSeatId,
                busy: props.authPanelProps?.busy ?? false,
                createPositionEditor,
                seatOfferEditor: props.seatOfferEditor,
                handoverEditor: props.handoverEditor,
                ownershipTransferEditor: props.ownershipTransferEditor,
                openedFromGovernance:
                  resolveOrganizationFrom(search) === "governance" && Boolean(selectedSeatId),
              })
            : html`
                <section class="enterprise-org-layout enterprise-org-layout--governance">
                  <div class="enterprise-org-layout__main enterprise-org-layout__main--full">
                    ${
                      organizationIsEmpty(readModel) &&
                      !organizationScopeBlocksDepartmentManagement(departmentScope)
                        ? renderOrganizationEmptyState({
                            busy: props.authPanelProps?.busy ?? false,
                            editors: {
                              seatOfferEditor: props.seatOfferEditor,
                              createPositionEditor,
                              handoverEditor: props.handoverEditor,
                            },
                          })
                        : nothing
                    }
                    <div class="enterprise-org-overview">
                      ${renderEnterpriseKpiGrid(overviewKpiItems, { variant: "compact" })}
                    </div>

                    ${
                      view === "position"
                        ? renderOrganizationPositionTable({
                            rows: pagedPositions.rows,
                            totalCount: pagedPositions.totalCount,
                            currentPage: pagedPositions.currentPage,
                            totalPages: pagedPositions.totalPages,
                            pageSize: pagedPositions.pageSize as 10 | 20 | 50,
                            readModel,
                            baseHref,
                            view,
                            status,
                            query,
                            team,
                            teamOptions,
                            selectedSeatId,
                            seatOfferEditor: props.seatOfferEditor,
                            handoverEditor: props.handoverEditor,
                            createPositionEditor,
                            actions,
                            riskSort,
                          })
                        : view === "ai"
                          ? renderOrganizationAiEmployeeTable({
                              rows: pagedAiRows.rows,
                              totalCount: pagedAiRows.totalCount,
                              currentPage: pagedAiRows.currentPage,
                              totalPages: pagedAiRows.totalPages,
                              pageSize: pagedAiRows.pageSize as 10 | 20 | 50,
                              baseHref,
                              view,
                              status,
                              query,
                              team,
                              teamOptions,
                              actions,
                            })
                          : view === "group"
                            ? renderOrganizationGroupTable({
                                rows: pagedGroups.rows,
                                totalCount: pagedGroups.totalCount,
                                currentPage: pagedGroups.currentPage,
                                totalPages: pagedGroups.totalPages,
                                pageSize: pagedGroups.pageSize as 10 | 20 | 50,
                                baseHref,
                                basePath,
                                view,
                                status,
                                query,
                                team,
                                teamOptions,
                                readModel,
                                ownershipTransferEditor: props.ownershipTransferEditor,
                                actions,
                              })
                            : renderOrganizationMemberTable({
                                adminInvitePick,
                                feedback: {
                                  busy: props.authPanelProps?.busy ?? false,
                                  notice: props.authPanelProps?.notice ?? null,
                                  error: props.authPanelProps?.error ?? null,
                                },
                                rows: pagedMembers.rows,
                                totalCount: pagedMembers.totalCount,
                                currentPage: pagedMembers.currentPage,
                                totalPages: pagedMembers.totalPages,
                                pageSize: pagedMembers.pageSize as 10 | 20 | 50,
                                baseHref,
                                view,
                                status,
                                query,
                                team,
                                teamOptions,
                                readModel,
                                createPositionEditor,
                                actions,
                              })
                    }
                  </div>
                </section>
              `
        }
      </section>
    </div>
  `;
}
