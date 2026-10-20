/**
 * 企业数据能力中心（Enterprise Data Capability Center）首页前端业务类型。
 *
 * 设计约束（见 .kiro/specs/enterprise-data-capability-center/tasks.md）：
 * - 仅承载视图所需的业务字段，**禁止**透传后端 runtime/grant/digest/trace 字段。
 * - KPI「知识供给」定标为「知识对象数」（feedItemCount），并附带 enabledBindingCount 供后续切换。
 *
 * @module enterprise-data-capability/types
 */

/** 首页指标概览卡片数据（对应后端 `enterprise-data.dashboard.summary`）。 */
export type DataCapabilityDashboardSummary = {
  /** 数据源总数。 */
  totalDataSources: number;
  /** 数据能力总数。 */
  totalCapabilities: number;
  /** 开放部门数（去重统计 department 授权目标）。 */
  totalDepartments: number;
  /** 已产出知识对象数（feedItemCount）。 */
  knowledgeObjectCount: number;
  /** 已启用供给通道（投影绑定）数；供 KPI 文案切换使用。 */
  enabledBindingCount: number;
  /** 待审批数（治理审批中心 totalPending）。 */
  pendingApprovals: number;
};

/** 待审批面板行（对应 governance-approvals.overview 的 recentPending）。 */
export type PendingApprovalItem = {
  approvalId: string;
  /** source_onboarding | data_access | capability_exposure | identity_binding。 */
  category:
    | "source_onboarding"
    | "data_access"
    | "capability_exposure"
    | "identity_binding"
    | "seat_capability_access";
  displayName: string;
  requestedAt: string;
  status: string;
};

/** 数据源健康状态（5 态，Phase 4.1）。 */
export type DataSourceHealthStatus =
  | "normal"
  | "sync_delayed"
  | "token_expiring"
  | "error"
  | "disconnected";

/** 数据源健康面板行（对应 sources.list 的 DataSource）。 */
export type DataSourceHealthRow = {
  sourceId: string;
  displayName: string;
  category: string;
  status: DataSourceHealthStatus;
};

// --- Phase 2 / Phase 3 视图类型（契约补齐后启用） ---

/** 授权目标分组（seat 权威；role/department 为治理视图聚合，不改变运行时 seat 编译边界）。 */
export type AuthorizationTarget = {
  kind: "seat" | "role" | "department";
  label: string;
  count: number;
  /** true=权威 seat / 可解析 department；false=role 聚合或回退值。 */
  precise: boolean;
};

/** 数据授权总览卡片（对应 `dashboard.authorization-cards` v1）。 */
export type AuthorizationSourceCard = {
  sourceId: string;
  displayName: string;
  targets: AuthorizationTarget[];
};

/** 能力目录使用行（对应 Phase 2 `dashboard.capability-rows`）。 */
export type CapabilityUsageRow = {
  capabilityId: string;
  displayName: string;
  sourceNames: string[];
  targetLabels: string[];
  knowledgeObjectCount: number;
  enabled: boolean;
  /** 最近运行时间戳（真实审计数据，Phase 4.5）；从未运行为 null。 */
  lastRunAt: string | null;
};

/** 资产全景图节点（对应 Phase 3 `asset-landscape.graph`）。 */
export type AssetLandscapeNode = {
  id: string;
  kind: "source" | "capability" | "knowledge" | "department" | "seat" | "role";
  label: string;
};

/** 资产全景图边：source（来源）/ generate（生成）/ open（开放）。 */
export type AssetLandscapeEdge = {
  from: string;
  to: string;
  relation: "source" | "generate" | "open";
};

export type AssetLandscapeGraph = {
  nodes: AssetLandscapeNode[];
  edges: AssetLandscapeEdge[];
  /** True when capabilities were truncated by limit (partial graph). */
  truncated: boolean;
};

/** 知识供给中心 / Projection Studio 概览（对应 `knowledge-supply.overview`）。 */
export type KnowledgeSupplyOverview = {
  projectionCount: number;
  activeProjectionCount: number;
  enabledBindingCount: number;
  visibilityPolicyCount: number;
  feedItemCount: number;
  freshness: { fresh: number; stale: number; expired: number };
  lineageRecordCount: number;
  recentFeedItems?: Array<{
    objectId: string;
    projectionId: string;
    title: string;
    freshnessStatus: "fresh" | "stale" | "expired";
    generatedAt: string;
    sourceSystems: string[];
  }>;
};

/** 审计与血缘概览（对应 `audit-lineage.overview`）。 */
export type AuditLineageReverseRole =
  | "insight"
  | "metric"
  | "projection"
  | "connector_action"
  | "source_data";

export type AuditLineageOverview = {
  lineageCount: number;
  supplyAuditCount: number;
  /** 物化失败审计事件数（status=failure），用于投影工作室「近期物化失败」告警。 */
  materializationFailureCount: number;
  /** 最近一条血缘的 §8.7 反向链。没有记录时为空数组。 */
  recentReverseChain?: Array<{
    role: AuditLineageReverseRole;
    id: string;
    label: string;
  }>;
};

/** 新建/编辑投影规格入参（对应 `enterprise-data.projection-specs.upsert`）。 */
export type ProjectionSpecUpsertInput = {
  projectionId?: string;
  projectionKey: string;
  displayName: string;
  category: string;
  objectKind: string;
  templateKey: string;
  lifecycle: string;
  sourceActions: Array<{ connectorId: string; actionKey: string; version: string }>;
  capabilityId?: string;
  description?: string;
};

/** 新建/编辑供给绑定入参（对应 `enterprise-data.projection-bindings.upsert`）。 */
export type ProjectionBindingUpsertInput = {
  bindingId?: string;
  projectionId: string;
  materializationMode: string;
  materializationTeamLabel: string;
  generatorVersion: string;
  capabilityId?: string;
  freshnessSlaMinutes?: number;
  enabled?: boolean;
  visibilityPolicyId?: string;
};

/** 组织架构目标（授权策略 / 能力授予的可选目标，对应 `enterprise-data.org.targets`）。 */
export type OrgSeatTarget = {
  seatId: string;
  title: string;
  teamLabel?: string;
  roleCode?: string;
  status: string;
};

export type OrgDepartmentTarget = {
  /** 合成 id `roleCode:teamLabel`，作为策略 targetId。 */
  departmentId: string;
  label: string;
  seatCount: number;
};

export type OrgRoleTarget = {
  roleCode: string;
  seatCount: number;
};

export type OrgTargets = {
  seats: OrgSeatTarget[];
  departments: OrgDepartmentTarget[];
  roles: OrgRoleTarget[];
};

// --- Management console types (admin actions) ---

export type ManagedConnectorActionRef = {
  connectorId: string;
  actionKey: string;
  version: string;
};

export type DataConnectorCatalogEntry = {
  connectorId: string;
  label: string;
  category: "crm" | "erp" | "finance" | "oa" | "mes" | "external";
  integrationTier: "demo" | "production";
  credentialKind: "none" | "api_key" | "oauth2";
  accessMethod?: "credential" | "website_session";
  description: string;
  defaultSourceKey: string;
  registeredActionCount: number;
  runtimeHandlerCount: number;
  ready: boolean;
};

/** HTTP REST connector authentication scheme. Bearer is the default for back-compat. */
export type HttpRestAuthScheme = "bearer" | "basic" | "header" | "query" | "none";

/** Optional HTTP REST connector tuning carried by test-connection + credential upsert. */
export type HttpRestConnectorConfig = {
  authScheme?: HttpRestAuthScheme;
  authHeaderName?: string;
  authQueryParam?: string;
  basicUsername?: string;
  probePath?: string;
};

export type SourceConnectionProbeResult = {
  ok: boolean;
  connectorId: string;
  integrationTier: "demo" | "production" | null;
  mode:
    | "mock_smoke_ok"
    | "live_probe_ok"
    | "live_probe_failed"
    | "actions_missing"
    | "handlers_missing"
    | "credential_required"
    | "unknown_connector"
    | "handler_error";
  message: string;
  actionCount: number;
  handlerCount: number;
};

export type DataConnectorCredentialRecord = {
  credentialId: string;
  connectorId: string;
  kind: "api_key" | "oauth2";
  status: "active" | "reauth_required" | "revoked";
  label: string;
  secretHint?: string;
  instanceUrl?: string;
  updatedAt: string;
};

export type ManagedDataSourceRecord = {
  sourceId: string;
  sourceKey: string;
  displayName: string;
  category: "crm" | "erp" | "finance" | "oa" | "mes" | "external";
  status: "connected" | "disconnected" | "error";
  connectorId: string;
  credentialId?: string;
  accessMethod?: "credential" | "website_session";
  bindingId?: string;
  updatedAt: string;
  lastCheckedAt?: string;
  lastSucceededAt?: string;
  lastMaterializedAt?: string;
  materializationCount?: number;
};

export type ManagedProjectionSpecRecord = {
  projectionId: string;
  projectionKey: string;
  displayName: string;
  capabilityId?: string;
  lifecycle: string;
  objectKind: string;
  templateKey: string;
  sourceActionCount: number;
  updatedAt: string;
};

export type ManagedProjectionBindingRecord = {
  bindingId: string;
  projectionId: string;
  capabilityId?: string;
  materializationMode: string;
  enabled: boolean;
  materializationTeamLabel: string;
  updatedAt: string;
};

export type ProjectionMaterializeResult = {
  bindingId: string;
  feedItemId: string;
  objectId: string;
  title: string;
};

export type ManagedDataSourceSyncLogEntry = {
  entryId: string;
  recordedAt: string;
  status: "success" | "warning" | "failure";
  title: string;
  detail: string;
  projectionId?: string;
  projectionDisplayName?: string;
};

export type ManagedAccessPolicyRecord = {
  policyId: string;
  displayName: string;
  targetKind: "seat" | "department" | "role";
  targetId: string;
  sourceId?: string;
  actionRefs: ManagedConnectorActionRef[];
  scopePolicyId?: string;
  approvalPolicyId?: string;
  enabled: boolean;
  compiledGrantIds: string[];
  updatedAt: string;
};

export type ManagedAccessPolicyDetail = {
  policy: ManagedAccessPolicyRecord;
  runtimeActionRefs: ManagedConnectorActionRef[];
  compiledGrants: Array<{
    grantId: string;
    seatId: string;
    connectorId: string;
    actionKey: string;
    version: string;
    revokedAt?: string;
  }>;
  compilationSupported: boolean;
};

export type ManagedConnectorActionRecord = {
  connectorId: string;
  actionKey: string;
  version: string;
  displayName: string;
  category: string;
  lifecycle: "draft" | "active" | "deprecated" | "frozen";
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readOnly: boolean;
};

export type ManagedScopePolicyRecord = {
  scopePolicyId: string;
  displayName: string;
  scopeType: "SELF" | "TEAM" | "DEPARTMENT" | "ALL";
  filterDescription?: string;
};

export type ManagedApprovalPolicyRecord = {
  approvalPolicyId: string;
  displayName: string;
  mode: "NONE" | "ONCE" | "PER_REQUEST";
  expiryHours?: number;
};

export type ManagedCapabilityRecord = {
  capabilityId: string;
  capabilityKey: string;
  displayName: string;
  description: string;
  sourceIds: string[];
  actionRefs: ManagedConnectorActionRef[];
  enabled: boolean;
  updatedAt: string;
};

export type ManagedCapabilityGovernanceView = {
  capability: ManagedCapabilityRecord;
  sourceMappings: Array<{
    sourceId: string;
    source: {
      sourceId: string;
      sourceKey: string;
      displayName: string;
      category: string;
      status: string;
      connectorId: string;
    };
  }>;
  actionMappings: Array<{
    ref: ManagedConnectorActionRef;
    action: ManagedConnectorActionRecord | null;
    handlerRegistered: boolean;
  }>;
  projectionSpecs: Array<{
    projectionId: string;
    displayName: string;
    lifecycle: "draft" | "active" | "deprecated" | "frozen";
  }>;
  accessScope: {
    policies: Array<{
      policyId: string;
      displayName: string;
      targetKind: "seat" | "department" | "role";
      targetId: string;
      enabled: boolean;
    }>;
    activeGrants: Array<{
      grantId: string;
      seatId: string;
      connectorId: string;
      actionKey: string;
      version: string;
      revokedAt?: string;
    }>;
  };
  supplyHealth: {
    enabled: boolean;
    projectionCount: number;
    bindingCount: number;
    activeGrantCount: number;
    enabledPolicyCount: number;
  };
};

export type ManagedGovernanceApprovalRequest = {
  approvalId: string;
  category:
    | "source_onboarding"
    | "data_access"
    | "capability_exposure"
    | "identity_binding"
    | "seat_capability_access"
    | "enterprise_knowledge_access"
    | "mcp_tool_mapping"
    | "oi_enrollment"
    | "pack_skill_review";
  subjectKind:
    | "data_source"
    | "data_access_policy"
    | "data_capability"
    | "operational_identity_binding"
    | "seat_capability_access"
    | "enterprise_knowledge_projection"
    | "mcp_tool_mapping"
    | "oi_enrollment"
    | "pack_skill_review";
  subjectId: string;
  displayName: string;
  requestedBy: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reason?: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string;
  requesterSeatId?: string;
  reviewState?: "submitted" | "in_review";
  fulfillmentStatus?: "not_required" | "pending_admin_save" | "fulfilled" | "failed";
  fulfillmentMode?: "approve_intent_only" | "approve_and_provision";
  subjectPayload?: Record<string, unknown>;
  fulfilledAt?: string;
  fulfilledBy?: string;
  provisionError?: string;
};
