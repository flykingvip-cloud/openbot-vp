/**
 * Gateway RPC endpoint definitions for the Enterprise Capability Center.
 *
 * This module defines the typed request/response contracts for all 14 RPC
 * methods exposed under the `enterprise-capability.*` namespace.
 *
 * Critical constraint — EnterpriseCapabilityProjection:
 * Every Response type referenced here MUST be free of runtime fields
 * (prompt, workflowJson, toolchain, modelRouting, provider, memoryStrategy,
 * executionPolicy, routingHints, modelPreferences). The projection layer
 * strips these before the gateway responds, so they are not permitted to
 * appear anywhere in these signatures.
 *
 * Design principles:
 * - Only `type` aliases, no `interface`
 * - Types are imported exclusively from `./types.ts`
 * - Each endpoint has a paired Request / Response type
 */

import type {
  AssetListFilters,
  AssetSortConfig,
  CapabilityDomain,
  ContributionPerformanceItem,
  ContributionRecord,
  DomainDistribution,
  EnterpriseAssetListItem,
  EnterpriseCapabilityAsset,
  EnterpriseHealthStatus,
  InstallRelation,
  PaginationState,
  ReviewApprovalPayload,
  ReviewAssessment,
  ReviewQueueItem,
  ReviewRecord,
  SidebarEntry,
  StatisticsDashboardData,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Endpoint name constants
// ---------------------------------------------------------------------------

/**
 * Canonical RPC method names for the enterprise capability center.
 * All methods live under the `enterprise-capability.*` namespace to keep the
 * enterprise asset layer cleanly separated from the employee capability layer
 * (`employee-capability.*`).
 */
export const ENTERPRISE_CAPABILITY_ENDPOINTS = {
  list: "enterprise-capability.list",
  detail: "enterprise-capability.detail",
  review: "enterprise-capability.review",
  reviewQueue: "enterprise-capability.review-queue",
  installToRobots: "enterprise-capability.install-to-robots",
  pushToPositions: "enterprise-capability.push-to-positions",
  uninstall: "enterprise-capability.uninstall",
  stats: "enterprise-capability.stats",
  contributionRecords: "enterprise-capability.contribution-records",
  installManagement: "enterprise-capability.install-management",
  contributionPerformance: "enterprise-capability.contribution-performance",
  certify: "enterprise-capability.certify",
  promoteToStandard: "enterprise-capability.promote-to-standard",
  updateHealthStatus: "enterprise-capability.update-health-status",
  domainDistribution: "enterprise-capability.domain-distribution",
} as const;

/** Union of all enterprise-capability RPC method names. */
export type EnterpriseCapabilityEndpoint =
  (typeof ENTERPRISE_CAPABILITY_ENDPOINTS)[keyof typeof ENTERPRISE_CAPABILITY_ENDPOINTS];

// ---------------------------------------------------------------------------
// Shared pagination request shape
// ---------------------------------------------------------------------------

/**
 * Pagination input used across list-style endpoints. Page size is constrained
 * to the three options exposed in the UI (10 / 20 / 50 per page).
 */
export type PaginationInput = {
  page: number;
  pageSize: 10 | 20 | 50;
};

// ---------------------------------------------------------------------------
// list — Enterprise capability list with filters / sort / pagination
// ---------------------------------------------------------------------------

/**
 * Request the main enterprise capability list ("查看全部能力" table view).
 * Supports the five dropdown filters, keyword search, "only installable"
 * toggle, pagination, sort, and the quick-entry sidebar selection which
 * further narrows the result set (我的安装 / 我贡献的 / 全部).
 */
export type AssetListRequest = {
  filters: AssetListFilters;
  pagination: PaginationInput;
  sorting: AssetSortConfig;
  sidebarEntry: SidebarEntry;
  /** skills = 全部技能（排除 MCP）；mcp = 企业 MCP 模块。缺省 skills。 */
  catalog?: "skills" | "mcp";
};

export type AssetListResponse = {
  items: EnterpriseAssetListItem[];
  pagination: PaginationState;
};

// ---------------------------------------------------------------------------
// detail — Single enterprise capability asset (full business view)
// ---------------------------------------------------------------------------

/**
 * Request the full business-view detail of a single capability asset.
 * The returned `EnterpriseCapabilityAsset` is the projected view (no runtime
 * fields); link to the platform runtime console for technical details.
 */
export type AssetDetailRequest = {
  capabilityId: string;
};

export type AssetDetailResponse = {
  capability: EnterpriseCapabilityAsset;
};

// ---------------------------------------------------------------------------
// review — Submit a review decision (通过 / 拒绝 / 需修改)
// ---------------------------------------------------------------------------

/**
 * Submit a review decision on a pending capability.
 *
 * Business rules encoded in the type:
 * - Approval (通过) MUST carry a `ReviewApprovalPayload` which requires both
 *   `applicableScope` (ApplicableScope) AND `domain` (CapabilityDomain).
 * - Rejection (拒绝) and needs-modification (需修改) MUST NOT carry an
 *   approval payload; they require a non-empty `opinion` — the controller
 *   additionally enforces the ≥ 10-character minimum length per Req 14.5.
 */
export type ReviewRequest =
  | {
      reviewTaskId: string;
      result: "通过";
      opinion: string;
      approval: ReviewApprovalPayload;
    }
  | {
      reviewTaskId: string;
      result: "拒绝" | "需修改";
      opinion: string;
    };

export type ReviewResponse = {
  reviewTaskId: string;
  capabilityId: string;
  /** The persisted review record, appended to the capability's ReviewHistory. */
  record: ReviewRecord;
};

// ---------------------------------------------------------------------------
// reviewQueue — Pending / in-progress review tasks
// ---------------------------------------------------------------------------

export type ReviewQueueFilters = {
  status: "待审核" | "审核中" | null;
  searchQuery: string;
};

/**
 * Request the review queue (按提交时间升序，先进先审).
 * Each item also carries a `ReviewAssessment` so the reviewer can see the
 * security + quality evidence without leaving the queue.
 */
export type ReviewQueueRequest = {
  filters: ReviewQueueFilters;
  pagination: PaginationInput;
};

export type ReviewQueueItemWithAssessment = {
  item: ReviewQueueItem;
  assessment: ReviewAssessment;
};

export type ReviewQueueResponse = {
  items: ReviewQueueItemWithAssessment[];
  pagination: PaginationState;
};

// ---------------------------------------------------------------------------
// installToRobots — Admin push install (管理员推送路径)
// ---------------------------------------------------------------------------

/**
 * Install one capability to up to 20 robots in a single operation.
 * The service enforces the 20-robot cap; robots already carrying this
 * capability are rejected by the backend to prevent duplicate relations.
 */
export type InstallToRobotsRequest = {
  capabilityId: string;
  robotIds: string[];
};

export type InstallFailure = {
  robotId: string;
  /** Business-language reason, e.g. "已安装" / "机器人不可用". */
  reason: string;
};

export type InstallToRobotsResponse = {
  capabilityId: string;
  successfulRobotIds: string[];
  failures: InstallFailure[];
  /** The new install relations created by this operation. */
  createdRelations: InstallRelation[];
};

// ---------------------------------------------------------------------------
// pushToPositions — Enterprise position marketplace distribution
// ---------------------------------------------------------------------------

/**
 * Make one enterprise capability visible in selected position capability markets.
 * Employees in those positions can then choose which of their robots should
 * install/use the capability.
 */
export type PushToPositionsRequest = {
  capabilityId: string;
  positionIds: string[];
};

export type PositionPushFailure = {
  positionId: string;
  /** Business-language reason, e.g. "已推送" / "岗位不可用". */
  reason: string;
};

export type PositionCapabilityGrant = {
  grantId: string;
  capabilityId: string;
  positionId: string;
  positionTitle: string;
  teamLabel: string | null;
  employeeName: string | null;
  roleCode: string | null;
};

export type EnterpriseMcpMountResult = {
  skillId: string;
  scope: "tenant" | "positions";
  mountedRobotIds: string[];
  failures: Array<{ robotId: string; reason: string }>;
};

export type PushToPositionsResponse = {
  capabilityId: string;
  successfulPositionIds: string[];
  failures: PositionPushFailure[];
  createdGrants: PositionCapabilityGrant[];
  /** Present when the capability is an executable MCP. Null for other assets. */
  mcpMount?: EnterpriseMcpMountResult | null;
};

// ---------------------------------------------------------------------------
// uninstall — Remove an existing install relation
// ---------------------------------------------------------------------------

/**
 * Uninstall a capability from a robot by dissolving a specific install
 * relation. Works for both admin-push and employee-self-install sources.
 */
export type UninstallRequest = {
  installRelationId: string;
};

export type UninstallResponse = {
  installRelationId: string;
  capabilityId: string;
  robotId: string;
  /** Whether the relation was actually dissolved (false if concurrent change). */
  succeeded: boolean;
};

// ---------------------------------------------------------------------------
// stats — Statistics dashboard (第一屏五指标)
// ---------------------------------------------------------------------------

/**
 * Fetch the top-of-page statistics dashboard data. No parameters required;
 * the backend derives the current enterprise scope from the caller identity.
 */
export type StatsRequest = Record<string, never>;

export type StatsResponse = {
  stats: StatisticsDashboardData;
};

// ---------------------------------------------------------------------------
// contributionRecords — Submission history timeline
// ---------------------------------------------------------------------------

export type ContributionRecordsFilters = {
  employeeId: string | null;
  department: string | null;
  /** Inclusive submission time window in milliseconds since epoch. */
  submittedAfter: number | null;
  submittedBefore: number | null;
  /** Business-language review status filter. */
  reviewStatus: "待审核" | "审核中" | "已通过" | "已拒绝" | "需修改" | null;
};

export type ContributionRecordListItem = {
  contribution: ContributionRecord;
  capabilityId: string;
  capabilityName: string;
  sourceRobotName: string;
  /** Business-language status label derived from AssetLifecycle + review history. */
  reviewStatus: "待审核" | "审核中" | "已通过" | "已拒绝" | "需修改";
};

export type ContributionRecordsSortField = "submittedAt" | "employeeName" | "reviewStatus";

export type ContributionRecordsSorting = {
  field: ContributionRecordsSortField;
  direction: "asc" | "desc";
};

/**
 * Request paginated contribution records across all employees (或按筛选).
 * Default ordering: submission time descending (most recent first).
 */
export type ContributionRecordsRequest = {
  filters: ContributionRecordsFilters;
  pagination: PaginationInput;
  sorting?: ContributionRecordsSorting;
};

export type ContributionRecordsResponse = {
  items: ContributionRecordListItem[];
  pagination: PaginationState;
};

// ---------------------------------------------------------------------------
// installManagement — Active install relations ledger
// ---------------------------------------------------------------------------

export type InstallManagementFilters = {
  capabilityNameQuery: string;
  robotNameQuery: string;
  installedAfter: number | null;
  installedBefore: number | null;
  source: "管理员推送" | "员工自主安装" | null;
  status: "正常运行" | "已暂停" | "待更新" | null;
};

/**
 * Request the install management ledger (能力安装管理 page).
 * Lists every active install relation across both push and pull paths,
 * ordered by install time descending.
 */
export type InstallManagementRequest = {
  filters: InstallManagementFilters;
  pagination: PaginationInput;
};

export type InstallManagementResponse = {
  items: InstallRelation[];
  pagination: PaginationState;
  /** Cross-path summary counts to power the header statistics panel. */
  summary: {
    adminPushCount: number;
    employeeSelfInstallCount: number;
    coveredRobotCount: number;
    coveredCapabilityCount: number;
    coveredPositionCount: number;
  };
};

// ---------------------------------------------------------------------------
// contributionPerformance — Per-employee aggregated performance
// ---------------------------------------------------------------------------

export type ContributionPerformanceFilters = {
  department: string | null;
  /** Inclusive time window (ms since epoch) over which metrics are aggregated. */
  rangeStart: number | null;
  rangeEnd: number | null;
  sortField: "totalContributions" | "approvalRate" | "totalReuseRobots";
  sortDirection: "asc" | "desc";
};

/**
 * Request aggregated contribution performance per employee, used by the
 * "贡献绩效" analytics view and the "本月活跃贡献者" quick entry.
 */
export type ContributionPerformanceRequest = {
  filters: ContributionPerformanceFilters;
};

export type ContributionPerformanceResponse = {
  items: ContributionPerformanceItem[];
};

// ---------------------------------------------------------------------------
// certify — Promote to "企业认证" (企业认证 / level 4)
// ---------------------------------------------------------------------------

/**
 * Promote a capability's maturity to "企业认证".
 * Gate validation (enforced by the backend, per Property 10 / Req 5.8–5.9):
 * rejected if auto-calculated maturity is below "稳定使用".
 */
export type CertifyRequest = {
  capabilityId: string;
  /** Admin-provided rationale for the certification decision. */
  reason: string;
};

export type CertifyResponse = {
  capabilityId: string;
  /** Whether the promotion was accepted; false means a gate condition failed. */
  succeeded: boolean;
  /** Business-language explanation when `succeeded` is false. */
  rejectionReason: string | null;
};

// ---------------------------------------------------------------------------
// promoteToStandard — Promote to "企业标准" (企业标准 / level 5)
// ---------------------------------------------------------------------------

/**
 * Promote a capability's maturity to "企业标准".
 * Gate validation (enforced by the backend, per Property 10 / Req 5.10):
 * rejected if current maturity is below "企业认证".
 */
export type PromoteToStandardRequest = {
  capabilityId: string;
  /** Admin-provided rationale for the promotion decision. */
  reason: string;
};

export type PromoteToStandardResponse = {
  capabilityId: string;
  succeeded: boolean;
  rejectionReason: string | null;
};

// ---------------------------------------------------------------------------
// updateHealthStatus — Manual health override with lock
// ---------------------------------------------------------------------------

/**
 * Manually override a capability's health status (Req 6.6).
 * Setting `manualLock = true` freezes the status against subsequent automatic
 * telemetry-driven updates until the lock is explicitly released. The reason
 * must be 1–500 characters per Req 6.6.
 */
export type UpdateHealthStatusRequest = {
  capabilityId: string;
  newStatus: EnterpriseHealthStatus;
  reason: string;
  manualLock: boolean;
};

export type UpdateHealthStatusResponse = {
  capabilityId: string;
  healthStatus: EnterpriseHealthStatus;
  healthManualLock: boolean;
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// domainDistribution — "能力领域分布" aggregation (第二屏)
// ---------------------------------------------------------------------------

/**
 * Fetch the per-domain aggregation powering the second-screen "能力领域分布"
 * view. Optionally narrow to a single domain when drilling in from the UI.
 */
export type DomainDistributionRequest = {
  domain: CapabilityDomain | null;
};

export type DomainDistributionResponse = {
  domains: DomainDistribution[];
};
