import { EnterpriseDataStoreError } from "../enterprise-data/connector-action-store.js";
import { findDataCapability } from "../enterprise-data/data-capability-store.js";
import { createGovernanceApprovalRequest } from "../enterprise-data/governance-approval-store.js";
import { upsertSeatActionGrant } from "../enterprise-data/seat-action-grant-store.js";
import type { EnterpriseDataStore, GovernanceApprovalRequest } from "../enterprise-data/types.js";

export const SEAT_CAPABILITY_SUBJECT_PREFIX = "seat-capability:";

export function buildSeatCapabilitySubjectId(seatId: string, capabilityId: string): string {
  return `${SEAT_CAPABILITY_SUBJECT_PREFIX}${seatId}::${capabilityId}`;
}

export function parseSeatCapabilitySubjectId(
  subjectId: string,
): { seatId: string; capabilityId: string } | null {
  if (!subjectId.startsWith(SEAT_CAPABILITY_SUBJECT_PREFIX)) {
    return null;
  }
  const payload = subjectId.slice(SEAT_CAPABILITY_SUBJECT_PREFIX.length);
  const separator = payload.indexOf("::");
  if (separator <= 0) {
    return null;
  }
  const seatId = payload.slice(0, separator);
  const capabilityId = payload.slice(separator + 2);
  if (!seatId || !capabilityId) {
    return null;
  }
  return { seatId, capabilityId };
}

export function grantDataCapabilityToSeat(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  seatId: string;
  capabilityId: string;
  nowIso: string;
}): number {
  const capability = findDataCapability(params.store, params.tenantId, params.capabilityId);
  if (!capability) {
    throw new EnterpriseDataStoreError("DATA_CAPABILITY_NOT_FOUND", "DataCapability not found.");
  }
  if (!capability.enabled) {
    throw new EnterpriseDataStoreError(
      "DATA_CAPABILITY_DISABLED",
      "DataCapability is not enabled for employee access.",
    );
  }
  let grantCount = 0;
  for (const ref of capability.actionRefs) {
    upsertSeatActionGrant({
      store: params.store,
      tenantId: params.tenantId,
      seatId: params.seatId,
      connectorId: ref.connectorId,
      actionKey: ref.actionKey,
      version: ref.version,
      nowIso: params.nowIso,
    });
    grantCount += 1;
  }
  return grantCount;
}

export function hasPendingSeatCapabilityAccess(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  seatId: string;
  capabilityId: string;
}): boolean {
  const subjectId = buildSeatCapabilitySubjectId(params.seatId, params.capabilityId);
  return Object.values(params.store.governanceApprovalRequests).some(
    (request) =>
      request.tenantId === params.tenantId &&
      request.category === "seat_capability_access" &&
      request.subjectId === subjectId &&
      request.status === "pending",
  );
}

export function createSeatCapabilityAccessRequest(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  seatId: string;
  capabilityId: string;
  capabilityTitle: string;
  requestedBy: string;
  reason?: string;
  nowIso: string;
}): GovernanceApprovalRequest {
  const capability = findDataCapability(params.store, params.tenantId, params.capabilityId);
  if (!capability) {
    throw new EnterpriseDataStoreError("DATA_CAPABILITY_NOT_FOUND", "DataCapability not found.");
  }
  if (!capability.enabled) {
    throw new EnterpriseDataStoreError(
      "DATA_CAPABILITY_DISABLED",
      "DataCapability is not enabled for employee access.",
    );
  }
  if (hasPendingSeatCapabilityAccess(params)) {
    throw new EnterpriseDataStoreError(
      "GOVERNANCE_APPROVAL_DUPLICATE",
      "A pending access request already exists for this capability.",
    );
  }
  const subjectId = buildSeatCapabilitySubjectId(params.seatId, params.capabilityId);
  return createGovernanceApprovalRequest({
    store: params.store,
    tenantId: params.tenantId,
    category: "seat_capability_access",
    subjectId,
    requestedBy: params.requestedBy,
    reason: params.reason ?? `员工申请数据能力：${params.capabilityTitle}`,
    nowIso: params.nowIso,
    requesterSeatId: params.seatId,
    displayName: params.capabilityTitle.trim() || capability.displayName,
  });
}
