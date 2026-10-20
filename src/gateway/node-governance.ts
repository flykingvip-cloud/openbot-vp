import { listDevicePairing } from "../infra/device-pairing.js";
import {
  isGovernanceActionAllowed,
  type GovernanceAction,
  type GovernanceSubject,
} from "./governance-policy.js";
import { auditManagementDecision } from "./management-governance-audit.js";
import { getManagementNodeOwnership } from "./management-governance-ownership.js";
import { resolveQueryScope, type QueryScope, type RecordOwnership } from "./scope-attribution.js";
import type { GatewayClient } from "./server-methods/types.js";

export type NodeGovernanceDecision = {
  allowed: boolean;
  scope: QueryScope;
  ownership: RecordOwnership;
  reason?: "outside-governance-scope" | "node-ownership-unattributed";
};

function governanceSubjectForScope(scope: QueryScope): GovernanceSubject {
  if (scope.kind === "platform") {
    return { role: "platform-admin" };
  }
  if (scope.kind === "tenant") {
    return { role: "tenant-admin", tenantId: scope.tenantId };
  }
  if (scope.kind === "self") {
    return { role: "employee-supervisor", userId: scope.ownerId };
  }
  return { role: "employee-supervisor", userId: "unknown" };
}

export async function resolveNodeOwnership(nodeId: string): Promise<RecordOwnership> {
  const normalized = nodeId.trim();
  const assigned = await getManagementNodeOwnership(normalized);
  if (assigned) {
    return assigned;
  }
  const devices = await listDevicePairing();
  const device = devices.paired.find((entry) => entry.deviceId === normalized);
  if (device?.ownerId) {
    return { ownerId: device.ownerId };
  }
  return {};
}

export async function authorizeNodeGovernance(params: {
  client: GatewayClient | null;
  nodeId: string;
  action: GovernanceAction;
  audit?: boolean;
}): Promise<NodeGovernanceDecision> {
  const scope = await resolveQueryScope(params.client);
  // Platform governance may operate legacy nodes, but known ownership must still be
  // resolved so tenant/self audit views can see platform actions on their assets.
  const ownership = await resolveNodeOwnership(params.nodeId);
  const attributed = Boolean(ownership.tenantId || ownership.ownerId);
  const allowed = isGovernanceActionAllowed(governanceSubjectForScope(scope), params.action, {
    kind: "device",
    tenantId: ownership.tenantId,
    ownerUserId: ownership.ownerId,
    deviceId: params.nodeId,
  });
  const reason = allowed
    ? undefined
    : attributed
      ? "outside-governance-scope"
      : "node-ownership-unattributed";
  if (params.audit !== false) {
    await auditManagementDecision({
      client: params.client,
      scope,
      action: params.action,
      target: {
        kind: "device",
        resourceId: params.nodeId,
        ...(ownership.tenantId ? { tenantId: ownership.tenantId } : {}),
        ...(ownership.ownerId ? { ownerUserId: ownership.ownerId } : {}),
      },
      effect: allowed ? "allowed" : "denied",
      ...(reason ? { reason } : {}),
    });
  }
  return { allowed, scope, ownership, ...(reason ? { reason } : {}) };
}
