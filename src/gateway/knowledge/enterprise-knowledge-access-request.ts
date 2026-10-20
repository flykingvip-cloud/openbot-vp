/**
 * Durable enterprise knowledge projection access requests via governance approval center.
 *
 * Subject id format: `ekp:{seatId}:{projectionId}` (seatId has no `:` by convention).
 * On approve, the seat is added to every KnowledgeVisibilityPolicy for that projection
 * (or a seat-only policy is created when none exist). Open bindings without a policy
 * stay open — we never attach a new restrictive policy to unrestricted bindings.
 */

import { EnterpriseDataStoreError } from "../enterprise-data/connector-action-store.js";
import { createGovernanceApprovalRequest } from "../enterprise-data/governance-approval-store.js";
import {
  evaluateKnowledgeVisibility,
  listKnowledgeVisibilityPolicies,
  upsertKnowledgeVisibilityPolicy,
} from "../enterprise-data/knowledge-visibility-policy-store.js";
import { findEnterpriseKnowledgeProjectionSpec } from "../enterprise-data/projection-spec-store.js";
import type {
  EnterpriseDataStore,
  GovernanceApprovalRequest,
  KnowledgeVisibilityPolicy,
} from "../enterprise-data/types.js";

export const ENTERPRISE_KNOWLEDGE_ACCESS_SUBJECT_PREFIX = "ekp:";

export function buildEnterpriseKnowledgeAccessSubjectId(
  seatId: string,
  projectionId: string,
): string {
  return `${ENTERPRISE_KNOWLEDGE_ACCESS_SUBJECT_PREFIX}${seatId.trim()}:${projectionId.trim()}`;
}

export function parseEnterpriseKnowledgeAccessSubjectId(
  subjectId: string,
): { seatId: string; projectionId: string } | null {
  if (!subjectId.startsWith(ENTERPRISE_KNOWLEDGE_ACCESS_SUBJECT_PREFIX)) {
    return null;
  }
  const payload = subjectId.slice(ENTERPRISE_KNOWLEDGE_ACCESS_SUBJECT_PREFIX.length);
  const separator = payload.indexOf(":");
  if (separator <= 0) {
    return null;
  }
  const seatId = payload.slice(0, separator).trim();
  const projectionId = payload.slice(separator + 1).trim();
  if (!seatId || !projectionId) {
    return null;
  }
  return { seatId, projectionId };
}

export function hasPendingEnterpriseKnowledgeAccess(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  seatId: string;
  projectionId: string;
}): boolean {
  const subjectId = buildEnterpriseKnowledgeAccessSubjectId(params.seatId, params.projectionId);
  return Object.values(params.store.governanceApprovalRequests).some(
    (request) =>
      request.tenantId === params.tenantId &&
      request.category === "enterprise_knowledge_access" &&
      request.subjectId === subjectId &&
      request.status === "pending",
  );
}

/**
 * Grant seat-level visibility to an enterprise knowledge projection by updating
 * (or creating) KnowledgeVisibilityPolicy rows. Returns the number of policies
 * written.
 */
export function grantEnterpriseKnowledgeAccessToSeat(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  seatId: string;
  projectionId: string;
  nowIso: string;
}): number {
  const seatId = params.seatId.trim();
  const projectionId = params.projectionId.trim();
  if (!seatId || !projectionId) {
    throw new EnterpriseDataStoreError(
      "INVALID_REQUEST",
      "seatId and projectionId are required for enterprise knowledge access grant.",
    );
  }
  const spec = findEnterpriseKnowledgeProjectionSpec(params.store, params.tenantId, projectionId);
  if (!spec) {
    throw new EnterpriseDataStoreError(
      "ENTERPRISE_KNOWLEDGE_PROJECTION_NOT_FOUND",
      "Enterprise knowledge projection not found for this tenant.",
    );
  }

  const existing = listKnowledgeVisibilityPolicies({
    store: params.store,
    tenantId: params.tenantId,
    projectionId,
  });

  if (existing.length === 0) {
    upsertKnowledgeVisibilityPolicy({
      store: params.store,
      tenantId: params.tenantId,
      nowIso: params.nowIso,
      policy: {
        projectionId,
        visibleSeats: [seatId],
        visibleTeams: [],
        visibleDepartments: [],
        visibleRoles: [],
        visibleAgentTypes: [],
      },
    });
    return 1;
  }

  let written = 0;
  for (const policy of existing) {
    if (policy.visibleSeats.includes(seatId)) {
      continue;
    }
    upsertKnowledgeVisibilityPolicy({
      store: params.store,
      tenantId: params.tenantId,
      nowIso: params.nowIso,
      policy: {
        policyId: policy.policyId,
        projectionId: policy.projectionId,
        visibleSeats: [...policy.visibleSeats, seatId],
        visibleTeams: [...policy.visibleTeams],
        visibleDepartments: [...(policy.visibleDepartments ?? [])],
        visibleRoles: [...(policy.visibleRoles ?? [])],
        visibleAgentTypes: [...(policy.visibleAgentTypes ?? [])],
      },
    });
    written += 1;
  }
  // Idempotent re-approve: seat already present on every policy.
  return written > 0 ? written : existing.length;
}

/** True when the seat is already listed on at least one visibility policy for the projection. */
export function isEnterpriseKnowledgeAccessGranted(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  seatId: string;
  projectionId: string;
}): boolean {
  const policies = listKnowledgeVisibilityPolicies({
    store: params.store,
    tenantId: params.tenantId,
    projectionId: params.projectionId,
  });
  if (policies.length === 0) {
    return false;
  }
  return policies.some((policy: KnowledgeVisibilityPolicy) =>
    evaluateKnowledgeVisibility({
      policy,
      context: { seatId: params.seatId },
    }),
  );
}

export function createEnterpriseKnowledgeAccessRequest(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  seatId: string;
  projectionId: string;
  projectionTitle: string;
  requestedBy: string;
  reason?: string;
  nowIso: string;
}): GovernanceApprovalRequest {
  const projectionId = params.projectionId.trim();
  const seatId = params.seatId.trim();
  if (!projectionId || !seatId) {
    throw new EnterpriseDataStoreError(
      "INVALID_REQUEST",
      "projectionId and seatId are required for enterprise knowledge access request.",
    );
  }
  const spec = findEnterpriseKnowledgeProjectionSpec(params.store, params.tenantId, projectionId);
  if (!spec) {
    throw new EnterpriseDataStoreError(
      "ENTERPRISE_KNOWLEDGE_PROJECTION_NOT_FOUND",
      "Enterprise knowledge projection not found for this tenant.",
    );
  }
  if (
    hasPendingEnterpriseKnowledgeAccess({
      store: params.store,
      tenantId: params.tenantId,
      seatId,
      projectionId,
    })
  ) {
    throw new EnterpriseDataStoreError(
      "GOVERNANCE_APPROVAL_DUPLICATE",
      "A pending enterprise knowledge access request already exists for this seat and projection.",
    );
  }
  const subjectId = buildEnterpriseKnowledgeAccessSubjectId(seatId, projectionId);
  return createGovernanceApprovalRequest({
    store: params.store,
    tenantId: params.tenantId,
    category: "enterprise_knowledge_access",
    subjectId,
    requestedBy: params.requestedBy,
    reason:
      params.reason ??
      `员工申请企业知识投影：${params.projectionTitle || spec.displayName || projectionId}`,
    nowIso: params.nowIso,
    requesterSeatId: seatId,
    displayName: params.projectionTitle || spec.displayName || "企业知识",
  });
}
