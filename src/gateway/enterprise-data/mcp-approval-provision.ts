/**
 * Explicit admin provision for an approved mcp_tool_mapping request.
 *
 * Called only from decide when the admin selects approve_and_provision.
 * Uses upsertMcpToolMapping and grantDataCapabilityToSeat. Does not touch
 * billing packages. Seat id comes from the approval record, never from the
 * decide payload or subjectPayload.seatId.
 *
 * oi_enrollment and pack_skill_review stay out of this path: OI authorize would
 * write credentials (design §5.4 forbids that), and pack fulfill is an explicit
 * unlock mark rather than an install.
 */
import { grantDataCapabilityToSeat } from "../knowledge/seat-capability-access.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { suggestMcpCapabilityKey, upsertMcpToolMapping } from "./mcp-mapping.js";
import { findSeatActionGrant } from "./seat-action-grant-store.js";
import type {
  EnterpriseDataStore,
  GovernanceApprovalProvisionReceipt,
  GovernanceApprovalRequest,
} from "./types.js";

const GRANT_DESIRED_EFFECTS = new Set(["grant_only", "mapped_pending_grant", "grant"]);

function readPayloadString(payload: Record<string, unknown> | undefined, key: string): string {
  const value = payload?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function parseMcpSubject(subjectId: string): { mcpServer: string; mcpTool: string } | null {
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

/** Seat grant is required when the frozen subject says the tool still needs one. */
export function mcpApprovalNeedsSeatGrant(request: GovernanceApprovalRequest): boolean {
  const payload = request.subjectPayload;
  const desired = readPayloadString(payload, "desiredEffect");
  if (GRANT_DESIRED_EFFECTS.has(desired)) {
    return true;
  }
  return readPayloadString(payload, "discoveryStatusSnapshot") === "mapped_pending_grant";
}

export function describeGovernanceProvisionFailure(error: unknown): string {
  if (error instanceof EnterpriseDataStoreError) {
    if (error.code === "GOVERNANCE_APPROVAL_SEAT_REQUIRED") {
      return "申请单没有席位，无法授予能力。";
    }
    if (error.code === "GOVERNANCE_APPROVAL_INVALID_SUBJECT") {
      return "申请主题无法解析为 MCP 工具，开通未执行。";
    }
    if (error.code === "DATA_CAPABILITY_NOT_FOUND" || error.code === "DATA_CAPABILITY_DISABLED") {
      return "能力尚未就绪，席位授权未写入。";
    }
    if (error.code === "DATA_CAPABILITY_KEY_CONFLICT") {
      return "同名能力已存在，开通未完成。请稍后重试。";
    }
  }
  return "开通未完成，请稍后重试。";
}

/**
 * Upsert the MCP mapping, then grant the requester seat when the subject needs it.
 * Throws on failure so the caller can keep status=approved and fulfillmentStatus=failed.
 */
export function provisionMcpToolMappingApproval(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  request: GovernanceApprovalRequest;
  nowIso: string;
}): GovernanceApprovalProvisionReceipt {
  if (params.request.category !== "mcp_tool_mapping") {
    throw new EnterpriseDataStoreError(
      "GOVERNANCE_APPROVAL_PROVISION_UNSUPPORTED",
      "approve_and_provision is only supported for mcp_tool_mapping.",
    );
  }
  const parsed =
    parseMcpSubject(params.request.subjectId) ??
    (readPayloadString(params.request.subjectPayload, "mcpServer") &&
    readPayloadString(params.request.subjectPayload, "mcpTool")
      ? {
          mcpServer: readPayloadString(params.request.subjectPayload, "mcpServer"),
          mcpTool: readPayloadString(params.request.subjectPayload, "mcpTool"),
        }
      : null);
  if (!parsed) {
    throw new EnterpriseDataStoreError(
      "GOVERNANCE_APPROVAL_INVALID_SUBJECT",
      "mcp_tool_mapping subject is missing server or tool.",
    );
  }

  const capabilityKey = suggestMcpCapabilityKey(parsed.mcpServer, parsed.mcpTool);
  const existingCapability = Object.values(params.store.dataCapabilities).find(
    (capability) =>
      capability.tenantId === params.tenantId && capability.capabilityKey === capabilityKey,
  );
  const mapped = upsertMcpToolMapping({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    input: {
      mcpServer: parsed.mcpServer,
      mcpTool: parsed.mcpTool,
      displayName: params.request.displayName,
      ...(existingCapability ? { capabilityId: existingCapability.capabilityId } : {}),
    },
    createdBy: params.request.decidedBy,
  });

  const receipt: GovernanceApprovalProvisionReceipt = {
    handlerRef: mapped.handlerRef,
    capabilityId: mapped.capability.capabilityId,
  };

  if (!mcpApprovalNeedsSeatGrant(params.request)) {
    return receipt;
  }

  const seatId = params.request.requesterSeatId?.trim() ?? "";
  if (!seatId) {
    throw new EnterpriseDataStoreError(
      "GOVERNANCE_APPROVAL_SEAT_REQUIRED",
      "requesterSeatId is required to grant the mapped capability.",
    );
  }
  grantDataCapabilityToSeat({
    store: params.store,
    tenantId: params.tenantId,
    seatId,
    capabilityId: mapped.capability.capabilityId,
    nowIso: params.nowIso,
  });
  const grant = findSeatActionGrant(params.store, params.tenantId, seatId, {
    connectorId: mapped.action.connectorId,
    actionKey: mapped.action.actionKey,
    version: mapped.action.version,
  });
  if (grant?.grantId) {
    receipt.grantId = grant.grantId;
  }
  return receipt;
}
