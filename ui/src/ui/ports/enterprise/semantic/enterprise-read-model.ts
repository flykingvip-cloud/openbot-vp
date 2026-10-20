import type { ControlUiAuthMode } from "../../../../../../src/gateway/control-ui-contract.js";
import { readOperationalIdentityGovernancePanelState } from "../../../controllers/operational-identity-governance.ts";
import { matchTabRoute } from "../../../navigation.ts";
import type { MeshOwnershipListResult } from "../../../types.ts";
import type { MeshOwnership } from "../governance/types.ts";
import type { EnterprisePortState } from "../port-state.ts";
import {
  buildEnterpriseOrgTree,
  type EnterpriseOrgDepartmentNode,
} from "../views/enterprise-org-tree-model.ts";
import { buildIdentityProviderInventoryGroups } from "./enterprise-identity-inventory.ts";

type FindActiveOwnershipRecordParams = {
  tenantId: string;
  subjectKind: "agent" | "group";
  subjectId: string;
};

type OwnershipLookupState = {
  meshOwnershipList?: MeshOwnershipListResult | null;
};

function findActiveOwnershipRecord(
  state: OwnershipLookupState,
  params: FindActiveOwnershipRecordParams,
): MeshOwnership | null {
  const record = (state.meshOwnershipList?.records ?? []).find(
    (entry) =>
      entry.tenantId === params.tenantId &&
      entry.subjectKind === params.subjectKind &&
      entry.subjectId === params.subjectId &&
      entry.bindingStatus !== "revoked",
  );
  if (!record) {
    return null;
  }
  return {
    positionId: record.positionId,
    positionLabel: record.positionLabel,
    createdByUserId: record.createdByUserId,
    createdByUserLabel: record.createdByUserLabel,
    currentManagerUserId: record.currentManagerUserId,
    currentManagerLabel: record.currentManagerLabel,
    createdAt: record.createdAt,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

export type EnterpriseResolverOption = {
  tenantId: string;
  label: string;
  description: string;
  kind: "current" | "recent" | "invite";
};

export type MeshCreatorStatus = "owned" | "unowned" | "ambiguous";
export type MeshCostAttributionStatus = "attributed" | "partial" | "unattributed";
export type MeshGovernanceStatus = "normal" | "watch" | "restricted" | "paused";
export type MeshBudgetStatus = "normal" | "warning" | "exceeded" | "none";

export type EnterpriseMeshSummary = {
  userCount: number;
  agentCount: number;
  groupCount: number;
  onlineAgentCount: number;
  activeAgentCount: number;
  activeGroupCount: number;
  activeAgentRate: number;
  activeGroupRate: number;
  totalCost: number;
  totalTokens: number;
  costPerSession: number;
  sessionCount: number;
  inefficientAssetCount: number;
  unattributedCostCount: number;
  unownedAssetCount: number;
  governanceIssueCount: number;
};

export type EnterpriseMeshUser = {
  user: string;
  displayLabel: string;
  role: string;
  ownedAgentCount: number;
  ownedGroupCount: number;
  sessionCount: number;
  totalCost: number;
  totalTokens: number;
  incidentCount: number;
};

export type EnterpriseMeshAgent = {
  agentId: string;
  name: string;
  /** @deprecated Use ownership.createdByUserId instead */
  creatorUser: string | null;
  /** @deprecated Use ownership.createdByUserLabel instead */
  creatorLabel: string | null;
  /** @deprecated Always "owned" in new model — will be removed */
  creatorStatus: MeshCreatorStatus;
  costAttributionStatus: MeshCostAttributionStatus;
  governanceStatus: MeshGovernanceStatus;
  budgetLimit: number | null;
  budgetUsedRatio: number | null;
  budgetStatus: MeshBudgetStatus;
  status: "online" | "offline" | "unknown";
  runtimeHost: string | null;
  groupCount: number;
  sessionCount: number;
  /** Calendar-month cost (本月) — list / KPIs. */
  totalCost: number;
  /** Lifetime / cumulative cost for detail. */
  lifetimeCost: number;
  totalTokens: number;
  errorCount: number;
  lastActiveAt: number | null;
  /** 岗位归属信息（新模型） */
  ownership: MeshOwnership;
};

export type EnterpriseMeshGroup = {
  groupId: string;
  name: string;
  /** @deprecated Use ownership.createdByUserId instead */
  creatorUser: string | null;
  /** @deprecated Use ownership.createdByUserLabel instead */
  creatorLabel: string | null;
  /** @deprecated Always "owned" in new model — will be removed */
  creatorStatus: MeshCreatorStatus;
  costAttributionStatus: MeshCostAttributionStatus;
  governanceStatus: MeshGovernanceStatus;
  budgetLimit: number | null;
  budgetUsedRatio: number | null;
  budgetStatus: MeshBudgetStatus;
  memberCount: number;
  agentCount: number;
  sessionCount: number;
  /** Calendar-month cost (本月) — list / KPIs. */
  totalCost: number;
  /** Lifetime / cumulative cost for detail. */
  lifetimeCost: number;
  totalTokens: number;
  incidentCount: number;
  lastActiveAt: number | null;
  /** 岗位归属信息（新模型） */
  ownership: MeshOwnership;
};

export type EnterpriseMeshAnomaly = {
  id: string;
  kind: "agent" | "group" | "user" | "cost";
  title: string;
  reason: string;
  severity: "watch" | "critical";
  meta: string;
  targetId?: string;
};

export type EnterprisePortReadModel = {
  currentTenantId: string | null;
  currentTenantLabel: string | null;
  connected?: boolean;
  /** Gateway hello phase. Absent on hand-built fixtures. */
  connectionPhase?: string | null;
  /** True after org, usage, session, or channel payload has been applied. */
  enterprisePayloadReady?: boolean;
  lastError?: string | null;
  bootstrapAuthMode?: ControlUiAuthMode | null;
  authenticatedUser: string | null;
  membershipRole: string | null;
  memberCount: number;
  memberUsers: string[];
  memberSummaries: Array<{
    user: string;
    displayLabel: string;
    membershipRole: string;
    status: string;
    seatTitle: string | null;
    seatStatus: string | null;
    seatTeamLabel: string | null;
    /** Every role held (dual identity lists both `enterprise-admin` and `member`). */
    membershipRoles?: string[];
    /** Pending enterprise co-admin invite expiry (「管理员邀请待接受」). */
    adminInvitePendingExpiresAt?: string | null;
    isCurrentUser?: boolean;
  }>;
  adminCount: number;
  seatCount: number;
  occupiedSeatCount: number;
  assignedSeatCount: number;
  vacantSeatCount: number;
  handoverSeatCount: number;
  frozenSeatCount: number;
  handoverCaseCount: number;
  pendingOfferCount: number;
  organizationDepartmentPaths: string[];
  organizationChildOrders?: Record<string, string[]>;
  seatSummaries: Array<{
    seatId: string;
    title: string;
    teamLabel: string | null;
    status: string;
    currentEmployeeUser: string | null;
    currentEmployeeLabel: string | null;
    pendingEmployeeUser?: string | null;
    pendingEmployeeDisplayName?: string | null;
    pendingAssignmentId?: string | null;
    pendingActivationExpiresAt?: string | null;
    roleCode: string | null;
    defaultAgentId: string | null;
    agentIds: string[];
    defaultSpaceIds: string[];
    memoryScopeIds: string[];
    responsibility: string | null;
  }>;
  handoverSummaries: Array<{
    handoverCaseId: string;
    /** 稳定主键；后端 ControlUiPlatformHandoverSummary.seatId 透传 */
    seatId?: string | null;
    seatTitle: string;
    status: string;
    outgoingEmployeeUser: string | null;
    incomingEmployeeUser: string | null;
    createdAt: string | null;
    completedAt: string | null;
  }>;
  offerSummaries: Array<{
    assignmentId?: string | null;
    assignmentType?: "new_hire" | "internal" | null;
    offerId: string;
    seatId: string;
    seatTitle: string;
    targetEmployeeUser: string;
    status: string;
    defaultAgentId: string | null;
    agentIds: string[];
    defaultSpaceIds: string[];
    offeredAt: string | null;
    expiresAt: string | null;
  }>;
  latestInviteCode: string | null;
  latestInviteExpiresAt: string | null;
  agentCount: number;
  defaultAgentId: string | null;
  presenceCount: number;
  runtimeHosts: string[];
  sessionsCount: number;
  nodeCount: number;
  groupIds: string[];
  cronJobCount: number;
  meshSummary: EnterpriseMeshSummary;
  meshUsers: EnterpriseMeshUser[];
  meshAgents: EnterpriseMeshAgent[];
  meshGroups: EnterpriseMeshGroup[];
  meshAnomalies: EnterpriseMeshAnomaly[];
  totalTokens: number;
  totalCost: number;
  missingCostEntries: number;
  channelCount: number;
  channelIds: string[];
  accountCount: number;
  modelMode: string | null;
  configuredProviderCount: number;
  providerIds: string[];
  configuredModelCount: number;
  configuredModelIds: string[];
  configValid: boolean | null;
  configIssueCount: number;
  configIssueLabels: string[];
  resolverOptions: EnterpriseResolverOption[];
  identityCount: number;
  identityProviderCounts: Record<string, number>;
  identityProviderCatalog: import("../../../controllers/enterprise-operational-identity.ts").EnterpriseOperationalIdentityProviderCatalogEntry[];
  identitySummaries: Array<{
    identityId: string;
    provider: string;
    providerLabel: string;
    category: "official" | "communication" | "business";
    displayName: string;
    status: "active" | "expired" | "reauth_required";
    policyCount: number;
    dataSourceBindingCount: number;
    credentialBindingId: string;
    updatedAt: string;
    externalAccountId?: string;
    credentialEditPreview?: {
      fields: Record<string, string>;
      secretsConfigured: string[];
    };
    steward?: {
      kind: "seat" | "employee";
      ownerId: string;
    };
    stewardLabel?: string;
    stewardDetail?: string;
    expiresAt?: string;
    lastVerifiedAt?: string;
    configReadiness?: {
      items: Array<{
        key: string;
        label: string;
        satisfied: boolean;
        scope: "field" | "verify" | "identity";
        detail?: string;
      }>;
      probedAt?: string;
    };
    capabilities?: string[];
    capabilityMissing?: string[];
    capabilityDiscoveredAt?: string;
    providerMetadata?: Record<string, string>;
    connectionStatus?: string;
    healthStatus?: "active" | "warning" | "failed";
    connectionStatusLabel?: string;
    agentReady?: boolean;
    capabilityDetails?: Array<{
      action: string;
      label: string;
      risk: "low" | "medium" | "high";
      enabled: boolean;
      alias?: string;
    }>;
    statusHint?: {
      status: "active" | "expired" | "reauth_required";
      label: string;
      tone: "ok" | "warn" | "danger";
      detail: string;
    };
  }>;
  identityPolicySummaries: Array<{
    policyId: string;
    identityId: string;
    seatIds: string[];
    allowedAgentIds: string[];
    allowedActions: string[];
    enabled: boolean;
  }>;
  identityDataSourceBindings: Array<{
    bindingId: string;
    identityId: string;
    dataSourceId: string;
    purpose: string;
  }>;
  identityEligibleDataSources: Array<{
    sourceId: string;
    sourceKey: string;
    displayName: string;
    connectorId: string;
    status: string;
  }>;
  dataSourceGovernanceDetail: {
    sourceId: string | null;
    busy: boolean;
    error: string | null;
    source: {
      sourceId: string;
      sourceKey: string;
      displayName: string;
      category: string;
      status: string;
      connectorId: string;
    } | null;
    boundOperationalIdentities: Array<{
      bindingId: string;
      identityId: string;
      displayName: string;
      provider: string;
      providerLabel: string;
      status: "active" | "expired" | "reauth_required";
      purpose: string;
    }>;
  };
  identityAlerts: Array<{
    identityId: string;
    displayName: string;
    status: "expired" | "reauth_required";
    message: string;
  }>;
  identityGovernanceStats: {
    total: number;
    connected: number;
    atRisk: number;
    inUse: number;
    unused: number;
  };
  identityAssetSummaries: Array<{
    identityId: string;
    displayName: string;
    externalAccountId?: string;
    provider: string;
    providerLabel: string;
    category: "official" | "communication" | "business";
    status: "active" | "expired" | "reauth_required";
    statusLabel: string;
    expiresAt?: string;
    updatedAt: string;
    inUse: boolean;
    agentIds: string[];
    agentLabels: string[];
    employeeAgentBindings: Array<{
      employeeId: string;
      employeeLabel: string;
      agents: Array<{ agentId: string; agentLabel: string }>;
    }>;
    seatTitles: string[];
    allowedActionKeys: string[];
    allowedActionLabels: string[];
    dataSourceCount: number;
    policyCount: number;
    stewardKind: "seat" | "employee" | "unassigned";
    stewardLabel: string;
    stewardDetail?: string;
    lastUsedAt?: string;
    lastVerifiedAt?: string;
    recentUsageCount: number;
    lastUsageAction?: string;
    configReadiness?: EnterprisePortReadModel["identitySummaries"][number]["configReadiness"];
    capabilities?: string[];
    capabilityMissing?: string[];
    capabilityDiscoveredAt?: string;
    providerMetadata?: Record<string, string>;
    connectionStatus?: string;
    healthStatus?: "active" | "warning" | "failed";
    connectionStatusLabel?: string;
    agentReady?: boolean;
    capabilityDetails?: EnterprisePortReadModel["identitySummaries"][number]["capabilityDetails"];
  }>;
  identityProviderGroups: Array<{
    provider: string;
    providerLabel: string;
    category: "official" | "communication" | "business";
    canRegister: boolean;
    identities: EnterprisePortReadModel["identityAssetSummaries"];
  }>;
  gatewayEgressIp: string | null;
  operationalIdentityBusy: boolean;
  operationalIdentityLoaded: boolean;
  operationalIdentityError: string | null;
  operationalIdentityNotice: string | null;
  identityVerify: {
    identityId: string;
    phase: "idle" | "running" | "passed" | "failed";
    message: string;
  } | null;
  operationalIdentityRelationships: Array<{
    identityId: string;
    displayName: string;
    providerLabel: string;
    status: "active" | "expired" | "reauth_required";
    seats: string[];
    agents: string[];
    dataSourceIds: string[];
    allowedActions: string[];
  }>;
  seatOperationalIdentityAccess: Array<{
    seatId: string;
    seatTitle: string;
    identities: Array<{
      identityId: string;
      displayName: string;
      providerLabel: string;
      status: "active" | "expired" | "reauth_required";
      allowedActions: string[];
      agentIds: string[];
    }>;
  }>;
  employeeIdentityBindingRows: Array<{
    enrollmentId: string;
    employeeId: string;
    employeeLabel: string;
    seatId: string | null;
    seatTitle: string | null;
    departmentPath: string | null;
    agentId: string;
    agentLabel: string;
    identityId: string;
    identityDisplayName: string;
    providerLabel: string;
    updatedAt: string;
  }>;
  recentIdentityBindingActivity: Array<{
    auditEventId: string;
    kind: "bound" | "unbound";
    identityId: string;
    identityDisplayName: string;
    providerLabel: string;
    employeeId: string;
    employeeLabel: string;
    agentId: string;
    agentLabel: string;
    seatTitle: string | null;
    createdAt: string;
  }>;
};

export const EMPTY_IDENTITY_GOVERNANCE_STATS: EnterprisePortReadModel["identityGovernanceStats"] = {
  total: 0,
  connected: 0,
  atRisk: 0,
  inUse: 0,
  unused: 0,
};

/** Safe accessor when readModel is partially hydrated (tests / bootstrap). */
export function resolveIdentityGovernanceStats(
  readModel: Pick<EnterprisePortReadModel, "identityGovernanceStats">,
): EnterprisePortReadModel["identityGovernanceStats"] {
  return readModel.identityGovernanceStats ?? EMPTY_IDENTITY_GOVERNANCE_STATS;
}

export function resolveEnterpriseTenantId(state: EnterprisePortState): string | null {
  const helloTenantId = state.hello?.auth?.tenantId?.trim();
  if (helloTenantId) {
    return helloTenantId;
  }
  const trustedTenantId =
    state.platformAuthState?.session?.tenantId?.trim() ??
    state.bootstrapAuthSession?.tenantId?.trim();
  if (trustedTenantId) {
    return trustedTenantId;
  }
  const recentTenantId = state.settings.recentEnterpriseTenantIds?.[0]?.trim();
  if (recentTenantId) {
    return recentTenantId;
  }
  if (typeof window !== "undefined") {
    const fromRoute = matchTabRoute(
      window.location.pathname,
      state.basePath ?? "",
    )?.context?.tenantId?.trim();
    if (fromRoute) {
      return fromRoute;
    }
  }
  return null;
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function resolveIdentityStewardLabel(params: {
  steward?: { kind: "seat" | "employee"; ownerId: string };
  stewardLabel?: string;
  seatSummaries: Array<{
    seatId: string;
    title: string;
    currentEmployeeLabel: string | null;
    currentEmployeeUser: string | null;
  }>;
  seatTitleById: Map<string, string>;
  memberLabelByUser: Map<string, string>;
  employeeLabelById: Map<string, string>;
  sessionUserId?: string | null;
  sessionDisplayName?: string | null;
  sessionEmail?: string | null;
}): { kind: "seat" | "employee" | "unassigned"; label: string; detail?: string } {
  if (params.stewardLabel?.trim()) {
    const kind = params.steward?.kind ?? "employee";
    return {
      kind: kind === "seat" ? "seat" : kind === "employee" ? "employee" : "unassigned",
      label: params.stewardLabel.trim(),
    };
  }
  const steward = params.steward;
  if (!steward?.ownerId?.trim()) {
    return { kind: "unassigned", label: "未指定负责人" };
  }
  if (steward.kind === "seat") {
    const seat = params.seatSummaries.find((entry) => entry.seatId === steward.ownerId);
    if (seat) {
      const occupant = seat.currentEmployeeLabel ?? seat.currentEmployeeUser;
      return {
        kind: "seat",
        label: occupant ? `${seat.title} · ${occupant}` : seat.title,
        detail: occupant ? "保存凭证时绑定的岗位及在岗成员" : "保存凭证时绑定的岗位（当前空岗）",
      };
    }
    const title = params.seatTitleById.get(steward.ownerId);
    if (title) {
      return { kind: "seat", label: title };
    }
  }
  const ownerId = steward.ownerId.trim();
  const byEmployeeId = params.employeeLabelById.get(ownerId);
  if (byEmployeeId) {
    return { kind: "employee", label: byEmployeeId, detail: "保存凭证的企业成员" };
  }
  if (params.sessionUserId?.trim() === ownerId) {
    const label =
      params.sessionDisplayName?.trim() || params.sessionEmail?.trim() || "当前登录成员";
    return {
      kind: "employee",
      label,
      ...(params.sessionEmail ? { detail: `保存凭证的企业成员（${params.sessionEmail}）` } : {}),
    };
  }
  const normalizedUser = ownerId.toLowerCase();
  const byEmail = params.memberLabelByUser.get(normalizedUser);
  if (byEmail) {
    return { kind: "employee", label: byEmail };
  }
  const seatFallback = params.seatSummaries.find((entry) => entry.seatId === ownerId);
  if (seatFallback) {
    const occupant = seatFallback.currentEmployeeLabel ?? seatFallback.currentEmployeeUser;
    return {
      kind: "seat",
      label: occupant ? `${seatFallback.title} · ${occupant}` : seatFallback.title,
    };
  }
  if (/^[0-9a-f-]{36}$/i.test(ownerId)) {
    return {
      kind: steward.kind,
      label: steward.kind === "seat" ? "未知岗位" : "未知企业成员",
      detail: "请同步组织与身份列表后刷新",
    };
  }
  return {
    kind: "employee",
    label: ownerId,
    detail: "保存凭证的企业成员",
  };
}

function buildIdentityUsageRollup(
  identityIds: Iterable<string>,
): Map<string, { lastUsedAt: string; recentUsageCount: number; lastUsageAction?: string }> {
  const allowedIds = new Set(identityIds);
  const rollup = new Map<
    string,
    { lastUsedAt: string; recentUsageCount: number; lastUsageAction?: string }
  >();
  for (const event of readOperationalIdentityGovernancePanelState().overview?.recentUsage ?? []) {
    if (!allowedIds.has(event.identityId)) {
      continue;
    }
    const existing = rollup.get(event.identityId);
    if (!existing) {
      rollup.set(event.identityId, {
        lastUsedAt: event.createdAt,
        recentUsageCount: 1,
        lastUsageAction: event.action,
      });
      continue;
    }
    existing.recentUsageCount += 1;
  }
  return rollup;
}

function parseSessionAgentId(key: string): string | null {
  const match = key.match(/^agent:([^:]+):/);
  return match?.[1] ?? null;
}

function parseSessionGroupId(entry: Record<string, unknown>): string | null {
  const directGroupId = typeof entry.groupId === "string" ? entry.groupId.trim() : "";
  if (directGroupId) {
    return directGroupId;
  }
  const origin = asRecord(entry.origin);
  const originGroup =
    (typeof origin?.threadId === "string" && origin.threadId.trim()) ||
    (typeof origin?.to === "string" && origin.to.trim()) ||
    "";
  if (origin?.chatType === "group" && originGroup) {
    return originGroup;
  }
  const key = typeof entry.key === "string" ? entry.key : "";
  const groupMatch = key.match(/^agent:[^:]+:[^:]+:group:(.+)$/);
  return groupMatch?.[1]?.trim() || null;
}

function sessionRowMatchesGroupId(row: Record<string, unknown>, groupId: string): boolean {
  const normalizedGroupId = groupId.trim();
  if (!normalizedGroupId) {
    return false;
  }
  const rowGroupId = parseSessionGroupId(row);
  if (rowGroupId === normalizedGroupId) {
    return true;
  }
  const key = typeof row.key === "string" ? row.key.trim() : "";
  return (
    key === `space:${normalizedGroupId}` ||
    key.endsWith(`:space:${normalizedGroupId}`) ||
    key === normalizedGroupId
  );
}

function collectSessionTitleCandidates(row: Record<string, unknown>): string[] {
  const profile = asRecord(row.collaborationGroupProfile);
  const candidates = [
    typeof row.displayName === "string" ? row.displayName.trim() : "",
    typeof row.label === "string" ? row.label.trim() : "",
    typeof row.derivedTitle === "string" ? row.derivedTitle.trim() : "",
    typeof row.subject === "string" ? row.subject.trim() : "",
    typeof profile?.displayName === "string" ? profile.displayName.trim() : "",
    typeof profile?.title === "string" ? profile.title.trim() : "",
  ];
  return candidates.filter(Boolean);
}

function isGeneratedGroupTitle(title: string, groupId: string): boolean {
  const normalizedTitle = title.trim();
  const normalizedGroupId = groupId.trim();
  if (!normalizedTitle) {
    return true;
  }
  if (normalizedTitle === normalizedGroupId) {
    return true;
  }
  if (/^space[:/]/i.test(normalizedTitle)) {
    return true;
  }
  return normalizedTitle.toLowerCase() === `group:${normalizedGroupId}`.toLowerCase();
}

function resolveMeshGroupDisplayName(params: {
  groupId: string;
  sessionRows: Record<string, unknown>[];
  spaceTitleByGroupId?: Map<string, string>;
}): string {
  const fromSpace = params.spaceTitleByGroupId?.get(params.groupId)?.trim();
  if (fromSpace) {
    return fromSpace;
  }
  const titles: string[] = [];
  for (const row of params.sessionRows) {
    if (!sessionRowMatchesGroupId(row, params.groupId)) {
      continue;
    }
    titles.push(...collectSessionTitleCandidates(row));
  }
  const meaningful = titles.find((title) => !isGeneratedGroupTitle(title, params.groupId));
  return meaningful ?? params.groupId;
}

function statusFromBudget(
  budgetLimit: number | null,
  totalCost: number,
): { ratio: number | null; status: MeshBudgetStatus } {
  if (!budgetLimit || budgetLimit <= 0) {
    return { ratio: null, status: "none" };
  }
  const ratio = totalCost / budgetLimit;
  if (ratio >= 1) {
    return { ratio, status: "exceeded" };
  }
  if (ratio >= 0.8) {
    return { ratio, status: "warning" };
  }
  return { ratio, status: "normal" };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function fallbackOwnership(params: {
  positionId?: string | null;
  positionLabel?: string | null;
  createdByUserId?: string | null;
  createdByUserLabel?: string | null;
}): MeshOwnership {
  return {
    positionId: params.positionId?.trim() || "unassigned",
    positionLabel: params.positionLabel?.trim() || params.positionId?.trim() || "待归属岗位",
    createdByUserId: params.createdByUserId?.trim() || "unassigned",
    createdByUserLabel:
      params.createdByUserLabel?.trim() || params.createdByUserId?.trim() || "待确认",
    currentManagerUserId: params.createdByUserId?.trim() || "unassigned",
    currentManagerLabel:
      params.createdByUserLabel?.trim() || params.createdByUserId?.trim() || "待确认",
    createdAt: new Date().toISOString(),
  };
}

/** Resolve enterprise member for ownership labels (never treat seat title as person name). */
function resolveMemberSummary(
  memberSummaries: EnterprisePortReadModel["memberSummaries"],
  userId: string | null | undefined,
  hintName?: string | null,
): EnterprisePortReadModel["memberSummaries"][number] | null {
  const normalized = userId?.trim().toLowerCase();
  if (normalized) {
    const byUser = memberSummaries.find((entry) => entry.user.trim().toLowerCase() === normalized);
    if (byUser) {
      return byUser;
    }
  }
  const hint = hintName?.trim();
  if (!hint) {
    return null;
  }
  return (
    memberSummaries.find((entry) => entry.displayLabel === hint) ??
    memberSummaries.find((entry) => entry.seatTitle === hint) ??
    null
  );
}

function deriveBudgetLimit(params: {
  kind: "agent" | "group";
  totalCost: number;
  sessionCount: number;
  averageCost: number;
  costPerSessionBaseline: number;
  shouldPlan: boolean;
}): number | null {
  if (!params.shouldPlan && params.totalCost <= 0 && params.sessionCount <= 0) {
    return null;
  }
  const floor = params.kind === "group" ? 1 : 0.5;
  const minimumSessions = params.kind === "group" ? 2 : 1;
  const sessionMultiplier = params.kind === "group" ? 1.8 : 1.5;
  const portfolioMultiplier = params.kind === "group" ? 1.15 : 0.95;
  return Math.max(
    floor,
    params.costPerSessionBaseline *
      Math.max(params.sessionCount, minimumSessions) *
      sessionMultiplier,
    params.averageCost * portfolioMultiplier,
    params.totalCost > 0 ? params.totalCost * 1.5 : 0,
  );
}

function deriveAgentGovernanceStatus(params: {
  creatorStatus: MeshCreatorStatus;
  costAttributionStatus: MeshCostAttributionStatus;
  budgetStatus: MeshBudgetStatus;
  status: EnterpriseMeshAgent["status"];
  runtimeHost: string | null;
  sessionCount: number;
  totalCost: number;
  errorCount: number;
}): MeshGovernanceStatus {
  if (
    params.budgetStatus === "exceeded" ||
    (params.totalCost > 0 &&
      (params.creatorStatus === "unowned" || params.costAttributionStatus === "unattributed")) ||
    params.errorCount >= 3
  ) {
    return "restricted";
  }
  if (
    params.sessionCount === 0 &&
    params.totalCost === 0 &&
    params.status !== "online" &&
    params.creatorStatus === "unowned" &&
    !params.runtimeHost
  ) {
    return "paused";
  }
  if (
    params.creatorStatus !== "owned" ||
    params.costAttributionStatus !== "attributed" ||
    params.budgetStatus === "warning" ||
    params.errorCount > 0 ||
    (params.totalCost > 0 && params.sessionCount <= 1) ||
    !params.runtimeHost
  ) {
    return "watch";
  }
  return "normal";
}

function deriveGroupGovernanceStatus(params: {
  creatorStatus: MeshCreatorStatus;
  costAttributionStatus: MeshCostAttributionStatus;
  budgetStatus: MeshBudgetStatus;
  sessionCount: number;
  totalCost: number;
  incidentCount: number;
  agentCount: number;
}): MeshGovernanceStatus {
  if (
    params.budgetStatus === "exceeded" ||
    (params.totalCost > 0 &&
      (params.creatorStatus === "unowned" || params.costAttributionStatus === "unattributed")) ||
    params.incidentCount >= 3
  ) {
    return "restricted";
  }
  if (params.sessionCount === 0 && params.totalCost === 0 && params.agentCount === 0) {
    return "paused";
  }
  if (
    params.creatorStatus !== "owned" ||
    params.costAttributionStatus !== "attributed" ||
    params.budgetStatus === "warning" ||
    params.incidentCount > 0 ||
    (params.totalCost > 0 && params.sessionCount <= 1) ||
    params.agentCount === 0
  ) {
    return "watch";
  }
  return "normal";
}

/** Index per-agent / per-group totalCost from a sessions.usage payload (sessions + aggregates). */
function indexUsageCostByAgentAndGroup(usageResult: unknown): {
  byAgent: Map<string, number>;
  byGroup: Map<string, number>;
} {
  const byAgent = new Map<string, number>();
  const byGroup = new Map<string, number>();
  const result = asRecord(usageResult);
  if (!result) {
    return { byAgent, byGroup };
  }
  const sessions = (Array.isArray(result.sessions) ? result.sessions : [])
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  for (const entry of sessions) {
    const key = typeof entry.key === "string" ? entry.key : "";
    const usage = asRecord(entry.usage);
    const agentId =
      (typeof entry.agentId === "string" && entry.agentId.trim()) || parseSessionAgentId(key);
    const groupId = parseSessionGroupId(entry);
    const totalCost = finiteNumber(usage?.totalCost);
    if (agentId && totalCost > 0) {
      byAgent.set(agentId, (byAgent.get(agentId) ?? 0) + totalCost);
    }
    if (groupId && totalCost > 0) {
      byGroup.set(groupId, (byGroup.get(groupId) ?? 0) + totalCost);
    }
  }
  const aggregates = asRecord(result.aggregates);
  const byAgentRows = (Array.isArray(aggregates?.byAgent) ? aggregates.byAgent : [])
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  for (const row of byAgentRows) {
    const agentId = typeof row.agentId === "string" ? row.agentId.trim() : "";
    if (!agentId) {
      continue;
    }
    const aggregateCost = finiteNumber(asRecord(row.totals)?.totalCost);
    if (aggregateCost > (byAgent.get(agentId) ?? 0)) {
      byAgent.set(agentId, aggregateCost);
    }
  }
  return { byAgent, byGroup };
}

function buildMeshReadModel(params: {
  state: EnterprisePortState;
  memberSummaries: EnterprisePortReadModel["memberSummaries"];
  memberUsers: string[];
  groupIds: string[];
  configIssueLabels: string[];
  spaceTitleByGroupId?: Map<string, string>;
  /** Seat-bound agent ids (organization snapshot) — mesh must not rely on personal agents.list. */
  seatAgentIds?: readonly string[];
  /** Authoritative route/session tenant id for ownership lookup. */
  currentTenantId?: string | null;
}): Pick<
  EnterprisePortReadModel,
  "meshSummary" | "meshUsers" | "meshAgents" | "meshGroups" | "meshAnomalies"
> {
  const {
    state,
    memberSummaries,
    memberUsers,
    groupIds,
    configIssueLabels,
    spaceTitleByGroupId = new Map(),
    seatAgentIds = [],
    currentTenantId = null,
  } = params;
  const usageSessions = ((state.usageResult?.sessions ?? []) as unknown[])
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  const sessionRows = ((state.sessionsResult?.sessions ?? []) as unknown[])
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  const sessionByKey = new Map(
    sessionRows
      .map((entry) => (typeof entry.key === "string" ? [entry.key, entry] : null))
      .filter((entry): entry is [string, Record<string, unknown>] => entry !== null),
  );
  const runtimeHosts = unique(state.presenceEntries.map((entry) => entry.host));
  const online = runtimeHosts.length > 0;
  // Tenant mesh roster only. An empty mesh.ownership.list must stay empty:
  // personal agents.list is seat-scoped and includes host/other-tenant robots.
  const meshTenantAgentRows = state.meshOwnershipList?.agents ?? [];
  const personalById = new Map(
    (state.agentsList?.agents ?? []).map((agent) => [agent.id, agent] as const),
  );
  const agentRows = meshTenantAgentRows.map((agent) => ({
    id: agent.id,
    name: agent.name ?? undefined,
    identity: agent.identity ?? undefined,
    ownerId: agent.ownerId ?? undefined,
    ownerName: agent.ownerName ?? undefined,
  }));
  const ownershipAgentIds = (state.meshOwnershipList?.records ?? [])
    .filter(
      (record) =>
        record.subjectKind === "agent" &&
        record.bindingStatus !== "revoked" &&
        typeof record.subjectId === "string" &&
        record.subjectId.trim(),
    )
    .map((record) => record.subjectId.trim());
  const agentIds = unique([
    ...agentRows.map((agent) => agent.id),
    ...ownershipAgentIds,
    ...seatAgentIds,
    ...usageSessions.map((entry) =>
      typeof entry.agentId === "string"
        ? entry.agentId
        : typeof entry.key === "string"
          ? parseSessionAgentId(entry.key)
          : null,
    ),
  ]);
  const agentById = new Map(agentRows.map((agent) => [agent.id, agent] as const));
  const labelForAgent = (agentId: string) => agentById.get(agentId) ?? personalById.get(agentId);
  const agentUsage = new Map<
    string,
    {
      sessionCount: number;
      totalCost: number;
      totalTokens: number;
      errorCount: number;
      lastActiveAt: number | null;
      groupIds: Set<string>;
    }
  >();
  const groupUsage = new Map<
    string,
    {
      sessionCount: number;
      totalCost: number;
      totalTokens: number;
      errorCount: number;
      lastActiveAt: number | null;
      agentIds: Set<string>;
    }
  >();

  for (const entry of usageSessions) {
    const key = typeof entry.key === "string" ? entry.key : "";
    const row = key ? sessionByKey.get(key) : undefined;
    const usage = asRecord(entry.usage);
    const messageCounts = asRecord(usage?.messageCounts);
    const agentId =
      (typeof entry.agentId === "string" && entry.agentId.trim()) || parseSessionAgentId(key);
    const groupId = parseSessionGroupId({
      ...entry,
      groupId: row?.groupId ?? entry.groupId,
    });
    const totalCost = finiteNumber(usage?.totalCost);
    const totalTokens = finiteNumber(usage?.totalTokens);
    const errorCount = finiteNumber(messageCounts?.errors);
    const lastActiveAt =
      finiteNumber(usage?.lastActivity) ||
      finiteNumber(entry.updatedAt) ||
      finiteNumber(row?.updatedAt) ||
      null;

    if (agentId) {
      const current = agentUsage.get(agentId) ?? {
        sessionCount: 0,
        totalCost: 0,
        totalTokens: 0,
        errorCount: 0,
        lastActiveAt: null,
        groupIds: new Set<string>(),
      };
      current.sessionCount += 1;
      current.totalCost += totalCost;
      current.totalTokens += totalTokens;
      current.errorCount += errorCount;
      current.lastActiveAt = Math.max(current.lastActiveAt ?? 0, lastActiveAt ?? 0) || null;
      if (groupId) {
        current.groupIds.add(groupId);
      }
      agentUsage.set(agentId, current);
    }

    if (groupId) {
      const current = groupUsage.get(groupId) ?? {
        sessionCount: 0,
        totalCost: 0,
        totalTokens: 0,
        errorCount: 0,
        lastActiveAt: null,
        agentIds: new Set<string>(),
      };
      current.sessionCount += 1;
      current.totalCost += totalCost;
      current.totalTokens += totalTokens;
      current.errorCount += errorCount;
      current.lastActiveAt = Math.max(current.lastActiveAt ?? 0, lastActiveAt ?? 0) || null;
      if (agentId) {
        current.agentIds.add(agentId);
      }
      groupUsage.set(groupId, current);
    }
  }

  // Prefer gateway aggregates.byAgent when per-session costs were empty (common when
  // transcripts lack usage.cost but aggregate totals still resolved pricing).
  const usageAggregates = asRecord(
    (state.usageResult as { aggregates?: unknown } | null | undefined)?.aggregates as
      | Record<string, unknown>
      | undefined,
  );
  const byAgentRows = (Array.isArray(usageAggregates?.byAgent) ? usageAggregates.byAgent : [])
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  for (const row of byAgentRows) {
    const agentId = typeof row.agentId === "string" ? row.agentId.trim() : "";
    if (!agentId) {
      continue;
    }
    const totals = asRecord(row.totals);
    const aggregateCost = finiteNumber(totals?.totalCost);
    const aggregateTokens = finiteNumber(totals?.totalTokens);
    if (!(aggregateCost > 0) && !(aggregateTokens > 0)) {
      continue;
    }
    const current = agentUsage.get(agentId) ?? {
      sessionCount: 0,
      totalCost: 0,
      totalTokens: 0,
      errorCount: 0,
      lastActiveAt: null,
      groupIds: new Set<string>(),
    };
    if (aggregateCost > current.totalCost) {
      current.totalCost = aggregateCost;
    }
    if (aggregateTokens > current.totalTokens) {
      current.totalTokens = aggregateTokens;
    }
    agentUsage.set(agentId, current);
  }

  const totalSessionCount =
    usageSessions.length > 0 ? usageSessions.length : (state.sessionsResult?.count ?? 0);
  const totalCost = state.usageResult?.totals?.totalCost ?? 0;
  const costPerSessionBaseline = totalSessionCount > 0 ? totalCost / totalSessionCount : 0;
  const averageAgentCost = average(
    Array.from(agentUsage.values())
      .map((entry) => entry.totalCost)
      .filter((value) => value > 0),
  );
  const averageGroupCost = average(
    Array.from(groupUsage.values())
      .map((entry) => entry.totalCost)
      .filter((value) => value > 0),
  );
  const tenantId =
    currentTenantId?.trim() ||
    state.platformAuthState?.session?.tenantId?.trim() ||
    state.hello?.auth?.tenantId?.trim() ||
    state.bootstrapAuthSession?.tenantId?.trim() ||
    "";

  const lifetimeUsageLoaded = state.meshLifetimeUsageResult != null;
  const lifetimeCosts = indexUsageCostByAgentAndGroup(state.meshLifetimeUsageResult);

  const meshAgents: EnterpriseMeshAgent[] = agentIds.map((agentId) => {
    const agent = labelForAgent(agentId);
    const usage = agentUsage.get(agentId);
    const ownership = tenantId
      ? findActiveOwnershipRecord(state, {
          tenantId,
          subjectKind: "agent",
          subjectId: agentId,
        })
      : null;
    // Prefer ownership manager for creator attribution; agents.list ownerId is personal-seat biased.
    const creatorUser =
      ownership?.currentManagerUserId?.trim() ||
      ownership?.createdByUserId?.trim() ||
      agent?.ownerId?.trim() ||
      null;
    const member = resolveMemberSummary(memberSummaries, creatorUser, agent?.ownerName);
    const ownerNameRaw =
      ownership?.currentManagerLabel?.trim() ||
      ownership?.createdByUserLabel?.trim() ||
      agent?.ownerName?.trim() ||
      null;
    // Prefer enterprise member display name; never treat seat title as person label.
    const creatorLabel =
      member?.displayLabel?.trim() ||
      (ownerNameRaw && ownerNameRaw !== member?.seatTitle ? ownerNameRaw : null) ||
      creatorUser;
    const seatTitle = ownership?.positionLabel?.trim() || member?.seatTitle?.trim() || null;
    const totalCost = usage?.totalCost ?? 0;
    const creatorStatus: MeshCreatorStatus = creatorUser ? "owned" : "unowned";
    const costAttributionStatus: MeshCostAttributionStatus =
      usage && usage.sessionCount > 0 ? "attributed" : "unattributed";
    const budgetLimit = deriveBudgetLimit({
      kind: "agent",
      totalCost,
      sessionCount: usage?.sessionCount ?? 0,
      averageCost: averageAgentCost,
      costPerSessionBaseline,
      shouldPlan: creatorStatus === "owned" || costAttributionStatus === "attributed",
    });
    const budget = statusFromBudget(budgetLimit, totalCost);
    const status: EnterpriseMeshAgent["status"] =
      online && (usage?.sessionCount ?? 0) > 0
        ? "online"
        : !online && (usage?.sessionCount ?? 0) > 0
          ? "offline"
          : "unknown";
    const runtimeHost = (usage?.sessionCount ?? 0) > 0 ? (runtimeHosts[0] ?? null) : null;
    const governanceStatus = deriveAgentGovernanceStatus({
      creatorStatus,
      costAttributionStatus,
      budgetStatus: budget.status,
      status,
      runtimeHost,
      sessionCount: usage?.sessionCount ?? 0,
      totalCost,
      errorCount: usage?.errorCount ?? 0,
    });
    return {
      agentId,
      name: agent?.identity?.name?.trim() || agent?.name?.trim() || agentId,
      creatorUser,
      creatorLabel,
      creatorStatus,
      costAttributionStatus,
      governanceStatus,
      budgetLimit,
      budgetUsedRatio: budget.ratio,
      budgetStatus: budget.status,
      status,
      runtimeHost,
      groupCount: usage?.groupIds.size ?? 0,
      sessionCount: usage?.sessionCount ?? 0,
      totalCost,
      lifetimeCost: lifetimeUsageLoaded ? (lifetimeCosts.byAgent.get(agentId) ?? 0) : totalCost,
      totalTokens: usage?.totalTokens ?? 0,
      errorCount: usage?.errorCount ?? 0,
      lastActiveAt: usage?.lastActiveAt ?? null,
      ownership: ownership
        ? {
            positionId: ownership.positionId,
            positionLabel: ownership.positionLabel,
            createdByUserId: ownership.createdByUserId,
            createdByUserLabel: ownership.createdByUserLabel,
            currentManagerUserId: ownership.currentManagerUserId,
            currentManagerLabel: ownership.currentManagerLabel,
            createdAt: ownership.createdAt,
          }
        : fallbackOwnership({
            // Seat/title belongs in position; person display name belongs in manager/creator.
            positionId: seatTitle ? `seat:${seatTitle}` : "unassigned",
            positionLabel: seatTitle || "未分配岗位",
            createdByUserId: creatorUser || "system",
            createdByUserLabel: creatorLabel || "系统",
          }),
    };
  });

  const allGroupIds = unique([...groupIds, ...Array.from(groupUsage.keys())]);
  const meshGroups: EnterpriseMeshGroup[] = allGroupIds.map((groupId) => {
    const usage = groupUsage.get(groupId);
    const totalCost = usage?.totalCost ?? 0;
    const lifetimeCost = lifetimeUsageLoaded
      ? (lifetimeCosts.byGroup.get(groupId) ?? 0)
      : totalCost;
    const creatorStatus: MeshCreatorStatus = "unowned";
    const costAttributionStatus: MeshCostAttributionStatus =
      usage && usage.sessionCount > 0 ? "partial" : "unattributed";
    const budgetLimit = deriveBudgetLimit({
      kind: "group",
      totalCost,
      sessionCount: usage?.sessionCount ?? 0,
      averageCost: averageGroupCost,
      costPerSessionBaseline,
      shouldPlan: costAttributionStatus !== "unattributed",
    });
    const budget = statusFromBudget(budgetLimit, totalCost);
    const governanceStatus = deriveGroupGovernanceStatus({
      creatorStatus,
      costAttributionStatus,
      budgetStatus: budget.status,
      sessionCount: usage?.sessionCount ?? 0,
      totalCost,
      incidentCount: usage?.errorCount ?? 0,
      agentCount: usage?.agentIds.size ?? 0,
    });
    const ownership = tenantId
      ? findActiveOwnershipRecord(state, {
          tenantId,
          subjectKind: "group",
          subjectId: groupId,
        })
      : null;
    return {
      groupId,
      name: resolveMeshGroupDisplayName({ groupId, sessionRows, spaceTitleByGroupId }),
      creatorUser: null,
      creatorLabel: null,
      creatorStatus,
      costAttributionStatus,
      governanceStatus,
      budgetLimit,
      budgetUsedRatio: budget.ratio,
      budgetStatus: budget.status,
      memberCount: memberUsers.length,
      agentCount: usage?.agentIds.size ?? 0,
      sessionCount: usage?.sessionCount ?? 0,
      totalCost,
      lifetimeCost,
      totalTokens: usage?.totalTokens ?? 0,
      incidentCount: usage?.errorCount ?? 0,
      lastActiveAt: usage?.lastActiveAt ?? null,
      ownership: ownership
        ? {
            positionId: ownership.positionId,
            positionLabel: ownership.positionLabel,
            createdByUserId: ownership.createdByUserId,
            createdByUserLabel: ownership.createdByUserLabel,
            currentManagerUserId: ownership.currentManagerUserId,
            currentManagerLabel: ownership.currentManagerLabel,
            createdAt: ownership.createdAt,
          }
        : fallbackOwnership({}),
    };
  });

  const meshUsers: EnterpriseMeshUser[] = memberSummaries.map((member) => {
    const ownedAgents = meshAgents.filter((agent) => agent.creatorUser === member.user);
    const ownedGroups = meshGroups.filter((group) => group.creatorUser === member.user);
    return {
      user: member.user,
      displayLabel: member.displayLabel,
      role: member.membershipRole,
      ownedAgentCount: ownedAgents.length,
      ownedGroupCount: ownedGroups.length,
      sessionCount:
        ownedAgents.reduce((sum, agent) => sum + agent.sessionCount, 0) +
        ownedGroups.reduce((sum, group) => sum + group.sessionCount, 0),
      totalCost:
        ownedAgents.reduce((sum, agent) => sum + agent.totalCost, 0) +
        ownedGroups.reduce((sum, group) => sum + group.totalCost, 0),
      totalTokens:
        ownedAgents.reduce((sum, agent) => sum + agent.totalTokens, 0) +
        ownedGroups.reduce((sum, group) => sum + group.totalTokens, 0),
      incidentCount:
        ownedAgents.reduce((sum, agent) => sum + agent.errorCount, 0) +
        ownedGroups.reduce((sum, group) => sum + group.incidentCount, 0),
    };
  });

  const meshAnomalies: EnterpriseMeshAnomaly[] = [];
  for (const agent of meshAgents) {
    // 不再为"未记录创建人"生成治理项 — 归属由岗位体系自动维护
    if (agent.totalCost > 0 && agent.sessionCount <= 1) {
      meshAnomalies.push({
        id: `agent-efficiency-${agent.agentId}`,
        kind: "agent",
        title: agent.name,
        reason: "高成本低活跃，需要复核是否继续保留",
        severity: "watch",
        meta: `${agent.sessionCount} 个会话`,
        targetId: agent.agentId,
      });
    }
  }
  for (const group of meshGroups) {
    // 不再为"未记录创建人"生成治理项 — 归属由岗位体系自动维护
    if (group.costAttributionStatus !== "attributed") {
      meshAnomalies.push({
        id: `group-attribution-${group.groupId}`,
        kind: "group",
        title: group.name,
        reason: "小组成本仍为推导或未归因",
        severity: "watch",
        meta: `${group.sessionCount} 个会话`,
        targetId: group.groupId,
      });
    }
  }
  if ((state.usageResult?.totals?.missingCostEntries ?? 0) > 0) {
    meshAnomalies.push({
      id: "missing-cost-attribution",
      kind: "cost",
      title: "成本归因缺失",
      reason: "部分使用记录缺少成本归因",
      severity: "critical",
      meta: `${state.usageResult?.totals?.missingCostEntries ?? 0} 条记录`,
    });
  }
  for (const issue of configIssueLabels) {
    meshAnomalies.push({
      id: `config-${issue}`,
      kind: "cost",
      title: issue,
      reason: "配置或运行治理问题",
      severity: "watch",
      meta: "待复核",
    });
  }

  const activeAgentCount = meshAgents.filter((agent) => agent.sessionCount > 0).length;
  const activeGroupCount = meshGroups.filter((group) => group.sessionCount > 0).length;
  const meshSummary: EnterpriseMeshSummary = {
    userCount: memberUsers.length,
    agentCount: meshAgents.length,
    groupCount: meshGroups.length,
    onlineAgentCount: meshAgents.filter((agent) => agent.status === "online").length,
    activeAgentCount,
    activeGroupCount,
    activeAgentRate: meshAgents.length > 0 ? activeAgentCount / meshAgents.length : 0,
    activeGroupRate: meshGroups.length > 0 ? activeGroupCount / meshGroups.length : 0,
    totalCost,
    totalTokens: state.usageResult?.totals?.totalTokens ?? 0,
    costPerSession: totalSessionCount > 0 ? totalCost / totalSessionCount : 0,
    sessionCount: totalSessionCount,
    inefficientAssetCount: meshAnomalies.filter((entry) => entry.id.includes("efficiency")).length,
    unattributedCostCount:
      meshAgents.filter((agent) => agent.costAttributionStatus === "unattributed").length +
      meshGroups.filter((group) => group.costAttributionStatus !== "attributed").length,
    unownedAssetCount:
      meshAgents.filter((agent) => agent.creatorStatus === "unowned").length +
      meshGroups.filter((group) => group.creatorStatus === "unowned").length,
    governanceIssueCount: meshAnomalies.length,
  };

  return { meshSummary, meshUsers, meshAgents, meshGroups, meshAnomalies };
}

export function buildEnterprisePortReadModel(
  state: EnterprisePortState,
  configValue: Record<string, unknown> | null,
  currentTenantId: string | null,
): EnterprisePortReadModel {
  const members = state.platformAuthState?.members ?? [];
  const modelsConfig = asRecord(configValue?.models);
  const providers = asRecord(modelsConfig?.providers);
  const providerIds = Object.keys(providers ?? {}).toSorted();
  const configuredModelIds: string[] = [];
  let configuredModelCount = 0;
  for (const [providerId, provider] of Object.entries(providers ?? {})) {
    const providerConfig = asRecord(provider);
    const providerModels = Array.isArray(providerConfig?.models) ? providerConfig.models : [];
    for (const model of providerModels) {
      if (typeof model === "string" && model.trim()) {
        configuredModelCount += 1;
        configuredModelIds.push(`${providerId}/${model.trim()}`);
        continue;
      }
      const modelConfig = asRecord(model);
      const modelId =
        typeof modelConfig?.id === "string" && modelConfig.id.trim() ? modelConfig.id.trim() : null;
      if (!modelId) {
        continue;
      }
      configuredModelCount += 1;
      configuredModelIds.push(`${providerId}/${modelId}`);
    }
  }
  // Do not use global channelsSnapshot for enterprise KPIs — that reflects the
  // shared platform runtime, not tenant-scoped config. Authoritative channel
  // status lives on the message-channels surface (tenant channels.status).
  const accountCount = 0;
  const channelIds: string[] = [];
  const authenticatedUser =
    state.hello?.auth?.displayName ??
    state.hello?.auth?.user ??
    state.platformAuthState?.session?.displayName ??
    state.platformAuthState?.session?.user ??
    state.bootstrapAuthSession?.displayName ??
    state.bootstrapAuthSession?.user ??
    null;
  const resolverOptions = Array.from(
    new Map(
      [
        currentTenantId
          ? {
              tenantId: currentTenantId,
              label: state.platformAuthState?.tenantName?.trim() || currentTenantId,
              description: "Current authenticated tenant context",
              kind: "current" as const,
            }
          : null,
        ...(state.settings.recentEnterpriseTenantIds ?? [])
          .filter((tenantId) => tenantId !== currentTenantId)
          .map((tenantId) => ({
            tenantId,
            label: tenantId,
            description: "最近打开的企业",
            kind: "recent" as const,
          })),
        state.platformAuthState?.latestInvite?.tenantId
          ? {
              tenantId: state.platformAuthState.latestInvite.tenantId,
              label:
                state.platformAuthState.latestInvite.tenantName ??
                state.platformAuthState.latestInvite.tenantId,
              description: "最近邀请上下文",
              kind: "invite" as const,
            }
          : null,
      ]
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .map((entry) => [entry.tenantId, entry]),
    ).values(),
  );
  const memberUsers = unique(
    members.map((member) =>
      typeof member.user === "string"
        ? member.user
        : typeof member.displayName === "string"
          ? member.displayName
          : null,
    ),
  );
  const runtimeHosts = unique(state.presenceEntries.map((entry) => entry.host));
  const organization = state.platformAuthState?.organization;
  const seatSummaries =
    organization?.seats.map((seat) => ({
      seatId: seat.seatId,
      title: seat.title,
      teamLabel: seat.teamLabel?.trim() || null,
      status: seat.status,
      currentEmployeeUser: seat.currentEmployeeUser?.trim() || null,
      currentEmployeeLabel: seat.currentEmployeeDisplayName ?? seat.currentEmployeeUser ?? null,
      pendingEmployeeUser: seat.pendingEmployeeUser ?? null,
      pendingEmployeeDisplayName: seat.pendingEmployeeDisplayName ?? null,
      pendingAssignmentId: seat.pendingAssignmentId ?? null,
      pendingActivationExpiresAt: seat.pendingActivationExpiresAt ?? null,
      roleCode: seat.roleCode?.trim() || null,
      defaultAgentId: seat.defaultAgentId ?? null,
      agentIds: seat.agentIds ?? (seat.defaultAgentId ? [seat.defaultAgentId] : []),
      defaultSpaceIds: seat.defaultSpaceIds ?? [],
      memoryScopeIds: seat.memoryScopeIds ?? [],
      responsibility: seat.responsibility?.trim() || null,
    })) ?? [];
  const seatByEmployeeEmail = new Map<string, (typeof seatSummaries)[number]>();
  for (const [index, seat] of (organization?.seats ?? []).entries()) {
    const summary = seatSummaries[index];
    if (!summary) {
      continue;
    }
    const currentEmployeeUser = seat.currentEmployeeUser?.trim().toLowerCase();
    if (currentEmployeeUser) {
      seatByEmployeeEmail.set(currentEmployeeUser, summary);
    }
    const pendingEmployeeUser = seat.pendingEmployeeUser?.trim().toLowerCase();
    if (pendingEmployeeUser) {
      seatByEmployeeEmail.set(pendingEmployeeUser, summary);
    }
  }
  const memberSummaries = members.map((member) => {
    const linkedSeat = seatByEmployeeEmail.get(member.user.trim().toLowerCase());
    return {
      user: member.user,
      displayLabel: member.displayName?.trim() || member.user,
      membershipRole: member.membershipRole,
      status: member.status ?? "active",
      seatTitle: member.seatTitle ?? linkedSeat?.title ?? null,
      seatStatus: member.seatStatus ?? linkedSeat?.status ?? null,
      seatTeamLabel: member.seatTeamLabel?.trim() || linkedSeat?.teamLabel || null,
      membershipRoles: member.membershipRoles?.length
        ? [...member.membershipRoles]
        : [member.membershipRole],
      adminInvitePendingExpiresAt: member.adminInvitePendingExpiresAt ?? null,
      isCurrentUser: member.isCurrentUser === true,
    };
  });
  const handoverSummaries =
    organization?.handovers.map((handover) => ({
      handoverCaseId: handover.handoverCaseId,
      seatId: handover.seatId ?? null,
      seatTitle: handover.seatTitle,
      status: handover.status,
      outgoingEmployeeUser: handover.outgoingEmployeeUser ?? null,
      incomingEmployeeUser: handover.incomingEmployeeUser ?? null,
      createdAt: handover.createdAt ?? null,
      completedAt: handover.completedAt ?? null,
    })) ?? [];
  const offerSummaries =
    organization?.offers.map((offer) => ({
      assignmentId: offer.assignmentId ?? null,
      assignmentType: offer.assignmentType ?? null,
      offerId: offer.offerId,
      seatId: offer.seatId,
      seatTitle: offer.seatTitle,
      targetEmployeeUser: offer.targetEmployeeUser,
      status: offer.status,
      defaultAgentId: offer.defaultAgentId ?? null,
      agentIds: offer.agentIds ?? (offer.defaultAgentId ? [offer.defaultAgentId] : []),
      defaultSpaceIds: offer.defaultSpaceIds ?? [],
      offeredAt: offer.offeredAt ?? null,
      expiresAt: offer.expiresAt ?? null,
    })) ?? [];
  const nodeGroupIds = unique(
    state.nodes.map((node) => {
      const record = asRecord(node);
      return (
        (typeof record?.groupId === "string" && record.groupId) ||
        (typeof record?.nodeId === "string" && record.nodeId) ||
        (typeof record?.name === "string" && record.name) ||
        null
      );
    }),
  );
  const spaceTitleByGroupId = new Map<string, string>();
  const spaceGroupIds: string[] = [];
  for (const space of state.collaborationSpacesResult?.spaces ?? []) {
    const groupId = (space.groupId ?? space.id)?.trim();
    if (!groupId) {
      continue;
    }
    spaceGroupIds.push(groupId);
    const title = space.title?.trim();
    if (title) {
      spaceTitleByGroupId.set(groupId, title);
    }
  }
  const groupIds = unique([...nodeGroupIds, ...spaceGroupIds]);
  const configIssueLabels = unique(
    state.configIssues.map((issue, index) => {
      if (typeof issue === "string") {
        return issue;
      }
      const record = asRecord(issue);
      return (
        (typeof record?.message === "string" && record.message) ||
        (typeof record?.path === "string" && record.path) ||
        `issue-${index + 1}`
      );
    }),
  );
  const mesh = buildMeshReadModel({
    state,
    memberSummaries,
    memberUsers,
    groupIds,
    configIssueLabels,
    spaceTitleByGroupId,
    seatAgentIds: seatSummaries.flatMap((seat) => [
      ...seat.agentIds,
      ...(seat.defaultAgentId ? [seat.defaultAgentId] : []),
    ]),
    currentTenantId,
  });

  const identitySnapshot = state.enterpriseOperationalIdentities;
  const identitySummaries = (identitySnapshot?.identities ?? []).map((identity) => ({
    identityId: identity.identityId,
    provider: identity.provider,
    providerLabel: identity.providerLabel,
    category: identity.category,
    displayName: identity.displayName,
    status: identity.status,
    policyCount: identity.policyCount,
    dataSourceBindingCount: identity.dataSourceBindingCount,
    credentialBindingId: identity.credentialBindingId,
    updatedAt: identity.updatedAt,
    ...(identity.externalAccountId ? { externalAccountId: identity.externalAccountId } : {}),
    ...(identity.steward ? { steward: identity.steward } : {}),
    ...(identity.stewardLabel ? { stewardLabel: identity.stewardLabel } : {}),
    ...(identity.stewardDetail ? { stewardDetail: identity.stewardDetail } : {}),
    ...(identity.expiresAt ? { expiresAt: identity.expiresAt } : {}),
    ...(identity.lastVerifiedAt ? { lastVerifiedAt: identity.lastVerifiedAt } : {}),
    ...(identity.configReadiness ? { configReadiness: identity.configReadiness } : {}),
    ...(identity.capabilities ? { capabilities: identity.capabilities } : {}),
    ...(identity.capabilityMissing ? { capabilityMissing: identity.capabilityMissing } : {}),
    ...(identity.capabilityDiscoveredAt
      ? { capabilityDiscoveredAt: identity.capabilityDiscoveredAt }
      : {}),
    ...(identity.providerMetadata ? { providerMetadata: identity.providerMetadata } : {}),
    ...(identity.connectionStatus ? { connectionStatus: identity.connectionStatus } : {}),
    ...(identity.healthStatus ? { healthStatus: identity.healthStatus } : {}),
    ...(identity.connectionStatusLabel
      ? { connectionStatusLabel: identity.connectionStatusLabel }
      : {}),
    ...(identity.agentReady != null ? { agentReady: identity.agentReady } : {}),
    ...(identity.capabilityDetails ? { capabilityDetails: identity.capabilityDetails } : {}),
    ...(identity.statusHint ? { statusHint: identity.statusHint } : {}),
    ...(identity.credentialEditPreview
      ? { credentialEditPreview: identity.credentialEditPreview }
      : {}),
  }));
  const identityAlerts = identitySummaries.flatMap(
    (
      identity,
    ): Array<{
      identityId: string;
      displayName: string;
      status: "expired" | "reauth_required";
      message: string;
    }> => {
      if (identity.status === "reauth_required") {
        return [
          {
            identityId: identity.identityId,
            displayName: identity.displayName,
            status: identity.status as "reauth_required",
            message: identity.statusHint?.detail ?? "凭证需要重新授权后才能继续使用。",
          },
        ];
      }
      if (identity.status === "expired") {
        return [
          {
            identityId: identity.identityId,
            displayName: identity.displayName,
            status: identity.status as "expired",
            message: identity.statusHint?.detail ?? "身份已过期或已停用，请检查凭证状态。",
          },
        ];
      }
      return [];
    },
  );

  const identitySnapshotBindings = identitySnapshot?.dataSourceBindings ?? [];
  const employeeEnrollments = identitySnapshot?.employeeEnrollments ?? [];
  const bindingActivity = identitySnapshot?.bindingActivity ?? [];
  const identityDisplayNameById = new Map(
    identitySummaries.map((identity) => [identity.identityId, identity.displayName]),
  );
  const identityProviderLabelById = new Map(
    identitySummaries.map((identity) => [identity.identityId, identity.providerLabel]),
  );
  const enrollmentsByIdentity = new Map<string, typeof employeeEnrollments>();
  for (const enrollment of employeeEnrollments) {
    const list = enrollmentsByIdentity.get(enrollment.identityId) ?? [];
    list.push(enrollment);
    enrollmentsByIdentity.set(enrollment.identityId, list);
  }
  const providerCatalog = identitySnapshot?.providerCatalog ?? [];
  const actionLabelByProvider = new Map<string, Map<string, string>>();
  for (const entry of providerCatalog) {
    const labels = new Map<string, string>();
    for (const action of [...entry.operationalActions, ...entry.dataSyncActions]) {
      labels.set(action.action, action.label);
    }
    actionLabelByProvider.set(entry.provider, labels);
  }
  const seatTitleById = new Map(seatSummaries.map((seat) => [seat.seatId, seat.title]));
  const memberLabelByUser = new Map(
    memberSummaries.map((member) => [member.user.trim().toLowerCase(), member.displayLabel]),
  );
  const employeeLabelById = new Map(
    members.flatMap((member) => {
      const userId = typeof member.userId === "string" ? member.userId.trim() : "";
      if (!userId) {
        return [];
      }
      const label =
        (typeof member.displayName === "string" && member.displayName.trim()) ||
        (typeof member.user === "string" && member.user.trim()) ||
        userId;
      return [[userId, label] as const];
    }),
  );
  const employeeSeatById = new Map<string, { seatId: string; seatTitle: string }>();
  for (const member of members) {
    const userId = typeof member.userId === "string" ? member.userId.trim() : "";
    if (!userId) {
      continue;
    }
    const linkedSeat = seatByEmployeeEmail.get(member.user?.trim().toLowerCase() ?? "");
    if (linkedSeat) {
      employeeSeatById.set(userId, {
        seatId: linkedSeat.seatId,
        seatTitle: linkedSeat.title,
      });
    }
  }
  const seatDepartmentPathBySeatId = (() => {
    const output = new Map<string, string>();
    const walk = (departments: EnterpriseOrgDepartmentNode[]) => {
      for (const department of departments) {
        for (const position of department.positions) {
          output.set(position.seatId, department.fullPath);
        }
        walk(department.childDepartments);
      }
    };
    walk(
      buildEnterpriseOrgTree({
        readModel: {
          seatSummaries,
          memberSummaries,
          organizationDepartmentPaths: organization?.departmentPaths ?? [],
          organizationChildOrders: organization?.childOrders,
        } as EnterprisePortReadModel,
        includeVacantPositions: true,
      }),
    );
    return output;
  })();
  const agentNameById = new Map(mesh.meshAgents.map((agent) => [agent.agentId, agent.name]));
  const usageByIdentity = buildIdentityUsageRollup(
    identitySummaries.map((identity) => identity.identityId),
  );

  const buildEmployeeAgentBindingGroups = (
    enrollments: (typeof employeeEnrollments)[number][],
  ): EnterprisePortReadModel["identityAssetSummaries"][number]["employeeAgentBindings"] => {
    const byEmployee = new Map<string, Set<string>>();
    for (const enrollment of enrollments) {
      const agents = byEmployee.get(enrollment.employeeId) ?? new Set<string>();
      agents.add(enrollment.agentId);
      byEmployee.set(enrollment.employeeId, agents);
    }
    return [...byEmployee.entries()]
      .map(([employeeId, agentIds]) => ({
        employeeId,
        employeeLabel: employeeLabelById.get(employeeId) ?? employeeId,
        agents: [...agentIds]
          .map((agentId) => ({
            agentId,
            agentLabel: agentNameById.get(agentId) ?? agentId,
          }))
          .toSorted((left, right) => left.agentLabel.localeCompare(right.agentLabel, "zh-CN")),
      }))
      .toSorted((left, right) => left.employeeLabel.localeCompare(right.employeeLabel, "zh-CN"));
  };

  const sessionMember =
    members.find((member) => member.isCurrentUser) ??
    members.find(
      (member) =>
        member.user.trim().toLowerCase() ===
        (state.platformAuthState?.session?.user?.trim().toLowerCase() ?? ""),
    );
  const identityAssetSummaries = identitySummaries.map((identity) => {
    const policies = (identitySnapshot?.policies ?? []).filter(
      (policy) => policy.identityId === identity.identityId && policy.enabled,
    );
    const enrollments = enrollmentsByIdentity.get(identity.identityId) ?? [];
    const agentIds = [...new Set(enrollments.map((enrollment) => enrollment.agentId))];
    const agentLabels = enrollments.map((enrollment) => {
      const employeeLabel = employeeLabelById.get(enrollment.employeeId) ?? enrollment.employeeId;
      const agentLabel = agentNameById.get(enrollment.agentId) ?? enrollment.agentId;
      return `${employeeLabel} · ${agentLabel}`;
    });
    const employeeAgentBindings = buildEmployeeAgentBindingGroups(enrollments);
    const seatIds = [...new Set(policies.flatMap((policy) => policy.seatIds))];
    const allowedActionKeys = [
      ...new Set(policies.flatMap((policy) => policy.allowedActions)),
    ].toSorted();
    const actionLabels = actionLabelByProvider.get(identity.provider);
    const allowedActionLabels = allowedActionKeys.map((key) => actionLabels?.get(key) ?? key);
    const inUse = agentIds.length > 0 || policies.some((policy) => policy.seatIds.length > 0);
    const statusLabel =
      identity.status === "active"
        ? "正常"
        : identity.status === "reauth_required"
          ? "需重授权"
          : "已过期";
    const steward = resolveIdentityStewardLabel({
      steward: identity.steward,
      stewardLabel: identity.stewardLabel,
      seatSummaries,
      seatTitleById,
      memberLabelByUser,
      employeeLabelById,
      sessionUserId: sessionMember?.userId,
      sessionDisplayName:
        sessionMember?.displayName ??
        sessionMember?.user ??
        state.platformAuthState?.session?.displayName ??
        undefined,
      sessionEmail: sessionMember?.user ?? state.platformAuthState?.session?.user,
    });
    const usage = usageByIdentity.get(identity.identityId);
    return {
      identityId: identity.identityId,
      displayName: identity.displayName,
      ...(identity.externalAccountId ? { externalAccountId: identity.externalAccountId } : {}),
      provider: identity.provider,
      providerLabel: identity.providerLabel,
      category: identity.category,
      status: identity.status,
      statusLabel,
      ...(identity.expiresAt ? { expiresAt: identity.expiresAt } : {}),
      updatedAt: identity.updatedAt,
      inUse,
      agentIds,
      agentLabels: [...new Set(agentLabels)],
      employeeAgentBindings,
      seatTitles: seatIds.map((seatId) => seatTitleById.get(seatId) ?? seatId),
      allowedActionKeys,
      allowedActionLabels,
      dataSourceCount: identitySnapshotBindings.filter(
        (binding) => binding.identityId === identity.identityId,
      ).length,
      policyCount: policies.length,
      stewardKind: steward.kind,
      stewardLabel: steward.label,
      ...(identity.stewardDetail || steward.detail
        ? { stewardDetail: identity.stewardDetail ?? steward.detail }
        : {}),
      ...(usage?.lastUsedAt ? { lastUsedAt: usage.lastUsedAt } : {}),
      ...(identity.lastVerifiedAt ? { lastVerifiedAt: identity.lastVerifiedAt } : {}),
      ...(identity.configReadiness ? { configReadiness: identity.configReadiness } : {}),
      ...(identity.capabilities ? { capabilities: identity.capabilities } : {}),
      ...(identity.capabilityMissing ? { capabilityMissing: identity.capabilityMissing } : {}),
      ...(identity.capabilityDiscoveredAt
        ? { capabilityDiscoveredAt: identity.capabilityDiscoveredAt }
        : {}),
      ...(identity.providerMetadata ? { providerMetadata: identity.providerMetadata } : {}),
      ...(identity.connectionStatus ? { connectionStatus: identity.connectionStatus } : {}),
      ...(identity.healthStatus ? { healthStatus: identity.healthStatus } : {}),
      ...(identity.connectionStatusLabel
        ? { connectionStatusLabel: identity.connectionStatusLabel }
        : {}),
      ...(identity.agentReady != null ? { agentReady: identity.agentReady } : {}),
      ...(identity.capabilityDetails ? { capabilityDetails: identity.capabilityDetails } : {}),
      recentUsageCount: usage?.recentUsageCount ?? 0,
      ...(usage?.lastUsageAction ? { lastUsageAction: usage.lastUsageAction } : {}),
    };
  });

  const identityGovernanceStats = {
    total: identitySummaries.length,
    connected: identitySummaries.filter((identity) => identity.status === "active").length,
    atRisk: identityAlerts.length,
    inUse: identityAssetSummaries.filter((asset) => asset.inUse).length,
    unused: identityAssetSummaries.filter((asset) => !asset.inUse).length,
  };

  const identityProviderGroups = buildIdentityProviderInventoryGroups({
    providerCatalog,
    identityAssetSummaries,
  });

  const operationalIdentityRelationships = identityAssetSummaries.map((asset) => ({
    identityId: asset.identityId,
    displayName: asset.displayName,
    providerLabel: asset.providerLabel,
    status: asset.status,
    seats: asset.seatTitles,
    agents: asset.agentLabels,
    dataSourceIds: identitySnapshotBindings
      .filter((binding) => binding.identityId === asset.identityId)
      .map((binding) => binding.dataSourceId),
    allowedActions: asset.allowedActionLabels,
  }));

  const seatOperationalIdentityAccess = seatSummaries.map((seat) => {
    const policies = (identitySnapshot?.policies ?? []).filter(
      (policy) => policy.enabled && policy.seatIds.includes(seat.seatId),
    );
    const identities = policies
      .map((policy) => {
        const identity = identitySummaries.find((entry) => entry.identityId === policy.identityId);
        if (!identity) {
          return null;
        }
        return {
          identityId: identity.identityId,
          displayName: identity.displayName,
          providerLabel: identity.providerLabel,
          status: identity.status,
          allowedActions: policy.allowedActions,
          agentIds: [
            ...new Set(
              (enrollmentsByIdentity.get(identity.identityId) ?? []).map(
                (enrollment) => enrollment.agentId,
              ),
            ),
          ],
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    return {
      seatId: seat.seatId,
      seatTitle: seat.title,
      identities,
    };
  });

  return {
    currentTenantId,
    currentTenantLabel: state.platformAuthState?.tenantName?.trim() || currentTenantId,
    connected: state.connected,
    connectionPhase: state.gatewayConnectionPhase ?? null,
    enterprisePayloadReady: Boolean(
      state.platformAuthState?.organization ||
      (state.platformAuthState?.members?.length ?? 0) > 0 ||
      state.enterpriseOrganizationSnapshot ||
      state.agentsList ||
      state.sessionsResult ||
      state.usageResult ||
      state.channelsSnapshot,
    ),
    lastError: state.lastError,
    bootstrapAuthMode: state.bootstrapAuthMode,
    authenticatedUser,
    membershipRole: state.platformAuthState?.membershipRole ?? null,
    memberCount: members.length,
    memberUsers,
    memberSummaries,
    adminCount: members.filter((member) => member.membershipRole === "enterprise-admin").length,
    seatCount: organization?.seatCount ?? 0,
    occupiedSeatCount: organization?.occupiedSeatCount ?? 0,
    assignedSeatCount: organization?.assignedSeatCount ?? 0,
    vacantSeatCount: organization?.vacantSeatCount ?? 0,
    handoverSeatCount: organization?.handoverSeatCount ?? 0,
    frozenSeatCount: organization?.frozenSeatCount ?? 0,
    handoverCaseCount: organization?.handovers.length ?? 0,
    pendingOfferCount: organization?.pendingOfferCount ?? 0,
    organizationDepartmentPaths: organization?.departmentPaths ?? [],
    organizationChildOrders: organization?.childOrders ?? {},
    seatSummaries,
    handoverSummaries,
    offerSummaries,
    latestInviteCode: state.platformAuthState?.latestInvite?.code ?? null,
    latestInviteExpiresAt: state.platformAuthState?.latestInvite?.expiresAt ?? null,
    agentCount: state.agentsList?.agents?.length ?? 0,
    defaultAgentId: state.agentsList?.defaultId ?? null,
    presenceCount: state.presenceEntries.length,
    runtimeHosts,
    sessionsCount: state.sessionsResult?.count ?? 0,
    nodeCount: state.nodes.length,
    groupIds,
    cronJobCount: state.cronJobs.length,
    meshSummary: mesh.meshSummary,
    meshUsers: mesh.meshUsers,
    meshAgents: mesh.meshAgents,
    meshGroups: mesh.meshGroups,
    meshAnomalies: mesh.meshAnomalies,
    totalTokens: state.usageResult?.totals?.totalTokens ?? 0,
    totalCost: state.usageResult?.totals?.totalCost ?? 0,
    missingCostEntries: state.usageResult?.totals?.missingCostEntries ?? 0,
    channelCount: 0,
    channelIds,
    accountCount,
    modelMode: typeof modelsConfig?.mode === "string" ? modelsConfig.mode : null,
    configuredProviderCount: providerIds.length,
    providerIds,
    configuredModelCount,
    configuredModelIds: unique(configuredModelIds),
    configValid: state.configValid,
    configIssueCount: state.configIssues.length,
    configIssueLabels,
    resolverOptions,
    identityCount: identitySummaries.length,
    identityProviderCounts: identitySnapshot?.providerCounts ?? {},
    identityProviderCatalog: identitySnapshot?.providerCatalog ?? [],
    gatewayEgressIp: identitySnapshot?.gatewayEgressIp ?? null,
    identitySummaries,
    identityPolicySummaries: (identitySnapshot?.policies ?? []).map((policy) => ({
      policyId: policy.policyId,
      identityId: policy.identityId,
      seatIds: policy.seatIds,
      allowedAgentIds: policy.allowedAgentIds,
      allowedActions: policy.allowedActions,
      enabled: policy.enabled,
    })),
    identityDataSourceBindings: (identitySnapshot?.dataSourceBindings ?? []).map((binding) => ({
      bindingId: binding.bindingId,
      identityId: binding.identityId,
      dataSourceId: binding.dataSourceId,
      purpose: binding.purpose,
    })),
    identityEligibleDataSources: identitySnapshot?.eligibleDataSources ?? [],
    dataSourceGovernanceDetail: {
      sourceId: state.enterpriseDataSourceGovernanceSourceId,
      busy: state.enterpriseDataSourceGovernanceBusy,
      error: state.enterpriseDataSourceGovernanceError,
      source: state.enterpriseDataSourceGovernanceView?.source ?? null,
      boundOperationalIdentities:
        state.enterpriseDataSourceGovernanceView?.boundOperationalIdentities ?? [],
    },
    identityAlerts,
    identityGovernanceStats,
    identityAssetSummaries,
    identityProviderGroups,
    operationalIdentityBusy: state.enterpriseOperationalIdentityBusy,
    operationalIdentityLoaded: state.enterpriseOperationalIdentityLoaded,
    operationalIdentityError: state.enterpriseOperationalIdentityError,
    operationalIdentityNotice: state.enterpriseOperationalIdentityNotice,
    identityVerify:
      state.enterpriseIdentityVerifyId?.trim() && state.enterpriseIdentityVerifyPhase !== "idle"
        ? {
            identityId: state.enterpriseIdentityVerifyId,
            phase: state.enterpriseIdentityVerifyPhase ?? "idle",
            message: state.enterpriseIdentityVerifyMessage ?? "",
          }
        : null,
    operationalIdentityRelationships,
    seatOperationalIdentityAccess,
    employeeIdentityBindingRows: employeeEnrollments
      .map((enrollment) => {
        const seat = employeeSeatById.get(enrollment.employeeId);
        const seatId = seat?.seatId ?? null;
        return {
          enrollmentId: enrollment.enrollmentId,
          employeeId: enrollment.employeeId,
          employeeLabel: employeeLabelById.get(enrollment.employeeId) ?? enrollment.employeeId,
          seatId,
          seatTitle: seat?.seatTitle ?? null,
          departmentPath: seatId ? (seatDepartmentPathBySeatId.get(seatId) ?? null) : null,
          agentId: enrollment.agentId,
          agentLabel: agentNameById.get(enrollment.agentId) ?? enrollment.agentId,
          identityId: enrollment.identityId,
          identityDisplayName:
            identityDisplayNameById.get(enrollment.identityId) ?? enrollment.identityId,
          providerLabel:
            identityProviderLabelById.get(enrollment.identityId) ?? enrollment.identityId,
          updatedAt: enrollment.updatedAt,
        };
      })
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    recentIdentityBindingActivity: bindingActivity.map((event) => {
      const identityId = event.resourceId ?? "";
      const employeeId = String(event.metadata?.employeeId ?? event.actorEmployeeId ?? "");
      const agentId = String(event.metadata?.agentId ?? "");
      return {
        auditEventId: event.auditEventId,
        kind: event.eventType === "identity.bound" ? ("bound" as const) : ("unbound" as const),
        identityId,
        identityDisplayName: identityDisplayNameById.get(identityId) ?? identityId,
        providerLabel: identityProviderLabelById.get(identityId) ?? "",
        employeeId,
        employeeLabel: employeeLabelById.get(employeeId) ?? employeeId,
        agentId,
        agentLabel: agentNameById.get(agentId) ?? agentId,
        seatTitle: employeeSeatById.get(employeeId)?.seatTitle ?? null,
        createdAt: event.createdAt,
      };
    }),
  };
}
