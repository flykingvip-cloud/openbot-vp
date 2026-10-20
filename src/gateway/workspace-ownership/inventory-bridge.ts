import type { WorkspaceInventoryRecord } from "../workspace-inventory/types.js";
import {
  classifyWorkspaceAgentAsset,
  classifyWorkspaceGroup,
  classifyWorkspaceLegacyAgent,
  type TrustedWorkspaceClassificationContext,
  type WorkspaceOwnerScope,
} from "./index.js";

export function classifyInventoryRecord(params: {
  record: WorkspaceInventoryRecord;
  context: TrustedWorkspaceClassificationContext;
}): WorkspaceOwnerScope {
  const { record, context } = params;
  if (record.groupId) {
    return classifyWorkspaceGroup({
      context: {
        ...context,
        groupAcl: context.groupAcl ?? {
          tenantId: context.trusted.tenantId,
          groupId: record.groupId,
          memberUserIds: [context.trusted.userId],
          available: true,
        },
      },
      groupId: record.groupId,
    });
  }
  if (record.agentAssetId) {
    return classifyWorkspaceAgentAsset({
      context,
      agentAssetId: record.agentAssetId,
    });
  }
  if (record.agentId) {
    return classifyWorkspaceLegacyAgent({
      context,
      agentId: record.agentId,
    });
  }
  return { kind: "unknown", reason: "insufficient_inventory_evidence" };
}

export function mapInventoryOwnershipStatus(
  scope: WorkspaceOwnerScope,
): WorkspaceInventoryRecord["ownershipStatus"] {
  if (scope.kind === "unknown") {
    return "unknown";
  }
  return "proved";
}
