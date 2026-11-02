/**
 * 企业数据能力中心首页（Enterprise Data Capability Center）。
 *
 * 状态架构：module-local 可变 surface state（对齐 enterprise-capability-center-surface.ts），
 * 按复合 surface key（tenantId + client 实例）分桶存于 Map，支持多租户/多 surface 生命周期交错；
 * 异步分支统一经 refreshEnterpriseSurface() 重渲染。不扩展 EnterprisePortReadModel。
 *
 * Phase 1（MVP）：MetricsOverviewCards + PendingApprovalPanel + DataSourceHealthPanel。
 * 数据授权总览 / 能力目录 / 资产全景图：契约补齐后上线（当前为引导占位卡）。
 */

import { html, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import type {
  DataConnectorCatalogEntry,
  DataConnectorCredentialRecord,
  ManagedAccessPolicyDetail,
  ManagedAccessPolicyRecord,
  ManagedApprovalPolicyRecord,
  ManagedCapabilityGovernanceView,
  ManagedCapabilityRecord,
  ManagedConnectorActionRecord,
  ManagedConnectorActionRef,
  ManagedDataSourceRecord,
  ManagedDataSourceSyncLogEntry,
  ManagedGovernanceApprovalRequest,
  ManagedProjectionBindingRecord,
  ManagedProjectionSpecRecord,
  ManagedScopePolicyRecord,
  OrgTargets,
} from "../../../capability/enterprise-data-capability/types.ts";
import {
  createEnterpriseDataCapabilityGateway,
  type EnterpriseDataCapabilityGateway,
} from "../../../controllers/enterprise-data-capability/gateway-client.ts";
import {
  createInitialDataCapabilityHomeState,
  loadDataCapabilityHome,
  reloadDataCapabilityPendingApprovals,
  type DataCapabilityHomeState,
} from "../../../controllers/enterprise-data-capability/home-controller.ts";
import { renderIcon } from "../../../icons.ts";
import { pathForTab } from "../../../navigation.ts";
import { openExternalUrlSafe } from "../../../open-external-url.ts";
import { pushAppHistoryState } from "../../../request-app-rerender.ts";
import { renderCapabilityUsageBoard } from "../../../views/enterprise-data-capability/capability-usage-board.ts";
import { renderDataSourceHealthPanel } from "../../../views/enterprise-data-capability/data-source-health-panel.ts";
import { renderMetricsOverviewCards } from "../../../views/enterprise-data-capability/metrics-overview-cards.ts";
import { renderNodeDetailDrawer } from "../../../views/enterprise-data-capability/node-detail-drawer.ts";
import {
  collectDepartmentSeatIds,
  findOrgDepartmentByPath,
  renderOrgTargetPicker,
} from "../../../views/enterprise-data-capability/org-target-picker.ts";
import { renderPendingApprovalPanel } from "../../../views/enterprise-data-capability/pending-approval-panel.ts";
import { renderEnterpriseModuleHeader } from "../../../views/enterprise-module-header.ts";
import {
  type EnterpriseSegmentedNavItem,
  renderEnterpriseSegmentedNav,
} from "../../../views/enterprise-segmented-nav.ts";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import {
  createDefaultAssetFilters,
  type AssetListFilters,
} from "./enterprise-data-capability/asset-filters.ts";
import {
  normalizeAssetLinkage,
  normalizeAssetStats,
  type DataAssetLinkageView,
  type DataAssetStatsView,
} from "./enterprise-data-capability/asset-linkage.ts";
import {
  renderAssetsPage,
  renderAssetsPageContent,
} from "./enterprise-data-capability/assets-page.ts";
import { renderAuditLineagePanel } from "./enterprise-data-capability/audit-lineage-panel.ts";
import { renderGovernancePage } from "./enterprise-data-capability/governance-page.ts";
import {
  buildMcpMappingPrefill,
  formatMcpDiscoveryLabel,
  parseMcpDiscoveryContext,
  type McpDiscoveryDeeplinkContext,
} from "./enterprise-data-capability/mcp-discovery-deeplink.ts";
import {
  renderMcpMappingWizardModal,
  type McpMappingWizardEditorState,
} from "./enterprise-data-capability/mcp-mapping-wizard-modal.ts";
import { validateMcpMappingWizardDraft } from "./enterprise-data-capability/mcp-mapping-wizard.ts";
import { renderMemoryScopePanel as renderMemoryScopePanelContent } from "./enterprise-data-capability/memory-scope-panel.ts";
import {
  formatApprovalTimestamp,
  renderApprovalStatusBadge,
  renderDataStatusBadge,
  renderProjectionStudioSection,
} from "./enterprise-data-capability/outputs-page.ts";
import { buildOverviewActionQueue } from "./enterprise-data-capability/overview-action-queue.ts";
import {
  renderOverviewActionQueuePanel,
  renderOverviewPage,
} from "./enterprise-data-capability/overview-page.ts";
import { runProductCreateSaga } from "./enterprise-data-capability/product-create-transaction.ts";
import { renderProductDetailPanel } from "./enterprise-data-capability/product-detail-panel.ts";
import {
  renderCapabilityEditorModal,
  type CapabilityEditorState,
} from "./enterprise-data-capability/product-editor-modal.ts";
import {
  productWizardSourceActionMismatch,
  productWizardValidationContext,
  validateProductWizardStep,
} from "./enterprise-data-capability/product-wizard.ts";
import {
  renderProductsCatalog,
  renderProductsPage,
} from "./enterprise-data-capability/products-page.ts";
import {
  dataSectionsForPrimary,
  PRIMARY_TAB_NAV,
  resolveRouteFromLocation,
  type DataCapabilityPrimaryTab,
  type GovernanceSubPanel,
  type ProductsSubPanel,
} from "./enterprise-data-capability/section-routing.ts";
import { renderWebsiteAccessWizard } from "./enterprise-data-capability/website-access-wizard.ts";
import { buildEnterpriseOrgTree } from "./enterprise-org-tree-model.ts";
import {
  buildOrganizationMemberDisplayLookup,
  resolveOrganizationHumanLabel,
  resolveOrganizationMemberDisplayLabel,
  resolveOrganizationSeatDisplayName,
  stripOrganizationSeatIdSuffix,
} from "./enterprise-organization-display-label.ts";
import {
  renderEnterprisePage,
  requestEnterpriseAppRerender,
  shouldProceed,
} from "./enterprise-surface-shared.ts";
import type { EnterpriseSurfaceProps } from "./enterprise-surface-types.ts";
import {
  MCP_APPROVE_AND_PROVISION_RISK_ZH,
  governanceCategorySupportsApproveAndProvision,
  governanceFulfillmentStatusLabel,
} from "./governance-approval-labels.ts";

// --- module-local surface state（不进 read-model） ---

type DataCapabilitySection =
  | "home"
  | "sources"
  | "authorization"
  | "capabilities"
  | "projections"
  | "approvals"
  | "memory"
  | "audit";

type SourceEditorState = {
  open: boolean;
  /** 新建分步：1连接器 2凭证 3测连 4保存 */
  wizardStep: 1 | 2 | 3 | 4;
  sourceId: string | null;
  sourceKey: string;
  displayName: string;
  category: ManagedDataSourceRecord["category"];
  status: ManagedDataSourceRecord["status"];
  connectorId: string;
  credentialId: string;
  credentialLabel: string;
  instanceUrl: string;
  apiKey: string;
  /** HTTP REST connector tuning (only surfaced for the http-rest connector). */
  authScheme: "bearer" | "basic" | "header" | "query" | "none";
  authHeaderName: string;
  authQueryParam: string;
  basicUsername: string;
  probePath: string;
  /** Structured DB connection fields (only surfaced for relational connectors, e.g. db-postgres). */
  dbHost: string;
  dbPort: string;
  dbName: string;
  /** Reveal the password/token input in plain text. */
  passwordVisible: boolean;
  saveNewCredential: boolean;
  oauthBusy: boolean;
  oauthNotice: string | null;
  busy: boolean;
  error: string | null;
  probeBusy: boolean;
  probeMessage: string | null;
  probeOk: boolean | null;
  bindingId?: string;
  websiteBindingDraft?: string;
  websiteOutcome?: "select_existing" | "owner_must_authorize" | null;
  websiteSelectable?: Array<{ bindingId: string }>;
  /** Chanjet cloud enterprise id. Used by 用友 T+ OAuth. */
  orgId?: string;
  /** Chanjet appName. T+Cloud defaults to tpluscloud. */
  appName?: string;
};

type PolicyEditorState = {
  open: boolean;
  policyId: string | null;
  displayName: string;
  targetKind: ManagedAccessPolicyRecord["targetKind"];
  targetId: string;
  sourceId: string;
  actionRefTokens: string;
  scopePolicyId: string;
  approvalPolicyId: string;
  enabled: boolean;
  busy: boolean;
  error: string | null;
};

type ProjectionEditorState = {
  open: boolean;
  projectionKey: string;
  displayName: string;
  category: string;
  objectKind: string;
  templateKey: string;
  lifecycle: string;
  sourceActionToken: string;
  capabilityId: string;
  description: string;
  materializationMode: string;
  materializationTeamLabel: string;
  generatorVersion: string;
  freshnessSlaMinutes: string;
  enabled: boolean;
  busy: boolean;
  error: string | null;
};

function createInitialProjectionEditor(): ProjectionEditorState {
  return {
    open: false,
    projectionKey: "",
    displayName: "",
    category: "customer",
    objectKind: "data",
    templateKey: "NormalizeTemplate",
    lifecycle: "active",
    sourceActionToken: "",
    capabilityId: "",
    description: "",
    materializationMode: "on_demand",
    materializationTeamLabel: "",
    generatorVersion: "v1",
    freshnessSlaMinutes: "",
    enabled: true,
    busy: false,
    error: null,
  };
}

type ApprovalDecisionState = {
  open: boolean;
  approvalId: string | null;
  decision: "approved" | "rejected";
  displayName: string;
  category: string;
  decisionNote: string;
  fulfillmentMode: "approve_intent_only" | "approve_and_provision";
  busy: boolean;
  error: string | null;
};

type SourceLogDetailState = {
  open: boolean;
  sourceId: string | null;
  sourceLabel: string;
};

type DataCapabilitySurfaceState = {
  key: string;
  home: DataCapabilityHomeState;
  /** 资产全景图当前选中的节点 id（Drawer 用，surface 级临时状态）。 */
  selectedNodeId: string | null;
  /** 模块内兼容旧段（surface 级状态；由 primaryTab 派生）。 */
  activeSection: DataCapabilitySection;
  /** 一级业务 Tab。 */
  primaryTab: DataCapabilityPrimaryTab;
  productsSubPanel: ProductsSubPanel;
  governanceSubPanel: GovernanceSubPanel;
  sourcesLoaded: boolean;
  sourcesLoading: boolean;
  sourcesError: string | null;
  sourcesNotice: string | null;
  sources: ManagedDataSourceRecord[];
  assetLinkage: DataAssetLinkageView[];
  assetStats: DataAssetStatsView | null;
  selectedAssetSourceId: string | null;
  assetFilters: AssetListFilters;
  connectorCatalog: DataConnectorCatalogEntry[];
  connectorCatalogLoaded: boolean;
  connectorCredentials: DataConnectorCredentialRecord[];
  connectorCredentialsConnectorId: string | null;
  projectionsLoaded: boolean;
  projectionsLoading: boolean;
  projectionsError: string | null;
  projectionsNotice: string | null;
  projectionSpecs: ManagedProjectionSpecRecord[];
  projectionBindings: ManagedProjectionBindingRecord[];
  materializeBusyBindingId: string | null;
  projectionEditor: ProjectionEditorState;
  projectionAuditFailureCount: number | null;
  sourceSyncLogSourceId: string | null;
  sourceSyncLogEntries: ManagedDataSourceSyncLogEntry[] | null;
  sourceSyncLogLoading: boolean;
  sourceSyncLogError: string | null;
  sourceEditor: SourceEditorState;
  policiesLoaded: boolean;
  policiesLoading: boolean;
  policiesError: string | null;
  policiesNotice: string | null;
  policies: ManagedAccessPolicyRecord[];
  policyEditor: PolicyEditorState;
  policyDetailId: string | null;
  policyDetail: ManagedAccessPolicyDetail | null;
  policyDetailLoading: boolean;
  policyDetailError: string | null;
  policyCompileNotice: string | null;
  scopePolicies: ManagedScopePolicyRecord[];
  approvalPolicies: ManagedApprovalPolicyRecord[];
  actionsCatalog: ManagedConnectorActionRecord[];
  lookupsLoaded: boolean;
  lookupsLoading: boolean;
  lookupsError: string | null;
  capabilitiesLoaded: boolean;
  capabilitiesLoading: boolean;
  capabilitiesError: string | null;
  capabilitiesNotice: string | null;
  capabilities: ManagedCapabilityRecord[];
  capabilityEditor: CapabilityEditorState;
  mcpMappingEditor: McpMappingWizardEditorState;
  capabilityDetailId: string | null;
  capabilityDetail: ManagedCapabilityGovernanceView | null;
  capabilityDetailLoading: boolean;
  capabilityDetailError: string | null;
  approvalsLoaded: boolean;
  approvalsLoading: boolean;
  approvalsError: string | null;
  approvalsNotice: string | null;
  approvalsTab: "pending" | "history";
  approvalRequests: ManagedGovernanceApprovalRequest[];
  approvalDetailId: string | null;
  approvalDetail: ManagedGovernanceApprovalRequest | null;
  approvalDetailLoading: boolean;
  approvalDetailError: string | null;
  approvalDecision: ApprovalDecisionState;
  sourceLogDetail: SourceLogDetailState;
  seatGrantSeatIds: Set<string>;
  seatGrantDepartmentPaths: Set<string>;
  seatGrantQuery: string;
  seatGrantCapabilityId: string;
  seatGrantBusy: boolean;
  seatGrantNotice: string | null;
  policyPickerSeatIds: Set<string>;
  policyPickerDepartmentPaths: Set<string>;
  policyPickerQuery: string;
  orgTargets: OrgTargets | null;
  orgTargetsLoaded: boolean;
  orgTargetsLoading: boolean;
};

const GOVERNANCE_CATEGORY_LABEL: Record<ManagedGovernanceApprovalRequest["category"], string> = {
  source_onboarding: "数据源接入",
  data_access: "数据访问策略",
  capability_exposure: "能力开放",
  identity_binding: "身份绑定",
  seat_capability_access: "员工能力申请",
  enterprise_knowledge_access: "企业知识申请",
  mcp_tool_mapping: "MCP 工具映射申请",
  oi_enrollment: "运营身份开通申请",
  pack_skill_review: "Pack 技能审核",
};

const DATA_SOURCE_CATEGORY_LABEL: Record<ManagedDataSourceRecord["category"], string> = {
  crm: "客户关系（CRM）",
  erp: "企业资源计划（ERP）",
  finance: "财务",
  oa: "办公协同（OA）",
  mes: "制造执行（MES）",
  external: "外部",
};

const DATA_SOURCE_STATUS_LABEL: Record<ManagedDataSourceRecord["status"], string> = {
  connected: "已连接",
  disconnected: "已断开",
  error: "异常",
};

// 数据源状态由连通性探测结果派生，而非人工选择，避免保存出与实际不符的「已连接」。
// live_probe_failed / handler_error 视为「异常」（链路通但探测失败）；
// 缺包 / 缺凭证 / 未知连接器等前置未就绪则视为「已断开」。
function deriveSourceStatusFromProbe(probe: {
  ok: boolean;
  mode: string;
}): ManagedDataSourceRecord["status"] {
  if (probe.ok) {
    return "connected";
  }
  return probe.mode === "live_probe_failed" || probe.mode === "handler_error"
    ? "error"
    : "disconnected";
}

/**
 * Build the optional connector-specific secret fields sent with test-connection
 * and credential upsert. HTTP REST carries the full auth-scheme + probe-path
 * tuning; PostgreSQL carries the database user. Other connectors get an empty
 * object so the spread is a no-op and their request shape is unchanged.
 */
function buildConnectorSecretOptions(editor: SourceEditorState): {
  authScheme?: SourceEditorState["authScheme"];
  authHeaderName?: string;
  authQueryParam?: string;
  basicUsername?: string;
  probePath?: string;
} {
  const connectorId = editor.connectorId.trim();
  if (connectorId === "http-rest") {
    return {
      authScheme: editor.authScheme,
      authHeaderName: editor.authHeaderName.trim() || undefined,
      authQueryParam: editor.authQueryParam.trim() || undefined,
      basicUsername: editor.basicUsername.trim() || undefined,
      probePath: editor.probePath.trim() || undefined,
    };
  }
  if (connectorId === "db-postgres" || connectorId === "db-mysql") {
    return { basicUsername: editor.basicUsername.trim() || undefined };
  }
  return {};
}

/**
 * Resolve the connection string to send as `instanceUrl`. Relational connectors
 * collect structured host/port/database fields in the UI and assemble them here
 * (keeping raw connection strings out of the form); other connectors use the
 * instanceUrl field verbatim.
 */
function resolveEditorInstanceUrl(editor: SourceEditorState): string {
  const connectorId = editor.connectorId.trim();
  if (connectorId === "db-postgres" || connectorId === "db-mysql") {
    const host = editor.dbHost.trim();
    if (!host) {
      return "";
    }
    const isMysql = connectorId === "db-mysql";
    const port = editor.dbPort.trim() || (isMysql ? "3306" : "5432");
    const db = editor.dbName.trim();
    const scheme = isMysql ? "mysql" : "postgres";
    return `${scheme}://${host}:${port}${db ? `/${db}` : ""}`;
  }
  return editor.instanceUrl.trim();
}

/** Password/token input with an inline show/hide (eye) toggle. */
function renderSecretInput(params: {
  label: string;
  value: string;
  visible: boolean;
  disabled: boolean;
  placeholder?: string;
  hint?: TemplateResult;
  full?: boolean;
  onInput: (value: string) => void;
  onToggle: () => void;
}): TemplateResult {
  return html`
    <label class="field ${params.full ? "full" : ""}">
      <span>${params.label}</span>
      <div class="edc-secret-input">
        <input
          type=${params.visible ? "text" : "password"}
          .value=${params.value}
          placeholder=${params.placeholder ?? ""}
          ?disabled=${params.disabled}
          @input=${(event: Event) => params.onInput((event.target as HTMLInputElement).value)}
        />
        <button
          type="button"
          class="edc-secret-input__toggle"
          aria-label=${params.visible ? "隐藏" : "显示"}
          ?disabled=${params.disabled}
          @click=${params.onToggle}
        >
          ${renderIcon("eye", "edc-secret-input__toggle-icon")}
        </button>
      </div>
      ${params.hint ? html`<small>${params.hint}</small>` : html``}
    </label>
  `;
}

/**
 * Top-of-form status banner: surfaces the connectivity probe result (including
 * the backend error code/detail) or a save error at the top of the modal, so
 * operators and network admins see it without scrolling.
 */
function renderSourceEditorBanner(state: SourceEditorState): TemplateResult {
  if (state.error) {
    return html`
      <div class="edc-form-banner edc-form-banner--danger" role="alert">
        <div class="edc-form-banner__title">保存失败</div>
        <div class="edc-form-banner__code">${state.error}</div>
      </div>
    `;
  }
  if (state.probeMessage) {
    const ok = state.probeOk === true;
    return html`
      <div
        class="edc-form-banner ${ok ? "edc-form-banner--ok" : "edc-form-banner--danger"}"
        role=${ok ? "status" : "alert"}
      >
        <div class="edc-form-banner__title">${ok ? "连通性正常" : "连通性测试失败"}</div>
        <div class="edc-form-banner__code">${state.probeMessage}</div>
      </div>
    `;
  }
  return html``;
}

const POLICY_TARGET_KIND_LABEL: Record<ManagedAccessPolicyRecord["targetKind"], string> = {
  seat: "岗位",
  department: "部门",
  role: "角色",
};

function formatGovernanceCategory(category: string): string {
  return (
    GOVERNANCE_CATEGORY_LABEL[category as ManagedGovernanceApprovalRequest["category"]] ?? category
  );
}

function formatDataSourceCategory(category: string): string {
  return DATA_SOURCE_CATEGORY_LABEL[category as ManagedDataSourceRecord["category"]] ?? category;
}

function formatDataSourceStatus(status: string): string {
  return DATA_SOURCE_STATUS_LABEL[status as ManagedDataSourceRecord["status"]] ?? status;
}

function formatPolicyTargetKind(targetKind: string): string {
  return (
    POLICY_TARGET_KIND_LABEL[targetKind as ManagedAccessPolicyRecord["targetKind"]] ?? targetKind
  );
}

// 按 surfaceKey 分桶，支持同进程多租户/多 surface 生命周期交错，互不覆盖。
const surfaceStateByKey = new Map<string, DataCapabilitySurfaceState>();
// 防止极端情况下无界增长（租户频繁切换）；超过上限淘汰最早插入项。
const MAX_SURFACE_STATES = 16;

function getSurfaceState(key: string): DataCapabilitySurfaceState {
  let state = surfaceStateByKey.get(key);
  if (!state) {
    state = {
      key,
      home: createInitialDataCapabilityHomeState(),
      selectedNodeId: null,
      activeSection: "home",
      primaryTab: "overview",
      productsSubPanel: "catalog",
      governanceSubPanel: "matrix",
      sourcesLoaded: false,
      sourcesLoading: false,
      sourcesError: null,
      sourcesNotice: null,
      sources: [],
      assetLinkage: [],
      assetStats: null,
      selectedAssetSourceId: null,
      assetFilters: createDefaultAssetFilters(),
      connectorCatalog: [],
      connectorCatalogLoaded: false,
      connectorCredentials: [],
      connectorCredentialsConnectorId: null,
      projectionsLoaded: false,
      projectionsLoading: false,
      projectionsError: null,
      projectionsNotice: null,
      projectionSpecs: [],
      projectionBindings: [],
      materializeBusyBindingId: null,
      projectionEditor: createInitialProjectionEditor(),
      projectionAuditFailureCount: null,
      sourceSyncLogSourceId: null,
      sourceSyncLogEntries: null,
      sourceSyncLogLoading: false,
      sourceSyncLogError: null,
      sourceEditor: {
        open: false,
        wizardStep: 1,
        sourceId: null,
        sourceKey: "",
        displayName: "",
        category: "crm",
        status: "connected",
        connectorId: "",
        credentialId: "",
        credentialLabel: "",
        instanceUrl: "",
        apiKey: "",
        authScheme: "bearer",
        authHeaderName: "",
        authQueryParam: "",
        basicUsername: "",
        probePath: "",
        dbHost: "",
        dbPort: "",
        dbName: "",
        passwordVisible: false,
        saveNewCredential: false,
        oauthBusy: false,
        oauthNotice: null,
        busy: false,
        error: null,
        probeBusy: false,
        probeMessage: null,
        probeOk: null,
      },
      policiesLoaded: false,
      policiesLoading: false,
      policiesError: null,
      policiesNotice: null,
      policies: [],
      policyEditor: {
        open: false,
        policyId: null,
        displayName: "",
        targetKind: "seat",
        targetId: "",
        sourceId: "",
        actionRefTokens: "",
        scopePolicyId: "",
        approvalPolicyId: "",
        enabled: true,
        busy: false,
        error: null,
      },
      policyDetailId: null,
      policyDetail: null,
      policyDetailLoading: false,
      policyDetailError: null,
      policyCompileNotice: null,
      scopePolicies: [],
      approvalPolicies: [],
      actionsCatalog: [],
      lookupsLoaded: false,
      lookupsLoading: false,
      lookupsError: null,
      capabilitiesLoaded: false,
      capabilitiesLoading: false,
      capabilitiesError: null,
      capabilitiesNotice: null,
      capabilities: [],
      capabilityEditor: {
        open: false,
        wizardStep: 1,
        outputMode: "direct",
        projectionTemplateKey: "",
        capabilityId: null,
        capabilityKey: "",
        displayName: "",
        description: "",
        sourceIds: new Set<string>(),
        actionRefTokens: new Set<string>(),
        enabled: true,
        busy: false,
        error: null,
      },
      mcpMappingEditor: {
        open: false,
        mcpServer: "",
        mcpTool: "",
        capabilityKey: "",
        displayName: "",
        description: "",
        handlerRef: "",
        busy: false,
        error: null,
      },
      capabilityDetailId: null,
      capabilityDetail: null,
      capabilityDetailLoading: false,
      capabilityDetailError: null,
      approvalsLoaded: false,
      approvalsLoading: false,
      approvalsError: null,
      approvalsNotice: null,
      approvalsTab: "pending",
      approvalRequests: [],
      approvalDetailId: null,
      approvalDetail: null,
      approvalDetailLoading: false,
      approvalDetailError: null,
      approvalDecision: {
        open: false,
        approvalId: null,
        decision: "approved",
        displayName: "",
        category: "",
        decisionNote: "",
        fulfillmentMode: "approve_intent_only",
        busy: false,
        error: null,
      },
      sourceLogDetail: {
        open: false,
        sourceId: null,
        sourceLabel: "",
      },
      seatGrantSeatIds: new Set<string>(),
      seatGrantDepartmentPaths: new Set<string>(),
      seatGrantQuery: "",
      seatGrantCapabilityId: "",
      seatGrantBusy: false,
      seatGrantNotice: null,
      policyPickerSeatIds: new Set<string>(),
      policyPickerDepartmentPaths: new Set<string>(),
      policyPickerQuery: "",
      orgTargets: null,
      orgTargetsLoaded: false,
      orgTargetsLoading: false,
    };
    surfaceStateByKey.set(key, state);
    if (surfaceStateByKey.size > MAX_SURFACE_STATES) {
      const oldest = surfaceStateByKey.keys().next().value;
      if (oldest !== undefined) {
        surfaceStateByKey.delete(oldest);
      }
    }
  }
  return state;
}

// 给每个 client 实例分配稳定 id，用于复合 surface key（防重连陈旧态）。
const clientRequestIds = new WeakMap<object, number>();
let nextClientRequestId = 1;

function buildSurfaceKey(props: EnterpriseSurfaceProps): string {
  const tenant = props.readModel.currentTenantId ?? "root";
  const clientRef = props.client;
  if (!clientRef) {
    return `${tenant}::offline`;
  }
  let id = clientRequestIds.get(clientRef);
  if (id === undefined) {
    id = nextClientRequestId;
    nextClientRequestId += 1;
    clientRequestIds.set(clientRef, id);
  }
  return `${tenant}::client:${id}`;
}

/** 异步状态更新后强制重渲染（对齐 capability-center 的 PopStateEvent 模式）。 */
function refreshEnterpriseSurface(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
  requestEnterpriseAppRerender();
}

function normalizeTokenList(value: string): string[] {
  return value
    .split(/[\n,]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseActionRefTokens(value: string): ManagedConnectorActionRef[] {
  return normalizeTokenList(value).map((entry) => {
    const [connectorId = "", actionKey = "", version = ""] = entry.split(":");
    return { connectorId, actionKey, version };
  });
}

function serializeActionRefs(refs: ManagedConnectorActionRef[]): string {
  return refs.map((ref) => `${ref.connectorId}:${ref.actionKey}:${ref.version}`).join("\n");
}

async function loadManagementLookups(
  state: DataCapabilitySurfaceState,
  gateway: EnterpriseDataCapabilityGateway,
  tenantId: string,
): Promise<void> {
  if (state.lookupsLoaded || state.lookupsLoading) {
    return;
  }
  state.lookupsLoading = true;
  state.lookupsError = null;
  refreshEnterpriseSurface();
  const [actions, scopePolicies, approvalPolicies] = await Promise.all([
    gateway.listConnectorActions(tenantId),
    gateway.listScopePolicies(tenantId),
    gateway.listApprovalPolicies(tenantId),
  ]);
  state.lookupsLoading = false;
  if (actions.ok) {
    state.actionsCatalog = actions.data;
  } else {
    state.lookupsError = actions.error;
  }
  if (scopePolicies.ok) {
    state.scopePolicies = scopePolicies.data;
  } else {
    state.lookupsError = scopePolicies.error;
  }
  if (approvalPolicies.ok) {
    state.approvalPolicies = approvalPolicies.data;
  } else {
    state.lookupsError = approvalPolicies.error;
  }
  state.lookupsLoaded = actions.ok && scopePolicies.ok && approvalPolicies.ok;
  refreshEnterpriseSurface();
}

async function loadConnectorCredentialsForEditor(
  state: DataCapabilitySurfaceState,
  gateway: EnterpriseDataCapabilityGateway,
  tenantId: string,
  connectorId: string,
): Promise<void> {
  const normalized = connectorId.trim();
  if (!normalized) {
    state.connectorCredentials = [];
    state.connectorCredentialsConnectorId = null;
    return;
  }
  if (
    state.connectorCredentialsConnectorId === normalized &&
    state.connectorCredentials.length > 0
  ) {
    return;
  }
  const result = await gateway.listConnectorCredentials(tenantId, normalized);
  if (result.ok) {
    state.connectorCredentials = result.data;
    state.connectorCredentialsConnectorId = normalized;
  }
  refreshEnterpriseSurface();
}

async function loadProjectionsSection(
  state: DataCapabilitySurfaceState,
  gateway: EnterpriseDataCapabilityGateway,
  tenantId: string,
): Promise<void> {
  if (state.projectionsLoaded || state.projectionsLoading) {
    return;
  }
  state.projectionsLoading = true;
  state.projectionsError = null;
  refreshEnterpriseSurface();
  // 新建投影需要源动作目录；「近期物化失败」来自审计概览。两者 best-effort，不阻断列表。
  void loadManagementLookups(state, gateway, tenantId);
  const [specs, bindings, lineage] = await Promise.all([
    gateway.listProjectionSpecs(tenantId),
    gateway.listProjectionBindings(tenantId),
    gateway.loadLineageOverview(tenantId),
  ]);
  state.projectionsLoading = false;
  state.projectionAuditFailureCount = lineage.ok ? lineage.data.materializationFailureCount : null;
  if (specs.ok && bindings.ok) {
    state.projectionSpecs = specs.data;
    state.projectionBindings = bindings.data;
    state.projectionsLoaded = true;
  } else {
    state.projectionsError = specs.ok ? (bindings.ok ? null : bindings.error) : specs.error;
  }
  refreshEnterpriseSurface();
}

async function loadConnectorCatalog(
  state: DataCapabilitySurfaceState,
  gateway: EnterpriseDataCapabilityGateway,
  tenantId: string,
): Promise<void> {
  if (state.connectorCatalogLoaded) {
    return;
  }
  const result = await gateway.loadConnectorCatalog(tenantId);
  if (result.ok) {
    state.connectorCatalog = result.data;
    state.connectorCatalogLoaded = true;
  }
  refreshEnterpriseSurface();
}

const processedDataConnectorOAuthReturns = new Set<string>();
/** 一次性消费 MCP 发现深链，避免每次重渲重复打开空编辑器。 */
const processedMcpDiscoveryDeeplinks = new Set<string>();

function applyMcpDiscoveryDeeplinkOnce(state: DataCapabilitySurfaceState): void {
  if (typeof window === "undefined") {
    return;
  }
  let search = "";
  try {
    search = window.location.search ?? "";
  } catch {
    return;
  }
  const ctx = parseMcpDiscoveryContext(search);
  if (!ctx) {
    return;
  }
  let edc = "";
  try {
    edc = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("edc") ?? "";
  } catch {
    edc = "";
  }
  const key = `${edc}|${ctx.mcpServer}|${ctx.mcpTool}|${ctx.capabilityId ?? ""}`;
  if (processedMcpDiscoveryDeeplinks.has(key)) {
    return;
  }
  processedMcpDiscoveryDeeplinks.add(key);
  const label = formatMcpDiscoveryLabel(ctx);
  if (edc === "capabilities" || state.activeSection === "capabilities") {
    applyMcpDiscoveryMapContext(state, ctx, label);
    return;
  }
  if (edc === "authorization" || state.activeSection === "authorization") {
    applyMcpDiscoveryAuthorizeContext(state, ctx, label);
  }
}

function applyMcpDiscoveryMapContext(
  state: DataCapabilitySurfaceState,
  ctx: McpDiscoveryDeeplinkContext,
  label: string,
): void {
  state.capabilitiesNotice = `来自 MCP 发现：${label}。已打开映射引导，确认后保存才会写入动作与能力（不会自动授权）。`;
  if (state.mcpMappingEditor.open || state.capabilityEditor.open) {
    return;
  }
  const prefill = buildMcpMappingPrefill(ctx);
  if (!prefill) {
    state.capabilitiesNotice = `来自 MCP 发现：${label}。缺少工具名，无法打开映射引导。请从带工具名的发现行进入。`;
    return;
  }
  state.mcpMappingEditor = {
    open: true,
    mcpServer: prefill.mcpServer,
    mcpTool: prefill.mcpTool,
    capabilityKey: prefill.capabilityKey,
    displayName: prefill.displayName,
    description: prefill.description,
    handlerRef: prefill.handlerRef,
    busy: false,
    error: null,
  };
}

function applyMcpDiscoveryAuthorizeContext(
  state: DataCapabilitySurfaceState,
  ctx: McpDiscoveryDeeplinkContext,
  label: string,
): void {
  const capHint = ctx.capabilityId ? `（能力 ${ctx.capabilityId}）` : "";
  state.policiesNotice = `来自 MCP 发现：${label}${capHint}。请在此申请或配置席位授权（不会自动写入 Grant）。`;
  if (ctx.capabilityId) {
    state.seatGrantCapabilityId = ctx.capabilityId;
  }
  const query = ctx.mcpTool || ctx.mcpServer;
  if (query) {
    state.seatGrantQuery = query;
    state.policyPickerQuery = query;
  }
}

async function pollDataConnectorOAuthSession(
  gateway: EnterpriseDataCapabilityGateway,
  tenantId: string,
  sessionId: string,
  attempts = 120,
): Promise<{ credentialId: string; connectorId: string } | null> {
  for (let index = 0; index < attempts; index += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
    try {
      const status = await gateway.getConnectorOAuthStatus(tenantId, sessionId);
      if (!status.ok) {
        continue;
      }
      if (status.data.status === "completed" && status.data.credentialId) {
        return {
          credentialId: status.data.credentialId,
          connectorId: status.data.connectorId,
        };
      }
      if (status.data.status === "expired" || status.data.status === "failed") {
        return null;
      }
    } catch {
      // Keep polling until timeout.
    }
  }
  return null;
}

async function tryResumeDataConnectorOAuthFromUrl(
  state: DataCapabilitySurfaceState,
  gateway: EnterpriseDataCapabilityGateway,
  tenantId: string,
): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const status = params.get("dataConnectorOAuth")?.trim();
  const sessionId = params.get("dataConnectorOAuthSessionId")?.trim();
  const errorMessage = params.get("dataConnectorOAuthMessage")?.trim();
  if (!status || !sessionId || processedDataConnectorOAuthReturns.has(sessionId)) {
    return;
  }
  processedDataConnectorOAuthReturns.add(sessionId);
  params.delete("dataConnectorOAuth");
  params.delete("dataConnectorOAuthSessionId");
  params.delete("dataConnectorOAuthMessage");
  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", nextUrl);
  state.activeSection = "sources";
  if (status === "error") {
    state.sourcesNotice = errorMessage || "数据连接器 OAuth 授权失败。";
    refreshEnterpriseSurface();
    return;
  }
  const oauthStatus = await gateway.getConnectorOAuthStatus(tenantId, sessionId);
  if (
    !oauthStatus.ok ||
    oauthStatus.data.status !== "completed" ||
    !oauthStatus.data.credentialId
  ) {
    state.sourcesNotice = "OAuth 尚未完成，请重试授权。";
    refreshEnterpriseSurface();
    return;
  }
  state.connectorCatalogLoaded = false;
  await loadConnectorCatalog(state, gateway, tenantId);
  const connectorEntry =
    state.connectorCatalog.find((entry) => entry.connectorId === oauthStatus.data.connectorId) ??
    null;
  state.connectorCredentialsConnectorId = null;
  await loadConnectorCredentialsForEditor(state, gateway, tenantId, oauthStatus.data.connectorId);
  state.sourceEditor = {
    open: true,
    wizardStep: 1,
    sourceId: null,
    sourceKey: connectorEntry?.defaultSourceKey ?? "",
    displayName: connectorEntry?.label ?? "",
    category: connectorEntry?.category ?? "oa",
    status: "connected",
    connectorId: oauthStatus.data.connectorId,
    credentialId: oauthStatus.data.credentialId,
    credentialLabel: "",
    instanceUrl: "",
    apiKey: "",
    authScheme: "bearer",
    authHeaderName: "",
    authQueryParam: "",
    basicUsername: "",
    probePath: "",
    dbHost: "",
    dbPort: "",
    dbName: "",
    passwordVisible: false,
    saveNewCredential: false,
    oauthBusy: false,
    oauthNotice: null,
    busy: false,
    error: null,
    probeBusy: false,
    probeMessage: null,
    probeOk: null,
  };
  state.sourcesNotice = "OAuth 授权已完成，请确认数据源信息并保存。";
  refreshEnterpriseSurface();
}

async function loadSourcesSection(
  state: DataCapabilitySurfaceState,
  gateway: EnterpriseDataCapabilityGateway,
  tenantId: string,
): Promise<void> {
  if (state.sourcesLoaded || state.sourcesLoading) {
    return;
  }
  state.sourcesLoading = true;
  state.sourcesError = null;
  refreshEnterpriseSurface();
  await loadConnectorCatalog(state, gateway, tenantId);
  const result = await gateway.listSources(tenantId);
  state.sourcesLoading = false;
  if (result.ok) {
    state.sources = result.data;
    state.sourcesLoaded = true;
    const linkage = await gateway.listAssetLinkage(tenantId);
    if (linkage.ok) {
      state.assetLinkage = linkage.data.items.flatMap((item) => {
        const normalized = normalizeAssetLinkage(item);
        return normalized ? [normalized] : [];
      });
      state.assetStats = normalizeAssetStats(linkage.data.stats);
    }
    if (state.selectedAssetSourceId == null && typeof window !== "undefined") {
      const requested = new URLSearchParams(window.location.search).get("sourceId");
      if (requested) {
        state.selectedAssetSourceId = requested;
      }
    }
  } else {
    state.sourcesError = result.error;
  }
  refreshEnterpriseSurface();
}

async function loadOrgTargets(
  state: DataCapabilitySurfaceState,
  gateway: EnterpriseDataCapabilityGateway,
  tenantId: string,
): Promise<void> {
  if (state.orgTargetsLoaded || state.orgTargetsLoading) {
    return;
  }
  state.orgTargetsLoading = true;
  refreshEnterpriseSurface();
  const result = await gateway.loadOrgTargets(tenantId);
  state.orgTargetsLoading = false;
  if (result.ok) {
    state.orgTargets = result.data;
    state.orgTargetsLoaded = true;
  }
  refreshEnterpriseSurface();
}

async function loadPoliciesSection(
  state: DataCapabilitySurfaceState,
  gateway: EnterpriseDataCapabilityGateway,
  tenantId: string,
): Promise<void> {
  if (state.policiesLoaded || state.policiesLoading) {
    return;
  }
  state.policiesLoading = true;
  state.policiesError = null;
  refreshEnterpriseSurface();
  await loadManagementLookups(state, gateway, tenantId);
  void loadOrgTargets(state, gateway, tenantId);
  const result = await gateway.listAccessPolicies(tenantId);
  state.policiesLoading = false;
  if (result.ok) {
    state.policies = result.data;
    state.policiesLoaded = true;
  } else {
    state.policiesError = result.error;
  }
  refreshEnterpriseSurface();
}

async function loadPolicyDetail(
  state: DataCapabilitySurfaceState,
  gateway: EnterpriseDataCapabilityGateway,
  tenantId: string,
  policyId: string,
): Promise<void> {
  state.policyDetailId = policyId;
  state.policyDetail = null;
  state.policyDetailLoading = true;
  state.policyDetailError = null;
  refreshEnterpriseSurface();
  const result = await gateway.getAccessPolicy(tenantId, policyId);
  state.policyDetailLoading = false;
  if (result.ok) {
    state.policyDetail = result.data;
  } else {
    state.policyDetailError = result.error;
  }
  refreshEnterpriseSurface();
}

async function loadCapabilitiesSection(
  state: DataCapabilitySurfaceState,
  gateway: EnterpriseDataCapabilityGateway,
  tenantId: string,
): Promise<void> {
  if (state.capabilitiesLoaded || state.capabilitiesLoading) {
    return;
  }
  state.capabilitiesLoading = true;
  state.capabilitiesError = null;
  refreshEnterpriseSurface();
  await loadManagementLookups(state, gateway, tenantId);
  void loadOrgTargets(state, gateway, tenantId);
  // Capability editor binds real data sources via the visual checkbox list, so
  // make sure the source list is loaded (guarded; no-op if already loaded).
  void loadSourcesSection(state, gateway, tenantId);
  const result = await gateway.listCapabilities(tenantId);
  state.capabilitiesLoading = false;
  if (result.ok) {
    state.capabilities = result.data;
    state.capabilitiesLoaded = true;
  } else {
    state.capabilitiesError = result.error;
  }
  refreshEnterpriseSurface();
}

async function loadCapabilityDetail(
  state: DataCapabilitySurfaceState,
  gateway: EnterpriseDataCapabilityGateway,
  tenantId: string,
  capabilityId: string,
): Promise<void> {
  state.capabilityDetailId = capabilityId;
  state.capabilityDetail = null;
  state.capabilityDetailLoading = true;
  state.capabilityDetailError = null;
  refreshEnterpriseSurface();
  const result = await gateway.getCapabilityGovernanceView(tenantId, capabilityId);
  state.capabilityDetailLoading = false;
  if (result.ok) {
    state.capabilityDetail = result.data;
  } else {
    state.capabilityDetailError = result.error;
  }
  refreshEnterpriseSurface();
}

async function loadApprovalsSection(
  state: DataCapabilitySurfaceState,
  gateway: EnterpriseDataCapabilityGateway,
  tenantId: string,
): Promise<void> {
  if (state.approvalsLoaded || state.approvalsLoading) {
    return;
  }
  state.approvalsLoading = true;
  state.approvalsError = null;
  refreshEnterpriseSurface();
  const result = await gateway.listGovernanceApprovals(tenantId);
  state.approvalsLoading = false;
  if (result.ok) {
    state.approvalRequests = result.data;
    state.approvalsLoaded = true;
  } else {
    state.approvalsError = result.error;
  }
  refreshEnterpriseSurface();
}

async function loadApprovalDetail(
  state: DataCapabilitySurfaceState,
  gateway: EnterpriseDataCapabilityGateway,
  tenantId: string,
  approvalId: string,
): Promise<void> {
  state.approvalDetailId = approvalId;
  state.approvalDetail = null;
  state.approvalDetailLoading = true;
  state.approvalDetailError = null;
  refreshEnterpriseSurface();
  const result = await gateway.getGovernanceApproval(tenantId, approvalId);
  state.approvalDetailLoading = false;
  if (result.ok) {
    state.approvalDetail = result.data;
  } else {
    state.approvalDetailError = result.error;
  }
  refreshEnterpriseSurface();
}

function ensureLoaded(
  state: DataCapabilitySurfaceState,
  gateway: EnterpriseDataCapabilityGateway | null,
  tenantId: string | null,
): void {
  if (!gateway || !tenantId) {
    return;
  }
  const { home } = state;
  // load-once 总开关：用 loadStarted 而非某个面板分支，避免后续增量面板永不首载。
  if (home.loadStarted) {
    return;
  }
  void loadDataCapabilityHome({
    state: home,
    gateway,
    tenantId,
    requestRender: refreshEnterpriseSurface,
  });
}

const PRODUCTS_SUB_NAV: Array<{ id: ProductsSubPanel; label: string }> = [
  { id: "catalog", label: "产品目录" },
  { id: "outputs", label: "输出与物化" },
];

const GOVERNANCE_SUB_NAV: Array<{ id: GovernanceSubPanel; label: string }> = [
  { id: "matrix", label: "默认权限矩阵" },
  { id: "approvals", label: "待审批" },
  { id: "audit", label: "审计血缘" },
  { id: "memory", label: "记忆范围" },
];

function syncHashForLegacySection(section: DataCapabilitySection) {
  if (typeof window === "undefined" || !window.history?.replaceState) {
    return;
  }
  const next = `#${section}`;
  if (window.location.hash === next) {
    return;
  }
  const url = `${window.location.pathname}${window.location.search}${next}`;
  window.history.replaceState(null, "", url);
}

function renderMemoryScopePanel(state: DataCapabilitySurfaceState): TemplateResult {
  return renderMemoryScopePanelContent({
    scopes: state.scopePolicies.map((scope) => ({
      displayName: scope.displayName,
      scopePolicyId: scope.scopePolicyId,
      scopeType: scope.scopeType,
    })),
    loading: state.policiesLoading,
    loaded: state.policiesLoaded,
  });
}

function oauthConnectorHint(connectorId: string): string {
  if (connectorId === "erp-yonyou-tplus") {
    return "通过畅捷通开放平台授权用友 T+。填写云企业 ID；未配置 appKey 时使用模拟模式。T+Cloud 的应用名为 tpluscloud。";
  }
  if (connectorId === "crm-salesforce") {
    return "通过 Salesforce OAuth 完成授权；未配置 Client ID 时将使用模拟模式。";
  }
  return "通过 Notion OAuth 完成授权；未配置 Client ID 时将使用模拟模式。";
}

function renderSourceEditorModal(
  state: SourceEditorState,
  catalog: DataConnectorCatalogEntry[],
  credentials: DataConnectorCredentialRecord[],
  onClose: () => void,
  onSubmit: () => void,
  onUpdate: (patch: Partial<SourceEditorState>) => void,
  onTestConnection: () => void,
  onInstallConnectorPackage: () => void,
  onStartOAuth: () => void,
  onRegisterWebsiteBinding: () => void,
): TemplateResult {
  if (!state.open) {
    return html``;
  }
  const title = state.sourceId ? "编辑数据资产" : "新增数据资产";
  const isCreateSource = !state.sourceId;
  const sourceSteps = [
    { step: 1 as const, title: "选连接器" },
    { step: 2 as const, title: "凭证" },
    { step: 3 as const, title: "测连" },
    { step: 4 as const, title: "保存" },
  ];
  const selectedConnector =
    catalog.find((entry) => entry.connectorId === state.connectorId) ?? null;
  const showInstallPackage = selectedConnector != null && !selectedConnector.ready;
  const isWebsiteSession = selectedConnector?.accessMethod === "website_session";
  const showCredentialFields =
    selectedConnector != null && selectedConnector.credentialKind !== "none" && !isWebsiteSession;
  const isOAuthConnector = selectedConnector?.credentialKind === "oauth2";
  const isApiKeyConnector = selectedConnector?.credentialKind === "api_key";
  const isHttpRest = selectedConnector?.connectorId === "http-rest";
  const isMysql = selectedConnector?.connectorId === "db-mysql";
  const isDatabase = selectedConnector?.connectorId === "db-postgres" || isMysql;
  const showNewCredentialForm = state.saveNewCredential || state.credentialId === "";
  return html`
    <div
      class="enterprise-org-modal-overlay"
      @click=${(event: MouseEvent) => {
        if (event.target === event.currentTarget && !state.busy) {
          onClose();
        }
      }}
    >
      <section class="enterprise-org-modal" role="dialog" aria-modal="true" aria-label=${title}>
        <div class="enterprise-org-modal__header">
          <div>
            <div class="enterprise-org-modal__title">${title}</div>
            <div class="enterprise-org-modal__sub">
              ${
                isCreateSource
                  ? "分步接入：选择连接器 → 配置凭证 → 测试连通性 → 保存资产。"
                  : "从企业数据连接器目录选择源，安装连接器包后绑定凭证；保存时自动检测连通性并据此设置状态。"
              }
            </div>
          </div>
          <button class="btn btn--sm" type="button" ?disabled=${state.busy} @click=${onClose}>
            关闭
          </button>
        </div>
        <div class="enterprise-org-modal__body">
          ${renderSourceEditorBanner(state)}
          ${
            isCreateSource
              ? html`
                  <div class="edc-wizard-steps" role="list" style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;">
                    ${sourceSteps.map(
                      (item) => html`
                        <span
                          role="listitem"
                          class="enterprise-mesh-badge ${item.step === state.wizardStep ? "enterprise-mesh-badge--ok" : "enterprise-mesh-badge--neutral"}"
                        >
                          ${item.step}. ${item.title}
                        </span>
                      `,
                    )}
                  </div>
                `
              : html``
          }
          <div class="edc-form-section">
            <div class="edc-form-section__title">连接器与凭证</div>
            <div class="form-grid">
            <label class="field full">
              <span>连接器</span>
              <select
                .value=${state.connectorId}
                ?disabled=${state.busy}
                @change=${(event: Event) => {
                  const connectorId = (event.target as HTMLSelectElement).value;
                  const entry = catalog.find((item) => item.connectorId === connectorId);
                  onUpdate({
                    connectorId,
                    category: entry?.category ?? state.category,
                    sourceKey: entry?.defaultSourceKey ?? state.sourceKey,
                    displayName: entry?.label ?? state.displayName,
                    credentialId: "",
                    credentialLabel: "",
                    instanceUrl: "",
                    apiKey: "",
                    authScheme: "bearer",
                    authHeaderName: "",
                    authQueryParam: "",
                    basicUsername: "",
                    probePath: "",
                    dbHost: "",
                    dbPort: "",
                    dbName: "",
                    passwordVisible: false,
                    saveNewCredential: false,
                    orgId: "",
                    appName: "",
                    oauthNotice: null,
                    probeMessage: null,
                    probeOk: null,
                  });
                }}
              >
                <option value="">请选择连接器</option>
                ${catalog.map(
                  (entry) => html`
                    <option value=${entry.connectorId}>
                      ${entry.label} (${entry.integrationTier === "demo" ? "演示" : "生产"})
                    </option>
                  `,
                )}
              </select>
              ${
                selectedConnector
                  ? html`
                      <small>${selectedConnector.description}</small>
                      <small>
                        动作 ${selectedConnector.registeredActionCount} · 处理器
                        ${selectedConnector.runtimeHandlerCount}
                        ${selectedConnector.ready ? " · 已就绪" : " · 待安装连接器包"}
                      </small>
                    `
                  : html``
              }
            </label>
            ${
              isWebsiteSession
                ? renderWebsiteAccessWizard(
                    {
                      outcome: state.websiteOutcome ?? null,
                      selectable: state.websiteSelectable ?? [],
                      bindingId: state.bindingId ?? "",
                      draftBindingId: state.websiteBindingDraft ?? "",
                      busy: state.busy,
                    },
                    {
                      onSelectBinding: (bindingId) => onUpdate({ bindingId }),
                      onDraftBinding: (websiteBindingDraft) => onUpdate({ websiteBindingDraft }),
                      onRegisterOwnedBinding: onRegisterWebsiteBinding,
                    },
                  )
                : html``
            }
            ${
              showCredentialFields
                ? html`
                    <label class="field full">
                      <span>数据连接器凭证</span>
                      <select
                        .value=${state.saveNewCredential ? "__new__" : state.credentialId}
                        ?disabled=${state.busy}
                        @change=${(event: Event) => {
                          const value = (event.target as HTMLSelectElement).value;
                          if (value === "__new__") {
                            onUpdate({
                              saveNewCredential: true,
                              credentialId: "",
                              credentialLabel: "",
                              instanceUrl: "",
                              apiKey: "",
                              dbHost: "",
                              dbPort: "",
                              dbName: "",
                              passwordVisible: false,
                            });
                            return;
                          }
                          const selected = credentials.find((item) => item.credentialId === value);
                          onUpdate({
                            saveNewCredential: false,
                            credentialId: value,
                            credentialLabel: selected?.label ?? "",
                            instanceUrl: selected?.instanceUrl ?? "",
                            apiKey: "",
                            dbHost: "",
                            dbPort: "",
                            dbName: "",
                            passwordVisible: false,
                          });
                        }}
                      >
                        <option value="">不绑定（仅模拟演示）</option>
                        ${credentials.map(
                          (item) => html`
                            <option value=${item.credentialId}>
                              ${item.label}${item.secretHint ? ` (${item.secretHint})` : ""}
                            </option>
                          `,
                        )}
                        <option value="__new__">+ 新建凭证</option>
                      </select>
                    </label>
                    ${
                      showNewCredentialForm && isApiKeyConnector
                        ? html`
                            <label class="field">
                              <span>凭证名称</span>
                              <input
                                .value=${state.credentialLabel}
                                ?disabled=${state.busy}
                                @input=${(event: Event) =>
                                  onUpdate({
                                    credentialLabel: (event.target as HTMLInputElement).value,
                                  })}
                              />
                            </label>
                          `
                        : html``
                    }
                    ${
                      showNewCredentialForm && isApiKeyConnector && !isDatabase
                        ? html`
                            <label class="field full">
                              <span>实例 URL</span>
                              <input
                                .value=${state.instanceUrl}
                                placeholder=${
                                  isHttpRest
                                    ? "https://api.example.com"
                                    : "https://your-instance.example.com"
                                }
                                ?disabled=${state.busy}
                                @input=${(event: Event) =>
                                  onUpdate({
                                    instanceUrl: (event.target as HTMLInputElement).value,
                                  })}
                              />
                            </label>
                            ${renderSecretInput({
                              label: "访问令牌 / API Key",
                              value: state.apiKey,
                              visible: state.passwordVisible,
                              disabled: state.busy,
                              full: true,
                              hint: html`
                                留空则保持已存凭证；填写后将用于真实 API 连通性探测。
                              `,
                              onInput: (value) => onUpdate({ apiKey: value }),
                              onToggle: () => onUpdate({ passwordVisible: !state.passwordVisible }),
                            })}
                          `
                        : html``
                    }
                    ${
                      showNewCredentialForm && isHttpRest
                        ? html`
                            <label class="field">
                              <span>鉴权方式</span>
                              <select
                                .value=${state.authScheme}
                                ?disabled=${state.busy}
                                @change=${(event: Event) =>
                                  onUpdate({
                                    authScheme: (event.target as HTMLSelectElement)
                                      .value as SourceEditorState["authScheme"],
                                  })}
                              >
                                <option value="bearer">Bearer 令牌</option>
                                <option value="header">自定义请求头</option>
                                <option value="query">查询参数</option>
                                <option value="basic">Basic 认证</option>
                                <option value="none">无鉴权</option>
                              </select>
                              <small>令牌取自上方「访问令牌 / API Key」；「无鉴权」时可留空。</small>
                            </label>
                            ${
                              state.authScheme === "header"
                                ? html`
                                    <label class="field">
                                      <span>请求头名称</span>
                                      <input
                                        .value=${state.authHeaderName}
                                        placeholder="X-API-Key"
                                        ?disabled=${state.busy}
                                        @input=${(event: Event) =>
                                          onUpdate({
                                            authHeaderName: (event.target as HTMLInputElement)
                                              .value,
                                          })}
                                      />
                                    </label>
                                  `
                                : html``
                            }
                            ${
                              state.authScheme === "query"
                                ? html`
                                    <label class="field">
                                      <span>查询参数名</span>
                                      <input
                                        .value=${state.authQueryParam}
                                        placeholder="api_key"
                                        ?disabled=${state.busy}
                                        @input=${(event: Event) =>
                                          onUpdate({
                                            authQueryParam: (event.target as HTMLInputElement)
                                              .value,
                                          })}
                                      />
                                    </label>
                                  `
                                : html``
                            }
                            ${
                              state.authScheme === "basic"
                                ? html`
                                    <label class="field">
                                      <span>Basic 用户名</span>
                                      <input
                                        .value=${state.basicUsername}
                                        ?disabled=${state.busy}
                                        @input=${(event: Event) =>
                                          onUpdate({
                                            basicUsername: (event.target as HTMLInputElement).value,
                                          })}
                                      />
                                      <small>密码 / 令牌取自上方「访问令牌 / API Key」。</small>
                                    </label>
                                  `
                                : html``
                            }
                            <label class="field">
                              <span>健康检查路径</span>
                              <input
                                .value=${state.probePath}
                                placeholder="/health"
                                ?disabled=${state.busy}
                                @input=${(event: Event) =>
                                  onUpdate({ probePath: (event.target as HTMLInputElement).value })}
                              />
                              <small>连通性探测请求的相对路径；留空则探测基础 URL（需返回 2xx）。</small>
                            </label>
                          `
                        : html``
                    }
                    ${
                      showNewCredentialForm && isDatabase
                        ? html`
                            <label class="field">
                              <span>主机地址 (Host)</span>
                              <input
                                .value=${state.dbHost}
                                placeholder="192.168.1.100"
                                ?disabled=${state.busy}
                                @input=${(event: Event) =>
                                  onUpdate({ dbHost: (event.target as HTMLInputElement).value })}
                              />
                            </label>
                            <label class="field">
                              <span>端口 (Port)</span>
                              <input
                                .value=${state.dbPort}
                                placeholder=${isMysql ? "3306" : "5432"}
                                ?disabled=${state.busy}
                                @input=${(event: Event) =>
                                  onUpdate({ dbPort: (event.target as HTMLInputElement).value })}
                              />
                            </label>
                            <label class="field full">
                              <span>数据库名 (Database)</span>
                              <input
                                .value=${state.dbName}
                                placeholder="enterprise_prod"
                                ?disabled=${state.busy}
                                @input=${(event: Event) =>
                                  onUpdate({ dbName: (event.target as HTMLInputElement).value })}
                              />
                            </label>
                            <label class="field">
                              <span>用户名 (Username)</span>
                              <input
                                .value=${state.basicUsername}
                                placeholder="readonly_user"
                                ?disabled=${state.busy}
                                @input=${(event: Event) =>
                                  onUpdate({
                                    basicUsername: (event.target as HTMLInputElement).value,
                                  })}
                              />
                            </label>
                            ${renderSecretInput({
                              label: "密码 (Password)",
                              value: state.apiKey,
                              visible: state.passwordVisible,
                              disabled: state.busy,
                              onInput: (value) => onUpdate({ apiKey: value }),
                              onToggle: () => onUpdate({ passwordVisible: !state.passwordVisible }),
                            })}
                            <div class="field full">
                              <small>
                                自动拼装连接串 ${isMysql ? "mysql" : "postgres"}://host:port/dbname；建议使用只读数据库角色，密码加密存储。
                              </small>
                            </div>
                          `
                        : html``
                    }
                    ${
                      showNewCredentialForm && isOAuthConnector
                        ? html`
                            <label class="field">
                              <span>凭证名称</span>
                              <input
                                .value=${state.credentialLabel}
                                ?disabled=${state.busy || state.oauthBusy}
                                @input=${(event: Event) =>
                                  onUpdate({
                                    credentialLabel: (event.target as HTMLInputElement).value,
                                  })}
                              />
                            </label>
                            ${
                              selectedConnector?.connectorId === "erp-yonyou-tplus"
                                ? html`
                                    <label class="field">
                                      <span>云企业 ID (orgId)</span>
                                      <input
                                        .value=${state.orgId ?? ""}
                                        placeholder="畅捷通云企业 ID"
                                        ?disabled=${state.busy || state.oauthBusy}
                                        @input=${(event: Event) =>
                                          onUpdate({
                                            orgId: (event.target as HTMLInputElement).value,
                                          })}
                                      />
                                    </label>
                                    <label class="field">
                                      <span>应用名 (appName)</span>
                                      <input
                                        .value=${state.appName ?? ""}
                                        placeholder="tpluscloud"
                                        ?disabled=${state.busy || state.oauthBusy}
                                        @input=${(event: Event) =>
                                          onUpdate({
                                            appName: (event.target as HTMLInputElement).value,
                                          })}
                                      />
                                    </label>
                                  `
                                : html``
                            }
                            <div class="field full">
                              <button
                                class="btn btn--sm btn--primary"
                                type="button"
                                ?disabled=${
                                  state.busy || state.oauthBusy || !state.credentialLabel.trim()
                                }
                                @click=${onStartOAuth}
                              >
                                ${state.oauthBusy ? "授权中…" : "OAuth 授权"}
                              </button>
                              <small>
                                ${oauthConnectorHint(selectedConnector?.connectorId ?? "")}
                              </small>
                              ${
                                state.oauthNotice
                                  ? html`<small>${state.oauthNotice}</small>`
                                  : html``
                              }
                            </div>
                          `
                        : html``
                    }
                  `
                : html``
            }
            </div>
          </div>
          <div class="edc-form-section">
            <div class="edc-form-section__title">数据源标识与环境</div>
            <div class="form-grid">
            <label class="field">
              <span>数据源键</span>
              <input
                .value=${state.sourceKey}
                ?disabled=${state.busy}
                @input=${(event: Event) =>
                  onUpdate({ sourceKey: (event.target as HTMLInputElement).value })}
              />
            </label>
            <label class="field">
              <span>显示名称</span>
              <input
                .value=${state.displayName}
                ?disabled=${state.busy}
                @input=${(event: Event) =>
                  onUpdate({ displayName: (event.target as HTMLInputElement).value })}
              />
            </label>
            <label class="field">
              <span>分类</span>
              <select
                .value=${state.category}
                ?disabled=${state.busy}
                @change=${(event: Event) =>
                  onUpdate({
                    category: (event.target as HTMLSelectElement)
                      .value as SourceEditorState["category"],
                  })}
              >
                <option value="crm">${DATA_SOURCE_CATEGORY_LABEL.crm}</option>
                <option value="erp">${DATA_SOURCE_CATEGORY_LABEL.erp}</option>
                <option value="finance">${DATA_SOURCE_CATEGORY_LABEL.finance}</option>
                <option value="oa">${DATA_SOURCE_CATEGORY_LABEL.oa}</option>
                <option value="mes">${DATA_SOURCE_CATEGORY_LABEL.mes}</option>
                <option value="external">${DATA_SOURCE_CATEGORY_LABEL.external}</option>
              </select>
            </label>
            <div class="field">
              <span>连接状态</span>
              ${
                state.probeOk === null
                  ? html`
                      <div class="enterprise-mesh-badge enterprise-mesh-badge--warn">未检测</div>
                      <small>保存时将自动检测连通性，并据结果设置状态，无需手动选择。</small>
                    `
                  : html`
                      <div
                        class="enterprise-mesh-badge enterprise-mesh-badge--${
                          state.status === "connected"
                            ? "ok"
                            : state.status === "error"
                              ? "danger"
                              : "warn"
                        }"
                      >
                        ${DATA_SOURCE_STATUS_LABEL[state.status]}
                      </div>
                      <small>由最近一次连通性检测自动判定。</small>
                    `
              }
            </div>
          </div>
          </div>
          <div
            class="enterprise-data-capability__actions enterprise-data-capability__actions--center"
          >
            ${
              showInstallPackage
                ? html`
                    <button
                      class="btn btn--sm"
                      type="button"
                      ?disabled=${state.busy || state.probeBusy || !state.connectorId}
                      @click=${onInstallConnectorPackage}
                    >
                      安装连接器包
                    </button>
                  `
                : html``
            }
            <button
              class="btn btn--sm btn--primary"
              type="button"
              ?disabled=${state.busy || state.probeBusy || !state.connectorId}
              @click=${onTestConnection}
            >
              ${state.probeBusy ? "测试中…" : "测试连通性"}
            </button>
            ${
              state.probeOk === null
                ? html`
                    <span class="enterprise-data-capability__hint">提示：建议先测试连通性</span>
                  `
                : html``
            }
          </div>
        </div>
        <div class="enterprise-org-modal__footer">
          <button class="btn" type="button" ?disabled=${state.busy} @click=${onClose}>取消</button>
          ${
            isCreateSource && state.wizardStep > 1
              ? html`
                  <button
                    class="btn"
                    type="button"
                    ?disabled=${state.busy}
                    @click=${() => onUpdate({ wizardStep: Math.max(1, state.wizardStep - 1) as 1 | 2 | 3 | 4 })}
                  >
                    上一步
                  </button>
                `
              : html``
          }
          ${
            isCreateSource && state.wizardStep < 4
              ? html`
                  <button
                    class="btn"
                    type="button"
                    ?disabled=${state.busy}
                    @click=${() => {
                      if (state.wizardStep === 1 && !state.connectorId.trim()) {
                        onUpdate({ error: "请先选择连接器。" });
                        return;
                      }
                      onUpdate({
                        wizardStep: Math.min(4, state.wizardStep + 1) as 1 | 2 | 3 | 4,
                        error: null,
                      });
                    }}
                  >
                    下一步
                  </button>
                `
              : html``
          }
          <button class="btn btn--primary" type="button" ?disabled=${state.busy} @click=${onSubmit}>
            ${state.busy ? "保存中..." : "保存数据资产"}
          </button>
        </div>
      </section>
    </div>
  `;
}

function renderSourceSyncLogDrawer(
  sourceLabel: string,
  entries: ManagedDataSourceSyncLogEntry[] | null,
  loading: boolean,
  error: string | null,
  onClose: () => void,
): TemplateResult {
  if (!sourceLabel) {
    return html``;
  }
  return html`
    <aside class="enterprise-data-capability__drawer" role="dialog" aria-label="同步日志">
      <div class="enterprise-data-capability__drawer-head">
        <div>
          <div class="enterprise-data-capability__drawer-kind">同步日志</div>
          <div class="enterprise-data-capability__drawer-title">${sourceLabel}</div>
        </div>
        <button type="button" class="btn btn--sm" @click=${onClose}>关闭</button>
      </div>
      <div class="enterprise-data-capability__drawer-body">
        ${
          error
            ? html`<div class="enterprise-data-capability__hint" role="alert">${error}</div>`
            : loading
              ? html`
                  <div class="enterprise-data-capability__hint" aria-busy="true">加载中…</div>
                `
              : entries && entries.length > 0
                ? html`
                  <ul class="enterprise-settings-row-list">
                    ${entries.map(
                      (entry) => html`
                        <li class="enterprise-settings-row">
                          <div>
                            <strong>${entry.title}</strong>
                            <span>${entry.detail}</span>
                            <span>${entry.recordedAt}</span>
                          </div>
                          <span
                            class="enterprise-mesh-badge enterprise-mesh-badge--${
                              entry.status === "success"
                                ? "ok"
                                : entry.status === "warning"
                                  ? "warn"
                                  : "danger"
                            }"
                          >
                            ${entry.status}
                          </span>
                        </li>
                      `,
                    )}
                  </ul>
                `
                : html`
                    <div class="enterprise-data-capability__hint">暂无同步日志</div>
                  `
        }
      </div>
    </aside>
  `;
}

/** Map a data-source status to a colored capsule tone: connected=green, error=amber, disconnected=red. */
function sourceStatusTone(status: ManagedDataSourceRecord["status"]): "ok" | "warn" | "danger" {
  if (status === "connected") {
    return "ok";
  }
  if (status === "error") {
    return "warn";
  }
  return "danger";
}

function renderSourcesManagementSection(params: {
  state: DataCapabilitySurfaceState;
  onOpenCreate: () => void;
  onEdit: (source: ManagedDataSourceRecord) => void;
  onReconnect: (source: ManagedDataSourceRecord) => void;
  onTestConnection: (source: ManagedDataSourceRecord) => void;
  onArchive: (source: ManagedDataSourceRecord) => void;
  onOpenLogs: (source: ManagedDataSourceRecord) => void;
  onSync: (source: ManagedDataSourceRecord) => void;
  onFiltersChange: (patch: Partial<AssetListFilters>) => void;
  onSelectSource: (sourceId: string) => void;
  capabilityHref: (skillId: string) => string;
}): TemplateResult {
  const { state } = params;
  return renderAssetsPageContent(
    {
      sources: state.sources,
      assetFilters: state.assetFilters,
      connectorCatalog: state.connectorCatalog,
      sourcesLoading: state.sourcesLoading,
      sourcesError: state.sourcesError,
      sourcesNotice: state.sourcesNotice,
      linkageBySourceId: new Map(state.assetLinkage.map((item) => [item.sourceId, item])),
      stats: state.assetStats,
      selectedSourceId: state.selectedAssetSourceId,
      capabilityHref: params.capabilityHref,
    },
    {
      onOpenCreate: params.onOpenCreate,
      onEdit: params.onEdit,
      onReconnect: params.onReconnect,
      onTestConnection: params.onTestConnection,
      onArchive: params.onArchive,
      onOpenLogs: params.onOpenLogs,
      onSync: params.onSync,
      onFiltersChange: params.onFiltersChange,
      onSelectSource: params.onSelectSource,
    },
    {
      formatCategory: formatDataSourceCategory,
      formatStatus: formatDataSourceStatus,
      formatTimestamp: formatApprovalTimestamp,
      statusTone: sourceStatusTone,
      renderStatusBadge: renderDataStatusBadge,
    },
  );
}

function renderApprovalDecisionModal(
  state: ApprovalDecisionState,
  onClose: () => void,
  onSubmit: () => void,
  onUpdate: (patch: Partial<ApprovalDecisionState>) => void,
): TemplateResult {
  if (!state.open) {
    return html``;
  }
  return html`
    <div
      class="enterprise-org-modal-overlay"
      @click=${(event: MouseEvent) => {
        if (event.target === event.currentTarget && !state.busy) {
          onClose();
        }
      }}
    >
      <section class="enterprise-org-modal" role="dialog" aria-modal="true" aria-label="审批决策">
        <div class="enterprise-org-modal__header">
          <div>
            <div class="enterprise-org-modal__title">审批决策</div>
            <div class="enterprise-org-modal__sub">${state.displayName} · ${formatGovernanceCategory(state.category)}</div>
          </div>
          <button class="btn btn--sm" type="button" ?disabled=${state.busy} @click=${onClose}>
            关闭
          </button>
        </div>
        <div class="enterprise-org-modal__body">
          <div class="form-grid">
            <label class="field">
              <span>决策</span>
              <select
                .value=${state.decision}
                ?disabled=${state.busy}
                @change=${(event: Event) =>
                  onUpdate({
                    decision: (event.target as HTMLSelectElement)
                      .value as ApprovalDecisionState["decision"],
                  })}
              >
                <option value="approved">批准</option>
                <option value="rejected">拒绝</option>
              </select>
            </label>
            ${
              state.decision === "approved" &&
              governanceCategorySupportsApproveAndProvision(state.category)
                ? html`
                    <label class="field full">
                      <span>开通方式</span>
                      <select
                        data-approval-fulfillment-mode
                        .value=${state.fulfillmentMode}
                        ?disabled=${state.busy}
                        @change=${(event: Event) =>
                          onUpdate({
                            fulfillmentMode: (event.target as HTMLSelectElement)
                              .value as ApprovalDecisionState["fulfillmentMode"],
                          })}
                      >
                        <option value="approve_intent_only">仅批准，稍后在数据能力中心开通</option>
                        <option value="approve_and_provision">批准并开通</option>
                      </select>
                    </label>
                    ${
                      state.fulfillmentMode === "approve_and_provision"
                        ? html`<p class="enterprise-org-modal__sub" data-mcp-provision-risk>
                            ${MCP_APPROVE_AND_PROVISION_RISK_ZH}
                          </p>`
                        : html``
                    }
                  `
                : html``
            }
            <label class="field full">
              <span>审批意见</span>
              <textarea
                class="enterprise-org-modal__textarea"
                .value=${state.decisionNote}
                ?disabled=${state.busy}
                @input=${(event: Event) =>
                  onUpdate({ decisionNote: (event.target as HTMLTextAreaElement).value })}
              ></textarea>
            </label>
          </div>
          ${
            state.error
              ? html`
                <div class="enterprise-org-modal__notice enterprise-org-modal__notice--danger">
                  ${state.error}
                </div>
              `
              : html``
          }
        </div>
        <div class="enterprise-org-modal__footer">
          <button class="btn" type="button" ?disabled=${state.busy} @click=${onClose}>取消</button>
          <button
            class="btn ${state.decision === "approved" ? "btn--approve" : "btn--danger"}"
            type="button"
            ?disabled=${state.busy}
            @click=${onSubmit}
          >
            ${
              state.busy
                ? "处理中..."
                : state.decision === "approved"
                  ? state.fulfillmentMode === "approve_and_provision" &&
                    governanceCategorySupportsApproveAndProvision(state.category)
                    ? "批准并开通"
                    : "批准"
                  : "拒绝"
            }
          </button>
        </div>
      </section>
    </div>
  `;
}

function renderApprovalsManagementSection(params: {
  state: DataCapabilitySurfaceState;
  readModel: EnterprisePortReadModel;
  onSelectTab: (tab: "pending" | "history") => void;
  onOpenDecision: (
    request: ManagedGovernanceApprovalRequest,
    decision: "approved" | "rejected",
  ) => void;
  onOpenDetail: (request: ManagedGovernanceApprovalRequest) => void;
  onFulfillPackSkillReview?: (request: ManagedGovernanceApprovalRequest) => void;
  onRetryMcpProvision?: (request: ManagedGovernanceApprovalRequest) => void;
}): TemplateResult {
  const { state, readModel } = params;
  const memberLookup = buildOrganizationMemberDisplayLookup(readModel.memberSummaries ?? []);
  const seatById = new Map(
    (readModel.seatSummaries ?? []).map((seat) => [seat.seatId, seat] as const),
  );
  const seatPositionName = (seatId: string | undefined): string | null => {
    if (!seatId) {
      return null;
    }
    const seat = seatById.get(seatId);
    return seat ? resolveOrganizationSeatDisplayName(seat.title) : null;
  };
  const seatPersonName = (seatId: string | undefined): string | null => {
    if (!seatId) {
      return null;
    }
    const seat = seatById.get(seatId);
    if (!seat) {
      return null;
    }
    return resolveOrganizationMemberDisplayLabel({
      lookup: memberLookup,
      userId: seat.currentEmployeeUser,
      explicitDisplayName: seat.currentEmployeeLabel,
    });
  };
  const pending = state.approvalRequests.filter((request) => request.status === "pending");
  const history = state.approvalRequests.filter((request) => request.status !== "pending");
  const tab = state.approvalsTab;
  const categoryOrder: ManagedGovernanceApprovalRequest["category"][] = [
    "source_onboarding",
    "data_access",
    "capability_exposure",
    "identity_binding",
    "seat_capability_access",
    "enterprise_knowledge_access",
    "mcp_tool_mapping",
    "oi_enrollment",
    "pack_skill_review",
  ];
  const rows = (tab === "pending" ? pending : history).toSorted((left, right) => {
    const leftIndex = categoryOrder.indexOf(left.category);
    const rightIndex = categoryOrder.indexOf(right.category);
    return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
  });

  const renderSubject = (request: ManagedGovernanceApprovalRequest): TemplateResult => {
    const position = seatPositionName(request.requesterSeatId);
    const person = seatPersonName(request.requesterSeatId);
    if (position && person) {
      return html`<span>${position} · ${person}</span>`;
    }
    if (position) {
      return html`<span>${position}</span>`;
    }
    const requestedBy = resolveOrganizationHumanLabel(request.requestedBy);
    return html`<span>${requestedBy ?? "员工"}</span>`;
  };
  const applicantName = (request: ManagedGovernanceApprovalRequest): string =>
    seatPersonName(request.requesterSeatId) ??
    resolveOrganizationHumanLabel(request.requestedBy) ??
    "未绑定成员";
  const assetLabel = (displayName: string): string => {
    const stripped = stripOrganizationSeatIdSuffix(displayName);
    return resolveOrganizationHumanLabel(stripped) ?? "数据能力";
  };

  return html`
    <section class="enterprise-data-capability__panel enterprise-data-capability__panel--flat">
      <div class="edc-tabs" role="tablist" aria-label="审批列表">
        <button
          class="edc-tab ${tab === "pending" ? "is-active" : ""}"
          type="button"
          role="tab"
          aria-selected=${tab === "pending"}
          @click=${() => params.onSelectTab("pending")}
        >
          待我审批（${pending.length}）
        </button>
        <button
          class="edc-tab ${tab === "history" ? "is-active" : ""}"
          type="button"
          role="tab"
          aria-selected=${tab === "history"}
          @click=${() => params.onSelectTab("history")}
        >
          已处理历史（${history.length}）
        </button>
      </div>
      ${
        state.approvalsError && !state.approvalsLoading
          ? html`<div class="enterprise-data-capability__hint" role="alert">
              ${state.approvalsError}
            </div>`
          : state.approvalsLoading
            ? html`
                <div class="enterprise-data-capability__hint" aria-busy="true">加载中…</div>
              `
            : rows.length === 0
              ? html`
                  <div class="enterprise-data-capability__hint">
                    ${tab === "pending" ? "暂无待我审批的请求" : "暂无历史审批记录"}
                  </div>
                `
              : html`
                  <table class="edc-console-table">
                    <thead>
                      <tr>
                        <th>申请类型</th>
                        <th>目标资产</th>
                        <th>申请主体</th>
                        <th>${tab === "pending" ? "申请时间" : "处理时间"}</th>
                        <th class="edc-console-table__actions">
                          ${tab === "pending" ? "操作" : "状态"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      ${rows.map((request, index) => {
                        const expanded =
                          state.approvalDetailId === request.approvalId && state.approvalDetail;
                        const timeIso =
                          tab === "history" && request.decidedAt
                            ? request.decidedAt
                            : request.requestedAt;
                        const showCategory =
                          index === 0 || rows[index - 1]?.category !== request.category;
                        return html`
                          ${
                            showCategory
                              ? html`
                                  <tr>
                                    <th colspan="5">
                                      ${
                                        GOVERNANCE_CATEGORY_LABEL[request.category] ??
                                        request.category
                                      }
                                    </th>
                                  </tr>
                                `
                              : html``
                          }
                          <tr>
                            <td>
                              ${GOVERNANCE_CATEGORY_LABEL[request.category] ?? request.category}
                            </td>
                            <td>${assetLabel(request.displayName)}</td>
                            <td>${renderSubject(request)}</td>
                            <td>${formatApprovalTimestamp(timeIso)}</td>
                            <td class="edc-console-table__actions">
                              <button
                                class="btn btn--sm"
                                type="button"
                                @click=${() => params.onOpenDetail(request)}
                              >
                                ${
                                  state.approvalDetailId === request.approvalId
                                    ? "收起"
                                    : "查看详情"
                                }
                              </button>
                              ${
                                tab === "pending"
                                  ? html`
                                      <button
                                        class="btn btn--sm btn--danger"
                                        type="button"
                                        @click=${() => params.onOpenDecision(request, "rejected")}
                                      >
                                        拒绝
                                      </button>
                                      <button
                                        class="btn btn--sm btn--approve"
                                        type="button"
                                        @click=${() => params.onOpenDecision(request, "approved")}
                                      >
                                        批准
                                      </button>
                                    `
                                  : renderApprovalStatusBadge(request.status)
                              }
                            </td>
                          </tr>
                          ${
                            expanded && state.approvalDetail
                              ? html`
                                  <tr class="edc-detail-row">
                                    <td colspan="5">
                                      <div class="edc-detail-grid">
                                        <span>申请人：${applicantName(state.approvalDetail)}</span>
                                        ${
                                          seatPositionName(state.approvalDetail.requesterSeatId)
                                            ? html`<span
                                                >申请岗位：${seatPositionName(state.approvalDetail.requesterSeatId)}</span
                                              >`
                                            : html``
                                        }
                                        ${
                                          state.approvalDetail.reason
                                            ? html`<span
                                                >申请原因：${state.approvalDetail.reason}</span
                                              >`
                                            : html``
                                        }
                                        ${
                                          state.approvalDetail.decisionNote
                                            ? html`<span
                                                >审批意见：${state.approvalDetail.decisionNote}</span
                                              >`
                                            : html``
                                        }
                                        ${
                                          state.approvalDetail.fulfillmentStatus
                                            ? html`<span
                                                >开通状态：${governanceFulfillmentStatusLabel(
                                                  state.approvalDetail.fulfillmentStatus,
                                                )}</span
                                              >`
                                            : html``
                                        }
                                        ${
                                          state.approvalDetail.category === "mcp_tool_mapping" &&
                                          state.approvalDetail.fulfillmentStatus ===
                                            "pending_admin_save"
                                            ? html`<span
                                                >去 EDC 开通：携带 requestId=${state.approvalDetail.approvalId}（显式 Save，不会自动授权）</span
                                              >`
                                            : html``
                                        }
                                        ${
                                          state.approvalDetail.category === "mcp_tool_mapping" &&
                                          state.approvalDetail.fulfillmentStatus === "failed"
                                            ? html`<span
                                                >${
                                                  state.approvalDetail.provisionError ??
                                                  "开通失败。可重试开通，审批结论保持已批准。"
                                                }</span
                                              >
                                              ${
                                                params.onRetryMcpProvision
                                                  ? html`<button
                                                      class="btn btn--sm"
                                                      type="button"
                                                      data-retry-mcp-provision
                                                      @click=${() =>
                                                        params.onRetryMcpProvision?.(
                                                          state.approvalDetail!,
                                                        )}
                                                    >
                                                      重试开通
                                                    </button>`
                                                  : html``
                                              }`
                                            : html``
                                        }
                                        ${
                                          state.approvalDetail.category === "pack_skill_review" &&
                                          (state.approvalDetail.fulfillmentStatus ===
                                            "pending_admin_save" ||
                                            state.approvalDetail.fulfillmentStatus === "failed")
                                            ? html`<span
                                                >Pack 技能审核已批准，尚未开通。标记开通后，员工才能确认安装；不会自动安装，也不会写入凭证。</span
                                              >
                                              ${
                                                params.onFulfillPackSkillReview
                                                  ? html`<button
                                                      class="btn btn--sm"
                                                      type="button"
                                                      @click=${() =>
                                                        params.onFulfillPackSkillReview?.(
                                                          state.approvalDetail!,
                                                        )}
                                                    >
                                                      标记开通
                                                    </button>`
                                                  : html``
                                              }`
                                            : state.approvalDetail.category ===
                                                  "pack_skill_review" &&
                                                state.approvalDetail.fulfillmentStatus ===
                                                  "fulfilled"
                                              ? html`
                                                  <span>已开通。员工可以确认安装，系统不会自动安装。</span>
                                                `
                                              : html``
                                        }
                                      </div>
                                    </td>
                                  </tr>
                                `
                              : html``
                          }
                        `;
                      })}
                    </tbody>
                  </table>
                `
      }
      ${
        state.approvalsNotice
          ? html`<div class="enterprise-org-modal__notice enterprise-org-modal__notice--ok">
              ${state.approvalsNotice}
            </div>`
          : html``
      }
    </section>
  `;
}

function renderAuthorizationManagementSection(params: {
  state: DataCapabilitySurfaceState;
  onOpenCreate: () => void;
  onEdit: (policy: ManagedAccessPolicyRecord) => void;
  onArchive: (policy: ManagedAccessPolicyRecord) => void;
  onOpenDetail: (policy: ManagedAccessPolicyRecord) => void;
}): TemplateResult {
  const { state } = params;
  return html`
    <section class="enterprise-data-capability__panel enterprise-data-capability__panel--flat">
      <div class="edc-matrix-toolbar">
        <button class="btn btn--sm" type="button" @click=${params.onOpenCreate}>新建策略</button>
      </div>
      ${
        state.policiesError && !state.policiesLoading
          ? html`<div class="enterprise-data-capability__hint" role="alert">${state.policiesError}</div>`
          : state.policiesLoading
            ? html`
                <div class="enterprise-data-capability__hint" aria-busy="true">加载中…</div>
              `
            : state.policies.length === 0
              ? html`
                  <div class="edc-empty">
                    <strong>暂无授权策略</strong>
                    <p class="muted">为岗位、角色或部门配置默认可调用的数据动作。</p>
                    <button class="btn btn--sm" type="button" @click=${params.onOpenCreate}>
                      新建策略
                    </button>
                  </div>
                `
              : html`
                <ul class="enterprise-settings-row-list edc-policy-list">
                  ${state.policies.map(
                    (policy) => html`
                      <li class="enterprise-settings-row edc-policy-row">
                        <div class="enterprise-settings-row__main">
                          <div class="enterprise-settings-row__title">${policy.displayName}</div>
                          <div class="enterprise-settings-row__meta">
                            <span
                              >${formatPolicyTargetKind(policy.targetKind)}：${policy.targetId}</span
                            >
                            <span>·</span>
                            <span
                              >${policy.actionRefs.length} 个动作 ·
                              ${policy.enabled ? "启用" : "停用"}</span
                            >
                            ${
                              policy.targetKind !== "seat"
                                ? html`
                                    <span class="edc-policy-chip" title="部门/角色为仅登记目标，不编译为运行时席位授权">仅登记</span>
                                  `
                                : html``
                            }
                          </div>
                        </div>
                        <div class="enterprise-settings-row__actions">
                          <button
                            class="btn btn--sm"
                            type="button"
                            @click=${() => params.onOpenDetail(policy)}
                          >
                            ${state.policyDetailId === policy.policyId ? "收起" : "详情"}
                          </button>
                          <button
                            class="btn btn--sm"
                            type="button"
                            @click=${() => params.onEdit(policy)}
                          >
                            编辑
                          </button>
                          <button
                            class="btn btn--sm btn--danger"
                            type="button"
                            @click=${() => params.onArchive(policy)}
                          >
                            删除
                          </button>
                        </div>
                      </li>
                    `,
                  )}
                </ul>
              `
      }
      ${
        state.policyCompileNotice
          ? html`<div class="enterprise-org-modal__notice enterprise-org-modal__notice--ok">${state.policyCompileNotice}</div>`
          : html``
      }
      ${
        state.policiesNotice
          ? html`<div class="enterprise-org-modal__notice enterprise-org-modal__notice--ok">${state.policiesNotice}</div>`
          : html``
      }
    </section>
  `;
}

function renderCapabilitiesManagementSection(params: {
  state: DataCapabilitySurfaceState;
  readModel: EnterprisePortReadModel;
  onOpenCreate: () => void;
  onEdit: (capability: ManagedCapabilityRecord) => void;
  onArchive: (capability: ManagedCapabilityRecord) => void;
  onOpenDetail: (capability: ManagedCapabilityRecord) => void;
  onGrantSeat: () => void | Promise<void>;
  onSelectCapability: (capabilityId: string) => void;
  onToggleSeat: (seatId: string) => void;
  onSelectDepartment: (departmentPath: string) => void;
  onRemoveSeat: (seatId: string) => void;
  onClearDepartment: (departmentPath: string) => void;
  onClearAll: () => void;
  onQueryChange: (value: string) => void;
}): TemplateResult {
  const { state } = params;
  return renderProductsCatalog(
    {
      capabilities: state.capabilities,
      capabilitiesLoading: state.capabilitiesLoading,
      capabilitiesError: state.capabilitiesError,
      capabilitiesNotice: state.capabilitiesNotice,
      capabilityDetailId: state.capabilityDetailId,
      capabilityDetail: state.capabilityDetail,
    },
    {
      onOpenCreate: params.onOpenCreate,
      onEdit: params.onEdit,
      onArchive: params.onArchive,
      onOpenDetail: params.onOpenDetail,
    },
  );
}

function renderCapabilityDetailPanel(params: {
  detail: ManagedCapabilityGovernanceView | null;
  loading: boolean;
  error: string | null;
  state: DataCapabilitySurfaceState;
  readModel: EnterprisePortReadModel;
  onGrantSeat: () => void | Promise<void>;
  onToggleSeat: (seatId: string) => void;
  onSelectDepartment: (departmentPath: string) => void;
  onRemoveSeat: (seatId: string) => void;
  onClearDepartment: (departmentPath: string) => void;
  onClearAll: () => void;
  onQueryChange: (value: string) => void;
  onOpenAudit?: () => void;
  onOpenOutputs?: () => void;
}): TemplateResult {
  if (params.loading) {
    return html`
      <div class="enterprise-data-capability__hint" aria-busy="true">加载产品详情…</div>
    `;
  }
  if (params.error) {
    return html`<div class="enterprise-data-capability__hint" role="alert">${params.error}</div>`;
  }
  if (!params.detail) {
    return html``;
  }
  return renderProductDetailPanel({
    detail: params.detail,
    readModel: params.readModel,
    seatQuery: params.state.seatGrantQuery,
    selectedSeatIds: params.state.seatGrantSeatIds,
    selectedDepartmentPaths: params.state.seatGrantDepartmentPaths,
    grantBusy: params.state.seatGrantBusy,
    grantNotice: params.state.seatGrantNotice,
    materializationFailureCount: params.state.projectionAuditFailureCount,
    onGrantSeat: () => {
      params.state.seatGrantCapabilityId = params.detail!.capability.capabilityId;
      return params.onGrantSeat();
    },
    onToggleSeat: params.onToggleSeat,
    onSelectDepartment: params.onSelectDepartment,
    onRemoveSeat: params.onRemoveSeat,
    onClearDepartment: params.onClearDepartment,
    onClearAll: params.onClearAll,
    onQueryChange: params.onQueryChange,
    onOpenAudit: params.onOpenAudit,
    onOpenOutputs: params.onOpenOutputs,
  });
}

function renderPolicyDetailPanel(
  detail: ManagedAccessPolicyDetail | null,
  loading: boolean,
  error: string | null,
  onRevokeGrant: (grantId: string) => void,
  onCompile?: (policy: ManagedAccessPolicyRecord) => void,
  seatPositionById: ReadonlyMap<string, string> = new Map(),
): TemplateResult {
  if (loading) {
    return html`
      <div class="enterprise-data-capability__hint" aria-busy="true">加载策略详情…</div>
    `;
  }
  if (error) {
    return html`<div class="enterprise-data-capability__hint" role="alert">${error}</div>`;
  }
  if (!detail) {
    return html``;
  }
  const canCompile = detail.policy.targetKind === "seat" && typeof onCompile === "function";
  return html`
    <section class="enterprise-data-capability__panel enterprise-data-capability__panel--flat edc-policy-detail">
      <div class="edc-section-head">
        <div class="edc-section-label">策略详情</div>
        ${
          canCompile
            ? html`
                <button
                  class="btn btn--sm"
                  type="button"
                  @click=${() => onCompile?.(detail.policy)}
                >
                  编译为席位授权
                </button>
              `
            : html``
        }
      </div>
      <dl class="edc-kv-stack">
        <div class="edc-kv-stack__row">
          <dt>名称</dt>
          <dd>${detail.policy.displayName}</dd>
        </div>
        <div class="edc-kv-stack__row">
          <dt>运行时动作</dt>
          <dd>
            ${
              detail.runtimeActionRefs
                .map((ref) => `${ref.connectorId}:${ref.actionKey}:${ref.version}`)
                .join(" / ") || "—"
            }
          </dd>
        </div>
        <div class="edc-kv-stack__row">
          <dt>已编译授权</dt>
          <dd>${detail.compiledGrants.length}</dd>
        </div>
      </dl>
      ${
        detail.compiledGrants.length > 0
          ? html`
              <ul class="enterprise-settings-row-list edc-policy-list">
                ${detail.compiledGrants.map(
                  (grant) => html`
                    <li class="enterprise-settings-row edc-policy-row">
                      <div class="enterprise-settings-row__main">
                        <div class="enterprise-settings-row__title">
                          ${seatPositionById.get(grant.seatId) ?? "岗位"}
                        </div>
                        <div class="enterprise-settings-row__meta">
                          <span>${grant.connectorId}:${grant.actionKey}:${grant.version}</span>
                          ${
                            grant.revokedAt
                              ? html`<span>· 已撤销：${grant.revokedAt}</span>`
                              : html``
                          }
                        </div>
                      </div>
                      ${
                        grant.revokedAt
                          ? html``
                          : html`
                              <div class="enterprise-settings-row__actions">
                                <button
                                  class="btn btn--sm"
                                  type="button"
                                  @click=${() => onRevokeGrant(grant.grantId)}
                                >
                                  撤销授权
                                </button>
                              </div>
                            `
                      }
                    </li>
                  `,
                )}
              </ul>
            `
          : html``
      }
    </section>
  `;
}

function roleOptionLabel(
  role: OrgTargets["roles"][number],
  readModel: EnterprisePortReadModel,
): string {
  const titles = [
    ...new Set(
      (readModel.seatSummaries ?? [])
        .filter((seat) => seat.roleCode === role.roleCode)
        .map((seat) => resolveOrganizationSeatDisplayName(seat.title))
        .filter((title) => title !== "待补岗位名"),
    ),
  ];
  const count = `${role.seatCount} 个岗位`;
  return titles.length > 0 ? `${titles.join("、")} · ${count}` : count;
}

type PolicyTargetPickerBinding = {
  readModel: EnterprisePortReadModel;
  seatIds: ReadonlySet<string>;
  departmentPaths: ReadonlySet<string>;
  query: string;
  roles: OrgTargets["roles"];
  onToggleSeat: (seatId: string) => void;
  onToggleDepartment: (path: string) => void;
  onRemoveSeat: (seatId: string) => void;
  onRemoveDepartment: (path: string) => void;
  onClearAll: () => void;
  onSelectRole: (roleCode: string) => void;
  onQueryChange: (value: string) => void;
};

function renderPolicyEditorModal(
  state: PolicyEditorState,
  sourceOptions: ManagedDataSourceRecord[],
  scopePolicies: ManagedScopePolicyRecord[],
  approvalPolicies: ManagedApprovalPolicyRecord[],
  actionsCatalog: ManagedConnectorActionRecord[],
  picker: PolicyTargetPickerBinding,
  onClose: () => void,
  onSubmit: () => void,
  onUpdate: (patch: Partial<PolicyEditorState>) => void,
): TemplateResult {
  if (!state.open) {
    return html``;
  }
  return html`
    <div class="enterprise-org-modal-overlay" @click=${(event: MouseEvent) => {
      if (event.target === event.currentTarget && !state.busy) {
        onClose();
      }
    }}>
      <section class="enterprise-org-modal" role="dialog" aria-modal="true" aria-label="授权策略编辑">
        <div class="enterprise-org-modal__header">
          <div>
            <div class="enterprise-org-modal__title">${state.policyId ? "编辑授权策略" : "新建授权策略"}</div>
            <div class="enterprise-org-modal__sub">配置目标、来源数据源、动作、范围策略与审批策略。</div>
          </div>
          <button class="btn btn--sm" type="button" ?disabled=${state.busy} @click=${onClose}>关闭</button>
        </div>
        <div class="enterprise-org-modal__body">
          <div class="form-grid">
            <label class="field full">
              <span>策略名称</span>
              <input .value=${state.displayName} ?disabled=${state.busy}
                @input=${(event: Event) => onUpdate({ displayName: (event.target as HTMLInputElement).value })} />
            </label>
            <div class="field full">
              <span>授权目标</span>
              ${renderOrgTargetPicker({
                readModel: picker.readModel,
                query: picker.query,
                selectedSeatIds: picker.seatIds,
                selectedDepartmentPaths: picker.departmentPaths,
                disabled: state.busy,
                hint: "勾选岗位可多选（每个岗位生成一条策略）；勾选部门创建部门级策略。",
                onQueryChange: picker.onQueryChange,
                onToggleSeat: picker.onToggleSeat,
                onToggleDepartment: picker.onToggleDepartment,
                onRemoveSeat: picker.onRemoveSeat,
                onRemoveDepartment: picker.onRemoveDepartment,
                onClearAll: picker.onClearAll,
              })}
            </div>
            ${
              picker.roles.length > 0
                ? html`
                    <label class="field">
                      <span>或按角色授权（仅登记）</span>
                      <select
                        .value=${state.targetKind === "role" ? state.targetId : ""}
                        ?disabled=${state.busy}
                        @change=${(event: Event) =>
                          picker.onSelectRole((event.target as HTMLSelectElement).value)}
                      >
                        <option value="">不按角色</option>
                        ${picker.roles.map(
                          (role) => html`
                            <option value=${role.roleCode}>
                              ${roleOptionLabel(role, picker.readModel)}
                            </option>
                          `,
                        )}
                      </select>
                    </label>
                  `
                : html``
            }
            <label class="field">
              <span>数据源</span>
              <select .value=${state.sourceId} ?disabled=${state.busy}
                @change=${(event: Event) => onUpdate({ sourceId: (event.target as HTMLSelectElement).value })}>
                <option value="">请选择</option>
                ${sourceOptions.map(
                  (source) => html`<option value=${source.sourceId}>${source.displayName}</option>`,
                )}
              </select>
            </label>
            <label class="field">
              <span>范围策略</span>
              <select .value=${state.scopePolicyId} ?disabled=${state.busy}
                @change=${(event: Event) => onUpdate({ scopePolicyId: (event.target as HTMLSelectElement).value })}>
                <option value="">无</option>
                ${scopePolicies.map(
                  (policy) =>
                    html`<option value=${policy.scopePolicyId}>${policy.displayName}</option>`,
                )}
              </select>
            </label>
            <label class="field">
              <span>审批策略</span>
              <select .value=${state.approvalPolicyId} ?disabled=${state.busy}
                @change=${(event: Event) => onUpdate({ approvalPolicyId: (event.target as HTMLSelectElement).value })}>
                <option value="">无</option>
                ${approvalPolicies.map(
                  (policy) =>
                    html`<option value=${policy.approvalPolicyId}>${policy.displayName}</option>`,
                )}
              </select>
            </label>
            <label class="field full">
              <span>动作引用（connector:action:version，每行一条）</span>
              <textarea
                class="enterprise-org-modal__textarea"
                .value=${state.actionRefTokens}
                ?disabled=${state.busy}
                @input=${(event: Event) =>
                  onUpdate({ actionRefTokens: (event.target as HTMLTextAreaElement).value })}
              ></textarea>
              <small>可用动作：${actionsCatalog.map((action) => `${action.connectorId}:${action.actionKey}:${action.version}`).join(" / ")}</small>
            </label>
          </div>
          ${
            state.error
              ? html`<div class="enterprise-org-modal__notice enterprise-org-modal__notice--danger">${state.error}</div>`
              : html``
          }
        </div>
        <div class="enterprise-org-modal__footer">
          <button class="btn" type="button" ?disabled=${state.busy} @click=${onClose}>取消</button>
          <button class="btn btn--primary" type="button" ?disabled=${state.busy} @click=${onSubmit}>
            ${state.busy ? "保存中..." : "保存策略"}
          </button>
        </div>
      </section>
    </div>
  `;
}

function renderProjectionEditorModal(
  state: ProjectionEditorState,
  actionsCatalog: ManagedConnectorActionRecord[],
  capabilities: ManagedCapabilityRecord[],
  onClose: () => void,
  onSubmit: () => void,
  onUpdate: (patch: Partial<ProjectionEditorState>) => void,
): TemplateResult {
  if (!state.open) {
    return html``;
  }
  return html`
    <div
      class="enterprise-org-modal-overlay"
      @click=${(event: MouseEvent) => {
        if (event.target === event.currentTarget && !state.busy) {
          onClose();
        }
      }}
    >
      <section
        class="enterprise-org-modal"
        role="dialog"
        aria-modal="true"
        aria-label="新建输出规格"
      >
        <div class="enterprise-org-modal__header">
          <div>
            <div class="enterprise-org-modal__title">新建输出规格</div>
            <div class="enterprise-org-modal__sub">
              定义「数据能力动作 → 模板 → 知识对象」的供给配方，并同时创建供给绑定。
            </div>
          </div>
          <button class="btn btn--sm" type="button" ?disabled=${state.busy} @click=${onClose}>
            关闭
          </button>
        </div>
        <div class="enterprise-org-modal__body">
          ${
            state.error
              ? html`
                  <div class="edc-form-banner edc-form-banner--danger" role="alert">
                    <div class="edc-form-banner__title">创建失败</div>
                    <div class="edc-form-banner__code">${state.error}</div>
                  </div>
                `
              : html``
          }
          <div class="edc-form-section">
            <div class="edc-form-section__title">投影规格</div>
            <div class="form-grid">
              <label class="field">
                <span>投影标识 (Key)</span>
                <input
                  .value=${state.projectionKey}
                  placeholder="customer.profile"
                  ?disabled=${state.busy}
                  @input=${(event: Event) =>
                    onUpdate({ projectionKey: (event.target as HTMLInputElement).value })}
                />
              </label>
              <label class="field">
                <span>显示名称</span>
                <input
                  .value=${state.displayName}
                  placeholder="客户画像"
                  ?disabled=${state.busy}
                  @input=${(event: Event) =>
                    onUpdate({ displayName: (event.target as HTMLInputElement).value })}
                />
              </label>
              <label class="field">
                <span>分类</span>
                <select
                  .value=${state.category}
                  ?disabled=${state.busy}
                  @change=${(event: Event) =>
                    onUpdate({ category: (event.target as HTMLSelectElement).value })}
                >
                  <option value="customer">客户</option>
                  <option value="sales">销售</option>
                  <option value="finance">财务</option>
                  <option value="inventory">库存</option>
                  <option value="project">项目</option>
                </select>
              </label>
              <label class="field">
                <span>对象类型</span>
                <select
                  .value=${state.objectKind}
                  ?disabled=${state.busy}
                  @change=${(event: Event) =>
                    onUpdate({ objectKind: (event.target as HTMLSelectElement).value })}
                >
                  <option value="data">数据 (Data)</option>
                  <option value="metric">指标 (Metric)</option>
                  <option value="insight">洞察 (Insight)</option>
                </select>
              </label>
              <label class="field">
                <span>模板</span>
                <select
                  .value=${state.templateKey}
                  ?disabled=${state.busy}
                  @change=${(event: Event) =>
                    onUpdate({ templateKey: (event.target as HTMLSelectElement).value })}
                >
                  <option value="NormalizeTemplate">规范化 Normalize</option>
                  <option value="AggregateTemplate">聚合 Aggregate</option>
                  <option value="TrendTemplate">趋势 Trend</option>
                  <option value="RiskDetectionTemplate">风险检测 RiskDetection</option>
                  <option value="ForecastTemplate">预测 Forecast</option>
                </select>
              </label>
              <label class="field">
                <span>生命周期</span>
                <select
                  .value=${state.lifecycle}
                  ?disabled=${state.busy}
                  @change=${(event: Event) =>
                    onUpdate({ lifecycle: (event.target as HTMLSelectElement).value })}
                >
                  <option value="active">启用 Active</option>
                  <option value="draft">草稿 Draft</option>
                  <option value="deprecated">弃用 Deprecated</option>
                  <option value="frozen">冻结 Frozen</option>
                </select>
              </label>
              <label class="field full">
                <span>源动作（来自数据能力的动作）</span>
                <select
                  .value=${state.sourceActionToken}
                  ?disabled=${state.busy}
                  @change=${(event: Event) =>
                    onUpdate({ sourceActionToken: (event.target as HTMLSelectElement).value })}
                >
                  <option value="">请选择源动作</option>
                  ${actionsCatalog.map((action) => {
                    const token = `${action.connectorId}:${action.actionKey}:${action.version}`;
                    return html`
                      <option value=${token}>
                        ${action.displayName}（${action.actionKey}:${action.version}）
                      </option>
                    `;
                  })}
                </select>
                ${
                  actionsCatalog.length === 0
                    ? html`
                        <small>暂无可用动作，请先在「数据资产」安装/配置连接器动作。</small>
                      `
                    : html``
                }
              </label>
              <label class="field full">
                <span>关联数据能力（可选治理关联）</span>
                <select
                  .value=${state.capabilityId}
                  ?disabled=${state.busy}
                  @change=${(event: Event) =>
                    onUpdate({ capabilityId: (event.target as HTMLSelectElement).value })}
                >
                  <option value="">（不关联）</option>
                  ${capabilities.map(
                    (capability) =>
                      html`<option value=${capability.capabilityId}>
                        ${capability.displayName}
                      </option>`,
                  )}
                </select>
              </label>
              <label class="field full">
                <span>描述（可选）</span>
                <textarea
                  class="enterprise-org-modal__textarea"
                  .value=${state.description}
                  placeholder="说明该投影的业务用途与产出对象边界…"
                  ?disabled=${state.busy}
                  @input=${(event: Event) =>
                    onUpdate({ description: (event.target as HTMLTextAreaElement).value })}
                ></textarea>
              </label>
            </div>
          </div>
          <div class="edc-form-section">
            <div class="edc-form-section__title">供给绑定</div>
            <div class="form-grid">
              <label class="field">
                <span>触发模式</span>
                <select
                  .value=${state.materializationMode}
                  ?disabled=${state.busy}
                  @change=${(event: Event) =>
                    onUpdate({ materializationMode: (event.target as HTMLSelectElement).value })}
                >
                  <option value="on_demand">手动物化</option>
                  <option value="scheduled">定时同步</option>
                  ${
                    state.materializationMode === "event_driven"
                      ? html`
                          <option value="event_driven" disabled>事件驱动（无执行器）</option>
                        `
                      : html``
                  }
                </select>
                <small
                  >手动物化不会在打开知识宇宙时执行，需要到「输出与物化」点击「立即物化」。定时同步由网关定时节拍执行。</small
                >
              </label>
              <label class="field">
                <span>归属团队</span>
                <input
                  .value=${state.materializationTeamLabel}
                  placeholder="华东销售"
                  ?disabled=${state.busy}
                  @input=${(event: Event) =>
                    onUpdate({
                      materializationTeamLabel: (event.target as HTMLInputElement).value,
                    })}
                />
              </label>
              <label class="field">
                <span>生成器版本</span>
                <input
                  .value=${state.generatorVersion}
                  placeholder="v1"
                  ?disabled=${state.busy}
                  @input=${(event: Event) =>
                    onUpdate({ generatorVersion: (event.target as HTMLInputElement).value })}
                />
              </label>
              <label class="field">
                <span>新鲜度 SLA（分钟，可选）</span>
                <input
                  .value=${state.freshnessSlaMinutes}
                  placeholder="60"
                  ?disabled=${state.busy}
                  @input=${(event: Event) =>
                    onUpdate({ freshnessSlaMinutes: (event.target as HTMLInputElement).value })}
                />
              </label>
              <label class="field checkbox full">
                <input
                  type="checkbox"
                  .checked=${state.enabled}
                  ?disabled=${state.busy}
                  @change=${(event: Event) =>
                    onUpdate({ enabled: (event.target as HTMLInputElement).checked })}
                />
                <span>创建后立即启用该供给绑定</span>
              </label>
            </div>
          </div>
        </div>
        <div class="enterprise-org-modal__footer">
          <button class="btn" type="button" ?disabled=${state.busy} @click=${onClose}>取消</button>
          <button
            class="btn btn--primary"
            type="button"
            ?disabled=${state.busy}
            @click=${onSubmit}
          >
            ${state.busy ? "创建中…" : "确认创建"}
          </button>
        </div>
      </section>
    </div>
  `;
}

async function ensureSectionDataLoaded(
  state: DataCapabilitySurfaceState,
  gateway: EnterpriseDataCapabilityGateway | null,
  tenantId: string | null,
  section: DataCapabilitySection,
): Promise<void> {
  if (!gateway || !tenantId) {
    return;
  }
  if (section === "sources") {
    await loadSourcesSection(state, gateway, tenantId);
    return;
  }
  if (section === "authorization") {
    await loadPoliciesSection(state, gateway, tenantId);
    return;
  }
  if (section === "capabilities") {
    await loadCapabilitiesSection(state, gateway, tenantId);
    return;
  }
  if (section === "projections") {
    await loadProjectionsSection(state, gateway, tenantId);
    return;
  }
  if (section === "approvals") {
    await loadApprovalsSection(state, gateway, tenantId);
    return;
  }
  if (section === "memory") {
    // 记忆范围依赖 scope 策略列表（与授权段共用 lookups）。
    await loadPoliciesSection(state, gateway, tenantId);
    return;
  }
  if (section === "audit") {
    // 复用首页 lineage overview；未加载时补拉。
    const home = state.home;
    if (!home.lineageOverview && !home.lineageOverviewLoading) {
      home.lineageOverviewLoading = true;
      home.lineageOverviewError = null;
      refreshEnterpriseSurface();
      const result = await gateway.loadLineageOverview(tenantId);
      home.lineageOverviewLoading = false;
      if (result.ok) {
        home.lineageOverview = result.data;
      } else {
        home.lineageOverviewError = result.error;
      }
      refreshEnterpriseSurface();
    }
  }
}

export function renderEnterpriseDataGovernanceCenterSurface(
  props: EnterpriseSurfaceProps,
  basePath: string,
) {
  const tenantId = props.readModel.currentTenantId ?? null;
  const client = props.client ?? null;
  const key = buildSurfaceKey(props);
  // 登录成功后会先切到企业端页面，再异步完成 Gateway hello/快照握手。
  // 等到底层连接 ready 后 ensureLoaded 触发首载；各子面板失败时各自展示错误态。
  const gateway = client && client.connected ? createEnterpriseDataCapabilityGateway(client) : null;

  const state = getSurfaceState(key);
  ensureLoaded(state, gateway, tenantId);
  if (typeof window !== "undefined") {
    const rawHash = window.location.hash?.replace(/^#/, "") ?? "";
    let hasEdcQuery = false;
    try {
      hasEdcQuery = new URLSearchParams(window.location.search).has("edc");
    } catch {
      hasEdcQuery = false;
    }
    // 仅在显式深链时覆盖内存态；否则保留用户点击后的 primaryTab（避免空 hash 每次重渲回总览）。
    if (rawHash || hasEdcQuery) {
      const routed = resolveRouteFromLocation({
        hash: window.location.hash,
        search: window.location.search,
      });
      state.primaryTab = routed.primary;
      state.productsSubPanel = routed.productsSubPanel;
      state.governanceSubPanel = routed.governanceSubPanel;
      state.activeSection = routed.legacySection;
      if (gateway && tenantId) {
        for (const section of dataSectionsForPrimary(routed.primary, {
          productsSubPanel: routed.productsSubPanel,
          governanceSubPanel: routed.governanceSubPanel,
        })) {
          if (section !== "home") {
            void ensureSectionDataLoaded(state, gateway, tenantId, section);
          }
        }
      }
      applyMcpDiscoveryDeeplinkOnce(state);
    }
  }
  if (gateway && tenantId) {
    void tryResumeDataConnectorOAuthFromUrl(state, gateway, tenantId);
  }

  const { home } = state;

  const approvalCenterHref = "#approvals";

  const setPrimaryTab = (primary: DataCapabilityPrimaryTab) => {
    const switching = state.primaryTab !== primary;
    state.primaryTab = primary;
    if (primary === "products") {
      if (switching) {
        state.productsSubPanel = "catalog";
      }
    }
    if (primary === "governance") {
      if (switching) {
        state.governanceSubPanel = "matrix";
      }
    }
    const sections = dataSectionsForPrimary(primary, {
      productsSubPanel: state.productsSubPanel,
      governanceSubPanel: state.governanceSubPanel,
    });
    state.activeSection = sections[0] ?? "home";
    syncHashForLegacySection(state.activeSection);
    for (const section of sections) {
      if (section !== "home") {
        void ensureSectionDataLoaded(state, gateway, tenantId, section);
      }
    }
    refreshEnterpriseSurface();
  };

  const setProductsSubPanel = (panel: ProductsSubPanel) => {
    state.primaryTab = "products";
    state.productsSubPanel = panel;
    state.activeSection = panel === "outputs" ? "projections" : "capabilities";
    syncHashForLegacySection(state.activeSection);
    void ensureSectionDataLoaded(state, gateway, tenantId, state.activeSection);
    refreshEnterpriseSurface();
  };

  const setGovernanceSubPanel = (panel: GovernanceSubPanel) => {
    state.primaryTab = "governance";
    state.governanceSubPanel = panel;
    state.activeSection =
      panel === "approvals"
        ? "approvals"
        : panel === "memory"
          ? "memory"
          : panel === "audit"
            ? "audit"
            : "authorization";
    syncHashForLegacySection(state.activeSection);
    for (const section of dataSectionsForPrimary("governance", { governanceSubPanel: panel })) {
      if (section !== "home") {
        void ensureSectionDataLoaded(state, gateway, tenantId, section);
      }
    }
    refreshEnterpriseSurface();
  };

  const loadWebsiteCandidatesForEditor = (connectorId: string) => {
    if (!gateway || !tenantId) {
      return;
    }
    const entry = state.connectorCatalog.find((item) => item.connectorId === connectorId);
    if (entry?.accessMethod !== "website_session" && connectorId !== "site-session") {
      return;
    }
    void gateway.listWebsiteAccessCandidates(tenantId).then((result) => {
      if (!result.ok) {
        return;
      }
      state.sourceEditor.websiteOutcome = result.data.outcome;
      state.sourceEditor.websiteSelectable = result.data.selectable;
      refreshEnterpriseSurface();
    });
  };

  const updateSourceEditor = (patch: Partial<SourceEditorState>) => {
    state.sourceEditor = { ...state.sourceEditor, ...patch };
    if (patch.connectorId && gateway && tenantId) {
      void loadConnectorCredentialsForEditor(state, gateway, tenantId, patch.connectorId);
      loadWebsiteCandidatesForEditor(patch.connectorId);
    }
    refreshEnterpriseSurface();
  };

  const registerOwnedWebsiteBinding = async () => {
    if (!gateway || !tenantId) {
      return;
    }
    const draft = state.sourceEditor.websiteBindingDraft?.trim() ?? "";
    if (!draft) {
      return;
    }
    state.sourceEditor.busy = true;
    state.sourceEditor.error = null;
    refreshEnterpriseSurface();
    const result = await gateway.registerWebsiteAccess(tenantId, draft);
    state.sourceEditor.busy = false;
    if (!result.ok) {
      state.sourceEditor.error = result.error;
      refreshEnterpriseSurface();
      return;
    }
    state.sourceEditor.bindingId = result.data.bindingId;
    state.sourceEditor.websiteBindingDraft = "";
    const listed = await gateway.listWebsiteAccessCandidates(tenantId);
    if (listed.ok) {
      state.sourceEditor.websiteOutcome = listed.data.outcome;
      state.sourceEditor.websiteSelectable = listed.data.selectable;
    }
    refreshEnterpriseSurface();
  };

  const closeSourceEditor = () => {
    state.sourceEditor = {
      open: false,
      wizardStep: 1,
      sourceId: null,
      sourceKey: "",
      displayName: "",
      category: "crm",
      status: "disconnected",
      connectorId: "",
      credentialId: "",
      credentialLabel: "",
      instanceUrl: "",
      apiKey: "",
      authScheme: "bearer",
      authHeaderName: "",
      authQueryParam: "",
      basicUsername: "",
      probePath: "",
      dbHost: "",
      dbPort: "",
      dbName: "",
      passwordVisible: false,
      saveNewCredential: false,
      oauthBusy: false,
      oauthNotice: null,
      busy: false,
      error: null,
      probeBusy: false,
      probeMessage: null,
      probeOk: null,
    };
    refreshEnterpriseSurface();
  };

  const openCreateSourceEditor = () => {
    state.sourcesNotice = null;
    if (gateway && tenantId) {
      void loadConnectorCatalog(state, gateway, tenantId);
    }
    state.sourceEditor = {
      open: true,
      wizardStep: 1,
      sourceId: null,
      sourceKey: "",
      displayName: "",
      category: "crm",
      status: "disconnected",
      connectorId: "",
      credentialId: "",
      credentialLabel: "",
      instanceUrl: "",
      apiKey: "",
      authScheme: "bearer",
      authHeaderName: "",
      authQueryParam: "",
      basicUsername: "",
      probePath: "",
      dbHost: "",
      dbPort: "",
      dbName: "",
      passwordVisible: false,
      saveNewCredential: false,
      oauthBusy: false,
      oauthNotice: null,
      busy: false,
      error: null,
      probeBusy: false,
      probeMessage: null,
      probeOk: null,
    };
    refreshEnterpriseSurface();
  };

  const openEditSourceEditor = (source: ManagedDataSourceRecord) => {
    state.sourcesNotice = null;
    if (gateway && tenantId) {
      void loadConnectorCatalog(state, gateway, tenantId);
      void loadConnectorCredentialsForEditor(state, gateway, tenantId, source.connectorId);
    }
    state.sourceEditor = {
      open: true,
      wizardStep: 1,
      sourceId: source.sourceId,
      sourceKey: source.sourceKey,
      displayName: source.displayName,
      category: source.category,
      status: source.status,
      connectorId: source.connectorId,
      credentialId: source.credentialId ?? "",
      bindingId: source.bindingId ?? "",
      credentialLabel: "",
      instanceUrl: "",
      apiKey: "",
      authScheme: "bearer",
      authHeaderName: "",
      authQueryParam: "",
      basicUsername: "",
      probePath: "",
      dbHost: "",
      dbPort: "",
      dbName: "",
      passwordVisible: false,
      saveNewCredential: false,
      oauthBusy: false,
      oauthNotice: null,
      busy: false,
      error: null,
      probeBusy: false,
      probeMessage: null,
      probeOk: null,
    };
    loadWebsiteCandidatesForEditor(source.connectorId);
    refreshEnterpriseSurface();
  };

  const testSourceConnection = async () => {
    if (!gateway || !tenantId) {
      return;
    }
    const editor = state.sourceEditor;
    if (!editor.connectorId.trim()) {
      editor.probeMessage = "请先选择连接器。";
      editor.probeOk = false;
      refreshEnterpriseSurface();
      return;
    }
    editor.probeBusy = true;
    editor.probeMessage = null;
    editor.probeOk = null;
    refreshEnterpriseSurface();
    const result = await gateway.testSourceConnection(tenantId, editor.connectorId.trim(), {
      credentialId: editor.credentialId.trim() || undefined,
      sourceId: editor.sourceId ?? undefined,
      instanceUrl: resolveEditorInstanceUrl(editor) || undefined,
      apiKey: editor.apiKey.trim() || undefined,
      ...buildConnectorSecretOptions(editor),
    });
    editor.probeBusy = false;
    if (!result.ok) {
      editor.probeMessage = result.error;
      editor.probeOk = false;
      refreshEnterpriseSurface();
      return;
    }
    editor.probeMessage = result.data.message;
    editor.probeOk = result.data.ok;
    editor.status = deriveSourceStatusFromProbe(result.data);
    refreshEnterpriseSurface();
  };

  const installConnectorPackage = async () => {
    if (!gateway || !tenantId) {
      return;
    }
    const editor = state.sourceEditor;
    if (!editor.connectorId.trim()) {
      return;
    }
    editor.probeBusy = true;
    editor.error = null;
    refreshEnterpriseSurface();
    const result = await gateway.ensureConnectorPackage(tenantId, editor.connectorId.trim());
    editor.probeBusy = false;
    if (!result.ok) {
      editor.error = result.error;
      refreshEnterpriseSurface();
      return;
    }
    state.connectorCatalogLoaded = false;
    await loadConnectorCatalog(state, gateway, tenantId);
    const connectorEntry =
      state.connectorCatalog.find((entry) => entry.connectorId === editor.connectorId.trim()) ??
      null;
    const packageLabel = connectorEntry?.integrationTier === "demo" ? "演示包" : "连接器包";
    editor.probeMessage = result.data.installed
      ? `${packageLabel}已安装（${result.data.actionCount} 个 Action）。请再次测试连通性。`
      : `连接器动作目录已存在（${result.data.actionCount} 个）。`;
    editor.probeOk = true;
    refreshEnterpriseSurface();
  };

  const startConnectorOAuth = async () => {
    if (!gateway || !tenantId || typeof window === "undefined") {
      return;
    }
    const editor = state.sourceEditor;
    const label = editor.credentialLabel.trim();
    if (!editor.connectorId.trim()) {
      editor.error = "请先选择连接器。";
      refreshEnterpriseSurface();
      return;
    }
    if (!label) {
      editor.error = "请先填写凭证名称。";
      refreshEnterpriseSurface();
      return;
    }
    editor.oauthBusy = true;
    editor.error = null;
    editor.oauthNotice = null;
    refreshEnterpriseSurface();
    const connectorId = editor.connectorId.trim();
    const started = await gateway.startConnectorOAuth(tenantId, {
      connectorId,
      label,
      callbackOrigin: window.location.origin,
      basePath,
      returnPath: window.location.pathname + window.location.search,
      orgId: connectorId === "erp-yonyou-tplus" ? editor.orgId?.trim() || undefined : undefined,
      appName: connectorId === "erp-yonyou-tplus" ? editor.appName?.trim() || undefined : undefined,
    });
    if (!started.ok) {
      editor.oauthBusy = false;
      editor.error = started.error;
      refreshEnterpriseSurface();
      return;
    }
    if (started.data.authorizeUrl) {
      openExternalUrlSafe(started.data.authorizeUrl);
      editor.oauthNotice = "已打开授权页面，完成后会自动返回。";
      refreshEnterpriseSurface();
      const completed = await pollDataConnectorOAuthSession(
        gateway,
        tenantId,
        started.data.sessionId,
      );
      editor.oauthBusy = false;
      if (!completed) {
        editor.error = "等待 OAuth 回调超时，请重试。";
        refreshEnterpriseSurface();
        return;
      }
      state.connectorCredentialsConnectorId = null;
      await loadConnectorCredentialsForEditor(state, gateway, tenantId, completed.connectorId);
      editor.credentialId = completed.credentialId;
      editor.saveNewCredential = false;
      editor.oauthNotice = "OAuth 授权已完成，可进行连通性测试。";
      refreshEnterpriseSurface();
      return;
    }
    if (started.data.simulateAllowed) {
      const simulated = await gateway.simulateCompleteConnectorOAuth(
        tenantId,
        started.data.sessionId,
        label,
      );
      editor.oauthBusy = false;
      if (!simulated.ok) {
        editor.error = simulated.error;
        refreshEnterpriseSurface();
        return;
      }
      state.connectorCredentialsConnectorId = null;
      await loadConnectorCredentialsForEditor(state, gateway, tenantId, editor.connectorId.trim());
      editor.credentialId = simulated.data.credentialId;
      editor.saveNewCredential = false;
      editor.oauthNotice = "模拟 OAuth 已完成（开发模式）。";
      refreshEnterpriseSurface();
      return;
    }
    editor.oauthBusy = false;
    editor.error = "当前连接器暂不支持 OAuth 授权。";
    refreshEnterpriseSurface();
  };

  const submitSourceEditor = async () => {
    if (!gateway || !tenantId) {
      return;
    }
    const editor = state.sourceEditor;
    editor.busy = true;
    editor.error = null;
    refreshEnterpriseSurface();
    let credentialId = editor.credentialId.trim() || undefined;
    const resolvedInstanceUrl = resolveEditorInstanceUrl(editor);
    const isHttpRestNoneAuth =
      editor.connectorId.trim() === "http-rest" && editor.authScheme === "none";
    const shouldCreateCredential =
      editor.saveNewCredential &&
      editor.credentialLabel.trim() &&
      resolvedInstanceUrl &&
      // "none"-auth REST sources still persist a credential to hold the base URL config.
      (editor.apiKey.trim() || isHttpRestNoneAuth);
    if (shouldCreateCredential) {
      const credentialResult = await gateway.upsertConnectorCredential(tenantId, {
        connectorId: editor.connectorId.trim(),
        label: editor.credentialLabel.trim(),
        instanceUrl: resolvedInstanceUrl,
        apiKey: editor.apiKey.trim() || undefined,
        ...buildConnectorSecretOptions(editor),
      });
      if (!credentialResult.ok) {
        editor.busy = false;
        editor.error = credentialResult.error;
        refreshEnterpriseSurface();
        return;
      }
      credentialId = credentialResult.data.credentialId;
      state.connectorCredentialsConnectorId = null;
    }
    const catalogEntry = state.connectorCatalog.find(
      (entry) => entry.connectorId === editor.connectorId.trim(),
    );
    const isWebsite =
      catalogEntry?.accessMethod === "website_session" ||
      editor.connectorId.trim() === "site-session";
    // 网站探测只说明「这次没有验证会话」，不能把账户改成已连接，也不能把已连接账户改成断开。
    if (isWebsite) {
      const existing = state.sources.find((source) => source.sourceId === editor.sourceId);
      if (editor.status === "connected" && existing?.status !== "connected") {
        editor.status = "disconnected";
      }
    } else if (editor.probeOk !== true && editor.connectorId.trim()) {
      const probe = await gateway.testSourceConnection(tenantId, editor.connectorId.trim(), {
        credentialId,
        instanceUrl: resolvedInstanceUrl || undefined,
        apiKey: editor.apiKey.trim() || undefined,
        ...buildConnectorSecretOptions(editor),
      });
      if (probe.ok) {
        editor.probeMessage = probe.data.message;
        editor.probeOk = probe.data.ok;
        editor.status = deriveSourceStatusFromProbe(probe.data);
      } else {
        // 探测 RPC 本身失败（网络/权限），无法确认连通性，如实存为「已断开」。
        editor.probeMessage = probe.error;
        editor.probeOk = false;
        editor.status = "disconnected";
      }
      refreshEnterpriseSurface();
    }
    const result = await gateway.upsertSource(tenantId, {
      sourceId: editor.sourceId ?? undefined,
      sourceKey: editor.sourceKey.trim(),
      displayName: editor.displayName.trim(),
      category: editor.category,
      status: editor.status,
      connectorId: editor.connectorId.trim(),
      credentialId: isWebsite ? undefined : credentialId,
      bindingId: isWebsite ? editor.bindingId?.trim() || undefined : undefined,
    });
    editor.busy = false;
    if (!result.ok) {
      editor.error = result.error;
      refreshEnterpriseSurface();
      return;
    }
    state.sourcesLoaded = false;
    await loadSourcesSection(state, gateway, tenantId);
    const savedVerb = editor.sourceId ? "数据源已更新。" : "数据源已创建。";
    const connectivityNote = isWebsite
      ? "网站会话未把探测记成生产验证或入库。连接状态、能力验证和数据新鲜度仍分开显示。"
      : editor.status === "connected"
        ? "连通性正常。"
        : `连通性检测未通过（状态：${DATA_SOURCE_STATUS_LABEL[editor.status]}），请检查凭证后在列表中重连。`;
    state.sourcesNotice = `${savedVerb}${connectivityNote}`;
    closeSourceEditor();
  };

  const materializeProjectionBinding = async (bindingId: string) => {
    if (!gateway || !tenantId) {
      return;
    }
    state.materializeBusyBindingId = bindingId;
    state.projectionsNotice = null;
    refreshEnterpriseSurface();
    const result = await gateway.runProjectionMaterializer(tenantId, bindingId);
    state.materializeBusyBindingId = null;
    if (!result.ok) {
      state.projectionsError = result.error;
      refreshEnterpriseSurface();
      return;
    }
    state.projectionsError = null;
    state.projectionsNotice = `物化成功：${result.data.title}（${result.data.objectId}）`;
    refreshEnterpriseSurface();
  };

  const openProjectionEditor = () => {
    state.projectionEditor = { ...createInitialProjectionEditor(), open: true };
    refreshEnterpriseSurface();
  };

  const closeProjectionEditor = () => {
    state.projectionEditor = createInitialProjectionEditor();
    refreshEnterpriseSurface();
  };

  const updateProjectionEditor = (patch: Partial<ProjectionEditorState>) => {
    state.projectionEditor = { ...state.projectionEditor, ...patch };
    refreshEnterpriseSurface();
  };

  const submitProjectionEditor = async () => {
    if (!gateway || !tenantId) {
      return;
    }
    const editor = state.projectionEditor;
    const [connectorId = "", actionKey = "", version = ""] = editor.sourceActionToken.split(":");
    if (!editor.projectionKey.trim() || !editor.displayName.trim()) {
      editor.error = "请填写投影标识与显示名称。";
      refreshEnterpriseSurface();
      return;
    }
    if (!connectorId || !actionKey || !version) {
      editor.error = "请选择源动作（来自已配置的数据能力动作）。";
      refreshEnterpriseSurface();
      return;
    }
    if (!editor.materializationTeamLabel.trim() || !editor.generatorVersion.trim()) {
      editor.error = "请填写归属团队与生成器版本。";
      refreshEnterpriseSurface();
      return;
    }
    editor.busy = true;
    editor.error = null;
    refreshEnterpriseSurface();
    // 先建规格拿到 projectionId，再用它建供给绑定（规格无绑定无法物化）。
    const specResult = await gateway.upsertProjectionSpec(tenantId, {
      projectionKey: editor.projectionKey.trim(),
      displayName: editor.displayName.trim(),
      category: editor.category,
      objectKind: editor.objectKind,
      templateKey: editor.templateKey,
      lifecycle: editor.lifecycle,
      sourceActions: [{ connectorId, actionKey, version }],
      capabilityId: editor.capabilityId.trim() || undefined,
      description: editor.description.trim() || undefined,
    });
    if (!specResult.ok) {
      editor.busy = false;
      editor.error = specResult.error;
      refreshEnterpriseSurface();
      return;
    }
    const slaRaw = Number.parseInt(editor.freshnessSlaMinutes.trim(), 10);
    const bindingResult = await gateway.upsertProjectionBinding(tenantId, {
      projectionId: specResult.data.projectionId,
      materializationMode: editor.materializationMode,
      materializationTeamLabel: editor.materializationTeamLabel.trim(),
      generatorVersion: editor.generatorVersion.trim(),
      capabilityId: editor.capabilityId.trim() || undefined,
      freshnessSlaMinutes: Number.isFinite(slaRaw) && slaRaw > 0 ? slaRaw : undefined,
      enabled: editor.enabled,
    });
    editor.busy = false;
    if (!bindingResult.ok) {
      // 规格已落库但绑定失败：如实提示，规格保留，用户可重试绑定。
      editor.error = `投影规格已创建，但供给绑定失败：${bindingResult.error}`;
      refreshEnterpriseSurface();
      return;
    }
    const createdName = editor.displayName.trim();
    state.projectionEditor = createInitialProjectionEditor();
    state.projectionsNotice = `已新建投影「${createdName}」并创建供给绑定。`;
    state.projectionsError = null;
    state.projectionsLoaded = false;
    refreshEnterpriseSurface();
    await loadProjectionsSection(state, gateway, tenantId);
  };

  const reconnectSource = async (source: ManagedDataSourceRecord) => {
    if (!gateway || !tenantId) {
      return;
    }
    const result = await gateway.reconnectSource(tenantId, source.sourceId);
    if (!result.ok) {
      state.sourcesError = result.error;
      refreshEnterpriseSurface();
      return;
    }
    state.sourcesLoaded = false;
    await loadSourcesSection(state, gateway, tenantId);
    state.sourcesNotice = `已重连 ${source.displayName}。`;
  };

  const testListedSourceConnection = async (source: ManagedDataSourceRecord) => {
    if (!gateway || !tenantId) {
      return;
    }
    state.sourcesNotice = null;
    state.sourcesError = null;
    refreshEnterpriseSurface();
    const result = await gateway.testSourceConnection(tenantId, source.connectorId, {
      credentialId: source.credentialId ?? undefined,
      sourceId: source.sourceId,
    });
    if (!result.ok) {
      state.sourcesError = result.error;
      refreshEnterpriseSurface();
      return;
    }
    state.sourcesLoaded = false;
    await loadSourcesSection(state, gateway, tenantId);
    state.sourcesNotice = result.data.ok
      ? `「${source.displayName}」已检查连通性：${result.data.message} 这不是生产验证，也没有入库。`
      : `「${source.displayName}」连通性检查未通过：${result.data.message} 生产验证和入库次数不变。`;
  };

  const archiveSource = async (source: ManagedDataSourceRecord) => {
    if (!gateway || !tenantId) {
      return;
    }
    if (!shouldProceed(`确认停用数据源「${source.displayName}」？停用后同步会停止。`)) {
      return;
    }
    const result = await gateway.archiveSource(tenantId, source.sourceId);
    if (!result.ok) {
      state.sourcesError = result.error;
      refreshEnterpriseSurface();
      return;
    }
    state.sourcesLoaded = false;
    await loadSourcesSection(state, gateway, tenantId);
    state.sourcesNotice = `已停用 ${source.displayName}。`;
  };

  const openSourceLogs = async (source: ManagedDataSourceRecord) => {
    if (!gateway || !tenantId) {
      return;
    }
    state.sourceLogDetail = {
      open: true,
      sourceId: source.sourceId,
      sourceLabel: source.displayName,
    };
    state.sourceSyncLogEntries = null;
    state.sourceSyncLogSourceId = source.sourceId;
    state.sourceSyncLogLoading = true;
    state.sourceSyncLogError = null;
    refreshEnterpriseSurface();
    const result = await gateway.getSourceSyncLog(tenantId, source.sourceId);
    state.sourceSyncLogLoading = false;
    if (result.ok) {
      state.sourceSyncLogEntries = result.data;
    } else {
      state.sourceSyncLogError = result.error;
    }
    refreshEnterpriseSurface();
  };

  const syncListedSource = async (source: ManagedDataSourceRecord) => {
    if (!gateway || !tenantId) {
      return;
    }
    state.sourcesNotice = `正在同步「${source.displayName}」…`;
    state.sourcesError = null;
    refreshEnterpriseSurface();
    const result = await gateway.syncSource(tenantId, source.sourceId);
    if (!result.ok) {
      state.sourcesNotice = null;
      state.sourcesError = result.error;
      refreshEnterpriseSurface();
      return;
    }
    state.sourcesLoaded = false;
    await loadSourcesSection(state, gateway, tenantId);
    state.sourcesNotice = result.data.summary;
    await openSourceLogs(source);
  };

  const closeSourceLogs = () => {
    state.sourceLogDetail = {
      open: false,
      sourceId: null,
      sourceLabel: "",
    };
    state.sourceSyncLogEntries = null;
    state.sourceSyncLogSourceId = null;
    state.sourceSyncLogLoading = false;
    state.sourceSyncLogError = null;
    refreshEnterpriseSurface();
  };

  const openApprovalDetail = (request: ManagedGovernanceApprovalRequest) => {
    if (!gateway || !tenantId) {
      return;
    }
    if (state.approvalDetailId === request.approvalId) {
      state.approvalDetailId = null;
      state.approvalDetail = null;
      state.approvalDetailError = null;
      refreshEnterpriseSurface();
      return;
    }
    void loadApprovalDetail(state, gateway, tenantId, request.approvalId);
  };

  const openApprovalDecision = (
    request: ManagedGovernanceApprovalRequest,
    decision: "approved" | "rejected",
  ) => {
    state.approvalsNotice = null;
    state.approvalDecision = {
      open: true,
      approvalId: request.approvalId,
      decision,
      displayName: stripOrganizationSeatIdSuffix(request.displayName) || "数据能力",
      category: request.category,
      decisionNote: "",
      fulfillmentMode: "approve_intent_only",
      busy: false,
      error: null,
    };
    refreshEnterpriseSurface();
  };

  const updateApprovalDecision = (patch: Partial<ApprovalDecisionState>) => {
    state.approvalDecision = { ...state.approvalDecision, ...patch };
    refreshEnterpriseSurface();
  };

  const closeApprovalDecision = () => {
    state.approvalDecision = {
      open: false,
      approvalId: null,
      decision: "approved",
      displayName: "",
      category: "",
      decisionNote: "",
      fulfillmentMode: "approve_intent_only",
      busy: false,
      error: null,
    };
    refreshEnterpriseSurface();
  };

  const updatePolicyEditor = (patch: Partial<PolicyEditorState>) => {
    state.policyEditor = { ...state.policyEditor, ...patch };
    refreshEnterpriseSurface();
  };

  const closePolicyEditor = () => {
    state.policyEditor = {
      open: false,
      policyId: null,
      displayName: "",
      targetKind: "seat",
      targetId: "",
      sourceId: "",
      actionRefTokens: "",
      scopePolicyId: "",
      approvalPolicyId: "",
      enabled: true,
      busy: false,
      error: null,
    };
    state.policyPickerSeatIds.clear();
    state.policyPickerDepartmentPaths.clear();
    state.policyPickerQuery = "";
    refreshEnterpriseSurface();
  };

  const openCreatePolicyEditor = async () => {
    if (gateway && tenantId) {
      await loadPoliciesSection(state, gateway, tenantId);
    }
    state.policiesNotice = null;
    state.policyEditor = {
      open: true,
      policyId: null,
      displayName: "",
      targetKind: "seat",
      targetId: "",
      sourceId: "",
      actionRefTokens: "",
      scopePolicyId: "",
      approvalPolicyId: "",
      enabled: true,
      busy: false,
      error: null,
    };
    state.policyPickerSeatIds.clear();
    state.policyPickerDepartmentPaths.clear();
    state.policyPickerQuery = "";
    refreshEnterpriseSurface();
  };

  const openEditPolicyEditor = async (policy: ManagedAccessPolicyRecord) => {
    if (gateway && tenantId) {
      await loadPoliciesSection(state, gateway, tenantId);
    }
    state.policiesNotice = null;
    state.policyEditor = {
      open: true,
      policyId: policy.policyId,
      displayName: policy.displayName,
      targetKind: policy.targetKind,
      targetId: policy.targetId,
      sourceId: policy.sourceId ?? "",
      actionRefTokens: serializeActionRefs(policy.actionRefs),
      scopePolicyId: policy.scopePolicyId ?? "",
      approvalPolicyId: policy.approvalPolicyId ?? "",
      enabled: policy.enabled,
      busy: false,
      error: null,
    };
    state.policyPickerSeatIds = new Set(
      policy.targetKind === "seat" && policy.targetId ? [policy.targetId] : [],
    );
    state.policyPickerDepartmentPaths = new Set(
      policy.targetKind === "department" && policy.targetId ? [policy.targetId] : [],
    );
    state.policyPickerQuery = "";
    refreshEnterpriseSurface();
  };

  const submitPolicyEditor = async () => {
    if (!gateway || !tenantId) {
      return;
    }
    const editor = state.policyEditor;
    // 解析授权目标：部门/角色为单目标；岗位支持多选（新建时每个岗位生成一条策略）。
    type ResolvedTarget = {
      targetKind: PolicyEditorState["targetKind"];
      targetId: string;
      label?: string;
    };
    const seatTitleById = new Map(
      props.readModel.seatSummaries.map((seat) => [seat.seatId, seat.title] as const),
    );
    let targets: ResolvedTarget[] = [];
    if (editor.policyId) {
      // 编辑：保持单一目标（按原 targetKind/targetId）。
      if (editor.targetId.trim()) {
        targets = [
          {
            targetKind: editor.targetKind,
            targetId: editor.targetId.trim(),
            label:
              editor.targetKind === "seat" ? seatTitleById.get(editor.targetId.trim()) : undefined,
          },
        ];
      }
    } else if (editor.targetKind === "role" && editor.targetId.trim()) {
      targets = [{ targetKind: "role", targetId: editor.targetId.trim() }];
    } else {
      // 新建：从勾选树的两个集合构建（多部门 + 多岗位，各生成一条策略）。
      const departmentTargets: ResolvedTarget[] = [...state.policyPickerDepartmentPaths].map(
        (path) => ({
          targetKind: "department" as const,
          targetId: path,
          label: path.split("/").filter(Boolean).pop() ?? path,
        }),
      );
      const seatTargets: ResolvedTarget[] = [...state.policyPickerSeatIds].map((seatId) => ({
        targetKind: "seat" as const,
        targetId: seatId,
        label: seatTitleById.get(seatId),
      }));
      targets = [...departmentTargets, ...seatTargets];
    }
    if (targets.length === 0) {
      editor.error = "请从组织目录选择授权目标（部门或岗位）。";
      refreshEnterpriseSurface();
      return;
    }
    const baseName = editor.displayName.trim();
    if (!baseName) {
      editor.error = "请填写策略名称。";
      refreshEnterpriseSurface();
      return;
    }
    const actionRefs = parseActionRefTokens(editor.actionRefTokens).filter(
      (ref) => ref.connectorId && ref.actionKey && ref.version,
    );
    editor.busy = true;
    editor.error = null;
    refreshEnterpriseSurface();
    const multi = targets.length > 1;
    let created = 0;
    const failures: string[] = [];
    for (const target of targets) {
      const displayName = multi && target.label ? `${baseName} · ${target.label}` : baseName;
      const result = await gateway.upsertAccessPolicy(tenantId, {
        policyId: editor.policyId ?? undefined,
        displayName,
        targetKind: target.targetKind,
        targetId: target.targetId,
        sourceId: editor.sourceId.trim() || undefined,
        actionRefs,
        scopePolicyId: editor.scopePolicyId.trim() || undefined,
        approvalPolicyId: editor.approvalPolicyId.trim() || undefined,
        enabled: editor.enabled,
      });
      if (result.ok) {
        created += 1;
      } else {
        failures.push(`${target.label ?? target.targetId}：${result.error}`);
      }
    }
    editor.busy = false;
    if (created === 0) {
      editor.error = failures.join("；") || "保存失败。";
      refreshEnterpriseSurface();
      return;
    }
    state.policiesLoaded = false;
    await loadPoliciesSection(state, gateway, tenantId);
    state.policiesNotice =
      failures.length === 0
        ? editor.policyId
          ? "授权策略已更新。"
          : `已创建 ${created} 条授权策略。`
        : `已创建 ${created} 条；${failures.length} 条失败：${failures.join("；")}`;
    closePolicyEditor();
  };

  const openPolicyDetail = async (policy: ManagedAccessPolicyRecord) => {
    if (!gateway || !tenantId) {
      return;
    }
    if (state.policyDetailId === policy.policyId) {
      state.policyDetailId = null;
      state.policyDetail = null;
      state.policyDetailError = null;
      refreshEnterpriseSurface();
      return;
    }
    await loadPolicyDetail(state, gateway, tenantId, policy.policyId);
  };

  const compilePolicy = async (policy: ManagedAccessPolicyRecord) => {
    if (!gateway || !tenantId) {
      return;
    }
    const result = await gateway.compileAccessPolicy(tenantId, policy.policyId);
    state.policyCompileNotice = result.ok
      ? `已编译 ${result.data.length} 条席位授权`
      : result.error;
    if (result.ok) {
      await loadPolicyDetail(state, gateway, tenantId, policy.policyId);
    }
    if (result.ok) {
      state.policiesNotice = `已编译 ${result.data.length} 条席位授权。`;
    }
    refreshEnterpriseSurface();
  };

  const archivePolicy = async (policy: ManagedAccessPolicyRecord) => {
    if (!gateway || !tenantId) {
      return;
    }
    if (!shouldProceed(`确认删除策略「${policy.displayName}」？删除后相关授权会失效。`)) {
      return;
    }
    const result = await gateway.archiveAccessPolicy(tenantId, policy.policyId);
    if (!result.ok) {
      state.policiesError = result.error;
      refreshEnterpriseSurface();
      return;
    }
    state.policiesLoaded = false;
    await loadPoliciesSection(state, gateway, tenantId);
    state.policiesNotice = `已删除策略 ${policy.displayName}。`;
  };

  const revokeGrant = async (grantId: string) => {
    if (!gateway || !tenantId) {
      return;
    }
    if (!shouldProceed("确认撤销这条席位授权？撤销后该席位将失去对应的数据动作权限。")) {
      return;
    }
    const result = await gateway.revokeSeatActionGrant(tenantId, grantId);
    if (!result.ok) {
      state.policyDetailError = result.error;
      refreshEnterpriseSurface();
      return;
    }
    if (state.policyDetailId) {
      await loadPolicyDetail(state, gateway, tenantId, state.policyDetailId);
    }
  };

  const updateCapabilityEditor = (patch: Partial<CapabilityEditorState>) => {
    state.capabilityEditor = { ...state.capabilityEditor, ...patch };
    refreshEnterpriseSurface();
  };

  const closeCapabilityEditor = () => {
    state.capabilityEditor = {
      open: false,
      wizardStep: 1,
      outputMode: "direct",
      projectionTemplateKey: "",
      capabilityId: null,
      capabilityKey: "",
      displayName: "",
      description: "",
      sourceIds: new Set<string>(),
      actionRefTokens: new Set<string>(),
      enabled: true,
      busy: false,
      error: null,
    };
    refreshEnterpriseSurface();
  };

  const updateMcpMappingEditor = (patch: Partial<McpMappingWizardEditorState>) => {
    state.mcpMappingEditor = { ...state.mcpMappingEditor, ...patch };
    refreshEnterpriseSurface();
  };

  const closeMcpMappingEditor = () => {
    state.mcpMappingEditor = {
      open: false,
      mcpServer: "",
      mcpTool: "",
      capabilityKey: "",
      displayName: "",
      description: "",
      handlerRef: "",
      busy: false,
      error: null,
    };
    refreshEnterpriseSurface();
  };

  const submitMcpMappingEditor = async () => {
    if (!gateway || !tenantId) {
      return;
    }
    const editor = state.mcpMappingEditor;
    const validation = validateMcpMappingWizardDraft(editor);
    if (!validation.ok) {
      editor.error = validation.message;
      refreshEnterpriseSurface();
      return;
    }
    editor.busy = true;
    editor.error = null;
    refreshEnterpriseSurface();
    const result = await gateway.upsertMcpMapping(tenantId, {
      mcpServer: editor.mcpServer.trim(),
      mcpTool: editor.mcpTool.trim(),
      capabilityKey: editor.capabilityKey.trim(),
      displayName: editor.displayName.trim(),
      description: editor.description.trim(),
    });
    editor.busy = false;
    if (!result.ok) {
      editor.error = result.error;
      refreshEnterpriseSurface();
      return;
    }
    state.capabilitiesLoaded = false;
    await loadCapabilitiesSection(state, gateway, tenantId);
    state.lookupsLoaded = false;
    state.capabilitiesNotice = `已映射 ${editor.mcpServer} / ${editor.mcpTool} → ${result.data.capability.displayName}（${result.data.handlerRef}）。发现状态将推进为已映射待授权；席位授权需另行申请。`;
    closeMcpMappingEditor();
  };

  const openCreateCapabilityEditor = async () => {
    if (gateway && tenantId) {
      await loadCapabilitiesSection(state, gateway, tenantId);
      void loadOrgTargets(state, gateway, tenantId);
    }
    state.capabilitiesNotice = null;
    state.seatGrantSeatIds.clear();
    state.seatGrantDepartmentPaths.clear();
    state.seatGrantQuery = "";
    state.capabilityEditor = {
      open: true,
      wizardStep: 1,
      outputMode: "direct",
      projectionTemplateKey: "",
      capabilityId: null,
      capabilityKey: "",
      displayName: "",
      description: "",
      sourceIds: new Set<string>(),
      actionRefTokens: new Set<string>(),
      enabled: true,
      busy: false,
      error: null,
    };
    refreshEnterpriseSurface();
  };

  const openEditCapabilityEditor = async (capability: ManagedCapabilityRecord) => {
    if (gateway && tenantId) {
      await loadCapabilitiesSection(state, gateway, tenantId);
    }
    state.capabilitiesNotice = null;
    state.capabilityEditor = {
      open: true,
      wizardStep: 1,
      outputMode: "direct",
      projectionTemplateKey: "",
      capabilityId: capability.capabilityId,
      capabilityKey: capability.capabilityKey,
      displayName: capability.displayName,
      description: capability.description,
      sourceIds: new Set(capability.sourceIds),
      actionRefTokens: new Set(
        capability.actionRefs.map((ref) => `${ref.connectorId}:${ref.actionKey}:${ref.version}`),
      ),
      enabled: capability.enabled,
      busy: false,
      error: null,
    };
    refreshEnterpriseSurface();
  };

  const resolveWizardSeatIds = (): string[] => {
    const seatIds = new Set<string>(state.seatGrantSeatIds);
    if (state.seatGrantDepartmentPaths.size > 0) {
      const departments = buildEnterpriseOrgTree({
        readModel: props.readModel,
        includeVacantPositions: true,
      });
      for (const departmentPath of state.seatGrantDepartmentPaths) {
        const department = findOrgDepartmentByPath(departments, departmentPath);
        if (department) {
          for (const seatId of collectDepartmentSeatIds(department)) {
            seatIds.add(seatId);
          }
        }
      }
    }
    return [...seatIds];
  };

  const submitCapabilityEditor = async () => {
    if (!gateway || !tenantId) {
      return;
    }
    const editor = state.capabilityEditor;
    const isCreate = !editor.capabilityId;
    const draft = {
      capabilityKey: editor.capabilityKey,
      displayName: editor.displayName,
      description: editor.description,
      sourceIds: editor.sourceIds,
      actionRefTokens: editor.actionRefTokens,
      outputMode: editor.outputMode,
      projectionTemplateKey: editor.projectionTemplateKey,
      openScopeReady: state.seatGrantSeatIds.size + state.seatGrantDepartmentPaths.size > 0,
    };
    const seatCount = props.readModel.seatSummaries?.length ?? state.orgTargets?.seats?.length ?? 0;
    const wizardContext = productWizardValidationContext({
      sources: state.sources,
      actions: state.actionsCatalog,
      seatCount,
    });
    if (isCreate) {
      for (const step of [1, 2, 3, 4] as const) {
        const validation = validateProductWizardStep(step, draft, wizardContext);
        if (!validation.ok) {
          editor.wizardStep = step;
          editor.error = validation.message;
          refreshEnterpriseSurface();
          return;
        }
      }
    } else {
      const mismatch = productWizardSourceActionMismatch({
        sourceIds: draft.sourceIds,
        actionRefTokens: draft.actionRefTokens,
        sources: state.sources,
        actions: state.actionsCatalog,
      });
      if (mismatch || draft.sourceIds.size === 0 || draft.actionRefTokens.size === 0) {
        editor.error = mismatch ?? "请至少选择一个数据源和一个动作。";
        refreshEnterpriseSurface();
        return;
      }
    }
    editor.busy = true;
    editor.error = null;
    refreshEnterpriseSurface();
    const actionRefs = [...editor.actionRefTokens]
      .map((token) => {
        const [connectorId = "", actionKey = "", version = ""] = token.split(":");
        return { connectorId, actionKey, version };
      })
      .filter((ref) => ref.connectorId && ref.actionKey && ref.version);

    if (isCreate) {
      const sagaResult = await runProductCreateSaga(gateway, tenantId, {
        capabilityKey: editor.capabilityKey.trim(),
        displayName: editor.displayName.trim(),
        description: editor.description.trim(),
        sourceIds: [...editor.sourceIds],
        actionRefs,
        enabled: editor.enabled,
        outputMode: editor.outputMode,
        projectionTemplateKey: editor.projectionTemplateKey.trim(),
        seatIds: resolveWizardSeatIds(),
      });
      editor.busy = false;
      if (!sagaResult.ok) {
        // 补偿已归档半成品；保持向导打开，清空 id，避免误把失败当编辑态。
        editor.error = sagaResult.error;
        editor.capabilityId = null;
        state.capabilitiesLoaded = false;
        await loadCapabilitiesSection(state, gateway, tenantId);
        state.projectionsLoaded = false;
        refreshEnterpriseSurface();
        return;
      }
      state.seatGrantSeatIds.clear();
      state.seatGrantDepartmentPaths.clear();
      state.capabilitiesLoaded = false;
      await loadCapabilitiesSection(state, gateway, tenantId);
      state.projectionsLoaded = false;
      state.capabilitiesNotice = sagaResult.notices.join(" ");
      closeCapabilityEditor();
      return;
    }

    const result = await gateway.upsertCapability(tenantId, {
      capabilityId: editor.capabilityId ?? undefined,
      capabilityKey: editor.capabilityKey.trim(),
      displayName: editor.displayName.trim(),
      description: editor.description.trim(),
      sourceIds: [...editor.sourceIds],
      actionRefs,
      enabled: editor.enabled,
    });
    editor.busy = false;
    if (!result.ok) {
      editor.error = result.error;
      refreshEnterpriseSurface();
      return;
    }
    state.capabilitiesLoaded = false;
    await loadCapabilitiesSection(state, gateway, tenantId);
    state.capabilitiesNotice = "数据产品已更新。";
    closeCapabilityEditor();
  };

  const openCapabilityDetail = async (capability: ManagedCapabilityRecord) => {
    if (!gateway || !tenantId) {
      return;
    }
    if (state.capabilityDetailId === capability.capabilityId) {
      state.capabilityDetailId = null;
      state.capabilityDetail = null;
      state.capabilityDetailError = null;
      refreshEnterpriseSurface();
      return;
    }
    await loadCapabilityDetail(state, gateway, tenantId, capability.capabilityId);
  };

  const archiveCapability = async (capability: ManagedCapabilityRecord) => {
    if (!gateway || !tenantId) {
      return;
    }
    if (!shouldProceed(`确认停用数据产品「${capability.displayName}」？停用后将不再对组织开放。`)) {
      return;
    }
    const result = await gateway.archiveCapability(tenantId, capability.capabilityId);
    if (!result.ok) {
      state.capabilitiesError = result.error;
      refreshEnterpriseSurface();
      return;
    }
    state.capabilitiesLoaded = false;
    await loadCapabilitiesSection(state, gateway, tenantId);
    state.capabilitiesNotice = capability.enabled
      ? `已停用 ${capability.displayName}。`
      : `已归档 ${capability.displayName}。`;
  };

  const grantSeatCapability = async () => {
    if (!gateway || !tenantId || !state.seatGrantCapabilityId) {
      return;
    }
    // 解析目标席位集合：直选席位 ∪ 选中部门（含子部门）下全部席位。
    const seatIds = new Set<string>(state.seatGrantSeatIds);
    if (state.seatGrantDepartmentPaths.size > 0) {
      const departments = buildEnterpriseOrgTree({
        readModel: props.readModel,
        includeVacantPositions: true,
      });
      for (const departmentPath of state.seatGrantDepartmentPaths) {
        const department = findOrgDepartmentByPath(departments, departmentPath);
        if (department) {
          for (const seatId of collectDepartmentSeatIds(department)) {
            seatIds.add(seatId);
          }
        }
      }
    }
    if (seatIds.size === 0) {
      return;
    }
    state.seatGrantBusy = true;
    state.seatGrantNotice = null;
    refreshEnterpriseSurface();
    let granted = 0;
    let totalActions = 0;
    const failures: string[] = [];
    for (const seatId of seatIds) {
      const result = await gateway.grantCapabilityToSeat(tenantId, {
        seatId,
        capabilityId: state.seatGrantCapabilityId,
      });
      if (result.ok) {
        granted += 1;
        totalActions += result.data.grantCount;
      } else {
        const seat = props.readModel.seatSummaries.find((item) => item.seatId === seatId);
        const seatLabel = seat ? resolveOrganizationSeatDisplayName(seat.title) : "岗位";
        failures.push(`${seatLabel}：${result.error}`);
      }
    }
    state.seatGrantBusy = false;
    if (granted > 0) {
      state.seatGrantSeatIds.clear();
      state.seatGrantDepartmentPaths.clear();
      if (state.capabilityDetailId) {
        await loadCapabilityDetail(state, gateway, tenantId, state.capabilityDetailId);
      }
    }
    state.seatGrantNotice =
      failures.length === 0
        ? `已为 ${granted} 个席位授权（共 ${totalActions} 个运行时动作）。`
        : `已授权 ${granted} 个席位；${failures.length} 个失败：${failures.join("；")}`;
    refreshEnterpriseSurface();
  };

  const submitApprovalDecision = async () => {
    if (!gateway || !tenantId || !state.approvalDecision.approvalId) {
      return;
    }
    state.approvalDecision.busy = true;
    state.approvalDecision.error = null;
    refreshEnterpriseSurface();
    const provisionChoice =
      state.approvalDecision.decision === "approved" &&
      governanceCategorySupportsApproveAndProvision(state.approvalDecision.category)
        ? state.approvalDecision.fulfillmentMode
        : undefined;
    const result = await gateway.decideGovernanceApproval(tenantId, {
      approvalId: state.approvalDecision.approvalId,
      decision: state.approvalDecision.decision,
      decisionNote: state.approvalDecision.decisionNote.trim() || undefined,
      ...(provisionChoice ? { fulfillmentMode: provisionChoice } : {}),
    });
    state.approvalDecision.busy = false;
    if (!result.ok) {
      state.approvalDecision.error = result.error;
      refreshEnterpriseSurface();
      return;
    }
    state.approvalsLoaded = false;
    await loadApprovalsSection(state, gateway, tenantId);
    const approvedPackSkill = state.approvalDecision.category === "pack_skill_review";
    const fulfillmentStatus = result.data.fulfillmentStatus;
    state.approvalsNotice =
      state.approvalDecision.decision === "approved"
        ? approvedPackSkill
          ? `已批准 ${state.approvalDecision.displayName}。尚未安装；请标记开通后，员工才能确认安装。`
          : fulfillmentStatus === "fulfilled"
            ? `已批准并开通 ${state.approvalDecision.displayName}。`
            : fulfillmentStatus === "failed"
              ? `已批准 ${state.approvalDecision.displayName}，开通失败。${result.data.provisionError ?? "可重试开通。"}`
              : fulfillmentStatus === "pending_admin_save"
                ? `已批准 ${state.approvalDecision.displayName}。尚未开通，请到数据能力中心显式保存。`
                : `已批准 ${state.approvalDecision.displayName}。`
        : `已拒绝 ${state.approvalDecision.displayName}。`;
    closeApprovalDecision();
  };

  const retryMcpProvision = async (request: ManagedGovernanceApprovalRequest) => {
    if (!gateway || !tenantId) {
      return;
    }
    const result = await gateway.decideGovernanceApproval(tenantId, {
      approvalId: request.approvalId,
      decision: "approved",
      fulfillmentMode: "approve_and_provision",
    });
    if (!result.ok) {
      state.approvalsNotice = result.error;
      refreshEnterpriseSurface();
      return;
    }
    state.approvalsLoaded = false;
    await loadApprovalsSection(state, gateway, tenantId);
    state.approvalsNotice =
      result.data.fulfillmentStatus === "fulfilled"
        ? `已开通 ${request.displayName}。`
        : `开通仍未完成。${result.data.provisionError ?? "审批结论保持已批准。"}`;
    refreshEnterpriseSurface();
  };

  const fulfillPackSkillReview = async (request: ManagedGovernanceApprovalRequest) => {
    if (!gateway || !tenantId) {
      return;
    }
    const payload = request.subjectPayload ?? {};
    const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
    const result = await gateway.fulfillGovernanceApproval(tenantId, {
      approvalId: request.approvalId,
      provisionReceipt: {
        handlerRef: "pack-skill-review-unlock",
        ...(text(payload.packId) ? { packId: text(payload.packId) } : {}),
        ...(text(payload.skillKey) ? { skillKey: text(payload.skillKey) } : {}),
        ...(text(payload.targetRobotId) ? { targetRobotId: text(payload.targetRobotId) } : {}),
      },
    });
    if (!result.ok) {
      state.approvalsNotice = result.error;
      refreshEnterpriseSurface();
      return;
    }
    state.approvalsLoaded = false;
    await loadApprovalsSection(state, gateway, tenantId);
    state.approvalsNotice = `已开通 ${request.displayName}。员工现在可以确认安装，系统不会自动安装。`;
    refreshEnterpriseSurface();
  };

  const header = renderEnterpriseModuleHeader({
    title: t("tabs.enterpriseDataGovernanceCenter"),
    subtitle: t("subtitles.enterpriseDataGovernanceCenter"),
  });

  const drawer = renderNodeDetailDrawer({
    graph: home.assetLandscape,
    selectedNodeId: state.selectedNodeId,
    onClose: () => {
      state.selectedNodeId = null;
      refreshEnterpriseSurface();
    },
  });

  const healthPanel = renderDataSourceHealthPanel({
    rows: home.sourceHealth,
    loading: home.sourceHealthLoading,
    error: home.sourceHealthError,
    onViewDetails: () => setPrimaryTab("assets"),
  });
  const approvalsPanel = renderPendingApprovalPanel({
    items: home.approvals,
    loading: home.approvalsLoading,
    error: home.approvalsError,
    approvalCenterHref,
    onOpenApprovalCenter: () => setGovernanceSubPanel("approvals"),
    onDecideApproval:
      gateway && tenantId
        ? async (approvalId, decision) => {
            const result = await gateway.decideGovernanceApproval(tenantId, {
              approvalId,
              decision,
            });
            if (!result.ok) {
              state.approvalsNotice = result.error;
              refreshEnterpriseSurface();
            }
          }
        : undefined,
    onApprovalDecided: () => {
      if (!gateway || !tenantId) {
        return;
      }
      void reloadDataCapabilityPendingApprovals({
        state: home,
        gateway,
        tenantId,
        requestRender: refreshEnterpriseSurface,
      });
      if (state.activeSection === "approvals") {
        state.approvalsLoaded = false;
        state.approvalsLoading = false;
        void loadApprovalsSection(state, gateway, tenantId);
      }
    },
  });

  // 各子段内容：由一级 Tab + 子区驱动；旧 section 渲染函数复用。
  let sectionContent: TemplateResult[];
  const renderLegacySection = (section: DataCapabilitySection): TemplateResult[] => {
    switch (section) {
      case "sources":
        return [
          renderSourcesManagementSection({
            state,
            onOpenCreate: openCreateSourceEditor,
            onEdit: openEditSourceEditor,
            onReconnect: reconnectSource,
            onTestConnection: testListedSourceConnection,
            onSelectSource: (sourceId: string) => {
              state.selectedAssetSourceId =
                state.selectedAssetSourceId === sourceId ? "" : sourceId;
              refreshEnterpriseSurface();
            },
            capabilityHref: (skillId: string) =>
              `${pathForTab("enterpriseCapabilityCenter", basePath, {
                tenantId: tenantId ?? undefined,
              }).replace(/\/$/, "")}/${encodeURIComponent(skillId)}`,
            onArchive: archiveSource,
            onOpenLogs: openSourceLogs,
            onSync: syncListedSource,
            onFiltersChange: (patch) => {
              state.assetFilters = { ...state.assetFilters, ...patch };
              refreshEnterpriseSurface();
            },
          }),
        ];
      case "authorization":
        return [
          renderAuthorizationManagementSection({
            state,
            onOpenCreate: openCreatePolicyEditor,
            onEdit: openEditPolicyEditor,
            onArchive: archivePolicy,
            onOpenDetail: openPolicyDetail,
          }),
          renderPolicyDetailPanel(
            state.policyDetail,
            state.policyDetailLoading,
            state.policyDetailError,
            revokeGrant,
            compilePolicy,
            new Map(
              (props.readModel.seatSummaries ?? []).map(
                (seat) => [seat.seatId, resolveOrganizationSeatDisplayName(seat.title)] as const,
              ),
            ),
          ),
        ];
      case "capabilities":
        return [
          renderCapabilitiesManagementSection({
            state,
            readModel: props.readModel,
            onOpenCreate: openCreateCapabilityEditor,
            onEdit: openEditCapabilityEditor,
            onArchive: archiveCapability,
            onOpenDetail: openCapabilityDetail,
            onGrantSeat: grantSeatCapability,
            onSelectCapability: (capabilityId) => {
              state.seatGrantCapabilityId = capabilityId;
              refreshEnterpriseSurface();
            },
            onToggleSeat: (seatId) => {
              if (state.seatGrantSeatIds.has(seatId)) {
                state.seatGrantSeatIds.delete(seatId);
              } else {
                state.seatGrantSeatIds.add(seatId);
              }
              refreshEnterpriseSurface();
            },
            onSelectDepartment: (departmentPath) => {
              if (state.seatGrantDepartmentPaths.has(departmentPath)) {
                state.seatGrantDepartmentPaths.delete(departmentPath);
              } else {
                state.seatGrantDepartmentPaths.add(departmentPath);
              }
              refreshEnterpriseSurface();
            },
            onRemoveSeat: (seatId) => {
              state.seatGrantSeatIds.delete(seatId);
              refreshEnterpriseSurface();
            },
            onClearDepartment: (departmentPath) => {
              state.seatGrantDepartmentPaths.delete(departmentPath);
              refreshEnterpriseSurface();
            },
            onClearAll: () => {
              state.seatGrantSeatIds.clear();
              state.seatGrantDepartmentPaths.clear();
              refreshEnterpriseSurface();
            },
            onQueryChange: (value) => {
              state.seatGrantQuery = value;
              refreshEnterpriseSurface();
            },
          }),
          renderCapabilityDetailPanel({
            detail: state.capabilityDetail,
            loading: state.capabilityDetailLoading,
            error: state.capabilityDetailError,
            state,
            readModel: props.readModel,
            onGrantSeat: grantSeatCapability,
            onOpenAudit: () => setGovernanceSubPanel("audit"),
            onOpenOutputs: () => setProductsSubPanel("outputs"),
            onToggleSeat: (seatId) => {
              if (state.seatGrantSeatIds.has(seatId)) {
                state.seatGrantSeatIds.delete(seatId);
              } else {
                state.seatGrantSeatIds.add(seatId);
              }
              refreshEnterpriseSurface();
            },
            onSelectDepartment: (departmentPath) => {
              if (state.seatGrantDepartmentPaths.has(departmentPath)) {
                state.seatGrantDepartmentPaths.delete(departmentPath);
              } else {
                state.seatGrantDepartmentPaths.add(departmentPath);
              }
              refreshEnterpriseSurface();
            },
            onRemoveSeat: (seatId) => {
              state.seatGrantSeatIds.delete(seatId);
              refreshEnterpriseSurface();
            },
            onClearDepartment: (departmentPath) => {
              state.seatGrantDepartmentPaths.delete(departmentPath);
              refreshEnterpriseSurface();
            },
            onClearAll: () => {
              state.seatGrantSeatIds.clear();
              state.seatGrantDepartmentPaths.clear();
              refreshEnterpriseSurface();
            },
            onQueryChange: (value) => {
              state.seatGrantQuery = value;
              refreshEnterpriseSurface();
            },
          }),
        ];
      case "projections":
        return [
          renderProjectionStudioSection({
            state,
            onMaterialize: materializeProjectionBinding,
            onOpenCreate: openProjectionEditor,
          }),
        ];
      case "approvals":
        return [
          renderApprovalsManagementSection({
            state,
            readModel: props.readModel,
            onSelectTab: (tab) => {
              state.approvalsTab = tab;
              refreshEnterpriseSurface();
            },
            onOpenDecision: openApprovalDecision,
            onOpenDetail: openApprovalDetail,
            onFulfillPackSkillReview: (request) => {
              void fulfillPackSkillReview(request);
            },
            onRetryMcpProvision: (request) => {
              void retryMcpProvision(request);
            },
          }),
        ];
      case "memory":
        return [renderMemoryScopePanel(state)];
      case "audit":
        return [
          renderAuditLineagePanel({
            overview: home.lineageOverview,
            loading: home.lineageOverviewLoading,
            error: home.lineageOverviewError,
            projectionFailureCount: state.projectionAuditFailureCount,
          }),
        ];
      case "home":
      default: {
        const actionItems = buildOverviewActionQueue({
          summary: home.summary,
          sourceHealth: home.sourceHealth,
          pendingApprovals: home.approvals,
          capabilityRows: home.capabilityRows,
          materializationFailureCount: home.lineageOverview?.materializationFailureCount ?? null,
        });
        return [
          renderMetricsOverviewCards({
            summary: home.summary,
            loading: home.summaryLoading,
            error: home.summaryError,
            onDrilldown: (target) => {
              if (target === "sources") {
                setPrimaryTab("assets");
                return;
              }
              if (target === "capabilities") {
                setProductsSubPanel("catalog");
                return;
              }
              if (target === "authorization") {
                setGovernanceSubPanel("matrix");
                return;
              }
              setGovernanceSubPanel("approvals");
            },
          }),
          renderOverviewActionQueuePanel(actionItems, (item) => {
            if (item.primary === "assets") {
              setPrimaryTab("assets");
              return;
            }
            if (item.primary === "products") {
              setProductsSubPanel(item.productsSubPanel ?? "catalog");
              return;
            }
            if (item.primary === "governance") {
              setGovernanceSubPanel(item.governanceSubPanel ?? "matrix");
              return;
            }
            setPrimaryTab("overview");
          }),
          html`
            <div class="grid grid-cols-2 enterprise-data-capability__home-grid">
              ${renderCapabilityUsageBoard({
                rows: home.capabilityRows,
                loading: home.capabilityRowsLoading,
                error: home.capabilityRowsError,
                maxRows: 5,
                onViewAll: () => setProductsSubPanel("catalog"),
              })}
              ${approvalsPanel}
            </div>
          `,
          healthPanel,
          drawer,
        ];
      }
    }
  };

  switch (state.primaryTab) {
    case "assets":
      sectionContent = [renderAssetsPage(renderLegacySection("sources"))];
      break;
    case "products": {
      const subNav = html`
        <div class="edc-subnav">
          ${renderEnterpriseSegmentedNav(
            PRODUCTS_SUB_NAV.map((item) => ({
              id: item.id,
              label: item.label,
              active: state.productsSubPanel === item.id,
            })),
            (id) => setProductsSubPanel(id as ProductsSubPanel),
          )}
        </div>
      `;
      sectionContent = [
        renderProductsPage([
          subNav,
          ...renderLegacySection(
            state.productsSubPanel === "outputs" ? "projections" : "capabilities",
          ),
        ]),
      ];
      break;
    }
    case "governance": {
      const subNav = html`
        <div class="edc-subnav">
          ${renderEnterpriseSegmentedNav(
            GOVERNANCE_SUB_NAV.map((item) => ({
              id: item.id,
              label: item.label,
              active: state.governanceSubPanel === item.id,
            })),
            (id) => setGovernanceSubPanel(id as GovernanceSubPanel),
          )}
        </div>
      `;
      if (state.governanceSubPanel === "audit") {
        sectionContent = [
          renderGovernancePage([
            subNav,
            renderAuditLineagePanel({
              overview: home.lineageOverview,
              loading: home.lineageOverviewLoading,
              error: home.lineageOverviewError,
              projectionFailureCount: state.projectionAuditFailureCount,
            }),
          ]),
        ];
      } else {
        const panel =
          state.governanceSubPanel === "approvals"
            ? "approvals"
            : state.governanceSubPanel === "memory"
              ? "memory"
              : "authorization";
        sectionContent = [renderGovernancePage([subNav, ...renderLegacySection(panel)])];
      }
      break;
    }
    case "overview":
    default:
      sectionContent = [renderOverviewPage(renderLegacySection("home"))];
      break;
  }

  const pendingBadge =
    typeof home.summary?.pendingApprovals === "number" && home.summary.pendingApprovals > 0
      ? home.summary.pendingApprovals
      : null;

  const shell = html`
    <div class="enterprise-data-capability__shell">
      ${renderEnterpriseSegmentedNav(
        PRIMARY_TAB_NAV.map(
          (item): EnterpriseSegmentedNavItem => ({
            id: item.id,
            label:
              item.id === "governance" && pendingBadge != null
                ? `${item.label}（${pendingBadge}）`
                : item.label,
            active: state.primaryTab === item.id,
          }),
        ),
        (id) => setPrimaryTab(id as DataCapabilityPrimaryTab),
      )}
      <div class="enterprise-data-capability__section">${sectionContent}</div>
    </div>
  `;

  return renderEnterprisePage({
    tone: "overview",
    notices: [],
    header,
    primary: [
      shell,
      renderSourceEditorModal(
        state.sourceEditor,
        state.connectorCatalog,
        state.connectorCredentials,
        closeSourceEditor,
        submitSourceEditor,
        updateSourceEditor,
        testSourceConnection,
        installConnectorPackage,
        startConnectorOAuth,
        () => {
          void registerOwnedWebsiteBinding();
        },
      ),
      state.sourceLogDetail.open
        ? renderSourceSyncLogDrawer(
            state.sourceLogDetail.sourceLabel,
            state.sourceSyncLogEntries,
            state.sourceSyncLogLoading,
            state.sourceSyncLogError,
            closeSourceLogs,
          )
        : html``,
      renderApprovalDecisionModal(
        state.approvalDecision,
        closeApprovalDecision,
        submitApprovalDecision,
        updateApprovalDecision,
      ),
      renderPolicyEditorModal(
        state.policyEditor,
        state.sources,
        state.scopePolicies,
        state.approvalPolicies,
        state.actionsCatalog,
        {
          readModel: props.readModel,
          seatIds: state.policyPickerSeatIds,
          departmentPaths: state.policyPickerDepartmentPaths,
          query: state.policyPickerQuery,
          roles: state.orgTargets?.roles ?? [],
          onToggleSeat: (seatId) => {
            if (state.policyPickerSeatIds.has(seatId)) {
              state.policyPickerSeatIds.delete(seatId);
            } else {
              state.policyPickerSeatIds.add(seatId);
            }
            if (state.policyEditor.targetKind === "role") {
              state.policyEditor = { ...state.policyEditor, targetKind: "seat", targetId: "" };
            }
            refreshEnterpriseSurface();
          },
          onToggleDepartment: (path) => {
            if (state.policyPickerDepartmentPaths.has(path)) {
              state.policyPickerDepartmentPaths.delete(path);
            } else {
              state.policyPickerDepartmentPaths.add(path);
            }
            if (state.policyEditor.targetKind === "role") {
              state.policyEditor = { ...state.policyEditor, targetKind: "seat", targetId: "" };
            }
            refreshEnterpriseSurface();
          },
          onRemoveSeat: (seatId) => {
            state.policyPickerSeatIds.delete(seatId);
            refreshEnterpriseSurface();
          },
          onRemoveDepartment: (path) => {
            state.policyPickerDepartmentPaths.delete(path);
            refreshEnterpriseSurface();
          },
          onClearAll: () => {
            state.policyPickerSeatIds.clear();
            state.policyPickerDepartmentPaths.clear();
            if (state.policyEditor.targetKind === "role") {
              state.policyEditor = { ...state.policyEditor, targetKind: "seat", targetId: "" };
            }
            refreshEnterpriseSurface();
          },
          onSelectRole: (roleCode) => {
            state.policyPickerSeatIds.clear();
            state.policyPickerDepartmentPaths.clear();
            state.policyEditor = {
              ...state.policyEditor,
              targetKind: roleCode ? "role" : "seat",
              targetId: roleCode,
            };
            refreshEnterpriseSurface();
          },
          onQueryChange: (value) => {
            state.policyPickerQuery = value;
            refreshEnterpriseSurface();
          },
        },
        closePolicyEditor,
        submitPolicyEditor,
        updatePolicyEditor,
      ),
      renderCapabilityEditorModal(
        state.capabilityEditor,
        state.sources,
        state.actionsCatalog,
        {
          seatCount: props.readModel.seatSummaries?.length ?? state.orgTargets?.seats?.length ?? 0,
          readModel: props.readModel,
          seatIds: state.seatGrantSeatIds,
          departmentPaths: state.seatGrantDepartmentPaths,
          seatQuery: state.seatGrantQuery,
          onToggleSeat: (seatId) => {
            if (state.seatGrantSeatIds.has(seatId)) {
              state.seatGrantSeatIds.delete(seatId);
            } else {
              state.seatGrantSeatIds.add(seatId);
            }
            refreshEnterpriseSurface();
          },
          onToggleDepartment: (departmentPath) => {
            if (state.seatGrantDepartmentPaths.has(departmentPath)) {
              state.seatGrantDepartmentPaths.delete(departmentPath);
            } else {
              state.seatGrantDepartmentPaths.add(departmentPath);
            }
            refreshEnterpriseSurface();
          },
          onRemoveSeat: (seatId) => {
            state.seatGrantSeatIds.delete(seatId);
            refreshEnterpriseSurface();
          },
          onRemoveDepartment: (departmentPath) => {
            state.seatGrantDepartmentPaths.delete(departmentPath);
            refreshEnterpriseSurface();
          },
          onClearAll: () => {
            state.seatGrantSeatIds.clear();
            state.seatGrantDepartmentPaths.clear();
            refreshEnterpriseSurface();
          },
          onSeatQueryChange: (value) => {
            state.seatGrantQuery = value;
            refreshEnterpriseSurface();
          },
        },
        closeCapabilityEditor,
        submitCapabilityEditor,
        updateCapabilityEditor,
        () => {
          closeCapabilityEditor();
          setPrimaryTab("assets");
        },
        () => {
          closeCapabilityEditor();
          pushAppHistoryState(pathForTab("enterpriseOrganization", basePath, { tenantId }));
        },
      ),
      renderMcpMappingWizardModal(
        state.mcpMappingEditor,
        closeMcpMappingEditor,
        submitMcpMappingEditor,
        updateMcpMappingEditor,
      ),
      renderProjectionEditorModal(
        state.projectionEditor,
        state.actionsCatalog,
        state.capabilities,
        closeProjectionEditor,
        submitProjectionEditor,
        updateProjectionEditor,
      ),
    ],
  });
}
