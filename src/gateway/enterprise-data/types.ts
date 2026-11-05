// Enterprise Data Governance & Supply Center — shared types.
// Final instruction: docs/design/openbot-enterprise-data-governance-and-supply-center-final-instruction-2026-06-05.md

import type { SarFailureClass } from "../../site-capability/failure-class.js";
import type {
  SiteCompleteness,
  SiteRetryHint,
  SiteRunStatus,
  SiteVerification,
} from "../../site-capability/result.js";
import type { AccountBinding } from "../../site-capability/session-handle.js";
import type { ValidationRecord } from "../../site-capability/validation-record.js";

export type { AccountBinding };

export type ConnectorActionRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ConnectorActionLifecycle = "draft" | "active" | "deprecated" | "frozen";

export type ConnectorAction = {
  actionId: string;
  tenantId: string;
  connectorId: string;
  actionKey: string;
  version: string;
  displayName: string;
  category: string;
  description?: string;
  riskLevel: ConnectorActionRiskLevel;
  requiresApproval: boolean;
  readOnly: boolean;
  outputSchema: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  lifecycle: ConnectorActionLifecycle;
  supersededBy?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
};

export type ConnectorActionRef = {
  connectorId: string;
  actionKey: string;
  version: string;
};

export type ConnectorRuntimeRegistryEntry = {
  registryId: string;
  tenantId: string;
  connectorId: string;
  actionKey: string;
  version: string;
  handlerRef: string;
  readOnly: boolean;
  timeoutMs: number;
  registeredAt: string;
  registeredBy?: string;
};

/** Runtime execution grant — compiled from DataAccessPolicy. */
export type SeatActionGrant = {
  grantId: string;
  tenantId: string;
  seatId: string;
  connectorId: string;
  actionKey: string;
  version: string;
  scopePolicyId?: string;
  approvalPolicyId?: string;
  dataAccessPolicyId?: string;
  effect: "allow";
  createdAt: string;
  revokedAt?: string;
};

/** Enterprise governance object — not a Connector alias. */
export type DataSourceCategory = "crm" | "erp" | "finance" | "oa" | "mes" | "external";

/**
 * How a connector reaches the system. Website session is an AccountBinding
 * reference, not an api_key or oauth2 credential.
 */
export type DataConnectorAccessMethod = "credential" | "website_session";

export type DataSourceStatus = "connected" | "disconnected" | "error";

export type DataSource = {
  sourceId: string;
  tenantId: string;
  sourceKey: string;
  displayName: string;
  category: DataSourceCategory;
  status: DataSourceStatus;
  connectorId: string;
  /** Optional link to tenant-level data connector credential (distinct from operational identity). */
  credentialId?: string;
  /**
   * Catalog access method for this instance. Omitted rows keep the connector
   * catalog value. `website_session` stores `bindingId`, not a credential.
   */
  accessMethod?: DataConnectorAccessMethod;
  /** AccountBinding.bindingId. Website session only. Not a secret. */
  bindingId?: string;
  createdAt: string;
  /**
   * Record modification time only. Not a connectivity check, a successful
   * read, or a knowledge-store materialization.
   */
  updatedAt: string;
  /** Last connectivity probe. Not a sync and not an ingest. */
  lastCheckedAt?: string;
  /**
   * Last successful governed read. Absent for probes and for demo mock
   * success. A live query sets this and still leaves lastMaterializedAt empty.
   */
  lastSucceededAt?: string;
  /** Last projection materialization that stored knowledge for this source. */
  lastMaterializedAt?: string;
  /**
   * Times a projection materialization stored data for this source.
   * Probes and live queries do not increment it.
   */
  materializationCount?: number;
};

export type DataConnectorCredentialStatus = "active" | "reauth_required" | "revoked";

/** Tenant-level CRM/ERP credential metadata — secrets live in the secret vault, not in this record. */
export type DataConnectorCredential = {
  credentialId: string;
  tenantId: string;
  connectorId: string;
  kind: "api_key" | "oauth2";
  status: DataConnectorCredentialStatus;
  label: string;
  /** Masked hint only, e.g. last four characters of the API key. */
  secretHint?: string;
  instanceUrl?: string;
  createdAt: string;
  updatedAt: string;
};

/** HTTP REST connector authentication scheme. Bearer is the default for back-compat. */
export type HttpRestAuthScheme = "bearer" | "basic" | "header" | "query" | "none";

export type DataConnectorCredentialSecret = {
  apiKey?: string;
  instanceUrl?: string;
  oauthAccessToken?: string;
  /**
   * HTTP REST connector tuning (all optional). When omitted the connector behaves
   * exactly as before: a Bearer token against the base URL.
   */
  authScheme?: HttpRestAuthScheme;
  /** Header name for the "header" scheme, e.g. "X-API-Key". */
  authHeaderName?: string;
  /** Query parameter name for the "query" scheme, e.g. "api_key". */
  authQueryParam?: string;
  /** Username for the "basic" scheme (password is taken from apiKey). Also reused as the DB user for relational connectors. */
  basicUsername?: string;
  /** Relative health-check path used by the connectivity probe, e.g. "/health". */
  probePath?: string;
  /**
   * Chanjet / 用友 T+ open-platform app key. Optional per-tenant override.
   * When omitted, the connector reads OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_KEY.
   */
  appKey?: string;
  /** Per-tenant Chanjet app secret. Prefer the platform env var when the ISV app is shared. */
  appSecret?: string;
  /** Chanjet refresh token. Rotated by /auth/v2/refreshToken. */
  oauthRefreshToken?: string;
  /** Chanjet user_auth_permanent_code. */
  oauthPermanentCode?: string;
  /**
   * Chanjet enterprise permanent auth code (`permanentAuthCode`).
   * Combined with a fresh appTicket and the user permanent code for headless renewal.
   */
  orgPermanentAuthCode?: string;
  /** Chanjet cloud enterprise id (orgId). */
  orgId?: string;
  /** Chanjet in-app name. T+Cloud is `tpluscloud`; on-prem T+ is `Tplus`. */
  appName?: string;
  /** T+ sid. Some product APIs expect it as a Cookie. */
  sid?: string;
  /**
   * Optional marketing-organ id. Sent as `?idMarketingOrgan=` only when the
   * Chanjet action documents that path query. QueryPage and FindVoucherList do not.
   */
  idMarketingOrgan?: string;
};

/** Business capability abstraction — actionRefs are the real execution source. */
export type DataCapability = {
  capabilityId: string;
  tenantId: string;
  capabilityKey: string;
  displayName: string;
  description: string;
  sourceIds: string[];
  actionRefs: ConnectorActionRef[];
  enabled: boolean;
  /** "demo" marks auto-seeded sample catalog entries (not real connectors). */
  seedOrigin?: "demo";
  createdAt: string;
  updatedAt: string;
};

/** Management-layer access policy — compiles to SeatActionGrant at runtime. */
export type DataAccessPolicyTargetKind = "seat" | "department" | "role";

export type DataAccessPolicy = {
  policyId: string;
  tenantId: string;
  displayName: string;
  targetKind: DataAccessPolicyTargetKind;
  targetId: string;
  sourceId?: string;
  actionRefs: ConnectorActionRef[];
  scopePolicyId?: string;
  approvalPolicyId?: string;
  enabled: boolean;
  compiledGrantIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectionSourceActionRef = ConnectorActionRef;

export type EnterpriseKnowledgeProjectionCategory =
  | "customer"
  | "sales"
  | "finance"
  | "inventory"
  | "project";

export type EnterpriseKnowledgeObjectKind = "data" | "metric" | "insight";

/**
 * Writable modes with executors: `on_demand`, `scheduled`, and `event_driven`
 * (minimal ingest path via runEventDrivenProjectionsForEvent). event_driven is
 * not a clock scheduler; durable restart queues / ordered replay are not claimed.
 */
export type EnterpriseKnowledgeProjectionMaterializationMode =
  | "on_demand"
  | "scheduled"
  | "event_driven";

/** Absent means withhold. Partial rows become a knowledge object only when this is explicit. */
export type KnowledgePartialPublicationPolicy = "withhold" | "publish_marked";

/** Consumer-visible publication. Absent on older feed items keeps their original meaning. */
export type KnowledgeObjectPublication = "complete" | "partial";

export type EnterpriseKnowledgeProjectionLifecycle = "draft" | "active" | "deprecated" | "frozen";

export type ProjectionTemplateKey =
  | "NormalizeTemplate"
  | "AggregateTemplate"
  | "TrendTemplate"
  | "RiskDetectionTemplate"
  | "ForecastTemplate";

export type EnterpriseKnowledgeProjectionSpec = {
  projectionId: string;
  tenantId: string;
  projectionKey: string;
  displayName: string;
  category: EnterpriseKnowledgeProjectionCategory;
  /** Optional governance association — not an execution permission object. */
  capabilityId?: string;
  /**
   * DataSource instance this projection reads. Required for website_session
   * actions so two instances of one connector cannot share an account.
   */
  sourceId?: string;
  /**
   * Product policy for incomplete output. Omitted records withhold partial
   * output. Only `publish_marked` may store a partial knowledge object.
   */
  partialPublication?: KnowledgePartialPublicationPolicy;
  /** Required explicit execution trace; must not be derived from DataCapability. */
  sourceActions: ProjectionSourceActionRef[];
  objectKind: EnterpriseKnowledgeObjectKind;
  templateKey: ProjectionTemplateKey;
  description: string;
  outputSchema: Record<string, unknown>;
  lifecycle: EnterpriseKnowledgeProjectionLifecycle;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
};

/** Supply binding metadata — governance view layer, not an execution grant. */
export type EnterpriseKnowledgeProjectionBinding = {
  bindingId: string;
  tenantId: string;
  projectionId: string;
  capabilityId?: string;
  materializationMode: EnterpriseKnowledgeProjectionMaterializationMode;
  /** TEAM-scope label used by ProjectionMaterializer; binding-controlled, not RPC-overridable. */
  materializationTeamLabel: string;
  freshnessSlaMinutes?: number;
  enabled: boolean;
  generatorVersion: string;
  visibilityPolicyId?: string;
  createdAt: string;
  updatedAt: string;
};

/** Frozen agent categories for KnowledgeVisibilityPolicy (not agent instance ids). */
export const KNOWLEDGE_AGENT_TYPES = [
  "employee-agent",
  "position-agent",
  "platform-agent",
] as const;
export type KnowledgeAgentType = (typeof KNOWLEDGE_AGENT_TYPES)[number];

export type KnowledgeVisibilityPolicy = {
  policyId: string;
  tenantId: string;
  projectionId: string;
  visibleSeats: string[];
  visibleTeams: string[];
  visibleDepartments: string[];
  visibleRoles: string[];
  visibleAgentTypes: KnowledgeAgentType[];
  createdAt: string;
  updatedAt: string;
};

export type EnterpriseKnowledgeObjectFeedItem = {
  objectId: string;
  tenantId: string;
  projectionId: string;
  title: string;
  kind: EnterpriseKnowledgeObjectKind;
  category: string;
  sourceSystems: string[];
  scopeApplied: string;
  maskedFields: string[];
  generatedAt: string;
  freshnessStatus: "fresh" | "stale" | "expired";
  traceRefs: string[];
  payload: Record<string, unknown>;
  /**
   * Set by E4 publication. Older items omit it and stay on their original
   * meaning. `partial` is a consumer-visible incomplete object, not a complete one.
   */
  publication?: KnowledgeObjectPublication;
  /**
   * Soft-delete timestamp. When set, the item is hidden from knowledge universe,
   * knowledge_search, supply counts, and feed-items.list. Absent means active.
   */
  deletedAt?: string;
};

export type KnowledgeLineageRecord = {
  lineageId: string;
  tenantId: string;
  objectId: string;
  projectionId: string;
  sourceActions: string[];
  sourceTraceIds: string[];
  generatedAt: string;
  generatorVersion: string;
  /** DataSource instance. Absent on older records, which is not a verified website source. */
  sourceId?: string;
  /** SAR capability id from the governed run. Absent is not a verified website capability. */
  sarCapabilityId?: string;
  /** SAR version from the governed run. Absent is not a verified website capability. */
  sarVersion?: string;
  /** SAR runId. Distinct from sourceTraceIds. Absent is not a verified run. */
  sarRunId?: string;
  sarEvidenceRef?: string;
  /**
   * Named validator copied from the bridge. A missing validator is not a passed review.
   */
  validator?: string;
  /** Copied only when the run carried it. Never defaulted to "passed". */
  sarVerification?: SiteVerification;
  /** Copied only when the run carried it. Never defaulted to "complete". */
  sarCompleteness?: SiteCompleteness;
  publication?: KnowledgeObjectPublication;
};

export type KnowledgeLineageChainLayer =
  | "feed_item"
  | "projection"
  | "capability"
  | "data_source"
  | "connector_action"
  | "invocation_trace";

export type KnowledgeLineageChainNode = {
  layer: KnowledgeLineageChainLayer;
  id: string;
  label: string;
  refs?: Record<string, unknown>;
};

/** §8.7 reverse explanation. Distinct from the operational feed/trace chain. */
export type KnowledgeLineageReverseRole =
  | "insight"
  | "metric"
  | "projection"
  | "connector_action"
  | "source_data";

export type KnowledgeLineageReverseNode = {
  role: KnowledgeLineageReverseRole;
  id: string;
  label: string;
  refs?: Record<string, unknown>;
};

export type KnowledgeLineageResolution = {
  lineageId: string;
  objectId: string;
  projectionId: string;
  chain: KnowledgeLineageChainNode[];
  /** Insight → Metric → Projection → ConnectorAction@version → Source Data. */
  reverseChain: KnowledgeLineageReverseNode[];
};

export type ConnectorSyncLogStatus = "success" | "warning" | "failure";

/**
 * One incremental pull of a connector stream. Visible in the data-asset sync
 * log. This is not a projection materialization audit.
 */
export type ConnectorSyncLogEntry = {
  entryId: string;
  tenantId: string;
  sourceId: string;
  connectorId: string;
  streamKey: string;
  status: ConnectorSyncLogStatus;
  title: string;
  detail: string;
  recordCount?: number;
  /** Watermark after this run. Absent when the cursor did not advance. */
  watermark?: string;
  recordedAt: string;
};

/** Next incremental window start for one source stream. */
export type ConnectorSyncCursor = {
  cursorId: string;
  tenantId: string;
  sourceId: string;
  streamKey: string;
  /**
   * Master data uses `YYYY-MM-DD HH:mm:ss`. Voucher dates use `YYYY-MM-DD`.
   * The next pull starts at this value (inclusive).
   */
  watermark: string;
  updatedAt: string;
};

export type KnowledgeSupplyAuditEventType = "materialization_success" | "materialization_failure";

export type KnowledgeSupplyAuditEvent = {
  auditId: string;
  tenantId: string;
  eventType: KnowledgeSupplyAuditEventType;
  bindingId: string;
  projectionId: string;
  objectId?: string;
  lineageId?: string;
  sourceTraceIds: string[];
  status: "success" | "failure";
  errorCode?: string;
  errorMessage?: string;
  generatorVersion?: string;
  materializerSeatId: string;
  recordedAt: string;
};

export type GovernanceApprovalCategory =
  | "source_onboarding"
  | "data_access"
  | "capability_exposure"
  | "identity_binding"
  | "seat_capability_access"
  /** Employee request for enterprise knowledge projection visibility. */
  | "enterprise_knowledge_access"
  /** Employee/capability-access: map MCP tool → DataCapability (approve intent only in MVP). */
  | "mcp_tool_mapping"
  /** Placeholder for personal/enterprise OI enrollment requests (MVP: intent only). */
  | "oi_enrollment"
  /** cn-office / enterprise_review_required pack skill install review. */
  | "pack_skill_review";

export type GovernanceApprovalSubjectKind =
  | "data_source"
  | "data_access_policy"
  | "data_capability"
  | "operational_identity_binding"
  | "seat_capability_access"
  | "enterprise_knowledge_projection"
  | "mcp_tool_mapping"
  | "oi_enrollment"
  | "pack_skill_review";

/** Product review sub-state while status stays `pending` (submitted / in_review). */
export type GovernanceApprovalReviewState = "submitted" | "in_review";

export type GovernanceApprovalFulfillmentStatus =
  | "not_required"
  | "pending_admin_save"
  | "fulfilled"
  | "failed";

/**
 * approve_intent_only: admin Save later.
 * approve_and_provision: admin-clicked decide runs mapping (+ seat grant when needed).
 * Supported on decide for mcp_tool_mapping only.
 */
export type GovernanceApprovalFulfillmentMode = "approve_intent_only" | "approve_and_provision";

export type GovernanceApprovalProvisionReceipt = {
  handlerRef?: string;
  capabilityId?: string;
  grantId?: string;
  enrollmentId?: string;
  /** Pack skill unlock receipt. Does not install the skill or write credentials. */
  packId?: string;
  skillKey?: string;
  targetRobotId?: string;
};

export type GovernanceApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export type GovernanceApprovalRequest = {
  approvalId: string;
  tenantId: string;
  category: GovernanceApprovalCategory;
  subjectKind: GovernanceApprovalSubjectKind;
  subjectId: string;
  displayName: string;
  requestedBy: string;
  requestedAt: string;
  status: GovernanceApprovalStatus;
  reason?: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string;
  /** 员工席位能力申请：申请方 seatId */
  requesterSeatId?: string;
  /** While status===pending: submitted | in_review (capability-access + legacy optional). */
  reviewState?: GovernanceApprovalReviewState;
  fulfillmentStatus?: GovernanceApprovalFulfillmentStatus;
  fulfillmentMode?: GovernanceApprovalFulfillmentMode;
  /** Frozen subject snapshot for audit (no secrets / tokens). */
  subjectPayload?: Record<string, unknown>;
  clientRequestId?: string;
  catalogId?: string;
  templateId?: string;
  fulfilledAt?: string;
  fulfilledBy?: string;
  provisionReceipt?: GovernanceApprovalProvisionReceipt;
  /** Safe zh-CN reason when approve_and_provision failed. Never a raw stack or secret. */
  provisionError?: string;
};

export type GovernanceApprovalCenterOverview = {
  pendingByCategory: Record<GovernanceApprovalCategory, number>;
  recentPending: GovernanceApprovalRequest[];
  totalPending: number;
};

// --- M1 Execution Governance ---

export type ScopeType = "SELF" | "TEAM" | "DEPARTMENT" | "ALL";

export type ScopeFilterOperator = "eq" | "in" | "contains";

export type ScopeFilterClause = {
  field: string;
  operator: ScopeFilterOperator;
  valueRef: string;
};

export type ScopePolicy = {
  scopePolicyId: string;
  tenantId: string;
  displayName: string;
  scopeType: ScopeType;
  filterClauses?: ScopeFilterClause[];
  filterDescription?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
};

export type ScopeEvaluationContext = {
  tenantId: string;
  seatId: string;
  employeeId: string;
  userId: string;
  teamLabel?: string;
  roleCode?: string;
  departmentId?: string;
};

export type ScopeEvaluationResult = {
  scopeType: ScopeType;
  appliedFilters: ScopeFilterClause[];
  resolvedValues: Record<string, string | string[]>;
  scopeAppliedLabel: string;
};

export type DataClassification = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";

export type MaskingStrategy =
  | "redact"
  | "partial_phone"
  | "partial_email"
  | "hash"
  | "aggregate_only";

export type MaskingPolicy = {
  maskingPolicyId: string;
  tenantId: string;
  displayName: string;
  strategy: MaskingStrategy;
  config?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type FieldClassification = {
  classificationId: string;
  tenantId: string;
  connectorId: string;
  actionKey: string;
  version: string;
  fieldPath: string;
  classification: DataClassification;
  maskingPolicyId?: string;
  blockDetail?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UnknownFieldPolicy = "fail_closed_redact" | "fail_closed_block";

export type ClassificationRuntimeConfig = {
  tenantId: string;
  unknownFieldPolicy: UnknownFieldPolicy;
  strictMode: boolean;
  updatedAt: string;
};

export type MaskingResult = {
  data: unknown;
  masked: boolean;
  maskedFields: string[];
  blockedFields: string[];
  unknownFields: string[];
  classifications: DataClassification[];
  classificationDigest: string;
};

export type ApprovalMode = "NONE" | "ONCE" | "PER_REQUEST";

export type ApprovalPolicy = {
  approvalPolicyId: string;
  tenantId: string;
  displayName: string;
  mode: ApprovalMode;
  approverRole: "enterprise-admin";
  expiryHours?: number;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalContextSnapshot = {
  scopePolicyId: string;
  scopePolicyDigest: string;
  grantId: string;
  grantDigest: string;
  classificationDigest?: string;
};

export type ApprovalRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "superseded"
  | "invalidated";

export type ApprovalRequest = {
  approvalId: string;
  tenantId: string;
  seatId: string;
  employeeId: string;
  connectorId: string;
  actionKey: string;
  version: string;
  approvalPolicyId: string;
  status: ApprovalRequestStatus;
  requestedAt: string;
  expiresAt?: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string;
  reason?: string;
  approvalContextId: string;
  contextSnapshot?: ApprovalContextSnapshot;
  consumedAt?: string;
  consumedTraceId?: string;
};

export type InvocationAuditStatus = "SUCCESS" | "DENIED" | "FAILED" | "PRESERVED";

export type InvocationDenialReason =
  | "NO_SEAT_CONTEXT"
  | "NO_ACTION_GRANT"
  | "ACTION_FROZEN"
  | "ACTION_NOT_REGISTERED"
  | "SCOPE_DENIED"
  | "SCOPE_CONTEXT_MISSING"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_INVALIDATED"
  | "CREDENTIAL_REAUTH_REQUIRED"
  | "HANDLER_TIMEOUT"
  | "HANDLER_ERROR"
  | "AUDIT_WRITE_FAILED"
  | "UNTRUSTED_CLIENT_CONTEXT"
  | "UNTRUSTED_EXECUTION_CONTEXT"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_ACCOUNT_AMBIGUOUS"
  | "SOURCE_CREDENTIAL_MISSING"
  | "SAR_BINDING_MISSING"
  | "SAR_BINDING_PRIVATE"
  | "SAR_HANDLER_MISSING"
  | "SAR_VERIFICATION_MISSING"
  | "SAR_SCOPE_UNSUPPORTED"
  | "SAR_WRITE_FORBIDDEN"
  | "SAR_OUTCOME_PRESERVED"
  | "SAR_EXECUTION_HALTED";

/**
 * Five operator-facing SAR failure classes. Unclassified outcomes stay unset
 * so they are not presented as one of these five.
 */
export type SarFailureDisplayClass =
  | "login"
  | "infrastructure"
  | "policy_denied"
  | "structure_change"
  | "business_validation";

/**
 * Link between an enterprise gateway trace and a SAR run.
 * Allowlist only: no payload, cookie, prompt, or trace body.
 */
export type SarTraceCorrelation = {
  correlationId: string;
  tenantId: string;
  traceId: string;
  sarRunId: string;
  capabilityId: string;
  version: string;
  evidenceRef: string;
  status: SiteRunStatus;
  denialReason?: InvocationDenialReason;
  sarErrorCode?: string;
  failureClass?: SarFailureClass;
  displayClass?: SarFailureDisplayClass;
  displayLabel?: string;
  recordedAt: string;
};

export type SarExecutionHaltScope = "tenant" | "capability" | "version";

/** Stops new website runs. Does not withdraw an in-flight side effect. */
export type SarExecutionHalt = {
  haltId: string;
  tenantId: string;
  scope: SarExecutionHaltScope;
  capabilityId?: string;
  version?: string;
  reason: string;
  haltedAt: string;
  haltedBy: string;
};

/**
 * E5-style allowlist audit for SAR admin ops (bridge upsert / halt / resume).
 * No payload, cookie, credential, or full client params.
 */
export type SarAdminAuditAction = "bridge_upsert" | "halt_set" | "halt_clear";

export type SarAdminAuditEvent = {
  auditId: string;
  tenantId: string;
  action: SarAdminAuditAction;
  actorId: string;
  /** Bridge or halt id when applicable. */
  subjectId?: string;
  capabilityId?: string;
  version?: string;
  haltScope?: SarExecutionHaltScope;
  /** Always false when action is halt_set. Halt does not withdraw in-flight effects. */
  inFlightSideEffectsWithdrawn?: false;
  /** Always false when action is halt_set. Matches P4 / E5. */
  priorWriteMayBeReplayed?: false;
  summary: string;
  recordedAt: string;
};

/**
 * Tenant-scoped durable ValidationRecord for capability-center install projection.
 * Reuses the SAR ValidationRecord shape; tenantId / expiresAt / accessibleScope
 * are enterprise store metadata so install RPC can fail closed across tenants.
 */
export type EnterpriseSarValidationRecord = ValidationRecord & {
  tenantId: string;
  /** When set and <= now, the record does not satisfy the execution gate. */
  expiresAt?: string;
  /**
   * Declared accessible scope for this artifact under the tenant
   * (e.g. SELF / TEAM). Empty means unrestricted within the tenant boundary.
   */
  accessibleScope?: string;
};

/**
 * SAR facts carried across the governance gateway. `runId` stays distinct
 * from the gateway `traceId`. Unknown and partial are not a complete success.
 */
export type SarGatewayCorrelation = {
  status: SiteRunStatus;
  verification: SiteVerification;
  completeness: SiteCompleteness;
  runId: string;
  evidenceRef: string;
  capabilityId: string;
  version: string;
  artifactDigest: string;
  retry: SiteRetryHint;
  ordinaryFailure: boolean;
  errorCode?: string;
};

export type InvocationAuditEvent = {
  invocationAuditId: string;
  traceId: string;
  tenantId: string;
  seatId: string;
  employeeId?: string;
  agentId?: string;
  connectorId: string;
  actionKey: string;
  version: string;
  riskLevel: ConnectorActionRiskLevel;
  scopeType: string;
  scopeAppliedLabel?: string;
  approvalContextId?: string;
  approvalId?: string;
  status: InvocationAuditStatus;
  denialReason?: InvocationDenialReason;
  errorMessage?: string;
  durationMs?: number;
  timestamp: string;
  /** Associated SAR run. Not a replacement for traceId. */
  sarRunId?: string;
  sarEvidenceRef?: string;
  sarStatus?: SiteRunStatus;
  sarVerification?: SiteVerification;
  sarCompleteness?: SiteCompleteness;
  artifactDigest?: string;
};

export type DataObjectRef = {
  objectType: string;
  objectKeyHash: string;
  objectKeyHint?: string;
};

export type DataAuditEvent = {
  dataAuditId: string;
  traceId: string;
  tenantId: string;
  recordCount: number;
  objectRefs: DataObjectRef[];
  objectRefTruncated: boolean;
  masked: boolean;
  maskedFields: string[];
  blockedFields: string[];
  unknownFields: string[];
  classifications: string[];
  approvalId?: string;
  timestamp: string;
};

export type EnterpriseDataInvokeContext = {
  tenantId: string;
  seatId: string;
  employeeId: string;
  userId: string;
  teamLabel?: string;
  roleCode?: string;
  departmentId?: string;
  agentId?: string;
  /** Set only by server-side resolution; never accept from clients. */
  trustAttestation?: "server-session-v1" | "projection-materializer-v1";
};

export type DataGatewaySuccessResponse = {
  ok: true;
  traceId: string;
  source: string;
  actionKey: string;
  version: string;
  generatedAt: string;
  data: unknown;
  recordCount: number;
  scopeApplied: string;
  masked: boolean;
  maskedFields: string[];
  blockedFields: string[];
  durationMs: number;
  approvalId?: string;
  /** Set only for a complete SAR bridge success. Partial and unknown use the denial shape. */
  sar?: SarGatewayCorrelation;
};

export type DataGatewayDenialResponse = {
  ok: false;
  traceId: string;
  code: InvocationDenialReason;
  message: string;
  details?: Record<string, unknown>;
  /** Preserved SAR facts. Present when a run happened but is not a complete success. */
  sar?: SarGatewayCorrelation;
  /**
   * Masked partial payload for the projection materializer only.
   * Employee and agent invokes leave this unset. It is not a complete success.
   */
  preservedPartial?: {
    data: unknown;
    maskedFields: string[];
    scopeApplied: string;
  };
};

export type DataGatewayResponse = DataGatewaySuccessResponse | DataGatewayDenialResponse;

export type EnterpriseDataStore = {
  version: number;
  connectorActions: Record<string, ConnectorAction>;
  connectorRuntimeRegistry: Record<string, ConnectorRuntimeRegistryEntry>;
  seatActionGrants: Record<string, SeatActionGrant>;
  scopePolicies: Record<string, ScopePolicy>;
  fieldClassifications: Record<string, FieldClassification>;
  maskingPolicies: Record<string, MaskingPolicy>;
  classificationRuntimeConfigs: Record<string, ClassificationRuntimeConfig>;
  approvalPolicies: Record<string, ApprovalPolicy>;
  approvalRequests: Record<string, ApprovalRequest>;
  invocationAuditEvents: Record<string, InvocationAuditEvent>;
  dataAuditEvents: Record<string, DataAuditEvent>;
  dataSources: Record<string, DataSource>;
  dataCapabilities: Record<string, DataCapability>;
  dataAccessPolicies: Record<string, DataAccessPolicy>;
  enterpriseKnowledgeProjectionSpecs: Record<string, EnterpriseKnowledgeProjectionSpec>;
  enterpriseKnowledgeProjectionBindings: Record<string, EnterpriseKnowledgeProjectionBinding>;
  knowledgeVisibilityPolicies: Record<string, KnowledgeVisibilityPolicy>;
  knowledgeFeedItems: Record<string, EnterpriseKnowledgeObjectFeedItem>;
  knowledgeLineageRecords: Record<string, KnowledgeLineageRecord>;
  knowledgeSupplyAuditEvents: Record<string, KnowledgeSupplyAuditEvent>;
  /**
   * Connector incremental-sync cursors. Keyed by cursorId. Older files omit the map.
   * Not a projection materialization watermark.
   */
  connectorSyncCursors?: Record<string, ConnectorSyncCursor>;
  /**
   * Connector sync-log rows shown beside projection audits. Older files omit the map.
   */
  connectorSyncLogEntries?: Record<string, ConnectorSyncLogEntry>;
  governanceApprovalRequests: Record<string, GovernanceApprovalRequest>;
  dataConnectorCredentials: Record<string, DataConnectorCredential>;
  /** E1 SAR execution bridges. Keyed by bridgeId. Absent on older files. */
  sarExecutionBridges?: Record<string, EnterpriseSarExecutionBridge>;
  /**
   * AccountBinding records the owner registered for website access.
   * Keyed by bindingId. Not a credential and not a cookie.
   */
  accountBindings?: Record<string, AccountBinding>;
  /**
   * E5 traceId ↔ runId links. Older files omit the map. Loading them does not
   * invent a link or a verified website capability.
   */
  sarTraceCorrelations?: Record<string, SarTraceCorrelation>;
  /** E5 tenant / capability / version switches. Older files omit the map. */
  sarExecutionHalts?: Record<string, SarExecutionHalt>;
  /**
   * A2 durable validation records for install projection. Older files omit
   * the map. Loading them does not invent a passed verdict.
   */
  sarValidationRecords?: Record<string, EnterpriseSarValidationRecord>;
  /**
   * A3 admin-op audit (bridge upsert / halt / resume). Older files omit the map.
   * Allowlist only; does not invent invoke success or withdrawn side effects.
   */
  sarAdminAuditEvents?: Record<string, SarAdminAuditEvent>;
};

/**
 * Explicit DataSource → AccountBinding → ConnectorActionRef → fixed SAR
 * capability mapping. Field names reuse the E0 contract. This is not a
 * credential and not a DataCapability id.
 */
export type EnterpriseSarExecutionBridge = {
  bridgeId: string;
  tenantId: string;
  sourceId: string;
  actionRef: ConnectorActionRef;
  capabilityId: string;
  version: string;
  artifactDigest: string;
  skillId?: string;
  /** AccountBinding.bindingId. */
  bindingId: string;
  /** AccountBinding.userId. Private to that user. */
  userId: string;
  /** Capability verification for this artifact. Execution requires "passed". */
  verification: "unverified" | "passed" | "failed" | "stale";
  /**
   * Named validator for lineage. Absent does not mean the artifact was reviewed.
   * Verification status above is not a substitute for this name.
   */
  validator?: string;
  effect: "read";
  supportedScopeTypes: ScopeType[];
  /** Filter fields the provider can push down before reading. */
  enforcedFilterFields: string[];
  createdAt: string;
  updatedAt: string;
};

export const ENTERPRISE_DATA_STORE_VERSION = 5;

export function buildConnectorActionRefKey(ref: ConnectorActionRef): string {
  return `${ref.connectorId}::${ref.actionKey}::${ref.version}`;
}

export function formatActionDisplayRef(ref: ConnectorActionRef): string {
  return `${ref.actionKey}@${ref.version}`;
}
