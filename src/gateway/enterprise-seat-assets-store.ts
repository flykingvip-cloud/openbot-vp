import { randomUUID } from "node:crypto";
import { withEmployeeUniversalStewardAgentIds } from "../agents/builtin-steward/identity.js";
import { invalidateCogniWeaveManagersForGovernanceChangeSync } from "../memory/search-manager.js";
import {
  executeHandoverSessionDataTransfer,
  mergeHandoverSessionTransferExecution,
} from "./enterprise-handover-session-transfer.js";
import type {
  CollaborationIdentityDelegation,
  DataSourceIdentityBinding,
  EmployeeEnterpriseIdentityEnrollment,
  EnterpriseIdentity,
  IdentityUsagePolicy,
  OperationalIdentityTenantSettings,
} from "./enterprise-operational-identity-types.js";
import {
  organizationChildSeatKey,
  removeOrganizationChildFromOrder,
} from "./enterprise-org-child-order.js";
import { recordEnterpriseAssetAuditEvent as recordAuditEvent } from "./enterprise-seat-assets-audit.js";
import {
  createEnterpriseSeatAssetsJsonBackend,
  normalizeEnterpriseSeatAssetsStore,
  resolveEnterpriseSeatAssetsBackendFromConfig,
  type EnterpriseSeatAssetsBackend,
} from "./enterprise-seat-assets-backend.js";
import {
  assertHandoverTransferSelection,
  applyHandoverTransferSelection,
  attachSeatManagedAsset,
  buildSeatConnectorProfileSnapshots,
  buildHandoverAssetSnapshot,
  buildSeatMemoryScopeSnapshots,
  freezeSeatManagedAssetsForHandover,
  listActiveSeatAssetBindings,
  listTenantSeatAssetBindings,
  reactivateSeatManagedAssetsAfterHandover,
  resolveSeatMemoryScopeId,
  syncSeatManagedAssetBindings,
  validateEnterpriseAssetGovernance,
} from "./enterprise-seat-assets-governance.js";

export type {
  DataSourceIdentityBinding,
  DataSourceIdentityBindingPurpose,
  EnterpriseIdentity,
  EnterpriseIdentityStatus,
  EnterpriseOperationalIdentityProvider,
  IdentityUsagePolicy,
} from "./enterprise-operational-identity-types.js";

/** v3 reserved for connectorActions / connectorRuntimeRegistry / seatActionGrants (see connector-action-versioning.md). */
const ENTERPRISE_SEAT_ASSETS_STORE_VERSION = 4;
export const ENTERPRISE_POSITION_AGENT_ASSET_LIMIT = 5;

export type EnterpriseSeatStatus =
  | "vacant"
  | "assigned"
  | "occupied"
  | "handover_pending"
  | "frozen";
export type EnterpriseSeatBindingStatus = "active" | "suspended" | "revoked" | "completed";
export type EnterpriseHandoverStatus =
  | "draft"
  | "asset_review"
  | "pending_approval"
  | "frozen"
  | "rebound"
  | "completed";
export type EnterpriseSeatAssignmentOfferStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "canceled"
  | "expired"
  | "superseded";
export type EnterpriseAccessSubjectType = "employee" | "seat";
export type EnterpriseAccessResourceType =
  | "seat"
  | "agent"
  | "space"
  | "memory"
  | "connector"
  | "capability"
  | "identity"
  | "data_source";
export type EnterpriseAccessAction = "read" | "write" | "execute" | "manage";
export type EnterpriseManagedAssetType = "agent" | "space" | "memory" | "connector" | "capability";
export type EnterpriseSeatAssetBindingStatus =
  | "active"
  | "handover_frozen"
  | "rebind_required"
  | "revoked";
export type EnterpriseConnectorCredentialStatus = "active" | "revoked" | "reauthorization_required";
export type EnterpriseMemoryTransferClass = "inheritable" | "review_required" | "private";
export type EnterpriseAssetAuditEventType =
  | "seat.created"
  | "seat.assets_configured"
  | "seat.assigned"
  | "seat.released"
  | "handover.started"
  | "handover.nominated"
  | "handover.reviewed"
  | "handover.approved"
  | "handover.completed"
  | "assignment.created"
  | "assignment.reminded"
  | "assignment.accepted"
  | "assignment.declined"
  | "assignment.canceled"
  | "asset.inheritance.applied"
  | "credential.reauthorization.required"
  | "access.granted"
  | "access.revoked"
  | "credential.registered"
  | "credential.revoked"
  | "identity.registered"
  | "identity.verified"
  | "identity.reauthorized"
  | "identity.revoked"
  | "identity.bound"
  | "identity.unbound"
  | "identity.used"
  | "identity.usage_denied"
  | "identity.grant_mode_updated"
  | "organization.department_created"
  | "organization.department_renamed"
  | "organization.department_moved"
  | "organization.department_deleted"
  | "organization.seat_moved"
  | "organization.seat_deleted"
  | "organization.department_merged"
  | "organization.structure_synced"
  | "organization.children_reordered";

export type EnterpriseAuditMetadataValue = string | number | boolean | null | string[];

export type EnterprisePositionSeat = {
  seatId: string;
  tenantId: string;
  title: string;
  teamLabel?: string;
  responsibility?: string;
  roleCode?: string;
  status: EnterpriseSeatStatus;
  currentEmployeeId?: string;
  defaultSpaceIds: string[];
  defaultAgentAssetIds: string[];
  memoryScopeEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type EnterpriseSeatBinding = {
  bindingId: string;
  seatId: string;
  tenantId: string;
  employeeId: string;
  bindingStatus: EnterpriseSeatBindingStatus;
  effectiveAt: string;
  endedAt?: string;
  endedReason?: "offboarded" | "transferred" | "temporary_cover_ended";
};

export type EnterpriseAccessPolicy = {
  policyId: string;
  tenantId: string;
  subjectType: EnterpriseAccessSubjectType;
  subjectId: string;
  resourceType: EnterpriseAccessResourceType;
  resourceId: string;
  action: EnterpriseAccessAction;
  effect: "allow";
  createdAt: string;
  revokedAt?: string;
};

export type EnterpriseSeatAssetBinding = {
  assetBindingId: string;
  tenantId: string;
  seatId: string;
  assetType: EnterpriseManagedAssetType;
  assetId: string;
  status: EnterpriseSeatAssetBindingStatus;
  source: "seat_default" | "manual" | "capability_push";
  requiresReauthorization?: boolean;
  createdBy?: string;
  handoverCaseId?: string;
  frozenAt?: string;
  reboundAt?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type EnterpriseConnectorCredentialBinding = {
  credentialBindingId: string;
  tenantId: string;
  connectorId: string;
  ownerType: "employee" | "seat";
  ownerId: string;
  status: EnterpriseConnectorCredentialStatus;
  createdBy?: string;
  handoverCaseId?: string;
  revokedAt?: string;
  revokedReason?: "offboarded" | "handover_reauth_required" | "manual";
  createdAt: string;
  updatedAt: string;
};

export type EnterpriseMemoryScopeSnapshot = {
  scopeId: string;
  transferClass: EnterpriseMemoryTransferClass;
};

export type EnterpriseConnectorProfileSnapshot = {
  profileId: string;
  credentialReauthorizationRequired: boolean;
};

export type EnterpriseHandoverTransferSelection = {
  agentIds: string[];
  spaceIds: string[];
  dataKeys: string[];
  policyIds: string[];
};

export type EnterpriseHandoverSessionDataTransfer = {
  recentSessions: boolean;
  historyArchive: boolean;
  coveredAgentIds: string[];
  executedAt?: string;
  archivedSessionIds?: string[];
  recentSessionIds?: string[];
  archivedTranscriptCount?: number;
};

export type EnterpriseHandoverAssetSnapshot = {
  agentIds: string[];
  spaceIds: string[];
  memoryScopeIds: string[];
  memoryScopes: EnterpriseMemoryScopeSnapshot[];
  dataKeys: string[];
  sessionDataTransfer: EnterpriseHandoverSessionDataTransfer;
  connectorIds: string[];
  connectorProfileIds: string[];
  connectorProfiles: EnterpriseConnectorProfileSnapshot[];
  connectorCredentialReauthorizationRequired: boolean;
  credentialBindings: Array<{
    credentialBindingId: string;
    connectorId: string;
    ownerType: "employee" | "seat";
    ownerId: string;
    status: EnterpriseConnectorCredentialStatus;
  }>;
  frozenAssetBindingIds: string[];
  rebindRequiredAssetBindingIds: string[];
  transferSelection?: EnterpriseHandoverTransferSelection;
  generatedAt: string;
};

export type EnterpriseHandoverCase = {
  handoverCaseId: string;
  tenantId: string;
  seatId: string;
  outgoingEmployeeId: string;
  incomingEmployeeId?: string;
  status: EnterpriseHandoverStatus;
  reviewSummary?: string;
  exceptionFlags: string[];
  transferSelection?: EnterpriseHandoverTransferSelection;
  assetSnapshot?: EnterpriseHandoverAssetSnapshot;
  approvedBy?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type EnterpriseSeatAssignmentOffer = {
  assignmentId?: string;
  offerId: string;
  tenantId: string;
  seatId: string;
  targetEmployeeId: string;
  offeredByEmployeeId: string;
  assignmentType?: "new_hire" | "internal";
  status: EnterpriseSeatAssignmentOfferStatus;
  inheritMode?: "full" | "selective";
  previousSeatStatus?: EnterpriseSeatStatus;
  handoverCaseId?: string;
  packageSnapshot: {
    seatTitle: string;
    defaultAgentId: string | null;
    agentIds?: string[];
    defaultSpaceIds: string[];
    memoryScopeIds?: string[];
    memoryScopes?: EnterpriseMemoryScopeSnapshot[];
    connectorIds?: string[];
    connectorProfileIds?: string[];
    connectorProfiles?: EnterpriseConnectorProfileSnapshot[];
    connectorCredentialReauthorizationRequired?: boolean;
    reauthorizationRequired?: boolean;
  };
  offeredAt: string;
  updatedAt: string;
  expiresAt?: string;
  respondedAt?: string;
};

export type EnterpriseAssetAuditEvent = {
  auditEventId: string;
  auditId?: string;
  tenantId: string;
  actorEmployeeId?: string;
  eventType: EnterpriseAssetAuditEventType;
  seatId?: string;
  handoverCaseId?: string;
  bindingId?: string;
  offerId?: string;
  policyId?: string;
  resourceType?: EnterpriseAccessResourceType;
  resourceId?: string;
  metadata?: Record<string, EnterpriseAuditMetadataValue>;
  createdAt: string;
};

export type EnterpriseOrganizationDepartment = {
  departmentId: string;
  tenantId: string;
  fullPath: string;
  createdAt: string;
  updatedAt: string;
};

export type EnterpriseSeatAssetsStore = {
  version: number;
  seats: Record<string, EnterprisePositionSeat>;
  bindings: Record<string, EnterpriseSeatBinding>;
  accessPolicies: Record<string, EnterpriseAccessPolicy>;
  assetBindings: Record<string, EnterpriseSeatAssetBinding>;
  credentialBindings: Record<string, EnterpriseConnectorCredentialBinding>;
  handovers: Record<string, EnterpriseHandoverCase>;
  offers: Record<string, EnterpriseSeatAssignmentOffer>;
  auditEvents: Record<string, EnterpriseAssetAuditEvent>;
  enterpriseIdentities: Record<string, EnterpriseIdentity>;
  identityUsagePolicies: Record<string, IdentityUsagePolicy>;
  dataSourceIdentityBindings: Record<string, DataSourceIdentityBinding>;
  employeeIdentityEnrollments: Record<string, EmployeeEnterpriseIdentityEnrollment>;
  /**
   * Optional collaboration-group OI narrowing (P2). Absent / empty → no effect.
   * Read path enters the same PDP as enrollment.
   */
  collaborationIdentityDelegations?: Record<string, CollaborationIdentityDelegation>;
  /** Per-tenant OI grant mode (admin); default seat_inherit_until_curated when absent. */
  operationalIdentityTenantSettings?: Record<string, OperationalIdentityTenantSettings>;
  organizationDepartments?: Record<string, EnterpriseOrganizationDepartment>;
  organizationChildOrders?: Record<string, string[]>;
};

export type EnterpriseEmployeeAccessSnapshot = {
  currentSeat: {
    seatId: string;
    title: string;
    status: EnterpriseSeatStatus;
    bindingStatus: EnterpriseSeatBindingStatus;
  } | null;
  defaultAgentId: string | null;
  agentIds: string[];
  defaultSpaceIds: string[];
  memoryScopeIds: string[];
  connectorIds: string[];
  pendingOffer: {
    assignmentId?: string;
    offerId: string;
    seatId: string;
    seatTitle: string;
    defaultAgentId: string | null;
    agentIds: string[];
    omittedAgentIds?: string[];
    defaultSpaceIds: string[];
    memoryScopeIds: string[];
    memoryScopes: EnterpriseMemoryScopeSnapshot[];
    connectorIds: string[];
    connectorProfileIds: string[];
    connectorProfiles: EnterpriseConnectorProfileSnapshot[];
    connectorCredentialReauthorizationRequired: boolean;
    reauthorizationRequired: boolean;
    offeredAt: string;
    expiresAt?: string;
    handoverCaseId?: string;
  } | null;
  notice: string | null;
};

export type EnterpriseSeatAccessSnapshot = {
  employeePolicies: EnterpriseAccessPolicy[];
  seatPolicies: EnterpriseAccessPolicy[];
};

export type EnterpriseGovernanceCheck = {
  code: string;
  severity: "error" | "warning";
  tenantId: string;
  seatId?: string;
  employeeId?: string;
  handoverCaseId?: string;
  message: string;
};

export async function loadEnterpriseSeatAssetsStore(
  storePath?: string,
): Promise<EnterpriseSeatAssetsStore> {
  return loadEnterpriseSeatAssetsStoreFromBackend(
    storePath
      ? createEnterpriseSeatAssetsJsonBackend({ storePath })
      : resolveEnterpriseSeatAssetsBackendFromConfig(),
  );
}

export async function saveEnterpriseSeatAssetsStore(
  storePath: string | undefined,
  store: EnterpriseSeatAssetsStore,
): Promise<void> {
  await saveEnterpriseSeatAssetsStoreToBackend(
    storePath
      ? createEnterpriseSeatAssetsJsonBackend({ storePath })
      : resolveEnterpriseSeatAssetsBackendFromConfig(),
    store,
  );
}

export async function loadEnterpriseSeatAssetsStoreFromBackend(
  backend: EnterpriseSeatAssetsBackend,
): Promise<EnterpriseSeatAssetsStore> {
  const parsed = await backend.load();
  return normalizeEnterpriseSeatAssetsStore(parsed, ENTERPRISE_SEAT_ASSETS_STORE_VERSION);
}

export async function saveEnterpriseSeatAssetsStoreToBackend(
  backend: EnterpriseSeatAssetsBackend,
  store: EnterpriseSeatAssetsStore,
): Promise<void> {
  await backend.save(store);
}

function normalizeSeatTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isEmailLikeSeatTitle(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.includes("@");
}

function assertHumanSeatTitle(title: string): string {
  if (!title) {
    throw new Error("Seat title is required.");
  }
  if (isEmailLikeSeatTitle(title)) {
    throw new Error("Seat title cannot be an email address.");
  }
  return title;
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}

function normalizeCodeToken(value: string): string {
  const ascii = value
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return ascii.replace(/[^A-Z0-9_]/g, "").replace(/_+/g, "_");
}

function resolveTeamCode(teamLabel: string | undefined, seatTitle: string): string {
  const source = `${teamLabel ?? ""} ${seatTitle}`.toLowerCase();
  if (/销售|sales/.test(source)) {
    return "SALES";
  }
  if (/人力|人事|hr/.test(source)) {
    return "HR";
  }
  if (/财务|finance|fin/.test(source)) {
    return "FIN";
  }
  if (/法务|legal/.test(source)) {
    return "LEGAL";
  }
  if (/运营|ops|operation/.test(source)) {
    return "OPS";
  }
  if (/客服|客户成功|support|cs/.test(source)) {
    return "CS";
  }
  if (/市场|marketing|mkt/.test(source)) {
    return "MKT";
  }
  if (/产品|product/.test(source)) {
    return "PROD";
  }
  if (/技术|研发|工程|engineering|engineer|eng/.test(source)) {
    return "ENG";
  }
  const normalized = normalizeCodeToken(teamLabel || seatTitle)
    .split("_")
    .find(Boolean);
  return (normalized || "TEAM").slice(0, 8);
}

function resolvePositionLevelCode(seatTitle: string): string {
  const title = seatTitle.toLowerCase();
  if (/总监|director|\bdir\b/.test(title)) {
    return "DIR";
  }
  if (/负责人|lead|owner/.test(title)) {
    return "L2";
  }
  if (/经理|manager|\bmgr\b/.test(title)) {
    return "MGR";
  }
  if (/专员|助理|assistant|associate|\bl1\b/.test(title)) {
    return "L1";
  }
  return "L1";
}

function generatePositionRoleCode(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  teamLabel: string | undefined;
  seatTitle: string;
}): string {
  const teamCode = resolveTeamCode(params.teamLabel, params.seatTitle);
  const levelCode = resolvePositionLevelCode(params.seatTitle);
  const prefix = `${teamCode}-${levelCode}-`;
  const highestSequence = Object.values(params.store.seats)
    .filter((seat) => seat.tenantId === params.tenantId)
    .map((seat) => seat.roleCode ?? "")
    .filter((roleCode) => roleCode.startsWith(prefix))
    .reduce((highest, roleCode) => {
      const sequence = Number.parseInt(roleCode.slice(prefix.length), 10);
      return Number.isFinite(sequence) ? Math.max(highest, sequence) : highest;
    }, 0);
  return `${prefix}${String(highestSequence + 1).padStart(3, "0")}`;
}

function uniqueTrimmedStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function normalizePositionAgentAssetIds(params: {
  defaultAgentId?: string | null;
  agentIds?: string[];
}): string[] {
  const ids = uniqueTrimmedStrings([params.defaultAgentId, ...(params.agentIds ?? [])]);
  if (ids.length > ENTERPRISE_POSITION_AGENT_ASSET_LIMIT) {
    throw new Error(
      `A position can include at most ${ENTERPRISE_POSITION_AGENT_ASSET_LIMIT} AI assets.`,
    );
  }
  return ids;
}

/** Read-path normalization for snapshots: clip excess IDs instead of failing the request. */
export function clipPositionAgentAssetIds(params: {
  defaultAgentId?: string | null;
  agentIds?: string[];
}): string[] {
  const ids = uniqueTrimmedStrings([params.defaultAgentId, ...(params.agentIds ?? [])]);
  return ids.slice(0, ENTERPRISE_POSITION_AGENT_ASSET_LIMIT);
}

export function resolvePositionAgentAssetPackage(params: {
  defaultAgentId?: string | null;
  agentIds?: string[];
}): { agentIds: string[]; omittedAgentIds: string[] } {
  const ids = uniqueTrimmedStrings([params.defaultAgentId, ...(params.agentIds ?? [])]);
  return {
    agentIds: ids.slice(0, ENTERPRISE_POSITION_AGENT_ASSET_LIMIT),
    omittedAgentIds: ids.slice(ENTERPRISE_POSITION_AGENT_ASSET_LIMIT),
  };
}

function offerAgentIds(offer: EnterpriseSeatAssignmentOffer): string[] {
  return resolvePositionAgentAssetPackage({
    defaultAgentId: offer.packageSnapshot.defaultAgentId,
    agentIds: offer.packageSnapshot.agentIds ?? [],
  }).agentIds;
}

function offerOmittedAgentIds(offer: EnterpriseSeatAssignmentOffer): string[] {
  return resolvePositionAgentAssetPackage({
    defaultAgentId: offer.packageSnapshot.defaultAgentId,
    agentIds: offer.packageSnapshot.agentIds ?? [],
  }).omittedAgentIds;
}

function buildSeatAssignmentPackageSnapshot(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  seatTitle: string;
  defaultAgentId: string | null;
  agentIds: string[];
  defaultSpaceIds: string[];
  includeMemoryScope: boolean;
}) {
  const memoryScopes = params.includeMemoryScope
    ? buildSeatMemoryScopeSnapshots({
        store: params.store,
        tenantId: params.tenantId,
        seatId: params.seatId,
      })
    : [];
  const connectorProfiles = buildSeatConnectorProfileSnapshots({
    store: params.store,
    tenantId: params.tenantId,
    seatId: params.seatId,
  });
  return {
    seatTitle: params.seatTitle,
    defaultAgentId: params.defaultAgentId,
    agentIds: [...params.agentIds],
    defaultSpaceIds: [...params.defaultSpaceIds],
    memoryScopeIds: memoryScopes.map((scope) => scope.scopeId),
    memoryScopes,
    connectorIds: connectorProfiles.map((profile) => profile.profileId),
    connectorProfileIds: connectorProfiles.map((profile) => profile.profileId),
    connectorProfiles,
    connectorCredentialReauthorizationRequired: connectorProfiles.some(
      (profile) => profile.credentialReauthorizationRequired,
    ),
    reauthorizationRequired: connectorProfiles.some(
      (profile) => profile.credentialReauthorizationRequired,
    ),
  };
}

function buildPendingSeatOfferSnapshot(offer: EnterpriseSeatAssignmentOffer) {
  const omittedAgentIds = offerOmittedAgentIds(offer);
  return {
    assignmentId: offer.assignmentId ?? offer.offerId,
    ...(offer.assignmentType ? { assignmentType: offer.assignmentType } : {}),
    offerId: offer.offerId,
    seatId: offer.seatId,
    seatTitle: offer.packageSnapshot.seatTitle,
    defaultAgentId: offer.packageSnapshot.defaultAgentId,
    agentIds: offerAgentIds(offer),
    ...(omittedAgentIds.length > 0 ? { omittedAgentIds } : {}),
    defaultSpaceIds: [...offer.packageSnapshot.defaultSpaceIds],
    memoryScopeIds: [...(offer.packageSnapshot.memoryScopeIds ?? [])],
    memoryScopes: [...(offer.packageSnapshot.memoryScopes ?? [])],
    connectorIds: [...(offer.packageSnapshot.connectorIds ?? [])],
    connectorProfileIds: [...(offer.packageSnapshot.connectorProfileIds ?? [])],
    connectorProfiles: [...(offer.packageSnapshot.connectorProfiles ?? [])],
    connectorCredentialReauthorizationRequired: Boolean(
      offer.packageSnapshot.connectorCredentialReauthorizationRequired,
    ),
    reauthorizationRequired: Boolean(offer.packageSnapshot.reauthorizationRequired),
    offeredAt: offer.offeredAt,
    ...(offer.expiresAt ? { expiresAt: offer.expiresAt } : {}),
    ...(offer.handoverCaseId ? { handoverCaseId: offer.handoverCaseId } : {}),
  };
}

function restoreSeatStatusAfterPendingAssignment(params: {
  store: EnterpriseSeatAssetsStore;
  offer: EnterpriseSeatAssignmentOffer;
  nowIso: string;
}) {
  const seat = params.store.seats[params.offer.seatId];
  if (!seat) {
    return;
  }
  seat.status = params.offer.previousSeatStatus ?? "vacant";
  seat.updatedAt = params.nowIso;
}

function isOfferExpired(offer: EnterpriseSeatAssignmentOffer, now = Date.now()): boolean {
  if (!offer.expiresAt || offer.status !== "pending") {
    return false;
  }
  const expiresAtMs = Number(new Date(offer.expiresAt));
  return Number.isFinite(expiresAtMs) && expiresAtMs <= now;
}

export function recordEnterpriseAssetAuditEvent(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  eventType: EnterpriseAssetAuditEventType;
  nowIso: string;
  auditId?: string;
  actorEmployeeId?: string;
  seatId?: string;
  handoverCaseId?: string;
  bindingId?: string;
  offerId?: string;
  policyId?: string;
  resourceType?: EnterpriseAccessResourceType;
  resourceId?: string;
  metadata?: Record<string, EnterpriseAuditMetadataValue>;
}): EnterpriseAssetAuditEvent {
  return recordAuditEvent(params);
}

function supersedeRelatedPendingOffers(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId?: string;
  targetEmployeeId?: string;
  exceptOfferId?: string;
  nowIso: string;
}) {
  for (const offer of Object.values(params.store.offers)) {
    if (
      offer.tenantId !== params.tenantId ||
      offer.status !== "pending" ||
      offer.offerId === params.exceptOfferId
    ) {
      continue;
    }
    if (params.seatId && offer.seatId === params.seatId) {
      offer.status = "superseded";
      offer.updatedAt = params.nowIso;
      offer.respondedAt = params.nowIso;
      continue;
    }
    if (params.targetEmployeeId && offer.targetEmployeeId === params.targetEmployeeId) {
      offer.status = "superseded";
      offer.updatedAt = params.nowIso;
      offer.respondedAt = params.nowIso;
    }
  }
}

function findReusableSeat(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  title: string;
}): EnterprisePositionSeat | null {
  const normalizedTitle = normalizeSeatTitle(params.title).toLowerCase();
  return (
    Object.values(params.store.seats)
      .filter((seat) => seat.tenantId === params.tenantId)
      .find((seat) => {
        if (normalizeSeatTitle(seat.title).toLowerCase() !== normalizedTitle) {
          return false;
        }
        return (
          seat.status === "vacant" || seat.status === "handover_pending" || seat.status === "frozen"
        );
      }) ?? null
  );
}

export function ensureSeatForProvision(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId?: string | null;
  seatTitle?: string | null;
  reuseByTitle?: boolean;
  teamLabel?: string | null;
  responsibility?: string | null;
  nowIso: string;
  defaultAgentId?: string | null;
  agentIds?: string[];
  defaultSpaceIds?: string[];
  actorEmployeeId?: string;
  auditId?: string;
}): EnterprisePositionSeat {
  const explicitSeatId = params.seatId?.trim() ?? "";
  if (explicitSeatId) {
    const exactSeat = params.store.seats[explicitSeatId];
    if (!exactSeat || exactSeat.tenantId !== params.tenantId) {
      throw new Error("Seat not found.");
    }
    if (
      exactSeat.status !== "vacant" &&
      exactSeat.status !== "handover_pending" &&
      exactSeat.status !== "frozen"
    ) {
      throw new Error("Seat is not available for succession.");
    }
    return exactSeat;
  }
  const title = assertHumanSeatTitle(normalizeSeatTitle(params.seatTitle ?? ""));
  const teamLabel = params.teamLabel?.trim() || undefined;
  const responsibility = normalizeOptionalText(params.responsibility);
  const shouldUpdateAgentAssets =
    params.defaultAgentId !== undefined || params.agentIds !== undefined;
  const agentAssetIds = shouldUpdateAgentAssets
    ? normalizePositionAgentAssetIds({
        defaultAgentId: params.defaultAgentId,
        agentIds: params.agentIds,
      })
    : [];
  const existing =
    params.reuseByTitle === false
      ? null
      : findReusableSeat({
          store: params.store,
          tenantId: params.tenantId,
          title,
        });
  if (existing) {
    existing.updatedAt = params.nowIso;
    if (!existing.roleCode) {
      existing.roleCode = generatePositionRoleCode({
        store: params.store,
        tenantId: params.tenantId,
        teamLabel,
        seatTitle: title,
      });
    }
    if (shouldUpdateAgentAssets) {
      existing.defaultAgentAssetIds = [...agentAssetIds];
    }
    if (params.defaultSpaceIds !== undefined) {
      existing.defaultSpaceIds = [...params.defaultSpaceIds];
    }
    if (teamLabel) {
      existing.teamLabel = teamLabel;
    }
    if (params.responsibility !== undefined) {
      if (responsibility) {
        existing.responsibility = responsibility;
      } else {
        delete existing.responsibility;
      }
    }
    syncSeatAssetAccessPolicies({
      store: params.store,
      tenantId: params.tenantId,
      seat: existing,
      nowIso: params.nowIso,
    });
    syncSeatManagedAssetBindings({
      store: params.store,
      tenantId: params.tenantId,
      seat: existing,
      nowIso: params.nowIso,
      actorEmployeeId: params.actorEmployeeId,
    });
    recordAuditEvent({
      store: params.store,
      tenantId: params.tenantId,
      eventType: "seat.assets_configured",
      nowIso: params.nowIso,
      auditId: params.auditId,
      actorEmployeeId: params.actorEmployeeId,
      seatId: existing.seatId,
      metadata: {
        defaultAgentIds: [...existing.defaultAgentAssetIds],
        defaultSpaceIds: [...existing.defaultSpaceIds],
        memoryScopeId: resolveSeatMemoryScopeId(existing.seatId),
      },
    });
    return existing;
  }
  const seatId = randomUUID();
  const seat: EnterprisePositionSeat = {
    seatId,
    tenantId: params.tenantId,
    title,
    ...(teamLabel ? { teamLabel } : {}),
    ...(responsibility ? { responsibility } : {}),
    roleCode: generatePositionRoleCode({
      store: params.store,
      tenantId: params.tenantId,
      teamLabel,
      seatTitle: title,
    }),
    status: "vacant",
    defaultSpaceIds: [...(params.defaultSpaceIds ?? [])],
    defaultAgentAssetIds: [...agentAssetIds],
    memoryScopeEnabled: true,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  };
  params.store.seats[seatId] = seat;
  syncSeatAssetAccessPolicies({
    store: params.store,
    tenantId: params.tenantId,
    seat,
    nowIso: params.nowIso,
  });
  syncSeatManagedAssetBindings({
    store: params.store,
    tenantId: params.tenantId,
    seat,
    nowIso: params.nowIso,
    actorEmployeeId: params.actorEmployeeId,
  });
  recordAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "seat.created",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId,
    seatId,
    metadata: {
      seatTitle: seat.title,
      roleCode: seat.roleCode ?? null,
      memoryScopeId: resolveSeatMemoryScopeId(seatId),
    },
  });
  return seat;
}

export function configureSeatProfile(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  seatTitle?: string | null;
  teamLabel?: string | null;
  responsibility?: string | null;
  defaultAgentId?: string | null;
  agentIds?: string[];
  defaultSpaceIds?: string[];
  memoryScopeEnabled?: boolean;
  actorEmployeeId?: string;
  auditId?: string;
  nowIso: string;
}): EnterprisePositionSeat {
  const seat = params.store.seats[params.seatId];
  if (!seat || seat.tenantId !== params.tenantId) {
    throw new Error("Seat not found.");
  }
  const seatTitle = normalizeOptionalText(params.seatTitle);
  if (seatTitle) {
    if (isEmailLikeSeatTitle(seatTitle)) {
      if (normalizeSeatTitle(seat.title) !== seatTitle) {
        throw new Error("Seat title cannot be an email address.");
      }
    } else {
      seat.title = seatTitle;
    }
  }
  if (params.teamLabel !== undefined) {
    const teamLabel = normalizeOptionalText(params.teamLabel);
    if (teamLabel) {
      seat.teamLabel = teamLabel;
    } else {
      delete seat.teamLabel;
    }
  }
  if (params.responsibility !== undefined) {
    const responsibility = normalizeOptionalText(params.responsibility);
    if (responsibility) {
      seat.responsibility = responsibility;
    } else {
      delete seat.responsibility;
    }
  }
  if (params.defaultAgentId !== undefined || params.agentIds !== undefined) {
    seat.defaultAgentAssetIds = normalizePositionAgentAssetIds({
      defaultAgentId: params.defaultAgentId,
      agentIds: params.agentIds,
    });
  }
  if (params.defaultSpaceIds !== undefined) {
    seat.defaultSpaceIds = [...params.defaultSpaceIds];
  }
  if (params.memoryScopeEnabled !== undefined) {
    seat.memoryScopeEnabled = params.memoryScopeEnabled;
  }
  seat.updatedAt = params.nowIso;
  syncSeatAssetAccessPolicies({
    store: params.store,
    tenantId: params.tenantId,
    seat,
    nowIso: params.nowIso,
  });
  syncSeatManagedAssetBindings({
    store: params.store,
    tenantId: params.tenantId,
    seat,
    nowIso: params.nowIso,
    actorEmployeeId: params.actorEmployeeId,
  });
  recordAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "seat.assets_configured",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId,
    seatId: seat.seatId,
    metadata: {
      defaultAgentIds: [...seat.defaultAgentAssetIds],
      defaultSpaceIds: [...seat.defaultSpaceIds],
      memoryScopeId: resolveSeatMemoryScopeId(seat.seatId),
    },
  });
  return seat;
}

export function deleteVacantPositionSeat(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): void {
  const seat = params.store.seats[params.seatId];
  if (!seat || seat.tenantId !== params.tenantId) {
    throw new Error("岗位不存在。");
  }
  if (seat.currentEmployeeId?.trim()) {
    throw new Error("岗位仍绑定成员，无法删除。");
  }
  // Allow vacant shells and pending-activation seats (assigned, no employee yet).
  const deletableStatuses = new Set(["vacant", "assigned"]);
  if (!deletableStatuses.has(seat.status)) {
    throw new Error("仅空岗或未注册待激活岗位可删除，请先解除成员绑定或完成交接。");
  }
  const pendingOffer = Object.values(params.store.offers).find(
    (offer) =>
      offer.tenantId === params.tenantId &&
      offer.seatId === params.seatId &&
      offer.status === "pending",
  );
  if (pendingOffer) {
    throw new Error("岗位有待确认绑定，请先处理后再删除。");
  }
  const activeHandover = Object.values(params.store.handovers).find(
    (handover) =>
      handover.tenantId === params.tenantId &&
      handover.seatId === params.seatId &&
      handover.status !== "completed",
  );
  if (activeHandover) {
    throw new Error("岗位正在交接中，无法删除。");
  }
  const activeBinding = Object.values(params.store.bindings).find(
    (binding) =>
      binding.tenantId === params.tenantId &&
      binding.seatId === params.seatId &&
      binding.bindingStatus === "active",
  );
  if (activeBinding) {
    throw new Error("岗位仍有关联成员绑定记录，无法删除。");
  }

  revokeSeatAccessPolicies({
    store: params.store,
    tenantId: params.tenantId,
    seatId: params.seatId,
    nowIso: params.nowIso,
  });
  for (const binding of Object.values(params.store.assetBindings)) {
    if (
      binding.tenantId === params.tenantId &&
      binding.seatId === params.seatId &&
      !binding.revokedAt
    ) {
      binding.revokedAt = params.nowIso;
      binding.status = "revoked";
      binding.updatedAt = params.nowIso;
    }
  }

  const parentPath = seat.teamLabel?.trim() || "未分组";
  removeOrganizationChildFromOrder(
    params.store,
    params.tenantId,
    parentPath,
    organizationChildSeatKey(params.seatId),
  );

  const seatTitle = seat.title;
  const teamLabel = seat.teamLabel ?? null;
  delete params.store.seats[params.seatId];

  recordAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "organization.seat_deleted",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId,
    seatId: params.seatId,
    metadata: {
      seatTitle,
      teamLabel,
    },
  });
}

export function assignSeatToEmployee(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  employeeId: string;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): { seat: EnterprisePositionSeat; binding: EnterpriseSeatBinding } {
  const seat = params.store.seats[params.seatId];
  if (!seat || seat.tenantId !== params.tenantId) {
    throw new Error("Seat not found.");
  }
  if (
    seat.status === "occupied" &&
    seat.currentEmployeeId &&
    seat.currentEmployeeId !== params.employeeId
  ) {
    throw new Error("Seat is already occupied.");
  }
  revokeAccessPolicies({
    store: params.store,
    tenantId: params.tenantId,
    employeeId: params.employeeId,
    nowIso: params.nowIso,
  });
  for (const binding of Object.values(params.store.bindings)) {
    if (
      binding.tenantId === params.tenantId &&
      binding.employeeId === params.employeeId &&
      binding.bindingStatus === "active"
    ) {
      binding.bindingStatus = "completed";
      binding.endedAt = params.nowIso;
      binding.endedReason = "transferred";
      const previousSeat = params.store.seats[binding.seatId];
      if (previousSeat && previousSeat.currentEmployeeId === params.employeeId) {
        previousSeat.currentEmployeeId = undefined;
        previousSeat.status = "vacant";
        previousSeat.updatedAt = params.nowIso;
      }
    }
  }
  seat.currentEmployeeId = params.employeeId;
  seat.status = "occupied";
  seat.updatedAt = params.nowIso;
  syncSeatAssetAccessPolicies({
    store: params.store,
    tenantId: params.tenantId,
    seat,
    nowIso: params.nowIso,
  });
  syncSeatManagedAssetBindings({
    store: params.store,
    tenantId: params.tenantId,
    seat,
    nowIso: params.nowIso,
    actorEmployeeId: params.actorEmployeeId,
  });
  const binding: EnterpriseSeatBinding = {
    bindingId: randomUUID(),
    seatId: seat.seatId,
    tenantId: params.tenantId,
    employeeId: params.employeeId,
    bindingStatus: "active",
    effectiveAt: params.nowIso,
  };
  params.store.bindings[binding.bindingId] = binding;
  issueDefaultAccessPolicies({
    store: params.store,
    tenantId: params.tenantId,
    seat,
    employeeId: params.employeeId,
    nowIso: params.nowIso,
  });
  reactivateSeatManagedAssetsAfterHandover({
    store: params.store,
    tenantId: params.tenantId,
    seatId: seat.seatId,
    nowIso: params.nowIso,
  });
  recordAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "seat.assigned",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId,
    seatId: seat.seatId,
    bindingId: binding.bindingId,
    metadata: {
      employeeId: params.employeeId,
      agentIds: [...seat.defaultAgentAssetIds],
      spaceIds: [...seat.defaultSpaceIds],
      memoryScopeId: resolveSeatMemoryScopeId(seat.seatId),
    },
  });
  // Seat transfer / reassignment: epoch + cache clear must complete before return.
  invalidateCogniWeaveManagersForGovernanceChangeSync();
  return { seat, binding };
}

export function revokeAccessPolicies(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  employeeId: string;
  nowIso: string;
}) {
  for (const policy of Object.values(params.store.accessPolicies)) {
    if (
      policy.tenantId === params.tenantId &&
      policy.subjectType === "employee" &&
      policy.subjectId === params.employeeId &&
      !policy.revokedAt
    ) {
      policy.revokedAt = params.nowIso;
    }
  }
}

function revokeSeatAccessPolicies(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  nowIso: string;
}) {
  for (const policy of Object.values(params.store.accessPolicies)) {
    if (
      policy.tenantId === params.tenantId &&
      policy.subjectType === "seat" &&
      policy.subjectId === params.seatId &&
      !policy.revokedAt
    ) {
      policy.revokedAt = params.nowIso;
    }
  }
}

function issueDefaultAccessPolicies(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seat: EnterprisePositionSeat;
  employeeId: string;
  nowIso: string;
}) {
  const policies: EnterpriseAccessPolicy[] = [
    {
      policyId: randomUUID(),
      tenantId: params.tenantId,
      subjectType: "employee",
      subjectId: params.employeeId,
      resourceType: "seat",
      resourceId: params.seat.seatId,
      action: "read",
      effect: "allow",
      createdAt: params.nowIso,
    },
  ];
  policies.push({
    policyId: randomUUID(),
    tenantId: params.tenantId,
    subjectType: "employee",
    subjectId: params.employeeId,
    resourceType: "memory",
    resourceId: resolveSeatMemoryScopeId(params.seat.seatId),
    action: "read",
    effect: "allow",
    createdAt: params.nowIso,
  });
  policies.push({
    policyId: randomUUID(),
    tenantId: params.tenantId,
    subjectType: "employee",
    subjectId: params.employeeId,
    resourceType: "memory",
    resourceId: resolveSeatMemoryScopeId(params.seat.seatId),
    action: "write",
    effect: "allow",
    createdAt: params.nowIso,
  });
  for (const agentId of withEmployeeUniversalStewardAgentIds(params.seat.defaultAgentAssetIds)) {
    policies.push({
      policyId: randomUUID(),
      tenantId: params.tenantId,
      subjectType: "employee",
      subjectId: params.employeeId,
      resourceType: "agent",
      resourceId: agentId,
      action: "execute",
      effect: "allow",
      createdAt: params.nowIso,
    });
  }
  for (const spaceId of params.seat.defaultSpaceIds) {
    policies.push({
      policyId: randomUUID(),
      tenantId: params.tenantId,
      subjectType: "employee",
      subjectId: params.employeeId,
      resourceType: "space",
      resourceId: spaceId,
      action: "read",
      effect: "allow",
      createdAt: params.nowIso,
    });
  }
  for (const policy of policies) {
    params.store.accessPolicies[policy.policyId] = policy;
  }
}

function syncSeatAssetAccessPolicies(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seat: EnterprisePositionSeat;
  nowIso: string;
}) {
  const desired = new Set<string>([
    `seat:${params.seat.seatId}:read`,
    ...params.seat.defaultAgentAssetIds.map((agentId) => `agent:${agentId}:execute`),
    ...params.seat.defaultSpaceIds.map((spaceId) => `space:${spaceId}:read`),
    `memory:${resolveSeatMemoryScopeId(params.seat.seatId)}:read`,
    `memory:${resolveSeatMemoryScopeId(params.seat.seatId)}:write`,
  ]);
  for (const policy of Object.values(params.store.accessPolicies)) {
    if (
      policy.tenantId !== params.tenantId ||
      policy.subjectType !== "seat" ||
      policy.subjectId !== params.seat.seatId ||
      policy.revokedAt
    ) {
      continue;
    }
    const key = `${policy.resourceType}:${policy.resourceId}:${policy.action}`;
    const isManagedDefaultPolicy =
      (policy.resourceType === "seat" && policy.action === "read") ||
      (policy.resourceType === "agent" && policy.action === "execute") ||
      (policy.resourceType === "space" && policy.action === "read") ||
      (policy.resourceType === "memory" &&
        policy.resourceId === resolveSeatMemoryScopeId(params.seat.seatId) &&
        (policy.action === "read" || policy.action === "write"));
    if (isManagedDefaultPolicy && !desired.has(key)) {
      policy.revokedAt = params.nowIso;
    }
  }
  grantEnterpriseAccessPolicy({
    store: params.store,
    tenantId: params.tenantId,
    subjectType: "seat",
    subjectId: params.seat.seatId,
    resourceType: "seat",
    resourceId: params.seat.seatId,
    action: "read",
    nowIso: params.nowIso,
  });
  for (const agentId of params.seat.defaultAgentAssetIds) {
    grantEnterpriseAccessPolicy({
      store: params.store,
      tenantId: params.tenantId,
      subjectType: "seat",
      subjectId: params.seat.seatId,
      resourceType: "agent",
      resourceId: agentId,
      action: "execute",
      nowIso: params.nowIso,
    });
  }
  for (const spaceId of params.seat.defaultSpaceIds) {
    grantEnterpriseAccessPolicy({
      store: params.store,
      tenantId: params.tenantId,
      subjectType: "seat",
      subjectId: params.seat.seatId,
      resourceType: "space",
      resourceId: spaceId,
      action: "read",
      nowIso: params.nowIso,
    });
  }
  for (const action of ["read", "write"] as const) {
    grantEnterpriseAccessPolicy({
      store: params.store,
      tenantId: params.tenantId,
      subjectType: "seat",
      subjectId: params.seat.seatId,
      resourceType: "memory",
      resourceId: resolveSeatMemoryScopeId(params.seat.seatId),
      action,
      nowIso: params.nowIso,
    });
  }
}

export function startSeatHandoverForEmployee(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  employeeId: string;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): EnterpriseHandoverCase[] {
  const cases: EnterpriseHandoverCase[] = [];
  for (const binding of Object.values(params.store.bindings)) {
    if (
      binding.tenantId !== params.tenantId ||
      binding.employeeId !== params.employeeId ||
      binding.bindingStatus !== "active"
    ) {
      continue;
    }
    binding.bindingStatus = "revoked";
    binding.endedAt = params.nowIso;
    binding.endedReason = "offboarded";
    const seat = params.store.seats[binding.seatId];
    if (!seat) {
      continue;
    }
    seat.currentEmployeeId = undefined;
    seat.status = "handover_pending";
    seat.updatedAt = params.nowIso;
    const handoverCase: EnterpriseHandoverCase = {
      handoverCaseId: randomUUID(),
      tenantId: params.tenantId,
      seatId: seat.seatId,
      outgoingEmployeeId: params.employeeId,
      status: "frozen",
      reviewSummary: "Seat write access frozen pending successor rebind.",
      exceptionFlags: [],
      createdAt: params.nowIso,
      updatedAt: params.nowIso,
    };
    freezeSeatManagedAssetsForHandover({
      store: params.store,
      tenantId: params.tenantId,
      seatId: seat.seatId,
      handoverCaseId: handoverCase.handoverCaseId,
      outgoingEmployeeId: params.employeeId,
      nowIso: params.nowIso,
    });
    handoverCase.assetSnapshot = buildHandoverAssetSnapshot({
      store: params.store,
      tenantId: params.tenantId,
      seatId: seat.seatId,
      nowIso: params.nowIso,
    });
    params.store.handovers[handoverCase.handoverCaseId] = handoverCase;
    recordAuditEvent({
      store: params.store,
      tenantId: params.tenantId,
      eventType: "handover.started",
      nowIso: params.nowIso,
      auditId: params.auditId,
      actorEmployeeId: params.actorEmployeeId,
      seatId: seat.seatId,
      handoverCaseId: handoverCase.handoverCaseId,
      bindingId: binding.bindingId,
      metadata: {
        reason: "offboarded",
        outgoingEmployeeId: params.employeeId,
        frozenAssetCount: handoverCase.assetSnapshot.frozenAssetBindingIds.length,
        rebindRequiredAssetCount: handoverCase.assetSnapshot.rebindRequiredAssetBindingIds.length,
      },
    });
    cases.push(handoverCase);
  }
  revokeAccessPolicies({
    store: params.store,
    tenantId: params.tenantId,
    employeeId: params.employeeId,
    nowIso: params.nowIso,
  });
  invalidateCogniWeaveManagersForGovernanceChangeSync();
  return cases;
}

export function startSeatHandover(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  initiatedByEmployeeId?: string;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): EnterpriseHandoverCase {
  const seat = params.store.seats[params.seatId];
  if (!seat || seat.tenantId !== params.tenantId) {
    throw new Error("Seat not found.");
  }
  const activeBinding =
    Object.values(params.store.bindings)
      .filter(
        (binding) =>
          binding.tenantId === params.tenantId &&
          binding.seatId === params.seatId &&
          binding.bindingStatus === "active",
      )
      .toSorted((left, right) => right.effectiveAt.localeCompare(left.effectiveAt))[0] ?? null;
  if (!activeBinding) {
    throw new Error("Seat does not have an active employee binding.");
  }
  const existing =
    Object.values(params.store.handovers)
      .filter(
        (handover) =>
          handover.tenantId === params.tenantId &&
          handover.seatId === params.seatId &&
          handover.status !== "completed",
      )
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  if (existing) {
    return existing;
  }
  activeBinding.bindingStatus = "suspended";
  seat.currentEmployeeId = undefined;
  seat.status = "handover_pending";
  seat.updatedAt = params.nowIso;
  const handoverCase: EnterpriseHandoverCase = {
    handoverCaseId: randomUUID(),
    tenantId: params.tenantId,
    seatId: params.seatId,
    outgoingEmployeeId: params.initiatedByEmployeeId ?? activeBinding.employeeId,
    status: "draft",
    exceptionFlags: [],
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  };
  params.store.handovers[handoverCase.handoverCaseId] = handoverCase;
  recordAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "handover.started",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId,
    seatId: params.seatId,
    handoverCaseId: handoverCase.handoverCaseId,
    bindingId: activeBinding.bindingId,
    metadata: {
      reason: "manual",
      outgoingEmployeeId: activeBinding.employeeId,
    },
  });
  invalidateCogniWeaveManagersForGovernanceChangeSync();
  return handoverCase;
}

export function nominateSeatHandoverSuccessor(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  handoverCaseId: string;
  incomingEmployeeId: string;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): EnterpriseHandoverCase {
  const handover = params.store.handovers[params.handoverCaseId];
  if (!handover || handover.tenantId !== params.tenantId) {
    throw new Error("Handover case not found.");
  }
  if (handover.status === "completed") {
    throw new Error("Handover case is already completed.");
  }
  if (handover.status !== "draft" && handover.status !== "asset_review") {
    throw new Error("Handover case is not awaiting successor nomination.");
  }
  if (handover.incomingEmployeeId && handover.status === "asset_review") {
    throw new Error("Successor is already nominated.");
  }
  if (params.incomingEmployeeId === handover.outgoingEmployeeId) {
    throw new Error("Successor cannot be the outgoing employee.");
  }
  const seat = params.store.seats[handover.seatId];
  if (!seat) {
    throw new Error("Seat not found.");
  }
  handover.incomingEmployeeId = params.incomingEmployeeId;
  if (handover.status === "draft" || !handover.assetSnapshot) {
    freezeSeatManagedAssetsForHandover({
      store: params.store,
      tenantId: params.tenantId,
      seatId: handover.seatId,
      handoverCaseId: handover.handoverCaseId,
      outgoingEmployeeId: handover.outgoingEmployeeId,
      nowIso: params.nowIso,
    });
    handover.assetSnapshot = buildHandoverAssetSnapshot({
      store: params.store,
      tenantId: params.tenantId,
      seatId: handover.seatId,
      nowIso: params.nowIso,
    });
    revokeAccessPolicies({
      store: params.store,
      tenantId: params.tenantId,
      employeeId: handover.outgoingEmployeeId,
      nowIso: params.nowIso,
    });
  }
  handover.status = "asset_review";
  handover.updatedAt = params.nowIso;
  seat.status = "handover_pending";
  seat.updatedAt = params.nowIso;
  recordAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "handover.nominated",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId,
    seatId: handover.seatId,
    handoverCaseId: handover.handoverCaseId,
    metadata: {
      incomingEmployeeId: params.incomingEmployeeId,
      frozenAssetCount: handover.assetSnapshot?.frozenAssetBindingIds.length ?? 0,
      rebindRequiredAssetCount: handover.assetSnapshot?.rebindRequiredAssetBindingIds.length ?? 0,
    },
  });
  return handover;
}

export function reviewSeatHandover(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  handoverCaseId: string;
  reviewSummary: string;
  exceptionFlags?: string[];
  transferSelection?: EnterpriseHandoverTransferSelection;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): EnterpriseHandoverCase {
  const handover = params.store.handovers[params.handoverCaseId];
  if (!handover || handover.tenantId !== params.tenantId) {
    throw new Error("Handover case not found.");
  }
  if (handover.status === "completed") {
    throw new Error("Handover case is already completed.");
  }
  if (handover.status !== "asset_review") {
    throw new Error("Handover case is not in asset review.");
  }
  if (!handover.incomingEmployeeId?.trim()) {
    throw new Error("Nominate a successor before submitting asset review.");
  }
  handover.reviewSummary = params.reviewSummary.trim();
  handover.exceptionFlags = [...(params.exceptionFlags ?? [])];
  handover.status = "pending_approval";
  handover.updatedAt = params.nowIso;
  const seat = params.store.seats[handover.seatId];
  if (seat) {
    if (params.transferSelection) {
      assertHandoverTransferSelection({
        store: params.store,
        tenantId: params.tenantId,
        seat,
        selection: params.transferSelection,
      });
      handover.transferSelection = params.transferSelection;
      applyHandoverTransferSelection({
        store: params.store,
        tenantId: params.tenantId,
        seat,
        selection: params.transferSelection,
        nowIso: params.nowIso,
        actorEmployeeId: params.actorEmployeeId,
      });
    }
    seat.status = "frozen";
    seat.updatedAt = params.nowIso;
    handover.assetSnapshot = buildHandoverAssetSnapshot({
      store: params.store,
      tenantId: params.tenantId,
      seatId: seat.seatId,
      nowIso: params.nowIso,
      transferSelection: handover.transferSelection,
    });
  }
  recordAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "handover.reviewed",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId,
    seatId: handover.seatId,
    handoverCaseId: handover.handoverCaseId,
    metadata: {
      exceptionFlags: [...handover.exceptionFlags],
      ...(handover.transferSelection
        ? {
            transferAgentIds: [...handover.transferSelection.agentIds],
            transferSpaceIds: [...handover.transferSelection.spaceIds],
            transferDataKeys: [...handover.transferSelection.dataKeys],
            transferPolicyIds: [...handover.transferSelection.policyIds],
          }
        : {}),
    },
  });
  return handover;
}

export function approveSeatHandover(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  handoverCaseId: string;
  approvedBy: string;
  nowIso: string;
  auditId?: string;
}): EnterpriseHandoverCase {
  const handover = params.store.handovers[params.handoverCaseId];
  if (!handover || handover.tenantId !== params.tenantId) {
    throw new Error("Handover case not found.");
  }
  if (handover.status === "completed") {
    throw new Error("Handover case is already completed.");
  }
  handover.approvedBy = params.approvedBy;
  handover.status = "frozen";
  handover.updatedAt = params.nowIso;
  const seat = params.store.seats[handover.seatId];
  if (seat) {
    seat.status = "frozen";
    seat.updatedAt = params.nowIso;
    handover.assetSnapshot = buildHandoverAssetSnapshot({
      store: params.store,
      tenantId: params.tenantId,
      seatId: seat.seatId,
      nowIso: params.nowIso,
      transferSelection: handover.transferSelection,
    });
  }
  recordAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "handover.approved",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.approvedBy,
    seatId: handover.seatId,
    handoverCaseId: handover.handoverCaseId,
  });
  return handover;
}

export function completeSeatHandover(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  incomingEmployeeId: string;
  approvedBy?: string;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): EnterpriseHandoverCase | null {
  const handover =
    Object.values(params.store.handovers)
      .filter((entry) => entry.tenantId === params.tenantId && entry.seatId === params.seatId)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  if (!handover || handover.status === "completed") {
    return null;
  }
  handover.incomingEmployeeId = params.incomingEmployeeId;
  handover.status = "completed";
  handover.completedAt = params.nowIso;
  handover.updatedAt = params.nowIso;
  if (params.approvedBy) {
    handover.approvedBy = params.approvedBy;
  }
  reactivateSeatManagedAssetsAfterHandover({
    store: params.store,
    tenantId: params.tenantId,
    seatId: params.seatId,
    handoverCaseId: handover.handoverCaseId,
    nowIso: params.nowIso,
  });
  handover.assetSnapshot = buildHandoverAssetSnapshot({
    store: params.store,
    tenantId: params.tenantId,
    seatId: params.seatId,
    nowIso: params.nowIso,
    transferSelection: handover.transferSelection,
  });
  let sessionTransferMetadata: Record<string, unknown> | undefined;
  const sessionPlan = handover.assetSnapshot.sessionDataTransfer;
  if (sessionPlan.recentSessions || sessionPlan.historyArchive) {
    try {
      const execution = executeHandoverSessionDataTransfer({
        transfer: sessionPlan,
        tenantId: params.tenantId,
        outgoingEmployeeId: handover.outgoingEmployeeId,
      });
      handover.assetSnapshot = {
        ...handover.assetSnapshot,
        sessionDataTransfer: mergeHandoverSessionTransferExecution({
          plan: sessionPlan,
          execution,
          executedAt: params.nowIso,
        }),
      };
      sessionTransferMetadata = {
        archivedSessionIds: execution.archivedSessionIds,
        recentSessionIds: execution.recentSessionIds,
        archivedTranscriptCount: execution.archivedTranscriptPaths.length,
      };
    } catch {
      // Best-effort: handover completion must not fail when transcript archive is unavailable.
    }
  }
  recordAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "handover.completed",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId ?? params.approvedBy,
    seatId: params.seatId,
    handoverCaseId: handover.handoverCaseId,
    metadata: {
      incomingEmployeeId: params.incomingEmployeeId,
      connectorReauthorizationRequired:
        handover.assetSnapshot.rebindRequiredAssetBindingIds.length > 0 ||
        handover.assetSnapshot.credentialBindings.some(
          (credential) => credential.status === "reauthorization_required",
        ),
      ...sessionTransferMetadata,
    },
  });
  return handover;
}

export function createSeatAssignmentOffer(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  targetEmployeeId: string;
  offeredByEmployeeId: string;
  assignmentType?: "new_hire" | "internal";
  inheritMode?: "full" | "selective";
  agentIds?: string[];
  defaultSpaceIds?: string[];
  inheritMemoryScope?: boolean;
  handoverCaseId?: string;
  nowIso: string;
  expiresAt?: string;
  auditId?: string;
}): EnterpriseSeatAssignmentOffer {
  const seat = params.store.seats[params.seatId];
  if (!seat || seat.tenantId !== params.tenantId) {
    throw new Error("Seat not found.");
  }
  if (seat.status === "occupied") {
    throw new Error("Occupied seats cannot be offered for confirmation.");
  }
  supersedeRelatedPendingOffers({
    store: params.store,
    tenantId: params.tenantId,
    seatId: params.seatId,
    targetEmployeeId: params.targetEmployeeId,
    nowIso: params.nowIso,
  });
  const inheritMode = params.inheritMode === "selective" ? "selective" : "full";
  const selectedAgentIds =
    inheritMode === "selective"
      ? normalizePositionAgentAssetIds({
          defaultAgentId: undefined,
          agentIds: params.agentIds ?? [],
        })
      : [...seat.defaultAgentAssetIds];
  const selectedDefaultAgentId = selectedAgentIds[0] ?? null;
  const selectedSpaceIds =
    inheritMode === "selective"
      ? [...new Set((params.defaultSpaceIds ?? []).map((value) => value.trim()).filter(Boolean))]
      : [...seat.defaultSpaceIds];
  const shouldIncludeMemoryScope =
    inheritMode === "selective"
      ? params.inheritMemoryScope !== false && seat.memoryScopeEnabled !== false
      : seat.memoryScopeEnabled !== false;
  const offer: EnterpriseSeatAssignmentOffer = {
    assignmentId: randomUUID(),
    offerId: randomUUID(),
    tenantId: params.tenantId,
    seatId: params.seatId,
    targetEmployeeId: params.targetEmployeeId,
    offeredByEmployeeId: params.offeredByEmployeeId,
    assignmentType: params.assignmentType ?? "internal",
    status: "pending",
    inheritMode,
    previousSeatStatus: seat.status,
    ...(params.handoverCaseId ? { handoverCaseId: params.handoverCaseId } : {}),
    packageSnapshot: buildSeatAssignmentPackageSnapshot({
      store: params.store,
      tenantId: params.tenantId,
      seatId: seat.seatId,
      seatTitle: seat.title,
      defaultAgentId: selectedDefaultAgentId,
      agentIds: selectedAgentIds,
      defaultSpaceIds: selectedSpaceIds,
      includeMemoryScope: shouldIncludeMemoryScope,
    }),
    offeredAt: params.nowIso,
    updatedAt: params.nowIso,
    ...(params.expiresAt ? { expiresAt: params.expiresAt } : {}),
  };
  params.store.offers[offer.offerId] = offer;
  seat.status = "assigned";
  seat.updatedAt = params.nowIso;
  recordAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "assignment.created",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.offeredByEmployeeId,
    seatId: params.seatId,
    handoverCaseId: params.handoverCaseId,
    offerId: offer.offerId,
    metadata: {
      assignmentId: offer.assignmentId ?? offer.offerId,
      assignmentType: offer.assignmentType ?? "internal",
      targetEmployeeId: params.targetEmployeeId,
      inheritMode,
      reauthorizationRequired: Boolean(offer.packageSnapshot.reauthorizationRequired),
    },
  });
  return offer;
}

function applyOfferPackageToSeat(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  offer: EnterpriseSeatAssignmentOffer;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}) {
  const { agentIds } = resolvePositionAgentAssetPackage({
    defaultAgentId: params.offer.packageSnapshot.defaultAgentId,
    agentIds: params.offer.packageSnapshot.agentIds ?? [],
  });
  configureSeatProfile({
    store: params.store,
    tenantId: params.tenantId,
    seatId: params.seatId,
    defaultAgentId: agentIds[0] ?? null,
    agentIds,
    defaultSpaceIds: [...params.offer.packageSnapshot.defaultSpaceIds],
    memoryScopeEnabled: (params.offer.packageSnapshot.memoryScopeIds?.length ?? 0) > 0,
    nowIso: params.nowIso,
    actorEmployeeId: params.actorEmployeeId,
    auditId: params.auditId,
  });
}

export function cancelSeatAssignmentOffer(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  offerId: string;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): EnterpriseSeatAssignmentOffer {
  const offer = params.store.offers[params.offerId];
  if (!offer || offer.tenantId !== params.tenantId) {
    throw new Error("Seat assignment offer not found.");
  }
  if (offer.status !== "pending") {
    throw new Error("Only pending seat assignment offers can be canceled.");
  }
  restoreSeatStatusAfterPendingAssignment({
    store: params.store,
    offer,
    nowIso: params.nowIso,
  });
  offer.status = "canceled";
  offer.updatedAt = params.nowIso;
  offer.respondedAt = params.nowIso;
  recordAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "assignment.canceled",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId,
    seatId: offer.seatId,
    handoverCaseId: offer.handoverCaseId,
    offerId: offer.offerId,
  });
  return offer;
}

export function acceptSeatAssignmentOffer(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  offerId: string;
  employeeId: string;
  nowIso: string;
  auditId?: string;
}): EnterpriseSeatAssignmentOffer {
  const offer = params.store.offers[params.offerId];
  if (!offer || offer.tenantId !== params.tenantId) {
    throw new Error("Seat assignment offer not found.");
  }
  if (offer.targetEmployeeId !== params.employeeId) {
    throw new Error("This seat assignment offer is not available for the current employee.");
  }
  if (isOfferExpired(offer)) {
    restoreSeatStatusAfterPendingAssignment({
      store: params.store,
      offer,
      nowIso: params.nowIso,
    });
    offer.status = "expired";
    offer.updatedAt = params.nowIso;
    offer.respondedAt = params.nowIso;
    throw new Error("This seat assignment offer has expired.");
  }
  if (offer.status !== "pending") {
    throw new Error("This seat assignment offer is no longer pending.");
  }
  applyOfferPackageToSeat({
    store: params.store,
    tenantId: params.tenantId,
    seatId: offer.seatId,
    offer,
    nowIso: params.nowIso,
    actorEmployeeId: params.employeeId,
    auditId: params.auditId,
  });
  recordAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "asset.inheritance.applied",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.employeeId,
    seatId: offer.seatId,
    handoverCaseId: offer.handoverCaseId,
    offerId: offer.offerId,
    metadata: {
      assignmentId: offer.assignmentId ?? offer.offerId,
      assignmentType: offer.assignmentType ?? "internal",
      inheritMode: offer.inheritMode ?? "full",
      agentIds: offer.packageSnapshot.agentIds ?? [],
      defaultSpaceIds: [...offer.packageSnapshot.defaultSpaceIds],
      memoryScopeIds: [...(offer.packageSnapshot.memoryScopeIds ?? [])],
      connectorProfileIds: [...(offer.packageSnapshot.connectorProfileIds ?? [])],
    },
  });
  if (offer.packageSnapshot.connectorCredentialReauthorizationRequired) {
    recordAuditEvent({
      store: params.store,
      tenantId: params.tenantId,
      eventType: "credential.reauthorization.required",
      nowIso: params.nowIso,
      auditId: params.auditId,
      actorEmployeeId: params.employeeId,
      seatId: offer.seatId,
      handoverCaseId: offer.handoverCaseId,
      offerId: offer.offerId,
      metadata: {
        assignmentId: offer.assignmentId ?? offer.offerId,
        connectorProfileIds: [...(offer.packageSnapshot.connectorProfileIds ?? [])],
      },
    });
  }
  assignSeatToEmployee({
    store: params.store,
    tenantId: params.tenantId,
    seatId: offer.seatId,
    employeeId: params.employeeId,
    nowIso: params.nowIso,
    actorEmployeeId: params.employeeId,
    auditId: params.auditId,
  });
  completeSeatHandover({
    store: params.store,
    tenantId: params.tenantId,
    seatId: offer.seatId,
    incomingEmployeeId: params.employeeId,
    nowIso: params.nowIso,
    actorEmployeeId: params.employeeId,
    auditId: params.auditId,
  });
  offer.status = "accepted";
  offer.updatedAt = params.nowIso;
  offer.respondedAt = params.nowIso;
  supersedeRelatedPendingOffers({
    store: params.store,
    tenantId: params.tenantId,
    seatId: offer.seatId,
    exceptOfferId: offer.offerId,
    nowIso: params.nowIso,
  });
  recordAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "assignment.accepted",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.employeeId,
    seatId: offer.seatId,
    handoverCaseId: offer.handoverCaseId,
    offerId: offer.offerId,
  });
  return offer;
}

export function declineSeatAssignmentOffer(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  offerId: string;
  employeeId: string;
  nowIso: string;
  auditId?: string;
}): EnterpriseSeatAssignmentOffer {
  const offer = params.store.offers[params.offerId];
  if (!offer || offer.tenantId !== params.tenantId) {
    throw new Error("Seat assignment offer not found.");
  }
  if (offer.targetEmployeeId !== params.employeeId) {
    throw new Error("This seat assignment offer is not available for the current employee.");
  }
  if (isOfferExpired(offer)) {
    restoreSeatStatusAfterPendingAssignment({
      store: params.store,
      offer,
      nowIso: params.nowIso,
    });
    offer.status = "expired";
    offer.updatedAt = params.nowIso;
    offer.respondedAt = params.nowIso;
    throw new Error("This seat assignment offer has expired.");
  }
  if (offer.status !== "pending") {
    throw new Error("This seat assignment offer is no longer pending.");
  }
  restoreSeatStatusAfterPendingAssignment({
    store: params.store,
    offer,
    nowIso: params.nowIso,
  });
  offer.status = "declined";
  offer.updatedAt = params.nowIso;
  offer.respondedAt = params.nowIso;
  recordAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "assignment.declined",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.employeeId,
    seatId: offer.seatId,
    handoverCaseId: offer.handoverCaseId,
    offerId: offer.offerId,
  });
  return offer;
}

export function listTenantAccessPolicies(
  store: EnterpriseSeatAssetsStore,
  tenantId: string,
): EnterpriseAccessPolicy[] {
  return Object.values(store.accessPolicies)
    .filter((policy) => policy.tenantId === tenantId)
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function buildSeatAccessSnapshot(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
}): EnterpriseSeatAccessSnapshot {
  return {
    employeePolicies: Object.values(params.store.accessPolicies)
      .filter(
        (policy) =>
          policy.tenantId === params.tenantId &&
          policy.subjectType === "employee" &&
          !policy.revokedAt &&
          (policy.resourceId === params.seatId ||
            Object.values(params.store.bindings).some(
              (binding) =>
                binding.seatId === params.seatId &&
                binding.employeeId === policy.subjectId &&
                binding.bindingStatus === "active",
            )),
      )
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt)),
    seatPolicies: Object.values(params.store.accessPolicies)
      .filter(
        (policy) =>
          policy.tenantId === params.tenantId &&
          policy.subjectType === "seat" &&
          policy.subjectId === params.seatId &&
          !policy.revokedAt,
      )
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt)),
  };
}

export function grantEnterpriseAccessPolicy(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  subjectType: EnterpriseAccessSubjectType;
  subjectId: string;
  resourceType: EnterpriseAccessResourceType;
  resourceId: string;
  action: EnterpriseAccessAction;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): EnterpriseAccessPolicy {
  const existing =
    Object.values(params.store.accessPolicies)
      .filter(
        (policy) =>
          policy.tenantId === params.tenantId &&
          policy.subjectType === params.subjectType &&
          policy.subjectId === params.subjectId &&
          policy.resourceType === params.resourceType &&
          policy.resourceId === params.resourceId &&
          policy.action === params.action &&
          !policy.revokedAt,
      )
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  if (existing) {
    return existing;
  }
  const policy: EnterpriseAccessPolicy = {
    policyId: randomUUID(),
    tenantId: params.tenantId,
    subjectType: params.subjectType,
    subjectId: params.subjectId,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    action: params.action,
    effect: "allow",
    createdAt: params.nowIso,
  };
  params.store.accessPolicies[policy.policyId] = policy;
  recordAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "access.granted",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId,
    policyId: policy.policyId,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    metadata: {
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      action: params.action,
    },
  });
  return policy;
}

export function revokeEnterpriseAccessPolicy(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  subjectType: EnterpriseAccessSubjectType;
  subjectId: string;
  resourceType?: EnterpriseAccessResourceType;
  resourceId?: string;
  action?: EnterpriseAccessAction;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): EnterpriseAccessPolicy[] {
  const revoked = Object.values(params.store.accessPolicies).filter((policy) => {
    if (
      policy.tenantId !== params.tenantId ||
      policy.subjectType !== params.subjectType ||
      policy.subjectId !== params.subjectId ||
      policy.revokedAt
    ) {
      return false;
    }
    if (params.resourceType && policy.resourceType !== params.resourceType) {
      return false;
    }
    if (params.resourceId && policy.resourceId !== params.resourceId) {
      return false;
    }
    if (params.action && policy.action !== params.action) {
      return false;
    }
    return true;
  });
  for (const policy of revoked) {
    policy.revokedAt = params.nowIso;
    recordAuditEvent({
      store: params.store,
      tenantId: params.tenantId,
      eventType: "access.revoked",
      nowIso: params.nowIso,
      auditId: params.auditId,
      actorEmployeeId: params.actorEmployeeId,
      policyId: policy.policyId,
      resourceType: policy.resourceType,
      resourceId: policy.resourceId,
      metadata: {
        subjectType: policy.subjectType,
        subjectId: policy.subjectId,
        action: policy.action,
      },
    });
  }
  return revoked;
}

export function releaseSeatToVacant(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}) {
  const seat = params.store.seats[params.seatId];
  if (!seat || seat.tenantId !== params.tenantId) {
    throw new Error("Seat not found.");
  }
  seat.currentEmployeeId = undefined;
  seat.status = "vacant";
  seat.updatedAt = params.nowIso;
  revokeSeatAccessPolicies({
    store: params.store,
    tenantId: params.tenantId,
    seatId: params.seatId,
    nowIso: params.nowIso,
  });
  recordAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "seat.released",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId,
    seatId: params.seatId,
  });
  invalidateCogniWeaveManagersForGovernanceChangeSync();
}

export function registerConnectorCredentialBinding(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  connectorId: string;
  ownerType: "employee" | "seat";
  ownerId: string;
  nowIso: string;
  createdBy?: string;
  auditId?: string;
  /** When true, always mint a new binding (supports multi-account per connector). */
  allowMultiple?: boolean;
}): EnterpriseConnectorCredentialBinding {
  if (!params.allowMultiple) {
    const existing =
      Object.values(params.store.credentialBindings)
        .filter(
          (binding) =>
            binding.tenantId === params.tenantId &&
            binding.connectorId === params.connectorId &&
            binding.ownerType === params.ownerType &&
            binding.ownerId === params.ownerId &&
            binding.status === "active",
        )
        .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
    if (existing) {
      return existing;
    }
  }
  const binding: EnterpriseConnectorCredentialBinding = {
    credentialBindingId: randomUUID(),
    tenantId: params.tenantId,
    connectorId: params.connectorId,
    ownerType: params.ownerType,
    ownerId: params.ownerId,
    status: "active",
    ...(params.createdBy ? { createdBy: params.createdBy } : {}),
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  };
  params.store.credentialBindings[binding.credentialBindingId] = binding;
  if (params.ownerType === "seat") {
    attachSeatManagedAsset({
      store: params.store,
      tenantId: params.tenantId,
      seatId: params.ownerId,
      assetType: "connector",
      assetId: params.connectorId,
      source: "manual",
      requiresReauthorization: true,
      nowIso: params.nowIso,
      createdBy: params.createdBy,
      auditId: params.auditId,
    });
  }
  recordAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "credential.registered",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.createdBy,
    resourceType: "connector",
    resourceId: params.connectorId,
    metadata: {
      ownerType: params.ownerType,
      ownerId: params.ownerId,
    },
  });
  return binding;
}

export function revokeConnectorCredentialBindings(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  ownerType?: "employee" | "seat";
  ownerId?: string;
  connectorId?: string;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
  reason?: EnterpriseConnectorCredentialBinding["revokedReason"];
}): EnterpriseConnectorCredentialBinding[] {
  const revoked = Object.values(params.store.credentialBindings).filter((binding) => {
    if (binding.tenantId !== params.tenantId || binding.status === "revoked") {
      return false;
    }
    if (params.ownerType && binding.ownerType !== params.ownerType) {
      return false;
    }
    if (params.ownerId && binding.ownerId !== params.ownerId) {
      return false;
    }
    if (params.connectorId && binding.connectorId !== params.connectorId) {
      return false;
    }
    return true;
  });
  for (const binding of revoked) {
    binding.status = "revoked";
    binding.revokedAt = params.nowIso;
    binding.revokedReason = params.reason ?? "manual";
    binding.updatedAt = params.nowIso;
    recordAuditEvent({
      store: params.store,
      tenantId: params.tenantId,
      eventType: "credential.revoked",
      nowIso: params.nowIso,
      auditId: params.auditId,
      actorEmployeeId: params.actorEmployeeId,
      resourceType: "connector",
      resourceId: binding.connectorId,
      metadata: {
        ownerType: binding.ownerType,
        ownerId: binding.ownerId,
        reason: binding.revokedReason ?? null,
      },
    });
  }
  return revoked;
}

/**
 * Seat-granted agent asset ids for an employee: defaultAgentAssetIds ∪ active
 * agent assetBindings. Ownership-store records are merged separately by callers
 * (resolveEmployeeWorkbenchActor / buildPlatformEmployeeAccess).
 */
export function resolveSeatGrantedAgentAssetIds(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seat: Pick<EnterprisePositionSeat, "seatId" | "defaultAgentAssetIds">;
}): string[] {
  const ids = new Set<string>();
  for (const agentId of params.seat.defaultAgentAssetIds) {
    const trimmed = agentId?.trim();
    if (trimmed) {
      ids.add(trimmed);
    }
  }
  for (const binding of listActiveSeatAssetBindings({
    store: params.store,
    tenantId: params.tenantId,
    seatId: params.seat.seatId,
  })) {
    if (binding.assetType !== "agent" || binding.status !== "active") {
      continue;
    }
    const assetId = binding.assetId?.trim();
    if (assetId) {
      ids.add(assetId);
    }
  }
  return [...ids].toSorted((left, right) => left.localeCompare(right));
}

export function buildEmployeeAccessSnapshot(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  employeeId: string;
}): EnterpriseEmployeeAccessSnapshot {
  const pendingOffer =
    Object.values(params.store.offers)
      .filter(
        (entry) =>
          entry.tenantId === params.tenantId &&
          entry.targetEmployeeId === params.employeeId &&
          entry.status === "pending" &&
          !isOfferExpired(entry),
      )
      .toSorted((left, right) => right.offeredAt.localeCompare(left.offeredAt))[0] ?? null;
  const binding =
    Object.values(params.store.bindings)
      .filter(
        (entry) =>
          entry.tenantId === params.tenantId &&
          entry.employeeId === params.employeeId &&
          entry.bindingStatus === "active",
      )
      .toSorted((left, right) => right.effectiveAt.localeCompare(left.effectiveAt))[0] ?? null;
  if (!binding) {
    return {
      currentSeat: null,
      defaultAgentId: null,
      agentIds: [],
      defaultSpaceIds: [],
      memoryScopeIds: [],
      connectorIds: [],
      pendingOffer: pendingOffer ? buildPendingSeatOfferSnapshot(pendingOffer) : null,
      notice: pendingOffer
        ? "A seat assignment is waiting for your confirmation."
        : "No active enterprise seat is currently bound to this account.",
    };
  }
  const seat = params.store.seats[binding.seatId];
  if (!seat) {
    return {
      currentSeat: null,
      defaultAgentId: null,
      agentIds: [],
      defaultSpaceIds: [],
      memoryScopeIds: [],
      connectorIds: [],
      pendingOffer: null,
      notice: "The bound enterprise seat could not be found.",
    };
  }
  const seatAgentAssetIds = resolveSeatGrantedAgentAssetIds({
    store: params.store,
    tenantId: params.tenantId,
    seat,
  });
  return {
    currentSeat: {
      seatId: seat.seatId,
      title: seat.title,
      status: seat.status,
      bindingStatus: binding.bindingStatus,
    },
    defaultAgentId: seat.defaultAgentAssetIds[0] ?? seatAgentAssetIds[0] ?? null,
    agentIds: withEmployeeUniversalStewardAgentIds(seatAgentAssetIds),
    defaultSpaceIds: [...seat.defaultSpaceIds],
    memoryScopeIds: listActiveSeatAssetBindings({
      store: params.store,
      tenantId: params.tenantId,
      seatId: seat.seatId,
    })
      .filter((assetBinding) => assetBinding.assetType === "memory")
      .map((assetBinding) => assetBinding.assetId)
      .toSorted(),
    connectorIds: listActiveSeatAssetBindings({
      store: params.store,
      tenantId: params.tenantId,
      seatId: seat.seatId,
    })
      .filter((assetBinding) => assetBinding.assetType === "connector")
      .map((assetBinding) => assetBinding.assetId)
      .toSorted(),
    pendingOffer: pendingOffer ? buildPendingSeatOfferSnapshot(pendingOffer) : null,
    notice:
      seat.status === "frozen" || seat.status === "handover_pending"
        ? "This seat is in handover mode. Some enterprise assets may be read-only."
        : null,
  };
}

export function listTenantSeats(
  store: EnterpriseSeatAssetsStore,
  tenantId: string,
): EnterprisePositionSeat[] {
  return Object.values(store.seats)
    .filter((seat) => seat.tenantId === tenantId)
    .toSorted((left, right) => left.title.localeCompare(right.title));
}

export function listTenantHandovers(
  store: EnterpriseSeatAssetsStore,
  tenantId: string,
): EnterpriseHandoverCase[] {
  return Object.values(store.handovers)
    .filter((handover) => handover.tenantId === tenantId)
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function listTenantSeatAssignmentOffers(
  store: EnterpriseSeatAssetsStore,
  tenantId: string,
): EnterpriseSeatAssignmentOffer[] {
  const now = Date.now();
  return Object.values(store.offers)
    .map((offer) => {
      if (offer.tenantId === tenantId && offer.status === "pending" && isOfferExpired(offer, now)) {
        return {
          ...offer,
          status: "expired" as const,
        };
      }
      return offer;
    })
    .filter((offer) => offer.tenantId === tenantId)
    .toSorted((left, right) => right.offeredAt.localeCompare(left.offeredAt));
}

export function listTenantAssetAuditEvents(
  store: EnterpriseSeatAssetsStore,
  tenantId: string,
): EnterpriseAssetAuditEvent[] {
  return Object.values(store.auditEvents)
    .filter((event) => event.tenantId === tenantId)
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export {
  attachSeatManagedAsset,
  buildSeatConnectorProfileSnapshots,
  buildSeatMemoryScopeSnapshots,
  listTenantSeatAssetBindings,
  reactivateSeatManagedAssetsAfterHandover,
  resolveSeatMemoryScopeId,
  validateEnterpriseAssetGovernance,
};
