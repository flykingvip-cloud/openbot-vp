import { randomUUID } from "node:crypto";
import {
  grantEnterpriseKnowledgeAccessToSeat,
  parseEnterpriseKnowledgeAccessSubjectId,
} from "../knowledge/enterprise-knowledge-access-request.js";
import {
  grantDataCapabilityToSeat,
  parseSeatCapabilitySubjectId,
} from "../knowledge/seat-capability-access.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { compileDataAccessPolicy } from "./data-access-policy-store.js";
import { findDataCapability } from "./data-capability-store.js";
import { findDataSource } from "./data-source-store.js";
import {
  describeGovernanceProvisionFailure,
  provisionMcpToolMappingApproval,
} from "./mcp-approval-provision.js";
import type {
  EnterpriseDataStore,
  GovernanceApprovalCategory,
  GovernanceApprovalCenterOverview,
  GovernanceApprovalFulfillmentMode,
  GovernanceApprovalFulfillmentStatus,
  GovernanceApprovalRequest,
  GovernanceApprovalReviewState,
  GovernanceApprovalStatus,
  GovernanceApprovalSubjectKind,
} from "./types.js";

/**
 * Capability-access categories. mcp_tool_mapping may provision only when the
 * admin explicitly chooses approve_and_provision. oi_enrollment and
 * pack_skill_review stay intent-only: OI must not write credentials here, and
 * pack install is not an existing safe authorize API.
 */
const INTENT_ONLY_ON_APPROVE = new Set<GovernanceApprovalCategory>([
  "mcp_tool_mapping",
  "oi_enrollment",
  "pack_skill_review",
]);

const PROVISION_ON_DECIDE = new Set<GovernanceApprovalCategory>(["mcp_tool_mapping"]);

const CATEGORY_SUBJECT_KIND: Record<GovernanceApprovalCategory, GovernanceApprovalSubjectKind> = {
  source_onboarding: "data_source",
  data_access: "data_access_policy",
  capability_exposure: "data_capability",
  identity_binding: "operational_identity_binding",
  seat_capability_access: "seat_capability_access",
  enterprise_knowledge_access: "enterprise_knowledge_projection",
  mcp_tool_mapping: "mcp_tool_mapping",
  oi_enrollment: "oi_enrollment",
  pack_skill_review: "pack_skill_review",
};

export function listGovernanceApprovalRequests(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  category?: GovernanceApprovalCategory;
  status?: GovernanceApprovalStatus;
  requestedBy?: string;
  limit?: number;
}): GovernanceApprovalRequest[] {
  return Object.values(params.store.governanceApprovalRequests)
    .filter((request) => {
      if (request.tenantId !== params.tenantId) {
        return false;
      }
      if (params.category && request.category !== params.category) {
        return false;
      }
      if (params.status && request.status !== params.status) {
        return false;
      }
      if (params.requestedBy && request.requestedBy !== params.requestedBy) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => right.requestedAt.localeCompare(left.requestedAt))
    .slice(0, params.limit ?? 100);
}

export function findGovernanceApprovalRequest(
  store: EnterpriseDataStore,
  tenantId: string,
  approvalId: string,
): GovernanceApprovalRequest | null {
  const request = store.governanceApprovalRequests[approvalId];
  if (!request || request.tenantId !== tenantId) {
    return null;
  }
  return request;
}

function resolveSubjectDisplayName(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  category: GovernanceApprovalCategory;
  subjectId: string;
}): string {
  if (params.category === "source_onboarding") {
    const source = findDataSource(params.store, params.tenantId, params.subjectId);
    if (!source) {
      throw new EnterpriseDataStoreError("DATA_SOURCE_NOT_FOUND", "DataSource not found.");
    }
    return source.displayName;
  }
  if (params.category === "data_access") {
    const policy = params.store.dataAccessPolicies[params.subjectId];
    if (!policy || policy.tenantId !== params.tenantId) {
      throw new EnterpriseDataStoreError(
        "DATA_ACCESS_POLICY_NOT_FOUND",
        "DataAccessPolicy not found.",
      );
    }
    return policy.displayName;
  }
  if (params.category === "identity_binding") {
    // 身份绑定的权威记录在 EnterpriseSeatAssetsStore（跨库），不在 enterprise-data store。
    // 此处不做跨库存在性校验；可见名不用 subjectId，避免把用户编号写进审批列表。
    return "身份绑定";
  }
  if (params.category === "seat_capability_access") {
    const parsed = parseSeatCapabilitySubjectId(params.subjectId);
    if (!parsed) {
      return "数据能力";
    }
    const capability = findDataCapability(params.store, params.tenantId, parsed.capabilityId);
    return capability?.displayName ?? "数据能力";
  }
  if (params.category === "enterprise_knowledge_access") {
    return "企业知识";
  }
  if (params.category === "mcp_tool_mapping") {
    return "MCP 工具映射";
  }
  if (params.category === "oi_enrollment") {
    return "运营身份开通";
  }
  if (params.category === "pack_skill_review") {
    return "Pack 技能审核";
  }
  const capability = findDataCapability(params.store, params.tenantId, params.subjectId);
  if (!capability) {
    throw new EnterpriseDataStoreError("DATA_CAPABILITY_NOT_FOUND", "DataCapability not found.");
  }
  return capability.displayName;
}

function assertNoDuplicatePending(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  category: GovernanceApprovalCategory;
  subjectId: string;
  requestedBy?: string;
  duplicateScope?: "per_subject" | "per_requester";
}): void {
  const scope = params.duplicateScope ?? "per_subject";
  const duplicate = Object.values(params.store.governanceApprovalRequests).find((request) => {
    if (
      request.tenantId !== params.tenantId ||
      request.category !== params.category ||
      request.subjectId !== params.subjectId ||
      request.status !== "pending"
    ) {
      return false;
    }
    if (scope === "per_requester") {
      return Boolean(params.requestedBy) && request.requestedBy === params.requestedBy;
    }
    return true;
  });
  if (duplicate) {
    throw new EnterpriseDataStoreError(
      "GOVERNANCE_APPROVAL_DUPLICATE",
      "A pending governance approval already exists for this subject.",
    );
  }
}

export function createGovernanceApprovalRequest(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  category: GovernanceApprovalCategory;
  subjectId: string;
  requestedBy: string;
  reason?: string;
  nowIso: string;
  requesterSeatId?: string;
  displayName?: string;
  subjectPayload?: Record<string, unknown>;
  clientRequestId?: string;
  catalogId?: string;
  templateId?: string;
  reviewState?: GovernanceApprovalReviewState;
  fulfillmentStatus?: GovernanceApprovalFulfillmentStatus;
  duplicateScope?: "per_subject" | "per_requester";
}): GovernanceApprovalRequest {
  const subjectKind = CATEGORY_SUBJECT_KIND[params.category];
  const displayName =
    params.displayName ??
    resolveSubjectDisplayName({
      store: params.store,
      tenantId: params.tenantId,
      category: params.category,
      subjectId: params.subjectId,
    });
  assertNoDuplicatePending({
    store: params.store,
    tenantId: params.tenantId,
    category: params.category,
    subjectId: params.subjectId,
    requestedBy: params.requestedBy,
    duplicateScope: params.duplicateScope,
  });
  const request: GovernanceApprovalRequest = {
    approvalId: randomUUID(),
    tenantId: params.tenantId,
    category: params.category,
    subjectKind,
    subjectId: params.subjectId,
    displayName,
    requestedBy: params.requestedBy,
    requestedAt: params.nowIso,
    status: "pending",
    reason: params.reason,
    ...(params.requesterSeatId ? { requesterSeatId: params.requesterSeatId } : {}),
    ...(params.subjectPayload ? { subjectPayload: { ...params.subjectPayload } } : {}),
    ...(params.clientRequestId ? { clientRequestId: params.clientRequestId } : {}),
    ...(params.catalogId ? { catalogId: params.catalogId } : {}),
    ...(params.templateId ? { templateId: params.templateId } : {}),
    ...(params.reviewState ? { reviewState: params.reviewState } : {}),
    ...(params.fulfillmentStatus ? { fulfillmentStatus: params.fulfillmentStatus } : {}),
  };
  params.store.governanceApprovalRequests[request.approvalId] = request;
  return request;
}

function applyGovernanceApprovalEffect(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  request: GovernanceApprovalRequest;
  nowIso: string;
}): void {
  if (params.request.category === "source_onboarding") {
    const source = findDataSource(params.store, params.tenantId, params.request.subjectId);
    if (!source) {
      throw new EnterpriseDataStoreError("DATA_SOURCE_NOT_FOUND", "DataSource not found.");
    }
    source.status = "connected";
    source.updatedAt = params.nowIso;
    return;
  }
  if (params.request.category === "data_access") {
    compileDataAccessPolicy({
      store: params.store,
      tenantId: params.tenantId,
      policyId: params.request.subjectId,
      nowIso: params.nowIso,
    });
    return;
  }
  if (params.request.category === "seat_capability_access") {
    const parsed = parseSeatCapabilitySubjectId(params.request.subjectId);
    if (!parsed) {
      throw new EnterpriseDataStoreError(
        "GOVERNANCE_APPROVAL_INVALID_SUBJECT",
        "Invalid seat capability access subject.",
      );
    }
    grantDataCapabilityToSeat({
      store: params.store,
      tenantId: params.tenantId,
      seatId: parsed.seatId,
      capabilityId: parsed.capabilityId,
      nowIso: params.nowIso,
    });
    return;
  }
  if (params.request.category === "capability_exposure") {
    const capability = findDataCapability(params.store, params.tenantId, params.request.subjectId);
    if (!capability) {
      throw new EnterpriseDataStoreError("DATA_CAPABILITY_NOT_FOUND", "DataCapability not found.");
    }
    capability.enabled = true;
    capability.updatedAt = params.nowIso;
    return;
  }
  if (params.request.category === "identity_binding") {
    return;
  }
  if (params.request.category === "enterprise_knowledge_access") {
    const parsed = parseEnterpriseKnowledgeAccessSubjectId(params.request.subjectId);
    if (!parsed) {
      throw new EnterpriseDataStoreError(
        "GOVERNANCE_APPROVAL_INVALID_SUBJECT",
        "Invalid enterprise knowledge access subject.",
      );
    }
    const seatId = params.request.requesterSeatId?.trim() || parsed.seatId;
    grantEnterpriseKnowledgeAccessToSeat({
      store: params.store,
      tenantId: params.tenantId,
      seatId,
      projectionId: parsed.projectionId,
      nowIso: params.nowIso,
    });
    return;
  }
}

function applyExplicitMcpProvision(
  request: GovernanceApprovalRequest,
  params: {
    store: EnterpriseDataStore;
    tenantId: string;
    nowIso: string;
    decidedBy: string;
  },
): void {
  request.fulfillmentMode = "approve_and_provision";
  try {
    const receipt = provisionMcpToolMappingApproval({
      store: params.store,
      tenantId: params.tenantId,
      request,
      nowIso: params.nowIso,
    });
    request.fulfillmentStatus = "fulfilled";
    request.fulfilledAt = params.nowIso;
    request.fulfilledBy = params.decidedBy;
    request.provisionReceipt = receipt;
    delete request.provisionError;
  } catch (error) {
    request.fulfillmentStatus = "failed";
    delete request.fulfilledAt;
    delete request.fulfilledBy;
    request.provisionError = describeGovernanceProvisionFailure(error);
  }
}

export function decideGovernanceApprovalRequest(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  approvalId: string;
  decision: "approved" | "rejected";
  decidedBy: string;
  decisionNote?: string;
  nowIso: string;
  fulfillmentMode?: GovernanceApprovalFulfillmentMode;
}): GovernanceApprovalRequest {
  const request = findGovernanceApprovalRequest(params.store, params.tenantId, params.approvalId);
  if (!request) {
    throw new EnterpriseDataStoreError(
      "GOVERNANCE_APPROVAL_NOT_FOUND",
      "Governance approval request not found.",
    );
  }
  const retryProvision =
    request.status === "approved" &&
    request.fulfillmentMode === "approve_and_provision" &&
    request.fulfillmentStatus === "failed" &&
    params.decision === "approved" &&
    params.fulfillmentMode === "approve_and_provision";
  if (retryProvision) {
    // Decision stays. Only the provision attempt is repeated.
    applyExplicitMcpProvision(request, params);
    return request;
  }

  if (request.status !== "pending") {
    throw new EnterpriseDataStoreError(
      "GOVERNANCE_APPROVAL_NOT_PENDING",
      "Only pending governance approvals can be decided.",
    );
  }
  if (
    params.decision === "approved" &&
    params.fulfillmentMode === "approve_and_provision" &&
    INTENT_ONLY_ON_APPROVE.has(request.category) &&
    !PROVISION_ON_DECIDE.has(request.category)
  ) {
    // TODO: oi_enrollment stays intent-only until an existing authorize API can
    // run without writing credentials. pack_skill_review stays intent-only plus
    // the explicit fulfill mark; decide must not install the skill.
    throw new EnterpriseDataStoreError(
      "GOVERNANCE_APPROVAL_PROVISION_UNSUPPORTED",
      "approve_and_provision is only supported for mcp_tool_mapping. Use approve_intent_only for this category.",
    );
  }
  request.reviewState = "in_review";
  request.status = params.decision === "approved" ? "approved" : "rejected";
  request.decidedAt = params.nowIso;
  request.decidedBy = params.decidedBy;
  request.decisionNote = params.decisionNote;
  if (params.decision !== "approved") {
    return request;
  }

  if (INTENT_ONLY_ON_APPROVE.has(request.category)) {
    if (params.fulfillmentMode === "approve_and_provision") {
      request.fulfillmentMode = "approve_and_provision";
      applyExplicitMcpProvision(request, params);
      return request;
    }
    // Explicit intent only: never call mcp-mapping.upsert / grants / OI authorize here.
    request.fulfillmentMode = "approve_intent_only";
    request.fulfillmentStatus = "pending_admin_save";
    return request;
  }

  applyGovernanceApprovalEffect({
    store: params.store,
    tenantId: params.tenantId,
    request,
    nowIso: params.nowIso,
  });
  return request;
}

export function resolveGovernanceApprovalCenterOverview(params: {
  store: EnterpriseDataStore;
  tenantId: string;
}): GovernanceApprovalCenterOverview {
  const pending = listGovernanceApprovalRequests({
    store: params.store,
    tenantId: params.tenantId,
    status: "pending",
  });
  const pendingByCategory: GovernanceApprovalCenterOverview["pendingByCategory"] = {
    source_onboarding: 0,
    data_access: 0,
    capability_exposure: 0,
    identity_binding: 0,
    seat_capability_access: 0,
    enterprise_knowledge_access: 0,
    mcp_tool_mapping: 0,
    oi_enrollment: 0,
    pack_skill_review: 0,
  };
  for (const request of pending) {
    pendingByCategory[request.category] += 1;
  }
  return {
    pendingByCategory,
    recentPending: pending.slice(0, 10),
    totalPending: pending.length,
  };
}
