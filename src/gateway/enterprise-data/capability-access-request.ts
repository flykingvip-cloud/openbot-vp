/**
 * Capability-access requests (cn-office / Stage C) layered on governance-approval-store.
 *
 * Employees create mcp_tool_mapping / oi_enrollment / pack_skill_review.
 * Admin decide defaults to approve_intent_only (no silent mcp-mapping.upsert / grant).
 * mcp_tool_mapping may use approve_and_provision inside the same admin decide.
 * OI and pack stay intent-only. Intent-only fulfillment is explicit EDC Save or fulfill.
 */
import { getPackById } from "../capability-packs/starter-packs.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import {
  createGovernanceApprovalRequest,
  findGovernanceApprovalRequest,
} from "./governance-approval-store.js";
import type {
  EnterpriseDataStore,
  GovernanceApprovalCategory,
  GovernanceApprovalFulfillmentMode,
  GovernanceApprovalProvisionReceipt,
  GovernanceApprovalRequest,
} from "./types.js";

export const EMPLOYEE_CREATABLE_GOVERNANCE_CATEGORIES = new Set<GovernanceApprovalCategory>([
  "mcp_tool_mapping",
  "oi_enrollment",
  "pack_skill_review",
]);

export const CAPABILITY_ACCESS_INTENT_ONLY_CATEGORIES = EMPLOYEE_CREATABLE_GOVERNANCE_CATEGORIES;

export const ALL_GOVERNANCE_APPROVAL_CATEGORIES = new Set<GovernanceApprovalCategory>([
  "source_onboarding",
  "data_access",
  "capability_exposure",
  "identity_binding",
  "seat_capability_access",
  "enterprise_knowledge_access",
  "mcp_tool_mapping",
  "oi_enrollment",
  "pack_skill_review",
]);

export function isEmployeeCreatableGovernanceCategory(
  category: string,
): category is GovernanceApprovalCategory {
  return EMPLOYEE_CREATABLE_GOVERNANCE_CATEGORIES.has(category as GovernanceApprovalCategory);
}

export function buildMcpToolMappingSubjectId(mcpServer: string, mcpTool: string): string {
  const server = mcpServer.trim();
  const tool = mcpTool.trim();
  if (!server || !tool) {
    throw new EnterpriseDataStoreError(
      "GOVERNANCE_APPROVAL_INVALID_SUBJECT",
      "mcpServer and mcpTool are required for mcp_tool_mapping.",
    );
  }
  return `mcp:${encodeURIComponent(server)}/${encodeURIComponent(tool)}`;
}

export function parseMcpToolMappingSubjectId(
  subjectId: string,
): { mcpServer: string; mcpTool: string } | null {
  if (!subjectId.startsWith("mcp:")) {
    return null;
  }
  const payload = subjectId.slice("mcp:".length);
  const slash = payload.indexOf("/");
  if (slash <= 0) {
    return null;
  }
  try {
    const mcpServer = decodeURIComponent(payload.slice(0, slash));
    const mcpTool = decodeURIComponent(payload.slice(slash + 1));
    if (!mcpServer || !mcpTool) {
      return null;
    }
    return { mcpServer, mcpTool };
  } catch {
    return null;
  }
}

export function buildOiEnrollmentSubjectId(params: {
  identityScope: "personal" | "enterprise";
  identityId: string;
  targetAgentId: string;
}): string {
  const identityId = params.identityId.trim();
  const agentId = params.targetAgentId.trim();
  if (!identityId || !agentId) {
    throw new EnterpriseDataStoreError(
      "GOVERNANCE_APPROVAL_INVALID_SUBJECT",
      "identityId and targetAgentId are required for oi_enrollment.",
    );
  }
  if (params.identityScope === "enterprise") {
    return `oi:enterprise:${identityId}:agent:${agentId}`;
  }
  return `oi:personal:${identityId}:agent:${agentId}`;
}

export function buildPackSkillReviewSubjectId(params: {
  packId: string;
  skillKey: string;
  targetRobotId: string;
}): string {
  const packId = params.packId.trim();
  const skillKey = params.skillKey.trim();
  const robotId = params.targetRobotId.trim();
  if (!packId || !skillKey || !robotId) {
    throw new EnterpriseDataStoreError(
      "GOVERNANCE_APPROVAL_INVALID_SUBJECT",
      "packId, skillKey, and targetRobotId are required for pack_skill_review.",
    );
  }
  return `pack:${packId}:skill:${skillKey}:robot:${robotId}`;
}

export type CapabilityAccessCreateInput = {
  store: EnterpriseDataStore;
  tenantId: string;
  category: "mcp_tool_mapping" | "oi_enrollment" | "pack_skill_review";
  requestedBy: string;
  nowIso: string;
  reason?: string;
  requesterSeatId?: string;
  clientRequestId?: string;
  catalogId?: string;
  templateId?: string;
  // MCP
  mcpServer?: string;
  mcpTool?: string;
  discoveryStatusSnapshot?: "unmapped" | "mapped_pending_grant" | "authorized";
  // OI
  identityScope?: "personal" | "enterprise";
  identityId?: string;
  targetAgentId?: string;
  // Pack
  packId?: string;
  skillKey?: string;
  targetRobotId?: string;
};

function findByClientRequestId(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  requestedBy: string;
  clientRequestId: string;
}): GovernanceApprovalRequest | null {
  const key = params.clientRequestId.trim();
  if (!key) {
    return null;
  }
  return (
    Object.values(params.store.governanceApprovalRequests).find(
      (request) =>
        request.tenantId === params.tenantId &&
        request.requestedBy === params.requestedBy &&
        request.clientRequestId === key,
    ) ?? null
  );
}

/**
 * Create a capability-access governance request (status=pending, reviewState=submitted).
 * Does not write mcp-mapping / grants / OI credentials.
 */
export function createCapabilityAccessRequest(
  params: CapabilityAccessCreateInput,
): GovernanceApprovalRequest {
  if (params.clientRequestId?.trim()) {
    const existing = findByClientRequestId({
      store: params.store,
      tenantId: params.tenantId,
      requestedBy: params.requestedBy,
      clientRequestId: params.clientRequestId,
    });
    if (existing) {
      return existing;
    }
  }

  let subjectId: string;
  let displayName: string;
  let subjectPayload: Record<string, unknown>;

  if (params.category === "mcp_tool_mapping") {
    const mcpServer = params.mcpServer?.trim() ?? "";
    const mcpTool = params.mcpTool?.trim() ?? "";
    subjectId = buildMcpToolMappingSubjectId(mcpServer, mcpTool);
    displayName = `${mcpServer} / ${mcpTool}`;
    subjectPayload = {
      mcpServer,
      mcpTool,
      ...(params.discoveryStatusSnapshot
        ? { discoveryStatusSnapshot: params.discoveryStatusSnapshot }
        : {}),
      ...(params.catalogId ? { catalogId: params.catalogId } : {}),
      ...(params.templateId ? { templateId: params.templateId } : {}),
    };
  } else if (params.category === "oi_enrollment") {
    const identityScope = params.identityScope ?? "enterprise";
    const identityId = params.identityId?.trim() ?? "";
    const targetAgentId = params.targetAgentId?.trim() ?? "";
    subjectId = buildOiEnrollmentSubjectId({ identityScope, identityId, targetAgentId });
    displayName =
      identityScope === "enterprise" ? `企业 OI ${identityId}` : `个人 OI ${identityId}`;
    subjectPayload = {
      identityScope,
      identityId,
      targetAgentId,
      ...(params.catalogId ? { catalogId: params.catalogId } : {}),
      ...(params.templateId ? { templateId: params.templateId } : {}),
    };
  } else {
    const packId = params.packId?.trim() ?? "";
    const skillKey = params.skillKey?.trim() ?? "";
    const targetRobotId = params.targetRobotId?.trim() ?? "";
    subjectId = buildPackSkillReviewSubjectId({ packId, skillKey, targetRobotId });
    displayName = `${packId}:${skillKey}`;
    const pack = getPackById(packId);
    const reviewRequired =
      pack?.employeeVisibilityMode === "enterprise_review_required" || packId === "cn-office";
    subjectPayload = {
      packId,
      skillKey,
      targetRobotId,
      // Entitle ≠ employee-usable. Snapshot the review mark for audit.
      ...(reviewRequired ? { employeeVisibilityMode: "enterprise_review_required" as const } : {}),
      ...(params.catalogId ? { catalogId: params.catalogId } : {}),
      ...(params.templateId ? { templateId: params.templateId } : {}),
    };
  }

  return createGovernanceApprovalRequest({
    store: params.store,
    tenantId: params.tenantId,
    category: params.category,
    subjectId,
    requestedBy: params.requestedBy,
    reason: params.reason,
    nowIso: params.nowIso,
    requesterSeatId: params.requesterSeatId,
    displayName,
    subjectPayload,
    clientRequestId: params.clientRequestId?.trim() || undefined,
    catalogId: params.catalogId?.trim() || undefined,
    templateId: params.templateId?.trim() || undefined,
    reviewState: "submitted",
    fulfillmentStatus: "not_required",
    duplicateScope: "per_requester",
  });
}

export function cancelGovernanceApprovalRequest(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  approvalId: string;
  actorId: string;
  /** When false, actor must be requestedBy. */
  asAdmin: boolean;
  nowIso: string;
  decisionNote?: string;
}): GovernanceApprovalRequest {
  const request = findGovernanceApprovalRequest(params.store, params.tenantId, params.approvalId);
  if (!request) {
    throw new EnterpriseDataStoreError(
      "GOVERNANCE_APPROVAL_NOT_FOUND",
      "Governance approval request not found.",
    );
  }
  if (request.status !== "pending") {
    throw new EnterpriseDataStoreError(
      "GOVERNANCE_APPROVAL_NOT_PENDING",
      "Only pending governance approvals can be cancelled.",
    );
  }
  if (!params.asAdmin && request.requestedBy !== params.actorId) {
    throw new EnterpriseDataStoreError(
      "GOVERNANCE_APPROVAL_FORBIDDEN",
      "Only the requester or an enterprise admin can cancel this approval.",
    );
  }
  request.status = "cancelled";
  request.decidedAt = params.nowIso;
  request.decidedBy = params.actorId;
  request.decisionNote = params.decisionNote ?? "cancelled";
  return request;
}

export function fulfillGovernanceApprovalRequest(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  approvalId: string;
  fulfilledBy: string;
  nowIso: string;
  provisionReceipt?: GovernanceApprovalProvisionReceipt;
}): GovernanceApprovalRequest {
  const request = findGovernanceApprovalRequest(params.store, params.tenantId, params.approvalId);
  if (!request) {
    throw new EnterpriseDataStoreError(
      "GOVERNANCE_APPROVAL_NOT_FOUND",
      "Governance approval request not found.",
    );
  }
  if (request.status !== "approved") {
    throw new EnterpriseDataStoreError(
      "GOVERNANCE_APPROVAL_NOT_APPROVED",
      "Only approved requests can be marked fulfilled.",
    );
  }
  if (
    request.fulfillmentStatus !== "pending_admin_save" &&
    request.fulfillmentStatus !== "failed"
  ) {
    throw new EnterpriseDataStoreError(
      "GOVERNANCE_APPROVAL_NOT_PENDING_FULFILLMENT",
      "Request is not awaiting admin Save fulfillment.",
    );
  }
  request.fulfillmentStatus = "fulfilled";
  request.fulfilledAt = params.nowIso;
  request.fulfilledBy = params.fulfilledBy;
  if (params.provisionReceipt) {
    request.provisionReceipt = { ...params.provisionReceipt };
  }
  return request;
}

export function resolveDefaultFulfillmentMode(
  category: GovernanceApprovalCategory,
  requested?: GovernanceApprovalFulfillmentMode,
): GovernanceApprovalFulfillmentMode | undefined {
  if (!CAPABILITY_ACCESS_INTENT_ONLY_CATEGORIES.has(category)) {
    return undefined;
  }
  if (requested === "approve_and_provision") {
    if (category === "mcp_tool_mapping") {
      return "approve_and_provision";
    }
    throw new EnterpriseDataStoreError(
      "GOVERNANCE_APPROVAL_PROVISION_UNSUPPORTED",
      "approve_and_provision is only supported for mcp_tool_mapping. Use approve_intent_only for this category.",
    );
  }
  return "approve_intent_only";
}

/** Build EDC deeplink query fragment for an approved mcp_tool_mapping request. */
export function buildMcpMappingFulfillmentDeeplinkQuery(
  request: GovernanceApprovalRequest,
): string | null {
  if (request.category !== "mcp_tool_mapping") {
    return null;
  }
  const parsed =
    parseMcpToolMappingSubjectId(request.subjectId) ??
    (typeof request.subjectPayload?.mcpServer === "string" &&
    typeof request.subjectPayload?.mcpTool === "string"
      ? {
          mcpServer: request.subjectPayload.mcpServer,
          mcpTool: request.subjectPayload.mcpTool,
        }
      : null);
  if (!parsed) {
    return null;
  }
  const search = new URLSearchParams();
  search.set("mcpServer", parsed.mcpServer);
  search.set("mcpTool", parsed.mcpTool);
  search.set("requestId", request.approvalId);
  search.set("capabilityAccessRequestId", request.approvalId);
  return search.toString();
}
